import { describe, expect, test } from "bun:test";
import { preprocess } from "../src/preprocess.js";
import type { Configuration, ProjectInput } from "../src/types.js";
const config: Configuration = { id: "default", roots: ["main"] };
function run(text: string, extra: Partial<ProjectInput> = {}, configuration = config) {
  return preprocess(
    { files: [{ id: "main", text }], configurations: [configuration], ...extra },
    configuration,
  );
}
describe("captured source preprocessing", () => {
  test("preserves untouched text and ignores macros in comments and strings", () => {
    const text = 'reg foo { desc="`UNKNOWN"; // `OTHER\n /* `OTHER */ };';
    const result = run(text);
    expect(result.complete).toBe(true);
    expect(result.units[0]!.text).toBe(text);
    for (const span of result.units[0]!.origins) {
      expect(span.generated).toBe(false);
      expect(text.slice(span.source.start, span.source.end)).toBe(text.slice(span.start, span.end));
    }
  });
  test("expands nested object/function macros with physical provenance", () => {
    const result = run(
      "`define WIDTH 8\n`define FIELD(n,w) field { fieldwidth=w; } n;\nreg R { `FIELD(data, (`WIDTH + 1)) };",
    );
    expect(result.complete).toBe(true);
    expect(result.units[0]!.text).toContain("field { fieldwidth=(8 + 1); } data;");
    expect(
      result.units[0]!.origins.some((span) => span.generated && (span.chain?.length ?? 0) >= 2),
    ).toBe(true);
  });
  test("supports defaults, concatenation and stringification", () => {
    const result = run(
      '`define MAKE(n,w=8) field { fieldwidth=w; desc=`"n`"; name="n"; } n``_f;\nreg R { `MAKE(data,) };',
    );
    expect(result.complete).toBe(true);
    expect(result.units[0]!.text).toContain('fieldwidth=8; desc="data"; name="n"; } data_f;');
  });
  test("guards permit repeated and recursive inclusion", () => {
    const configuration: Configuration = {
      ...config,
      includes: [
        { from: "main", request: "a", to: "a" },
        { from: "a", request: "a", to: "a" },
      ],
    };
    const result = run(
      "",
      {
        files: [
          { id: "main", text: '`include "a"\n`include "a"\naddrmap top {};' },
          { id: "a", text: '`ifndef A\n`define A\n`include "a"\nreg R {};\n`endif\n' },
        ],
      },
      configuration,
    );
    expect(result.complete).toBe(true);
    expect(result.units[0]!.text.match(/reg R/g)).toHaveLength(1);
    expect(
      result.units[0]!.origins.some(
        (span) => span.source.documentId === "a" && span.chain?.[0]?.documentId === "main",
      ),
    ).toBe(true);
  });
  test("resets macros between roots", () => {
    const configuration = { ...config, roots: ["main", "second"] };
    const result = run(
      "",
      {
        files: [
          { id: "main", text: "`define A 1\n`A" },
          { id: "second", text: "`A" },
        ],
      },
      configuration,
    );
    expect(result.units[0]!.text.trim()).toBe("1");
    expect(result.diagnostics.map((d) => d.code)).toContain("undefined-macro");
  });
  test("selects elsif without expanding inactive macros", () => {
    const result = run(
      "`define A\n`ifdef MISSING\n`UNKNOWN\n`elsif A\nreg R {};\n`else\nBAD\n`endif\n",
    );
    expect(result.complete).toBe(true);
    expect(result.units[0]!.text).toContain("reg R");
    expect(result.units[0]!.text).not.toContain("BAD");
  });
  test("logical line directives do not replace physical origins", () => {
    const text = '`line 100 "logical.rdl" 0\nreg R {};';
    const result = run(text);
    expect(result.complete).toBe(true);
    const range = result.units[0]!.origins.find(
      (span) => !span.generated && text.slice(span.source.start, span.source.end).includes("reg R"),
    )!;
    expect(range.source.documentId).toBe("main");
    expect(range.source.start).toBeGreaterThan(0);
    expect(range.logical).toEqual({ file: "logical.rdl", line: 100 });
  });
  test.each([
    ["`define A `A\n`A", "macro-recursion"],
    ["`define A(x,y) x+y\n`A(1)", "macro-arity"],
    ["`ifdef A\n", "unterminated-conditional"],
    ["`else\n", "conditional-order"],
    ["`ifdef A\n`else\n`else\n`endif\n", "conditional-order"],
    ['`include "missing"', "missing-include"],
    ['<% print "foo"; %>', "unsupported-perl"],
    ["`if X\nfoo\n`endif", "unsupported-if"],
  ])("reports incomplete processing: %s", (text, code) => {
    const result = run(text);
    expect(result.complete).toBe(false);
    expect(result.diagnostics.map((d) => d.code)).toContain(code);
  });
  test("caps include recursion and expanded output", () => {
    const configuration = { ...config, includes: [{ from: "main", request: "self", to: "main" }] };
    expect(
      run('`include "self"', { limits: { includeDepth: 16 } }, configuration).diagnostics.map(
        (d) => d.code,
      ),
    ).toContain("include-depth");
    expect(
      run("`define A 1234567890\n`A `A", { limits: { expandedCharacters: 8 } }).diagnostics.map(
        (d) => d.code,
      ),
    ).toContain("expansion-limit");
  });
});

test("nested calls to the same function macro expand arguments before substitution", () => {
  const result = run("`define ID(x) x\nreg R { field {} `ID(`ID(data)); };");
  expect(result.complete).toBe(true);
  expect(result.units[0]!.text).toContain("field {} data;");
});
test("ordinary code can follow a conditional directive on its line", () => {
  const result = run("`define A\n`ifdef A reg R {}; `else BAD `endif\n");
  expect(result.complete).toBe(true);
  expect(result.units[0]!.text).toContain("reg R {};");
  expect(result.units[0]!.text).not.toContain("BAD");
});
test("macro strings retain URL slash sequences", () => {
  const result = run('`define URL "https://example.test/register"\nreg R { desc=`URL; };');
  expect(result.complete).toBe(true);
  expect(result.units[0]!.text).toContain('"https://example.test/register"');
});
test("embedded Perl in comments still prevents complete preprocessing", () => {
  const result = run('// <% print "generated"; %>\naddrmap top {};');
  expect(result.complete).toBe(false);
  expect(result.diagnostics.map((d) => d.code)).toContain("unsupported-perl");
});
test("function macros may generate include names", () => {
  const configuration = { ...config, includes: [{ from: "main", request: "a.rdl", to: "a" }] };
  const result = run(
    "",
    {
      files: [
        { id: "main", text: '`define FILE(x) `"x.rdl`"\n`include `FILE(a)\n' },
        { id: "a", text: "addrmap top {};" },
      ],
    },
    configuration,
  );
  expect(result.complete).toBe(true);
  expect(result.units[0]!.text).toContain("addrmap top {};");
});
test("macro redefinition uses the later definition with a warning", () => {
  const result = run("`define A 1\n`define A 2\n`A");
  expect(result.complete).toBe(true);
  expect(result.units[0]!.text.trim()).toBe("2");
  expect(result.diagnostics[0]!.severity).toBe("warning");
});
test("excessive nested argument calls return diagnostics rather than exhausting the call stack", () => {
  const result = run("`define ID(x) x\n" + "`ID(".repeat(200) + "a" + ")".repeat(200));
  expect(result.complete).toBe(false);
  expect(result.diagnostics.map((d) => d.code)).toContain("expansion-limit");
});
