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
  sourceLocation,
} from "../src/index.js";
import type { ProjectSnapshot, SyntaxNode } from "../src/types.js";

function success<A, E>(result: Result.Result<A, E>): A {
  if (Result.isFailure(result)) throw new Error(JSON.stringify(result.failure));
  return result.success;
}
function project(text: string) {
  return success(
    open({ files: [{ id: "main", text }], configurations: [{ id: "c", roots: ["main"] }] }),
  );
}
function all(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  return nodes.flatMap((node) => [node, ...all(node.children ?? []), ...all(node.instances ?? [])]);
}
function target(snapshot: ProjectSnapshot, name: string, kind: SyntaxNode["kind"]) {
  const node = all(source(snapshot).documents[0]!.nodes).find(
    (n) => n.name === name && n.kind === kind,
  );
  expect(node).toBeDefined();
  return success(handle(snapshot, node!));
}
const configured = { mode: "configured", configurations: ["c"] } as const;
const text = "addrmap top { reg { field { sw=rw; hw=r; } f[7:0]; } a; };";

test("whole-array instance property overrides stay supported", async () => {
  const snapshot = project("addrmap top { reg { field { sw=rw; hw=r; } f[7:0]; } bank[2]; };");
  const report = await Effect.runPromise(analyze(snapshot, "c"));
  expect(report.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const bank = findInstance(report, "top.bank")!;
  const candidate = success(
    await Effect.runPromise(
      Effect.result(
        prepare(
          snapshot,
          [
            {
              kind: "setInstanceProperty",
              target: success(instanceHandle(report, bank)),
              property: "desc",
              expression: '"all elements"',
            },
          ],
          configured,
        ),
      ),
    ),
  );
  const next = success(apply(snapshot, candidate));
  expect(serialize(next)[0]!.text).toContain('bank->desc = "all elements";');
  const after = await Effect.runPromise(analyze(next, "c"));
  expect(findInstance(after, "top.bank[1]")!.properties.desc!.value).toBe("all elements");
});

test("fabricated candidates cannot smuggle a next snapshot or validation reports", async () => {
  const snapshot = project(text);
  const candidate = await Effect.runPromise(
    prepare(
      snapshot,
      [
        {
          kind: "setProperty",
          target: target(snapshot, "top", "component"),
          property: "desc",
          expression: '"new"',
        },
      ],
      configured,
    ),
  );
  expect(Result.isFailure(apply(snapshot, { ...candidate }))).toBe(true);
  expect(Object.isFrozen(candidate)).toBe(true);
  expect(Object.isFrozen(candidate.reports)).toBe(true);
  expect(Object.isFrozen(candidate.snapshot.files[0])).toBe(true);
  expect(serialize(snapshot)[0]!.text).toBe(text);
});

test("input mutation does not change captured sources, permissions, or configurations", () => {
  const input = {
    files: [{ id: "main", text, writable: true }],
    configurations: [{ id: "c", roots: ["main"], macros: { VALUE: "1" } }],
  };
  const snapshot = success(open(input));
  input.files[0]!.text = "destroyed";
  input.files[0]!.writable = false;
  input.configurations[0]!.roots.length = 0;
  input.configurations[0]!.macros.VALUE = "2";
  expect(serialize(snapshot)[0]!.text).toBe(text);
  expect(snapshot.files[0]!.writable).toBe(true);
  expect(snapshot.configurations[0]!.roots).toEqual(["main"]);
  expect(snapshot.configurations[0]!.macros!.VALUE).toBe("1");
});

test("read-only reference files block a complete rename atomically", async () => {
  const snapshot = success(
    open({
      files: [
        { id: "defs", text: "reg R { field {} f; };" },
        { id: "main", text: "addrmap top { R a; };", writable: false },
      ],
      configurations: [{ id: "c", roots: ["defs", "main"] }],
    }),
  );
  const result = await Effect.runPromise(
    Effect.result(
      prepare(
        snapshot,
        [{ kind: "rename", target: target(snapshot, "R", "component"), name: "S" }],
        configured,
      ),
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe("read-only");
  expect(serialize(snapshot).map((file) => file.text)).toEqual([
    "reg R { field {} f; };",
    "addrmap top { R a; };",
  ]);
});

test("literal replacement changes only the original expression span", async () => {
  const sourceText =
    "addrmap top {\r\n  reg { field { reset = 8'h00; /* keep */ } f[7:0]; } a;\n};\r\n";
  const snapshot = project(sourceText);
  const candidate = await Effect.runPromise(
    prepare(
      snapshot,
      [
        {
          kind: "replaceExpression",
          target: target(snapshot, "reset", "assignment"),
          expression: "8'h01",
        },
      ],
      configured,
    ),
  );
  expect(serialize(success(apply(snapshot, candidate)))[0]!.text).toBe(
    sourceText.replace("8'h00", "8'h01"),
  );
});

test("complete UDP rename cannot overlook an inactive property assignment", async () => {
  const snapshot = project(
    'property note { type=string; component=field; };\naddrmap top { reg { field {\n`ifdef OFF\nnote = "inactive";\n`endif\n} f; } a; };',
  );
  const result = await Effect.runPromise(
    Effect.result(
      prepare(
        snapshot,
        [{ kind: "rename", target: target(snapshot, "note", "property"), name: "annotation" }],
        configured,
      ),
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe("incomplete-rename");
});

test("rename refuses silent capture of a reference to an outer declaration", async () => {
  const snapshot = project(
    "reg A { field {} f[7:0]; }; addrmap top { reg B { field {} f[15:0]; }; B b; A a; };",
  );
  const result = await Effect.runPromise(
    Effect.result(
      prepare(
        snapshot,
        [{ kind: "rename", target: target(snapshot, "B", "component"), name: "A" }],
        configured,
      ),
    ),
  );
  expect(Result.isFailure(result)).toBe(true);
});

test("UDP type edits preserve existing order, spacing, and unrelated comments", async () => {
  const original =
    "property note { component = field; /* metadata */ type = bit; };\naddrmap top { reg { field { note = 1; } f; } a; };";
  const snapshot = project(original);
  const candidate = success(
    await Effect.runPromise(
      Effect.result(
        prepare(
          snapshot,
          [
            {
              kind: "editPropertyDeclaration",
              target: target(snapshot, "note", "property"),
              property: {
                name: "note",
                type: "longint unsigned",
                components: ["field"],
                origin: "editor",
              },
            },
          ],
          configured,
        ),
      ),
    ),
  );
  expect(serialize(success(apply(snapshot, candidate)))[0]!.text).toBe(
    original.replace("type = bit", "type = longint unsigned"),
  );
});

test("stale source selections and mismatched analysis instances return failures", async () => {
  const before = project(text);
  const next = project(text);
  const node = source(before).documents[0]!.nodes[0]!;
  const stale = handle(next, node);
  expect(Result.isFailure(stale)).toBe(true);
  const first = await Effect.runPromise(analyze(before, "c"));
  const second = await Effect.runPromise(analyze(before, "c"));
  expect(Result.isFailure(instanceHandle(second, first.roots[0]!))).toBe(true);
  expect(Result.isFailure(instanceHandle({ ...first }, first.roots[0]!))).toBe(true);
});

test("physical locations count UTF-16 columns and mixed newline forms", () => {
  const snapshot = project("a😀b\r\nc\rd\ne");
  expect(success(sourceLocation(snapshot, { documentId: "main", start: 3, end: 7 }))).toEqual({
    documentId: "main",
    start: { line: 0, column: 3 },
    end: { line: 1, column: 1 },
  });
  expect(success(sourceLocation(snapshot, { documentId: "main", start: 8, end: 11 }))).toEqual({
    documentId: "main",
    start: { line: 2, column: 0 },
    end: { line: 3, column: 1 },
  });
  expect(
    Result.isFailure(sourceLocation(snapshot, { documentId: "main", start: 0, end: 12 })),
  ).toBe(true);
  expect(
    Result.isFailure(sourceLocation(snapshot, { documentId: "missing", start: 0, end: 0 })),
  ).toBe(true);
  expect(Result.isFailure(sourceLocation(snapshot, { documentId: "main", start: 2, end: 1 }))).toBe(
    true,
  );
});

test("UDP declaration editing can add a default attribute", async () => {
  const snapshot = project(
    "property note { type=string; component=field; }; addrmap top { reg { field { note; } f; } a; };",
  );
  const candidate = success(
    await Effect.runPromise(
      Effect.result(
        prepare(
          snapshot,
          [
            {
              kind: "editPropertyDeclaration",
              target: target(snapshot, "note", "property"),
              property: {
                name: "note",
                type: "string",
                components: ["field"],
                default: '"fallback"',
                origin: "editor",
              },
            },
          ],
          configured,
        ),
      ),
    ),
  );
  const next = success(apply(snapshot, candidate));
  const report = await Effect.runPromise(analyze(next, "c"));
  expect(findInstance(report, "top.a.f")!.properties.note!.value).toBe("fallback");
});
