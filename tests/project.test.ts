import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { analyze, apply, handle, open, prepare, serialize, source } from "../src/index.js";
import type { ProjectSnapshot, SyntaxNode } from "../src/index.js";

const input = (text: string, writable = true) => ({
  files: [{ id: "main", text, writable }],
  configurations: [{ id: "default", roots: ["main"] }],
});
function value<A, E>(r: Result.Result<A, E>): A {
  if (Result.isFailure(r)) throw new Error(JSON.stringify(r.failure));
  return r.success;
}
const project = (text: string, writable = true) => value(open(input(text, writable)));
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
function all(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  return nodes.flatMap((n) => [n, ...all(n.children ?? []), ...all(n.instances ?? [])]);
}
function find(p: ProjectSnapshot, name: string, kind?: SyntaxNode["kind"]) {
  const n = all(source(p).documents[0]!.nodes).find(
    (n) => n.name === name && (!kind || n.kind === kind),
  );
  expect(n).toBeDefined();
  return value(handle(p, n!));
}
const rdl = `// keep\r\naddrmap top {\n    reg { field { sw = rw; hw = r; reset = 8'h00; } f[7:0]; } control; // tail\r\n};\n`;

describe("immutable source documents", () => {
  test("no-edit serialization is exact even for malformed text", () => {
    for (const text of [rdl, "addrmap broken { /* unterminated", "😀\r\n\n", ""]) {
      const p = project(text);
      expect(serialize(p)[0]!.text).toBe(text);
    }
  });
  test("input mutation cannot alter a snapshot", () => {
    const data = input(rdl);
    const p = value(open(data));
    data.files[0]!.text = "changed";
    data.configurations[0]!.roots.length = 0;
    expect(serialize(p)[0]!.text).toBe(rdl);
    expect(p.configurations[0]!.roots).toEqual(["main"]);
    expect(Object.isFrozen(p.files)).toBe(true);
  });
  test("duplicate inputs and invalid limits are failure values", () => {
    expect(
      Result.isFailure(
        open({
          ...input(rdl),
          files: [
            { id: "x", text: "" },
            { id: "x", text: "" },
          ],
        }),
      ),
    ).toBe(true);
    expect(Result.isFailure(open({ ...input(rdl), limits: { includeDepth: 1 } }))).toBe(true);
  });
});

