import { Result } from "effect";
import type { IntegerValue, RdlValue } from "./types.js";

export interface ExpressionError {
  readonly code: string;
  readonly message: string;
}
export interface ExpressionContext {
  readonly resolve?: (name: string) => RdlValue | undefined;
  readonly reference?: (path: string) => void;
  readonly struct?: (
    name: string,
    members: Readonly<Record<string, RdlValue>>,
  ) => RdlValue | undefined;
}
interface Token {
  text: string;
  start: number;
}
type Tree = { op: string; text?: string; args: Tree[] };
const MAX_WIDTH = 1_000_000n;
const MAX_POWER_WORK = 8_000_000n;
export function integer(value: bigint, width = 64n): IntegerValue {
  if (width < 1n || width > MAX_WIDTH)
    throw new EvalError(
      "expression.resource",
      "Integer width exceeds the supported resource limit.",
    );
  return { kind: "integer", value: BigInt.asUintN(Number(width), value), width };
}
export function isInteger(value: RdlValue | undefined): value is IntegerValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "integer";
}
export function numeric(value: RdlValue): bigint {
  if (isInteger(value)) return value.value;
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "enum" &&
    value.value !== undefined
  )
    return value.value;
  if (typeof value === "object" && "kind" in value && value.kind === "reference")
    throw new EvalError(
      "expression.nonconstant",
      "Runtime-dependent reference expressions are not supported.",
    );
  throw new EvalError("expression.type", "An integral or boolean value is required.");
}
class EvalError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
const precedences: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "|": 3,
  "^": 4,
  "~^": 4,
  "^~": 4,
  "&": 5,
  "==": 6,
  "!=": 6,
  "<": 7,
  ">": 7,
  "<=": 7,
  ">=": 7,
  "<<": 8,
  ">>": 8,
  "+": 9,
  "-": 9,
  "*": 10,
  "/": 10,
  "%": 10,
  "**": 11,
};
const enums: Record<string, string[]> = {
  accesstype: ["rw", "wr", "r", "w", "rw1", "w1", "na"],
  addressingtype: ["compact", "regalign", "fullalign"],
  onreadtype: ["rclr", "rset", "ruser"],
  onwritetype: ["woset", "woclr", "wot", "wzs", "wzc", "wzt", "wclr", "wset", "wuser"],
  precedencetype: ["hw", "sw"],
};
export function reservedEnum(name: string): RdlValue | undefined {
  for (const [type, values] of Object.entries(enums))
    if (values.includes(name)) return { kind: "enum", type, member: name };
  return undefined;
}
function lex(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|(?:[0-9][0-9_]*)?'[bBoOdDhH][0-9a-fA-F_]+|'[01]|0[xX][0-9a-fA-F_]+|[0-9][0-9_]*|\\[A-Za-z_$][A-Za-z0-9_$]*|[A-Za-z_$][A-Za-z0-9_$]*|::|->|\*\*|&&|\|\||==|!=|<=|>=|<<|>>|~\^|\^~|~&|~\||[{}()[\],.:?'!~+*/%&|^<>-]/gy;
  let offset = 0;
  while (offset < text.length) {
    pattern.lastIndex = offset;
    const match = pattern.exec(text);
    if (!match)
      throw new EvalError("expression.syntax", `Unexpected character at offset ${offset}.`);
    const value = match[0];
    if (!/^\s|^\/\//.test(value) && !value.startsWith("/*"))
      tokens.push({ text: value, start: offset });
    offset = pattern.lastIndex;
    if (tokens.length > 20_000)
      throw new EvalError("expression.resource", "Expression token limit exceeded.");
  }
  return tokens;
}
class Parser {
  index = 0;
  depth = 0;
  constructor(readonly tokens: Token[]) {}
  peek() {
    return this.tokens[this.index]?.text ?? "";
  }
  take() {
    const t = this.peek();
    if (!t) throw new EvalError("expression.syntax", "Unexpected end of expression.");
    this.index++;
    return t;
  }
  expect(text: string) {
    if (this.take() !== text) throw new EvalError("expression.syntax", `Expected '${text}'.`);
  }
  expression(min = 0): Tree {
    if (++this.depth > 256)
      throw new EvalError("expression.resource", "Expression nesting limit exceeded.");
    let left = this.primary();
    while ((precedences[this.peek()] ?? -1) >= min) {
      const op = this.take(),
        p = precedences[op]!;
      left = { op, args: [left, this.expression(p + 1)] };
    }
    if (min === 0 && this.peek() === "?") {
      this.take();
      const yes = this.expression();
      this.expect(":");
      left = { op: "?:", args: [left, yes, this.expression()] };
    }
    this.depth--;
    return left;
  }
  primary(): Tree {
    const t = this.take();
    let node: Tree;
    if (["+", "-", "!", "~", "&", "|", "^", "~&", "~|", "~^", "^~"].includes(t))
      return { op: `unary${t}`, args: [this.expression(12)] };
    if (t === "(") {
      node = this.expression();
      this.expect(")");
    } else if (t === "{") {
      const first = this.expression();
      if (this.peek() === "{") {
        this.take();
        const parts = this.list("}");
        this.expect("}");
        return { op: "repeat", args: [first, { op: "concat", args: parts }] };
      }
      const parts = [first];
      while (this.peek() === ",") {
        this.take();
        parts.push(this.expression());
      }
      this.expect("}");
      return { op: "concat", args: parts };
    } else if (t === "'") {
      this.expect("{");
      node = { op: "array", args: this.list("}") };
    } else node = { op: "atom", text: t, args: [] };
    if (t === "longint" && this.peek() === "unsigned") {
      this.take();
      node.text = "longint unsigned";
    }
    while (true) {
      if (this.peek() === "'") {
        this.take();
        if (this.peek() === "{") {
          this.take();
          const args: Tree[] = [];
          while (this.peek() !== "}") {
            const key = this.take();
            this.expect(":");
            args.push({ op: "member", text: key, args: [this.expression()] });
            if (this.peek() !== ",") break;
            this.take();
          }
          this.expect("}");
          node = { op: "struct", text: node.text, args };
        } else {
          this.expect("(");
          const value = this.expression();
          this.expect(")");
          node = { op: "cast", args: [node, value] };
        }
      } else if ([".", "::", "->"].includes(this.peek())) {
        const op = this.take();
        const name = this.take();
        node = { op: "select", text: op + name, args: [node] };
      } else if (this.peek() === "[") {
        this.take();
        const index = this.expression();
        this.expect("]");
        node = { op: "index", args: [node, index] };
      } else break;
    }
    return node;
  }
  list(end: string): Tree[] {
    const args: Tree[] = [];
    if (this.peek() !== end) {
      args.push(this.expression());
      while (this.peek() === ",") {
        this.take();
        args.push(this.expression());
      }
    }
    this.expect(end);
    return args;
  }
}
function nameOf(tree: Tree): string | undefined {
  if (tree.op === "atom") return tree.text;
  if (tree.op === "select") {
    const base = nameOf(tree.args[0]!);
    return base === undefined ? undefined : base + tree.text;
  }
  return undefined;
}
function sameTypeDefinition(
  a: import("./types.js").SourceRange | undefined,
  b: import("./types.js").SourceRange | undefined,
): boolean {
  return a === undefined
    ? b === undefined
    : b !== undefined && a.documentId === b.documentId && a.start === b.start && a.end === b.end;
}
function valueWidth(value: RdlValue): bigint {
  return isInteger(value)
    ? value.width
    : typeof value === "object" && "kind" in value && value.kind === "enum"
      ? (value.width ?? 64n)
      : 1n;
}
function same(a: RdlValue, b: RdlValue): boolean {
  if (isInteger(a) && isInteger(b)) return a.value === b.value;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => same(v, b[i]!));
  if ("kind" in a && "kind" in b && a.kind === b.kind) {
    if (a.kind === "reference")
      throw new EvalError("expression.type", "Structural references cannot be compared.");
    if (a.kind === "enum" && b.kind === "enum") return a.type === b.type && a.member === b.member;
    if (a.kind === "struct" && b.kind === "struct")
      return (
        a.type === b.type &&
        Object.keys(a.members).length === Object.keys(b.members).length &&
        Object.entries(a.members).every(
          ([k, v]) => b.members[k] !== undefined && same(v, b.members[k]!),
        )
      );
  }
  return false;
}
const evaluationCaches = new WeakMap<ExpressionContext, WeakMap<Tree, Map<string, RdlValue>>>();
function evaluate(tree: Tree, context: ExpressionContext, contextWidth?: bigint): RdlValue {
  let trees = evaluationCaches.get(context);
  if (!trees) {
    trees = new WeakMap();
    evaluationCaches.set(context, trees);
  }
  let widths = trees.get(tree);
  if (!widths) {
    widths = new Map();
    trees.set(tree, widths);
  }
  const key = contextWidth?.toString() ?? "self";
  const cached = widths.get(key);
  if (cached !== undefined) return cached;
  const value = evaluateUncached(tree, context, contextWidth);
  widths.set(key, value);
  return value;
}
function expressionShape(
  tree: Tree,
  context: ExpressionContext,
): { kind: string; width?: bigint; type?: string } {
  if (tree.op === "?:") return expressionShape(tree.args[1]!, context);
  if (tree.op.startsWith("unary")) {
    const operand = expressionShape(tree.args[0]!, context);
    return ["unary+", "unary-", "unary~"].includes(tree.op)
      ? operand
      : { kind: "boolean", width: 1n };
  }
  if (tree.op in precedences) {
    const left = expressionShape(tree.args[0]!, context),
      right = expressionShape(tree.args[1]!, context);
    if (["<", ">", "<=", ">=", "==", "!=", "&&", "||"].includes(tree.op))
      return { kind: "boolean", width: 1n };
    const lw = left.width ?? 1n,
      rw = right.width ?? 1n;
    return {
      kind: "integer",
      width: ["<<", ">>", "**"].includes(tree.op) ? lw : lw > rw ? lw : rw,
    };
  }
  const value = evaluate(tree, context);
  if (isInteger(value)) return { kind: "integer", width: value.width };
  if (typeof value === "boolean") return { kind: "boolean", width: 1n };
  if (typeof value === "string") return { kind: "string" };
  if (Array.isArray(value)) return { kind: "array" };
  if ("kind" in value)
    return { kind: value.kind, ...("type" in value ? { type: value.type } : {}) };
  return { kind: "unknown" };
}
function evaluateUncached(tree: Tree, context: ExpressionContext, contextWidth?: bigint): RdlValue {
  const get = (i: number, width?: bigint) => evaluate(tree.args[i]!, context, width);
  if (tree.op === "atom") {
    const t = tree.text!.replace(/^\\/, "");
    if (t === "true" || t === "false") return t === "true";
    if (t.startsWith('"'))
      return t
        .slice(1, -1)
        .replace(/\\([\\"ntr])/g, (_m, c: string) => ({ n: "\n", t: "\t", r: "\r" })[c] ?? c);
    if (/^\d|^'[01bBoOdDhH]/.test(t)) {
      const s = t.replaceAll("_", ""),
        m = /^(\d*)'([bBoOdDhH])([0-9a-fA-F]+)$/.exec(s);
      if (s === "'0" || s === "'1") return integer(s === "'1" ? -1n : 0n, contextWidth ?? 1n);
      if (m) {
        const base = m[2]!.toLowerCase();
        const digits = m[3]!;
        const v = BigInt({ b: "0b", o: "0o", h: "0x", d: "" }[base]! + digits);
        const width = m[1] ? BigInt(m[1]) : 64n;
        return integer(
          v,
          contextWidth !== undefined && contextWidth > width ? contextWidth : width,
        );
      }
      return integer(
        BigInt(s),
        contextWidth !== undefined && contextWidth > 64n ? contextWidth : 64n,
      );
    }
    const value = context.resolve?.(t) ?? reservedEnum(t);
    if (value === undefined) throw new EvalError("expression.name", `Unknown identifier '${t}'.`);
    return isInteger(value) && contextWidth !== undefined && contextWidth > value.width
      ? integer(value.value, contextWidth)
      : value;
  }
  if (tree.op === "select") {
    const name = nameOf(tree);
    const resolved = name === undefined ? undefined : context.resolve?.(name);
    if (resolved !== undefined) return resolved;
    const base = get(0),
      selection = tree.text!;
    if (
      typeof base === "object" &&
      "kind" in base &&
      base.kind === "struct" &&
      selection.startsWith(".")
    ) {
      const member = base.members[selection.slice(1)];
      if (member !== undefined) return member;
    }
    if (typeof base === "object" && "kind" in base && base.kind === "reference") {
      const selected = selection.startsWith("->")
        ? { ...base, property: selection.slice(2) }
        : { ...base, path: base.path + selection };
      context.reference?.(selected.path);
      return selected;
    }
    throw new EvalError("expression.name", `Unknown selection '${selection}'.`);
  }
  if (tree.op === "index") {
    const base = get(0),
      index = numeric(get(1));
    if (Array.isArray(base) && index >= 0n && index < BigInt(base.length))
      return base[Number(index)]!;
    if (typeof base === "object" && "kind" in base && base.kind === "reference")
      return { ...base, path: `${base.path}[${index}]` };
    throw new EvalError(
      "expression.index",
      "Array index is outside its bounds or target is not an array.",
    );
  }
  if (tree.op === "array") return tree.args.map((_, i) => get(i));
  if (tree.op === "struct") {
    const members: Record<string, RdlValue> = {};
    for (const part of tree.args) {
      if (part.text! in members)
        throw new EvalError("expression.struct", `Duplicate struct member '${part.text}'.`);
      members[part.text!] = evaluate(part.args[0]!, context);
    }
    const value = context.struct?.(tree.text!, members);
    if (!value) throw new EvalError("expression.struct", `Invalid struct literal '${tree.text}'.`);
    return value;
  }
  if (tree.op === "cast") {
    const type = nameOf(tree.args[0]!);
    const value = get(1);
    if (type === "boolean") return numeric(value) !== 0n;
    if (type === "longint unsigned") return integer(numeric(value), 64n);
    if (type === "bit") return integer(numeric(value), isInteger(value) ? value.width : 1n);
    if (type === "string") {
      if (typeof value === "string") return value;
      throw new EvalError("expression.cast", "String casts require strings.");
    }
    if (type && type in enums) {
      if (
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "enum" &&
        value.type === type
      )
        return value;
      throw new EvalError("expression.cast", "Incompatible enumeration cast.");
    }
    return integer(numeric(value), numeric(get(0)));
  }
  if (tree.op === "?:") {
    const condition = numeric(get(0)) !== 0n;
    const a = expressionShape(tree.args[1]!, context),
      b = expressionShape(tree.args[2]!, context);
    const numericBranches = [a.kind, b.kind].every(
      (kind) => kind === "integer" || kind === "boolean",
    );
    if (!numericBranches && (a.kind !== b.kind || a.type !== b.type))
      throw new EvalError("expression.type", "Conditional branches must have compatible types.");
    let width =
      a.width !== undefined && b.width !== undefined
        ? a.width > b.width
          ? a.width
          : b.width
        : undefined;
    if (width !== undefined && contextWidth !== undefined && contextWidth > width)
      width = contextWidth;
    const value = get(condition ? 1 : 2, width);
    return numericBranches && (a.kind === "integer" || b.kind === "integer")
      ? integer(numeric(value), width ?? 1n)
      : value;
  }
  if (tree.op === "concat" || tree.op === "repeat") {
    let values = tree.op === "concat" ? tree.args.map((_, i) => get(i)) : [get(1)];
    const count = tree.op === "repeat" ? numeric(get(0)) : 1n;
    if (count < 1n || count > MAX_WIDTH)
      throw new EvalError(
        "expression.resource",
        "Replication count is invalid or exceeds the resource limit.",
      );
    if (values.every((v) => typeof v === "string")) {
      const text = values.join("");
      if (BigInt(text.length) * count > MAX_WIDTH)
        throw new EvalError("expression.resource", "String replication limit exceeded.");
      return text.repeat(Number(count));
    }
    values = values.map((v) =>
      typeof v === "boolean"
        ? integer(v ? 1n : 0n, 1n)
        : typeof v === "object" && "kind" in v && v.kind === "enum" && v.value !== undefined
          ? integer(v.value, v.width ?? 64n)
          : v,
    );
    let n = 0n,
      width = 0n;
    for (const value of values) {
      if (
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "enum" &&
        value.value === undefined
      )
        throw new EvalError(
          "expression.reserved-enum-concat",
          "Reserved-enumeration concatenation is not supported.",
        );
      if (!isInteger(value))
        throw new EvalError(
          "expression.type",
          "Concatenation requires consistently integral or string operands.",
        );
      width += value.width;
      if (width * count > MAX_WIDTH)
        throw new EvalError("expression.resource", "Concatenation width limit exceeded.");
      n = (n << value.width) | value.value;
    }
    let repeated = 0n,
      chunk = n,
      chunkWidth = width,
      remaining = count;
    while (remaining > 0n) {
      if (remaining & 1n) repeated = (repeated << chunkWidth) | chunk;
      remaining >>= 1n;
      if (remaining > 0n) {
        chunk = (chunk << chunkWidth) | chunk;
        chunkWidth *= 2n;
      }
    }
    return integer(repeated, width * count);
  }
  if (tree.op.startsWith("unary")) {
    const v = get(0, contextWidth),
      n = numeric(v),
      w = isInteger(v) ? v.width : 1n,
      op = tree.op.slice(5);
    if (op === "!") return n === 0n;
    if (op === "+") return integer(n, w);
    if (op === "-") return integer(-n, w);
    if (op === "~") return integer(~n, w);
    let parity = false;
    if (op.includes("^")) for (const bit of n.toString(2)) if (bit === "1") parity = !parity;
    const result = op.includes("&") ? n === (1n << w) - 1n : op.includes("|") ? n !== 0n : parity;
    return op.includes("~") ? !result : result;
  }
  const op = tree.op;
  if (op === "&&") return numeric(get(0)) !== 0n && numeric(get(1)) !== 0n;
  if (op === "||") return numeric(get(0)) !== 0n || numeric(get(1)) !== 0n;
  let left = get(0),
    right = get(1);
  if (op === "==" || op === "!=") {
    if (
      (isInteger(left) || typeof left === "boolean") &&
      (isInteger(right) || typeof right === "boolean")
    ) {
      const lw = isInteger(left) ? left.width : 1n,
        rw = isInteger(right) ? right.width : 1n;
      return (
        (numeric(get(0, lw > rw ? lw : rw)) === numeric(get(1, lw > rw ? lw : rw))) ===
        (op === "==")
      );
    }
    return same(left, right) === (op === "==");
  }
  if (
    ["<", ">", "<=", ">="].includes(op) &&
    typeof left === "object" &&
    "kind" in left &&
    left.kind === "enum" &&
    typeof right === "object" &&
    "kind" in right &&
    right.kind === "enum"
  ) {
    if (
      left.type !== right.type ||
      !sameTypeDefinition(left.typeDefinition, right.typeDefinition) ||
      left.value === undefined ||
      right.value === undefined
    )
      throw new EvalError("expression.type", "Ordering requires members of the same user enum.");
    const a = left.value,
      b = right.value;
    return op === "<" ? a < b : op === ">" ? a > b : op === "<=" ? a <= b : a >= b;
  }
  const aWidth = valueWidth(left),
    bWidth = valueWidth(right);
  let width = ["<<", ">>", "**"].includes(op) ? aWidth : aWidth > bWidth ? aWidth : bWidth;
  if (contextWidth !== undefined && contextWidth > width && !["<", ">", "<=", ">="].includes(op))
    width = contextWidth;
  {
    left = get(0, width);
    if (!["<<", ">>", "**"].includes(op)) right = get(1, width);
  }
  const a = numeric(left),
    b = numeric(right);
  if (op === "<") return a < b;
  if (op === ">") return a > b;
  if (op === "<=") return a <= b;
  if (op === ">=") return a >= b;
  if ((op === "/" || op === "%") && b === 0n)
    throw new EvalError("expression.zero", "Division by zero.");
  if (op === "**") {
    if (b === 0n || a === 1n) return integer(1n, width);
    if (a === 0n || ((a & 1n) === 0n && b >= width)) return integer(0n, width);
    if (BigInt(b.toString(2).length) * width > MAX_POWER_WORK)
      throw new EvalError("expression.resource", "Exponentiation exceeds the bigint work limit.");
    let result = 1n,
      base = a,
      exponent = b;
    const mask = (1n << width) - 1n;
    while (exponent > 0n) {
      if (exponent & 1n) result = (result * base) & mask;
      base = (base * base) & mask;
      exponent >>= 1n;
    }
    return integer(result, width);
  }
  const result =
    op === "+"
      ? a + b
      : op === "-"
        ? a - b
        : op === "*"
          ? a * b
          : op === "/"
            ? a / b
            : op === "%"
              ? a % b
              : op === "&"
                ? a & b
                : op === "|"
                  ? a | b
                  : op === "^"
                    ? a ^ b
                    : op === "~^" || op === "^~"
                      ? ~(a ^ b)
                      : op === "<<"
                        ? b >= width
                          ? 0n
                          : a << b
                        : op === ">>"
                          ? b >= width
                            ? 0n
                            : a >> b
                          : undefined;
  if (result === undefined)
    throw new EvalError("expression.operator", `Unsupported operator '${op}'.`);
  return integer(result, width);
}
export function evaluateExpression(
  text: string,
  context: ExpressionContext = {},
): Result.Result<RdlValue, ExpressionError> {
  try {
    const parser = new Parser(lex(text));
    const tree = parser.expression();
    if (parser.peek())
      throw new EvalError("expression.syntax", `Unexpected token '${parser.peek()}'.`);
    return Result.succeed(evaluate(tree, context));
  } catch (error) {
    if (error instanceof EvalError)
      return Result.fail({ code: error.code, message: error.message });
    if (error instanceof SyntaxError || error instanceof RangeError)
      return Result.fail({
        code: "expression.literal",
        message: "Invalid or excessively large numeric literal.",
      });
    throw error;
  }
}
