import { expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { analyze, open } from "../src/index.js";
import { preprocess } from "../src/preprocess.js";
import type { Configuration } from "../src/types.js";

function expanded(text: string) {
  const configuration: Configuration = { id: "main", roots: ["main"] };
  return preprocess(
    { files: [{ id: "main", text }], configurations: [configuration] },
    configuration,
  );
}

test("macro block comments may contain line-comment delimiters", () => {
  const result = expanded("`define VALUE /* https://example.test */ 8\n`VALUE");
  expect(result.diagnostics).toEqual([]);
  expect(result.units[0]!.text).toContain("8");
});

test("include directives accept trailing block comments", () => {
  const configuration: Configuration = {
    id: "main",
    roots: ["main"],
    includes: [{ from: "main", request: "header", to: "header" }],
  };
  const result = preprocess(
    {
      files: [
        { id: "main", text: '`include "header" /* explanation */\n' },
        { id: "header", text: "addrmap top {};" },
      ],
      configurations: [configuration],
    },
    configuration,
  );
  expect(result.diagnostics).toEqual([]);
  expect(result.units[0]!.text).toContain("addrmap top");
});

test("escaped SystemRDL identifiers do not absorb adjacent macro substitutions", () => {
  const result = expanded("`define DECL(x) field {} \\field[x:0];\n`DECL(7)");
  expect(result.diagnostics).toEqual([]);
  expect(result.units[0]!.text.trim()).toBe("field {} \\field[7:0];");
});

test("carriage returns terminate directives and line comments", () => {
  const result = expanded("`define VALUE 8\r// comment\r`VALUE");
  expect(result.diagnostics).toEqual([]);
  expect(result.units[0]!.text.trim()).toEndWith("8");
});

test("analysis exposes include, macro, and logical provenance without replacing physical ranges", async () => {
  const header =
    '`define REG reg { field {} f; } control;\n`line 200 "logical.rdl" 0\naddrmap top {\n`REG\n};\n';
  const opened = open({
    files: [
      { id: "main", text: '`include "header"\n' },
      { id: "header", text: header },
    ],
    configurations: [
      {
        id: "main",
        roots: ["main"],
        includes: [{ from: "main", request: "header", to: "header" }],
      },
    ],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const report = await Effect.runPromise(analyze(opened.success, "main"));
  expect(report.diagnostics).toEqual([]);
  const register = report.roots[0]!.children[0]!;
  expect(register.sourceProvenance!.range.documentId).toBe("header");
  expect(register.sourceProvenance!.generated).toBe(true);
  expect(register.sourceProvenance!.chain!.some((range) => range.documentId === "main")).toBe(true);
  expect(
    register.sourceProvenance!.chain!.some(
      (range) => range.documentId === "header" && range.start === 0,
    ),
  ).toBe(true);
  expect(register.sourceProvenance!.logical).toEqual({ file: "logical.rdl", line: 201 });
});

test("continued macro bodies retain the invocation logical line", async () => {
  const text =
    '`define REGS reg { field {} f; } first; \\\nreg { field {} f; } second;\n`line 50 "logical.rdl" 0\naddrmap top { `REGS };';
  const opened = open({
    files: [{ id: "main", text }],
    configurations: [{ id: "main", roots: ["main"] }],
  });
  if (Result.isFailure(opened)) throw new Error(opened.failure.message);
  const report = await Effect.runPromise(analyze(opened.success, "main"));
  expect(report.diagnostics).toEqual([]);
  expect(report.roots[0]!.children.map((item) => item.sourceProvenance!.logical)).toEqual([
    { file: "logical.rdl", line: 50 },
    { file: "logical.rdl", line: 50 },
  ]);
});
