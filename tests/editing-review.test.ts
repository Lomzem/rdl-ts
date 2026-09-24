import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import {
  analyze,
  apply,
  findInstance,
  handle,
  instanceHandle,
  open,
  prepare,
  serialize,
  source,
} from "../src/index.js";
import type { EditCommand, ProjectInput, ProjectSnapshot, SyntaxNode } from "../src/types.js";
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
function success<A, E>(value: Result.Result<A, E>): A {
  if (Result.isFailure(value)) throw new Error(JSON.stringify(value.failure));
  return value.success;
}
const input = (text: string): ProjectInput => ({
  files: [{ id: "main", text }],
  configurations: [{ id: "default", roots: ["main"] }],
});
const project = (text: string) => success(open(input(text)));
const all = (items: readonly SyntaxNode[]): SyntaxNode[] =>
  items.flatMap((n) => [n, ...all(n.children ?? []), ...all(n.instances ?? [])]);
function target(p: ProjectSnapshot, name: string, kind?: SyntaxNode["kind"]) {
  const node = all(source(p).documents[0]!.nodes).find(
    (n) => n.name === name && (!kind || n.kind === kind),
  );
  expect(node).toBeDefined();
  return success(handle(p, node!));
}
async function edit(p: ProjectSnapshot, commands: readonly EditCommand[], configured = false) {
  return run(
    prepare(
      p,
      commands,
      configured ? { mode: "configured", configurations: ["default"] } : { mode: "sourceOnly" },
    ),
  );
}
const register = "reg R { field { sw=rw; hw=r; } f[7:0]; };\n";

