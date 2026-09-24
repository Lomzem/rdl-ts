import { expect, test } from "bun:test";
import { Result } from "effect";
import { evaluateExpression, integer } from "../src/expressions.js";
function value(text: string) {
  const result = evaluateExpression(text);
  if (Result.isFailure(result)) throw new Error(JSON.stringify(result.failure));
  return result.success;
}
test("exact unsigned arithmetic and expression widths", () => {
  expect(value("64'hffffffffffffffff")).toEqual(integer(0xffffffffffffffffn));
  expect(value("8'hff + 8'h01")).toEqual(integer(0n, 8n));
  expect(value("-8'h01")).toEqual(integer(255n, 8n));
  expect(value("(8'hff + 8'h01) + 16'h0000")).toEqual(integer(256n, 16n));
  expect(value("2 ** 63")).toEqual(integer(1n << 63n));
});
test("casts and operand-controlled shifts", () => {
  expect(value("4'(8'hff)")).toEqual(integer(15n, 4n));
  expect(value("boolean'(0)")).toBe(false);
  expect(value("longint unsigned'(true)")).toEqual(integer(1n));
  expect(value("8'hff << 8")).toEqual(integer(0n, 8n));
});
test("logical operators, comparison, conditional and reductions", () => {
  expect(value("2 + 3 * 4 == 14 && !false")).toBe(true);
  expect(value("true ? 7 : 1 / 0")).toEqual(integer(7n));
  expect(value("&4'hf")).toBe(true);
  expect(value("^4'b1011")).toBe(true);
  expect(value("~^4'b1011")).toBe(false);
});
test("concatenation replication arrays and strings", () => {
  expect(value("{4'ha,4'hb}")).toEqual(integer(171n, 8n));
  expect(value("{3{4'ha}}")).toEqual(integer(2730n, 12n));
  expect(value("'{1,2,3}[1]")).toEqual(integer(2n));
  expect(value('{"hello", " world"}')).toBe("hello world");
});
test("invalid expressions are values", () => {
  for (const expression of ["1 / 0", "1; 2", "missing", "0'(1)", "2 **", '1 + "x"'])
    expect(Result.isFailure(evaluateExpression(expression))).toBe(true);
});

test("conditional branches determine width and require compatible types", () => {
  expect(value("true ? 8'hff + 8'h01 : 16'h0000")).toEqual(integer(256n, 16n));
  expect(value("(8'hff + 8'hff) == 16'h1fe")).toBe(true);
  expect(Result.isFailure(evaluateExpression('true ? 1 : "wrong"'))).toBe(true);
});
test("long arithmetic chains do not repeatedly evaluate the same subexpression", () => {
  expect(value(Array.from({ length: 150 }, () => "1").join("+"))).toEqual(integer(150n));
});

test("large replication and reductions bound bigint work", () => {
  expect(value("{1000000{1'b1}}")).toEqual(integer((1n << 1_000_000n) - 1n, 1_000_000n));
  expect(value("^(~1000000'(0))")).toBe(false);
  expect(value("^(~999999'(0))")).toBe(true);
  expect(value("{5{3'b101}}")).toEqual(integer(0b101101101101101n, 15n));
});
test("exponentiation limits work and resolves modular zero without multiplication", () => {
  const rejected = evaluateExpression("1000000'(3) ** ~1000000'(0)");
  expect(Result.isFailure(rejected)).toBe(true);
  if (Result.isFailure(rejected)) expect(rejected.failure.code).toBe("expression.resource");
  expect(value("1000000'(2) ** ~1000000'(0)")).toEqual(integer(0n, 1_000_000n));
  expect(value("0 ** 0")).toEqual(integer(1n));
  expect(value("3 ** 127")).toEqual(integer(3n ** 127n));
});
