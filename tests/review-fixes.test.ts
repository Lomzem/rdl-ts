import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { literal, open, prepare, handle, source, serialize, apply } from "../src/index.js";
import { evaluateExpression } from "../src/expressions.js";
import { preprocess } from "../src/preprocess.js";
import { validateExpression } from "../src/syntax.js";

test("string literals round-trip all control characters, quotes, backslashes, and Unicode", () => {
  for (const value of [
    Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)).join(""),
    '\\n\\t\\r\\b\\f\\u0001 "quoted" C:\\x \\',
    "😀\ud800\udfff",
  ]) {
    const expression = literal(value);
    expect(validateExpression(expression)).toBe(true);
    const result = evaluateExpression(expression);
    expect(Result.isSuccess(result)).toBe(true);
    if (Result.isSuccess(result)) expect(result.success).toBe(value);
  }
});

test("Perl delimiters precede SystemRDL strings and inactive conditional branches", () => {
  for (const text of [
    'addrmap top { desc="<% Perl code %>"; };',
    "`ifdef NEVER\n<% Perl code %>\n`endif\naddrmap top {};",
  ]) {
    const configuration = { id: "main", roots: ["main"] };
    const result = preprocess(
      { files: [{ id: "main", text }], configurations: [configuration] },
      configuration,
    );
    expect(result.complete).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "unsupported-perl")).toBe(true);
  }
});

test("complete renames disclose source-less configuration dependencies", async () => {
  const text = "enum E { A=0; }; addrmap top #(E MODE=E::A) { reg { field {} f; } rr; };";
  const opened = open({
    files: [{ id: "main", text }],
    configurations: [{ id: "main", roots: ["main"], parameters: { MODE: "E::A" } }],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const snapshot = opened.success;
  const selected = handle(snapshot, source(snapshot).documents[0]!.nodes[0]!);
  if (Result.isFailure(selected)) throw new Error(selected.failure.message);
  const commands = [{ kind: "rename" as const, target: selected.success, name: "Mode" }];
  const configured = { mode: "configured" as const, configurations: ["main"] };
  const result = await Effect.runPromise(Effect.result(prepare(snapshot, commands, configured)));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe("incomplete-rename");
  const partial = await Effect.runPromise(
    prepare(snapshot, [{ ...commands[0]!, partial: true }], configured),
  );
  expect(partial.diagnostics.some((d) => d.code === "partial-rename")).toBe(true);
  const next = apply(snapshot, partial, "draft");
  expect(Result.isSuccess(next)).toBe(true);
  if (Result.isSuccess(next))
    expect(serialize(next.success)[0]!.text).toBe(text.replace(/\bE\b/g, "Mode"));
});

test("renames disclose captured top-level selections", async () => {
  const text = "addrmap top { reg { field {} f; } rr; };";
  const opened = open({
    files: [{ id: "main", text }],
    configurations: [{ id: "main", roots: ["main"], top: "top" }],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const snapshot = opened.success;
  const selected = handle(snapshot, source(snapshot).documents[0]!.nodes[0]!);
  if (Result.isFailure(selected)) throw new Error(selected.failure.message);
  const command = { kind: "rename" as const, target: selected.success, name: "renamed" };
  const configured = { mode: "configured" as const, configurations: ["main"] };
  const result = await Effect.runPromise(Effect.result(prepare(snapshot, [command], configured)));
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.code).toBe("incomplete-rename");
  const partial = await Effect.runPromise(
    prepare(snapshot, [{ ...command, partial: true }], configured),
  );
  expect(partial.diagnostics.find((d) => d.code === "partial-rename")?.message).toContain(
    "configuration.top",
  );
  expect(Result.isFailure(apply(snapshot, partial))).toBe(true);
  const draft = apply(snapshot, partial, "draft");
  expect(Result.isSuccess(draft)).toBe(true);
  if (Result.isSuccess(draft))
    expect(serialize(draft.success)[0]!.text).toBe(text.replace("addrmap top", "addrmap renamed"));
});
