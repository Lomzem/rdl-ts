import { describe, expect, test } from "bun:test";
import { parseDocument, tokenizeExpression, validateExpression } from "../src/syntax.js";
import type { SyntaxNode } from "../src/types.js";

function flatten(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flatten(node.children ?? []),
    ...flatten(node.instances ?? []),
  ]);
}
function parse(text: string) {
  return parseDocument(text, "input.rdl");
}
function valid(text: string) {
  const parsed = parse(text);
  expect(parsed.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
  return parsed;
}

describe("source syntax", () => {
  test("retains physical spans and comments with CRLF and supplementary Unicode", () => {
    const text =
      '// 😀 leading\r\naddrmap chip {\r\n  reg { field { desc = "😀"; reset = 8\'h00; } data[7:0]; } ctrl @ 0x20;\r\n};\r\n';
    const parsed = valid(text);
    const nodes = flatten(parsed.nodes);
    expect(parsed.comments[0]?.text).toBe("// 😀 leading");
    const reset = nodes.find((node) => node.name === "reset")!;
    expect(text.slice(reset.expression!.range.start, reset.expression!.range.end)).toBe("8'h00");
    const ctrl = nodes.find((node) => node.name === "ctrl")!;
    expect(ctrl.address?.text).toBe("0x20");
    expect(text.slice(ctrl.nameRange!.start, ctrl.nameRange!.end)).toBe("ctrl");
    expect(nodes.every((node) => node.range.start >= 0 && node.range.end <= text.length)).toBe(
      true,
    );
    expect(nodes.some((node) => node.uncertain)).toBe(false);
  });
  test("recognizes parameters, instance overrides, dimensions, stride and alignment", () => {
    const parsed = valid(
      'reg reg_type #(longint unsigned WIDTH = 32, string LABELS[]) { field {} data[WIDTH]; }; addrmap chip { reg_type #(.WIDTH(64), .LABELS(\'{"a", "b"})) bank[2][3] @ 0x100 += 8 %= 16; };',
    );
    expect(parsed.nodes[0]?.parameters?.map((parameter) => parameter.type)).toEqual([
      "longint unsigned",
      "string[]",
    ]);
    const bank = flatten(parsed.nodes).find((node) => node.name === "bank")!;
    expect(bank.typeName).toBe("reg_type");
    expect(bank.arguments?.map((argument) => argument.value.text)).toEqual(["64", '\'{"a", "b"}']);
    expect(bank.dimensions?.map((dimension) => dimension.text)).toEqual(["2", "3"]);
    expect(bank.stride?.text).toBe("8");
    expect(bank.alignment?.text).toBe("16");
  });
  test("recognizes every UDP value type and keeps declaration attributes", () => {
    for (const type of [
      "bit",
      "number",
      "longint unsigned",
      "boolean",
      "string",
      "ref",
      "field",
      "reg",
      "addrmap",
      "regfile",
      "mem",
      "my_enum",
      "my_struct",
      "longint unsigned[]",
      "my_struct[]",
    ]) {
      const parsed = valid(`property custom { component = field | reg; type = ${type}; };`);
      expect(
        parsed.nodes[0]?.children?.find((node) => node.name === "type")?.expression?.text,
      ).toBe(type);
    }
    const parsed = valid(
      "property custom { type = bit; component = field; default = 8'h00; constraint = componentwidth; };",
    );
    expect(parsed.nodes[0]?.kind).toBe("property");
    expect(parsed.nodes[0]?.children?.map((node) => node.name)).toEqual([
      "type",
      "component",
      "default",
      "constraint",
    ]);
  });
  test("recognizes enums, abstract and extended structs, and typed array members", () => {
    const parsed = valid(
      'enum encoding { RED = 0 { name = "Red"; desc = "description"; }; BLUE; }; abstract struct base { string label; }; struct info : base { longint unsigned values[]; field target; };',
    );
    expect(parsed.nodes.map((node) => node.kind)).toEqual(["enum", "struct", "struct"]);
    expect(parsed.nodes[0]?.children?.[0]?.children?.[1]?.expression?.text).toBe('"description"');
    expect(parsed.nodes[1]?.abstract).toBe(true);
    expect(parsed.nodes[2]?.extends).toBe("base");
    expect(parsed.nodes[2]?.children?.[0]?.typeName).toBe("longint unsigned[]");
  });
  test("recognizes aliases, storage modes, dynamic and default assignments", () => {
    const parsed = valid(
      "signal { activelow; } rst; reg control { field {} data; }; addrmap chip { external control ctrl; internal alias ctrl control alternate_ctrl; default sw = rw; ctrl.data->reset = 1; };",
    );
    const entries = flatten(parsed.nodes);
    expect(entries.find((node) => node.name === "ctrl")?.external).toBe(true);
    expect(entries.find((node) => node.name === "alternate_ctrl")?.alias).toBe("ctrl");
    expect(entries.find((node) => node.name === "alternate_ctrl")?.internal).toBe(true);
    expect(entries.find((node) => node.name === "sw")?.default).toBe(true);
    expect(entries.find((node) => node.name === "reset")?.target).toBe("ctrl.data");
  });
  test("retains field interrupt modifiers separately from assigned expressions", () => {
    const parsed = valid("field flags { posedge intr; nonsticky intr = true; };");
    expect(parsed.nodes[0]?.children?.map((node) => node.modifier)).toEqual([
      "posedge",
      "nonsticky",
    ]);
    expect(parsed.nodes[0]?.children?.[0]?.expression).toBeUndefined();
    expect(parsed.nodes[0]?.children?.[1]?.expression?.text).toBe("true");
  });
  test("retains array-range targets for deferred semantic analysis", () => {
    const parsed = valid('addrmap chip { bank[0:3]->desc = "selected"; };');
    expect(parsed.nodes[0]?.children?.[0]?.target).toBe("bank[0:3]");
  });
  test("does not expose missing-semicolon recovery as a reliable edit target", () => {
    const parsed = parse("addrmap chip { reg { field {} data; } ctrl };");
    expect(
      flatten(parsed.nodes).find((node) => node.component === "reg" && node.kind === "component")
        ?.uncertain,
    ).toBe(true);
  });
  test("canonicalizes dynamic targets while preserving exact physical segment boundaries", () => {
    const text = "addrmap chip { ctrl /* path */ . data  -> reset = 1; };";
    const parsed = valid(text);
    const assignment = parsed.nodes[0]!.children![0]!;
    expect(assignment.target).toBe("ctrl.data");
    expect(text.slice(assignment.targetRange!.start, assignment.targetRange!.end)).toBe(
      "ctrl /* path */ . data",
    );
  });
  test("supports escaped keyword identifiers", () => {
    const parsed = valid("addrmap chip { reg { field {} \\r; } \\reg; };");
    expect(
      flatten(parsed.nodes).find((node) => node.kind === "instance" && node.name === "reg")
        ?.nameRange,
    ).toBeDefined();
  });
  test("retains bounded unsupported constraints and Perl without hiding later declarations", () => {
    const parsed = parse(
      'constraint limits { this inside {0, [2:7]}; } bounds; <% print "foo"; %> addrmap chip { reg { field {} data; } ctrl; };',
    );
    expect(parsed.nodes.map((node) => node.kind)).toEqual(["constraint", "unknown", "component"]);
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain("unsupported.constraints");
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain("unsupported.perl");
    expect(parsed.nodes.at(-1)?.name).toBe("chip");
  });
  test("marks recovered syntax uncertain and keeps unrelated valid declarations", () => {
    const text =
      "property bad { type = bit component = field; }; addrmap chip { reg { field {} data; } ctrl; };";
    const parsed = parse(text);
    expect(parsed.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
    expect(parsed.nodes.some((node) => node.uncertain)).toBe(true);
    expect(parsed.nodes.at(-1)?.name).toBe("chip");
    expect(parsed.nodes.at(-1)?.uncertain).toBe(false);
  });
  test("retains opaque unterminated strings and comments as diagnostics", () => {
    for (const text of [
      'addrmap chip { desc = "unterminated',
      "/* unfinished comment",
      "<% unfinished Perl",
    ]) {
      const parsed = parse(text);
      expect(parsed.diagnostics.length).toBeGreaterThan(0);
      for (const node of flatten(parsed.nodes)) expect(node.range.start).toBeGreaterThanOrEqual(0);
    }
  });
  test("bounds recursive syntax without throwing or fabricating source targets", () => {
    for (const expression of [
      "(".repeat(2000) + "1" + ")".repeat(2000),
      "!".repeat(2000) + "true",
      "a ? b : ".repeat(2000) + "c",
    ]) {
      expect(validateExpression(expression)).toBe(false);
      const parsed = parse(`addrmap chip { desc = ${expression}; };`);
      expect(parsed.diagnostics.some((entry) => entry.code === "resource.syntax-depth")).toBe(true);
      expect(parsed.nodes).toEqual([]);
    }
    expect(
      parse("addrmap chip {".repeat(1000)).diagnostics.some(
        (entry) => entry.code === "resource.syntax-depth",
      ),
    ).toBe(true);
  });
  test("reports preprocessing requirements in physical source", () => {
    const parsed = parse("`define WIDTH 8\naddrmap chip { reg { field {} data[`WIDTH]; } ctrl; };");
    expect(parsed.diagnostics.map((entry) => entry.code)).toContain(
      "syntax.preprocessing-required",
    );
    expect(parsed.nodes.at(-1)?.uncertain).toBe(true);
  });
});

describe("expression fragments", () => {
  test("accepts complete typed aggregate, reference, cast, arithmetic and conditional syntax", () => {
    for (const expression of [
      "8'hff",
      "0xdead_beef",
      "64'd18446744073709551615",
      "1 + 2 * 3 ** 4",
      "~&(value << 2)",
      "select ? 3 : 4",
      "a ? b ? 1 : 2 : 3",
      "chip.bank[2].data->anded",
      "encoding::RED",
      "longint'(encoding::RED)",
      "32'(value)",
      "(WIDTH + 2)'(value)",
      "'{}",
      "'{1,2,3}",
      "info'{label: \"x\", values: '{1,2}}",
      "{4'hf, 4'h0}",
      "{2{4'hf}}",
      '"a\\\"b"',
      "true",
    ]) {
      expect(validateExpression(expression)).toBe(true);
    }
  });
  test("rejects incomplete expressions, invalid numeric forms, macro tokens and statement injection", () => {
    for (const expression of [
      "",
      "x +",
      "(1",
      "x; reset = 0",
      "x } reg {} injected;",
      "1,2",
      "'hff",
      "1'bx",
      "2'o3",
      "'{1,}",
      "value = 1",
      "--1",
      "++value",
      "value >>> 2",
      "value === 2",
      "`VALUE",
      "1 $ 2",
      '"unterminated',
    ]) {
      expect(validateExpression(expression)).toBe(false);
    }
  });
  test("exports token spellings and UTF16 ranges for semantic evaluation", () => {
    expect(tokenizeExpression(" /* a */ 8'h01 + WIDTH")).toEqual([
      { text: "8'h01", start: 9, end: 14 },
      { text: "+", start: 15, end: 16 },
      { text: "WIDTH", start: 17, end: 22 },
    ]);
  });
});