test("runtime input arrays/null cannot masquerade as maps or limits", () => {
  for (const malformed of [
    { configurations: [{ id: "x", roots: [], macros: [] }] },
    { configurations: [{ id: "x", roots: [], parameters: null }] },
    { limits: [] },
    { limits: null },
    { properties: [{ name: "x", type: "string", origin: "x", components: ["nope"] }] },
  ]) {
    expect(Result.isFailure(open({ ...input(""), ...malformed } as unknown as ProjectInput))).toBe(
      true,
    );
  }
});
test("source handles cannot be fabricated by copying public fields", async () => {
  const p = project(register + "addrmap top { R a; };");
  const original = target(p, "a", "instance");
  const result = await run(
    Effect.result(
      prepare(p, [{ kind: "delete", target: { ...original } }], { mode: "sourceOnly" }),
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
});
test("malformed public commands produce failure values", async () => {
  const p = project(register + "addrmap top { R a; };");
  for (const command of [
    { kind: "setInstanceProperty" },
    { kind: "declareProperty", documentId: "main" },
    { kind: "createDocument", documentId: "new", components: {} },
    {
      kind: "insertComponent",
      documentId: "main",
      component: { kind: "reg", name: "Z", children: {} },
    },
  ]) {
    const result = await run(
      Effect.result(prepare(p, [command as unknown as EditCommand], { mode: "sourceOnly" })),
    );
    expect(Result.isFailure(result)).toBe(true);
  }
});
test.each(["type", "default", "components"])(
  "UDP %s cannot inject additional assignments",
  async (slot) => {
    const p = project("");
    const property = {
      name: "p",
      type: "longint unsigned",
      origin: "test",
      components: ["field"],
      default: "1",
      ...{
        type: { type: "longint unsigned; default=3" },
        default: { default: "1; component=all" },
        components: { components: ["field; default=3"] },
      }[slot],
    };
    const result = await run(
      Effect.result(
        prepare(
          p,
          [{ kind: "declareProperty", documentId: "main", property } as unknown as EditCommand],
          { mode: "sourceOnly" },
        ),
      ),
    );
    expect(Result.isFailure(result)).toBe(true);
  },
);
test.each(["a", "b"])(
  "deleting %s from an explicit comma instance list preserves valid statement",
  async (name) => {
    const p = project(register + "addrmap top { R a, b; };");
    const c = await edit(p, [{ kind: "delete", target: target(p, name, "instance") }]);
    const next = success(apply(p, c, "draft"));
    expect(source(next).documents[0]!.diagnostics).toEqual([]);
    expect(serialize(next)[0]!.text).toContain(name === "a" ? "R b;" : "R a;");
  },
);
test("deleting a sole anonymous inline instance removes its declaration", async () => {
  const p = project("addrmap top { reg { /* preserved */ field {} f; } a; };");
  const c = await edit(p, [{ kind: "delete", target: target(p, "a", "instance") }]);
  const next = success(apply(p, c, "draft"));
  expect(source(next).documents[0]!.diagnostics).toEqual([]);
  expect(serialize(next)[0]!.text).toContain("/* preserved */");
  expect(serialize(next)[0]!.text).not.toContain("reg {");
});
test("deleting a sole named inline instance retains its named definition", async () => {
  const p = project("addrmap top { reg R { field {} f; } a; };");
  const c = await edit(p, [{ kind: "delete", target: target(p, "a", "instance") }]);
  const next = success(apply(p, c, "draft"));
  expect(source(next).documents[0]!.diagnostics).toEqual([]);
  expect(serialize(next)[0]!.text).toContain("reg R");
});
test.each([
  ["addrmap top { reg { field {} f; } a; };", "a"],
  [register + "addrmap top { R a,b; };", "b"],
])("duplicates instance suffixes as comma entries", async (text, name) => {
  const p = project(text);
  const c = await edit(p, [
    { kind: "duplicate", target: target(p, name, "instance"), name: "copy" },
  ]);
  const next = success(apply(p, c, "draft"));
  expect(source(next).documents[0]!.diagnostics).toEqual([]);
  expect(
    all(source(next).documents[0]!.nodes)
      .filter((n) => n.kind === "instance")
      .map((n) => n.name),
  ).toContain("copy");
});
test("duplicate omits copied comments and keeps existing comments once", async () => {
  const p = project("addrmap top { reg R { /* once */ field {} f; }; };");
  const c = await edit(p, [{ kind: "duplicate", target: target(p, "R", "component"), name: "S" }]);
  expect(serialize(success(apply(p, c, "draft")))[0]!.text.match(/\/\* once \*\//g)).toHaveLength(
    1,
  );
});
test("rename reports previous identity with complete layout comparison", async () => {
  const p = project(register + "addrmap top { R a; };");
  const c = await edit(
    p,
    [{ kind: "rename", target: target(p, "a", "instance"), name: "b" }],
    true,
  );
  expect(c.comparisonCoverage).toEqual({ complete: true, reasons: [] });
  expect(c.layoutChanges.find((x) => x.path === "top.b")?.previousPath).toBe("top.a");
  expect(c.layoutChanges.find((x) => x.path === "top.b")?.before?.address).toBe(0n);
  expect(c.layoutChanges.find((x) => x.path === "top.b")?.after?.address).toBe(0n);
});
test("delete and recreate the same path reports removal and addition separately", async () => {
  const p = project("addrmap top { reg { field {} f; } a; };");
  const c = await edit(
    p,
    [
      { kind: "delete", target: target(p, "a", "instance") },
      {
        kind: "insertComponent",
        documentId: "main",
        parent: target(p, "top", "component"),
        component: { kind: "reg", instance: "a", children: [{ kind: "field", instance: "f" }] },
      },
    ],
    true,
  );
  expect(c.comparisonCoverage.complete).toBe(true);
  const changes = c.layoutChanges.filter((x) => x.path === "top.a");
  expect(changes).toHaveLength(2);
  expect(changes.some((x) => x.before && !x.after)).toBe(true);
  expect(changes.some((x) => !x.before && x.after)).toBe(true);
});
test("partial rename discloses incomplete reference coverage", async () => {
  const p = project(register + "addrmap top { R a; };\n`ifdef OFF\nR hidden;\n`endif\n");
  const c = await edit(
    p,
    [{ kind: "rename", target: target(p, "R", "component"), name: "S", partial: true }],
    true,
  );
  expect(c.diagnostics.map((d) => d.code)).toContain("partial-rename");
  expect(c.comparisonCoverage.complete).toBe(false);
});
test("source-declared UDP can receive an instance-only assignment", async () => {
  const p = project(
    "property note { type=string; component=reg; };\n" + register + "addrmap top { R a,b; };",
  );
  const report = await run(analyze(p, "default"));
  const a = findInstance(report, "top.a")!;
  const c = await edit(
    p,
    [
      {
        kind: "setInstanceProperty",
        target: success(instanceHandle(report, a)),
        property: "note",
        expression: '"only a"',
      },
    ],
    true,
  );
  const next = success(apply(p, c));
  const after = await run(analyze(next, "default"));
  expect(findInstance(after, "top.a")!.properties.note!.value).toBe("only a");
  expect(findInstance(after, "top.b")!.properties.note?.value).toBeUndefined();
});
test("indexed navigation computes exact multidimensional offsets without expanding the array", async () => {
  const p = project("addrmap top { reg { field {} f; } bank[2][4] @ 0x100 += 0x10; };");
  const report = await run(analyze(p, "default"));
  const bank = findInstance(report, "top.bank")!;
  expect(bank.dimensions).toEqual([2n, 4n]);
  const cell = findInstance(report, "top.bank[1][3]")!;
  expect(cell.address).toBe(0x170n);
  expect(cell.dimensions).toEqual([]);
  expect(cell.path).toBe("top.bank[1][3]");
  expect(findInstance(report, "top.bank[1][3].f")!.path).toBe("top.bank[1][3].f");
  expect(bank.address).toBe(0x100n);
  expect(findInstance(report, "top.bank[2][0]")).toBeUndefined();
  expect(findInstance(report, "top.bank[1]")).toBeUndefined();
  expect(findInstance(report, "top.bank[-1][0]")).toBeUndefined();
  expect(Object.isFrozen(cell)).toBe(true);
});
test("a trailing expression line comment cannot consume existing statement suffixes", async () => {
  const p = project("addrmap top { reg { field { reset=0; } f; } a; };");
  const result = await run(
    Effect.result(
      prepare(
        p,
        [
          {
            kind: "replaceExpression",
            target: target(p, "reset", "assignment"),
            expression: "1 // hidden suffix",
          },
        ],
        { mode: "sourceOnly" },
      ),
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
  expect(serialize(p)[0]!.text).toContain("reset=0;");
});
test("duplicating a named definition does not duplicate its inline instances", async () => {
  const p = project("addrmap top { reg R { field {} f; } a,b; };");
  const c = await edit(p, [{ kind: "duplicate", target: target(p, "R", "component"), name: "S" }]);
  const next = success(apply(p, c, "draft"));
  expect(source(next).documents[0]!.diagnostics).toEqual([]);
  const declarations = all(source(next).documents[0]!.nodes);
  expect(declarations.find((n) => n.kind === "component" && n.name === "S")!.instances).toEqual([]);
  expect(declarations.filter((n) => n.kind === "instance" && n.name === "a")).toHaveLength(1);
});
test("indexed navigation adjusts nested array element addresses independently", async () => {
  const p = project(
    "addrmap top { regfile { reg { field {} f; } bank[2] @ 0x10 += 0x8; } group[3] @ 0x100 += 0x40; };",
  );
  const report = await run(analyze(p, "default"));
  expect(findInstance(report, "top.group[2].bank[1]")!.address).toBe(0x198n);
  expect(findInstance(report, "top.group.bank")!.address).toBe(0x110n);
});