describe("localized atomic editing", () => {
  test("changes only one literal and keeps previous snapshot", async () => {
    const p = project(rdl);
    const c = await run(
      prepare(
        p,
        [
          {
            kind: "replaceExpression",
            target: find(p, "reset", "assignment"),
            expression: "8'h01",
          },
        ],
        { mode: "sourceOnly" },
      ),
    );
    expect(Result.isFailure(apply(p, c))).toBe(true);
    const next = value(apply(p, c, "draft"));
    expect(serialize(next)[0]!.text).toBe(rdl.replace("8'h00", "8'h01"));
    expect(serialize(p)[0]!.text).toBe(rdl);
  });
  test("checked candidates validate the resulting source", async () => {
    const p = project(rdl);
    const report = await run(analyze(p, "default"));
    expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const c = await run(
      prepare(
        p,
        [
          {
            kind: "replaceExpression",
            target: find(p, "reset", "assignment"),
            expression: "8'h02",
          },
        ],
        { mode: "configured", configurations: ["default"] },
      ),
    );
    expect(Result.isSuccess(apply(p, c))).toBe(true);
  });
  test("stale and forged candidates fail even under draft policy", async () => {
    const p = project(rdl);
    const c = await run(prepare(p, [], { mode: "sourceOnly" }));
    expect(Result.isFailure(apply(project(rdl), c, "draft"))).toBe(true);
    expect(Result.isFailure(apply(p, { ...c }, "draft"))).toBe(true);
  });
  test("read-only edits and overlapping groups return failure values", async () => {
    const p = project(rdl, false);
    const outcome = await run(
      Effect.result(
        prepare(p, [{ kind: "delete", target: find(p, "top") }], { mode: "sourceOnly" }),
      ),
    );
    expect(Result.isFailure(outcome)).toBe(true);
    expect(serialize(p)[0]!.text).toBe(rdl);
    const writable = project(rdl);
    const h = find(writable, "reset", "assignment");
    expect(
      Result.isFailure(
        await run(
          Effect.result(
            prepare(
              writable,
              [
                { kind: "replaceExpression", target: h, expression: "1" },
                { kind: "replaceExpression", target: h, expression: "2" },
              ],
              { mode: "sourceOnly" },
            ),
          ),
        ),
      ),
    ).toBe(true);
  });
  test("statement injection into an expression is rejected", async () => {
    const p = project(rdl);
    expect(
      Result.isFailure(
        await run(
          Effect.result(
            prepare(
              p,
              [
                {
                  kind: "replaceExpression",
                  target: find(p, "reset", "assignment"),
                  expression: "1; sw = w",
                },
              ],
              { mode: "sourceOnly" },
            ),
          ),
        ),
      ),
    ).toBe(true);
  });
  test("creates a new document with structured components", async () => {
    const p = value(open({ files: [], configurations: [{ id: "default", roots: [] }] }));
    const c = await run(
      prepare(
        p,
        [
          {
            kind: "createDocument",
            documentId: "new",
            roots: ["default"],
            components: [
              {
                kind: "addrmap",
                name: "top",
                children: [
                  {
                    kind: "reg",
                    instance: "control",
                    children: [
                      {
                        kind: "field",
                        instance: "enable",
                        range: { msb: "7", lsb: "0" },
                        properties: { sw: "rw", hw: "r" },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
        { mode: "configured", configurations: ["default"] },
      ),
    );
    const next = value(apply(p, c));
    expect(serialize(next)[0]!.text).toContain("addrmap top");
    expect(serialize(p)).toEqual([]);
  });
  test("deletion retains comments inside and adjacent to a declaration", async () => {
    const text = "// before\naddrmap top { /* inside */ reg { field {} f; } rr; }; // after\n";
    const p = project(text);
    const c = await run(
      prepare(p, [{ kind: "delete", target: find(p, "top") }], { mode: "sourceOnly" }),
    );
    const next = value(apply(p, c, "draft"));
    const saved = serialize(next)[0]!.text;
    for (const comment of ["// before", "/* inside */", "// after"])
      expect(saved).toContain(comment);
  });
});

test("parameter default and named argument replacement preserve surrounding text", async () => {
  const text =
    "reg word #(longint unsigned WIDTH = 8) { field {} f[WIDTH-1:0]; };\naddrmap top { word #(.WIDTH(16)) rr; };\n";
  const snapshot = project(text);
  const candidate = await run(
    prepare(
      snapshot,
      [
        {
          kind: "replaceExpression",
          target: find(snapshot, "word", "component"),
          slot: { parameter: "WIDTH" },
          expression: "12",
        },
        {
          kind: "replaceExpression",
          target: find(snapshot, "rr", "instance"),
          slot: { argument: "WIDTH" },
          expression: "24",
        },
      ],
      { mode: "configured", configurations: ["default"] },
    ),
  );
  const next = value(apply(snapshot, candidate));
  expect(serialize(next)[0]!.text).toBe(
    text.replace("WIDTH = 8", "WIDTH = 12").replace("WIDTH(16)", "WIDTH(24)"),
  );
});

test("inserting before implicit registers previews shifted addresses", async () => {
  const text =
    "addrmap top {\n    reg { field {} f; } first;\n    reg { field {} f; } second;\n};\n";
  const snapshot = project(text);
  const root = source(snapshot).documents[0]!.nodes[0]!;
  const candidate = await run(
    prepare(
      snapshot,
      [
        {
          kind: "insertComponent",
          documentId: "main",
          parent: value(handle(snapshot, root)),
          before: value(handle(snapshot, root.children![0]!)),
          component: {
            kind: "reg",
            instance: "added",
            children: [{ kind: "field", instance: "f" }],
          },
        },
      ],
      { mode: "configured", configurations: ["default"] },
    ),
  );
  expect(Result.isSuccess(apply(snapshot, candidate))).toBe(true);
  expect(candidate.comparisonCoverage.complete).toBe(true);
  expect(candidate.layoutChanges.find((change) => change.path === "top.first")).toMatchObject({
    before: { address: 0n },
    after: { address: 4n },
  });
  expect(candidate.layoutChanges.find((change) => change.path === "top.second")).toMatchObject({
    before: { address: 4n },
    after: { address: 8n },
  });
});

test("instantiates a named type with validated named arguments", async () => {
  const snapshot = project(
    "reg word #(longint unsigned WIDTH=8) { field {} f[WIDTH-1:0]; };\naddrmap top { word first; };\n",
  );
  const candidate = await run(
    prepare(
      snapshot,
      [
        {
          kind: "insertInstance",
          documentId: "main",
          parent: find(snapshot, "top", "component"),
          instance: {
            kind: "instance",
            type: "word",
            name: "second",
            arguments: { WIDTH: "16" },
            address: "16",
          },
        },
      ],
      { mode: "configured", configurations: ["default"] },
    ),
  );
  expect(Result.isSuccess(apply(snapshot, candidate))).toBe(true);
  expect(candidate.reports[0]!.roots[0]!.children[1]).toMatchObject({
    name: "second",
    address: 16n,
  });
  expect(candidate.reports[0]!.roots[0]!.children[1]!.children[0]!.msb).toBe(15n);
});

test("complete instance rename follows hierarchical references through comments", async () => {
  const text =
    "addrmap top { reg { field { reset=0; } data; } ctrl; ctrl /* path */ . data -> reset = 1; };";
  const snapshot = project(text);
  const candidate = await run(
    prepare(
      snapshot,
      [{ kind: "rename", target: find(snapshot, "ctrl", "instance"), name: "status" }],
      { mode: "configured", configurations: ["default"] },
    ),
  );
  const next = value(apply(snapshot, candidate));
  expect(serialize(next)[0]!.text).toBe(text.replaceAll("ctrl", "status"));
});
