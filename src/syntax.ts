import {
  createToken,
  CstParser,
  Lexer,
  tokenMatcher,
  type CstNode,
  type IToken,
  type TokenType,
} from "chevrotain";
import type {
  ArgumentSyntax,
  ComponentKind,
  Diagnostic,
  ExpressionSyntax,
  ParameterSyntax,
  ParsedDocument,
  SourceRange,
  SyntaxNode,
} from "./types.js";

const Word = createToken({ name: "Word", pattern: Lexer.NA });
const Identifier = createToken({
  name: "Identifier",
  pattern: /\\?[a-zA-Z_][a-zA-Z_0-9]*/,
  categories: Word,
});
const words = new Map<string, TokenType>();
function keyword(name: string): TokenType {
  const token = createToken({
    name: `K_${name}`,
    pattern: name,
    longer_alt: Identifier,
    categories: Word,
  });
  words.set(name, token);
  return token;
}
const Addrmap = keyword("addrmap"),
  Regfile = keyword("regfile"),
  Reg = keyword("reg"),
  Field = keyword("field"),
  Mem = keyword("mem"),
  Signal = keyword("signal");
const Property = keyword("property"),
  Enum = keyword("enum"),
  Struct = keyword("struct"),
  Abstract = keyword("abstract"),
  Constraint = keyword("constraint");
const External = keyword("external"),
  Internal = keyword("internal"),
  Alias = keyword("alias"),
  Default = keyword("default"),
  Unsigned = keyword("unsigned");
const modifiers = ["posedge", "negedge", "bothedge", "level", "nonsticky"].map(keyword);
for (const name of [
  "all",
  "component",
  "componentwidth",
  "type",
  "boolean",
  "bit",
  "longint",
  "number",
  "string",
  "ref",
  "accesstype",
  "addressingtype",
  "onreadtype",
  "onwritetype",
  "precedencetype",
  "encode",
  "true",
  "false",
  "hw",
  "sw",
  "this",
  "inside",
  "alternate",
  "byte",
  "int",
  "real",
  "shortint",
  "shortreal",
  "signed",
  "with",
  "within",
  "r",
  "w",
  "rw",
  "wr",
  "rw1",
  "w1",
  "na",
  "rclr",
  "rset",
  "ruser",
  "woset",
  "woclr",
  "wot",
  "wzs",
  "wzc",
  "wzt",
  "wclr",
  "wset",
  "wuser",
  "compact",
  "regalign",
  "fullalign",
])
  keyword(name);
const symbols = new Map<string, TokenType>();
function symbol(image: string, name: string): TokenType {
  const token = createToken({ name, pattern: image });
  symbols.set(image, token);
  return token;
}
const Arrow = symbol("->", "Arrow"),
  Scope = symbol("::", "Scope"),
  Stride = symbol("+=", "Stride"),
  Align = symbol("%=", "Align");
const Power = symbol("**", "Power"),
  ShiftLeft = symbol("<<", "ShiftLeft"),
  ShiftRight = symbol(">>", "ShiftRight"),
  Le = symbol("<=", "Le"),
  Ge = symbol(">=", "Ge"),
  Eq = symbol("==", "Eq"),
  Ne = symbol("!=", "Ne");
const LogicAnd = symbol("&&", "LogicAnd"),
  LogicOr = symbol("||", "LogicOr"),
  Nand = symbol("~&", "Nand"),
  Nor = symbol("~|", "Nor"),
  Xnor = symbol("~^", "Xnor"),
  XnorAlt = symbol("^~", "XnorAlt");
const LBrace = symbol("{", "LBrace"),
  RBrace = symbol("}", "RBrace"),
  LParen = symbol("(", "LParen"),
  RParen = symbol(")", "RParen"),
  LBracket = symbol("[", "LBracket"),
  RBracket = symbol("]", "RBracket");
const Semi = symbol(";", "Semi"),
  Comma = symbol(",", "Comma"),
  Dot = symbol(".", "Dot"),
  Colon = symbol(":", "Colon"),
  Question = symbol("?", "Question"),
  Quote = symbol("'", "Quote"),
  Hash = symbol("#", "Hash"),
  At = symbol("@", "At"),
  Assign = symbol("=", "Assign");
const Plus = symbol("+", "Plus"),
  Minus = symbol("-", "Minus"),
  Star = symbol("*", "Star"),
  Slash = symbol("/", "Slash"),
  Percent = symbol("%", "Percent"),
  Lt = symbol("<", "Lt"),
  Gt = symbol(">", "Gt"),
  And = symbol("&", "And"),
  Or = symbol("|", "Or"),
  Xor = symbol("^", "Xor"),
  Not = symbol("!", "Not"),
  Tilde = symbol("~", "Tilde");
const Space = createToken({ name: "Space", pattern: /\s+/, group: "trivia", line_breaks: true });
const CommentToken = createToken({
  name: "Comment",
  pattern: /\/\/[^\r\n]*|\/\*[\s\S]*?\*\//,
  group: "comments",
  line_breaks: true,
});
const BrokenComment = createToken({
  name: "BrokenComment",
  pattern: /\/\*[\s\S]*/,
  group: "invalid",
  line_breaks: true,
});
const Perl = createToken({ name: "Perl", pattern: /<%[\s\S]*?%>/, line_breaks: true });
const BrokenPerl = createToken({ name: "BrokenPerl", pattern: /<%[\s\S]*/, line_breaks: true });
const Directive = createToken({
  name: "Directive",
  pattern:
    /`(?:define|undef|ifdef|ifndef|elsif|else|endif|include|line|if|begin_keywords|celldefine|default_nettype|end_keywords|endcelldefine|nounconnected_drive|pragma|resetall|timescale|unconnected_drive)\b(?:\\\r?\n|[^\r\n])*/,
  line_breaks: true,
});
const Macro = createToken({ name: "Macro", pattern: /`[a-zA-Z_][a-zA-Z_0-9]*/ });
const StringToken = createToken({
  name: "StringLiteral",
  pattern: /"(?:\\[\s\S]|[^"\\])*"/,
  line_breaks: true,
});
const BrokenString = createToken({
  name: "BrokenString",
  pattern: /"(?:\\[\s\S]|[^"\\])*/,
  group: "invalid",
  line_breaks: true,
});
const NumberToken = createToken({
  name: "NumberLiteral",
  pattern:
    /(?:[0-9]+'[bB][01][01_]*|[0-9]+'[dD][0-9][0-9_]*|[0-9]+'[hH][0-9a-fA-F][0-9a-fA-F_]*|0[xX][0-9a-fA-F][0-9a-fA-F_]*|[0-9][0-9_]*)/,
});
const InvalidOperator = createToken({
  name: "InvalidOperator",
  pattern: /(?:<<<|>>>|===|!==|==\?|!=\?|\+\+|--)/,
  group: "invalid",
});
const Invalid = createToken({
  name: "Invalid",
  pattern: /[^]/,
  group: "invalid",
  line_breaks: true,
});
const vocabulary = [
  Word,
  Space,
  CommentToken,
  BrokenComment,
  Perl,
  BrokenPerl,
  Directive,
  Macro,
  StringToken,
  BrokenString,
  NumberToken,
  ...words.values(),
  Identifier,
  InvalidOperator,
  ...symbols.values(),
  Invalid,
];
const lexer = new Lexer(vocabulary, { positionTracking: "onlyOffset" });
const components = [Addrmap, Regfile, Reg, Field, Mem, Signal];
const opaque = [Perl, BrokenPerl, Directive, Macro];

/** Recognition and recovery are private. Original source never comes from this CST. */
class RdlParser extends CstParser {
  constructor() {
    super(vocabulary, {
      recoveryEnabled: true,
      nodeLocationTracking: "onlyOffset",
      maxLookahead: 3,
    });
    this.performSelfAnalysis();
  }
  private is(token: TokenType, offset = 1): boolean {
    return tokenMatcher(this.LA(offset), token);
  }
  private isComponent(): boolean {
    return (
      components.some((token) => this.is(token)) ||
      ((this.is(External) || this.is(Internal)) && components.some((token) => this.is(token, 2)))
    );
  }
  private isInstance(): boolean {
    return (
      this.is(External) ||
      this.is(Internal) ||
      this.is(Alias) ||
      (this.is(Identifier) && (this.is(Identifier, 2) || this.is(Hash, 2)))
    );
  }
  document = this.RULE("document", () => {
    this.MANY(() => this.SUBRULE(this.item));
  });
  item = this.RULE("item", () => {
    this.OR([
      ...opaque.map((token) => ({ ALT: () => this.CONSUME(token, { LABEL: "opaque" }) })),
      {
        ALT: () => {
          this.SUBRULE(this.statement);
          this.CONSUME(Semi);
        },
      },
    ]);
  });
  statement = this.RULE("statement", () => {
    this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        { GATE: () => this.isComponent(), ALT: () => this.SUBRULE(this.componentDefinition) },
        { ALT: () => this.SUBRULE(this.propertyDefinition) },
        { ALT: () => this.SUBRULE(this.enumDefinition) },
        { ALT: () => this.SUBRULE(this.structDefinition) },
        { ALT: () => this.SUBRULE(this.constraintDefinition) },
        { GATE: () => this.isInstance(), ALT: () => this.SUBRULE(this.explicitInstance) },
        { ALT: () => this.SUBRULE(this.assignment) },
      ],
    });
  });
  componentKind = this.RULE("componentKind", () => {
    this.OR(components.map((token) => ({ ALT: () => this.CONSUME(token) })));
  });
  storage = this.RULE("storage", () => {
    this.OR([{ ALT: () => this.CONSUME(External) }, { ALT: () => this.CONSUME(Internal) }]);
  });
  componentDefinition = this.RULE("componentDefinition", () => {
    this.OPTION(() => this.SUBRULE(this.storage));
    this.SUBRULE(this.componentKind);
    this.OPTION2(() => this.CONSUME(Identifier, { LABEL: "name" }));
    this.OPTION3(() => this.SUBRULE(this.parameterList));
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.item));
    this.CONSUME(RBrace);
    this.OPTION4(() => this.SUBRULE2(this.storage));
    this.OPTION5(() => this.SUBRULE(this.instanceList));
  });
  parameterList = this.RULE("parameterList", () => {
    this.CONSUME(Hash);
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.parameter) });
    this.CONSUME(RParen);
  });
  dataType = this.RULE("dataType", () => {
    this.CONSUME(Word);
    this.OPTION(() => this.CONSUME(Unsigned));
  });
  parameter = this.RULE("parameter", () => {
    this.SUBRULE(this.dataType);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OPTION(() => {
      this.CONSUME(LBracket);
      this.CONSUME(RBracket);
    });
    this.OPTION2(() => {
      this.CONSUME(Assign);
      this.SUBRULE(this.expression);
    });
  });
  argumentList = this.RULE("argumentList", () => {
    this.CONSUME(Hash);
    this.CONSUME(LParen);
    this.AT_LEAST_ONE_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.argument) });
    this.CONSUME(RParen);
  });
  argument = this.RULE("argument", () => {
    this.CONSUME(Dot);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.CONSUME(LParen);
    this.SUBRULE(this.expression);
    this.CONSUME(RParen);
  });
  explicitInstance = this.RULE("explicitInstance", () => {
    this.OPTION(() => this.SUBRULE(this.storage));
    this.OPTION2(() => {
      this.CONSUME(Alias);
      this.CONSUME(Identifier, { LABEL: "alias" });
    });
    this.CONSUME2(Identifier, { LABEL: "type" });
    this.SUBRULE(this.instanceList);
  });
  instanceList = this.RULE("instanceList", () => {
    this.OPTION(() => this.SUBRULE(this.argumentList));
    this.AT_LEAST_ONE_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.instance) });
  });
  instance = this.RULE("instance", () => {
    this.CONSUME(Identifier, { LABEL: "name" });
    this.MANY(() => this.SUBRULE(this.dimension));
    this.OPTION(() => {
      this.CONSUME(Assign);
      this.SUBRULE(this.expression, { LABEL: "reset" });
    });
    this.OPTION2(() => {
      this.CONSUME(At);
      this.SUBRULE2(this.expression, { LABEL: "address" });
    });
    this.OPTION3(() => {
      this.CONSUME(Stride);
      this.SUBRULE3(this.expression, { LABEL: "stride" });
    });
    this.OPTION4(() => {
      this.CONSUME(Align);
      this.SUBRULE4(this.expression, { LABEL: "alignment" });
    });
  });
  dimension = this.RULE("dimension", () => {
    this.CONSUME(LBracket);
    this.SUBRULE(this.expression, { LABEL: "left" });
    this.OPTION(() => {
      this.CONSUME(Colon);
      this.SUBRULE2(this.expression, { LABEL: "right" });
    });
    this.CONSUME(RBracket);
  });
  assignment = this.RULE("assignment", () => {
    this.OPTION(() => this.CONSUME(Default));
    this.OPTION2(() => this.SUBRULE(this.modifier));
    this.SUBRULE(this.reference, { LABEL: "left" });
    this.OPTION3(() => {
      this.CONSUME(Assign);
      this.SUBRULE(this.expression);
    });
  });
  modifier = this.RULE("modifier", () => {
    this.OR(modifiers.map((token) => ({ ALT: () => this.CONSUME(token) })));
  });
  propertyDefinition = this.RULE("propertyDefinition", () => {
    this.CONSUME(Property);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.CONSUME(LBrace);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.propertyAttribute));
    this.CONSUME(RBrace);
  });
  propertyAttribute = this.RULE("propertyAttribute", () => {
    this.CONSUME(Word, { LABEL: "name" });
    this.CONSUME(Assign);
    this.OR({
      IGNORE_AMBIGUITIES: true,
      DEF: [
        {
          GATE: () => this.LA(0).image === "=" && this.LA(-1).image === "type",
          ALT: () => {
            this.SUBRULE(this.dataType);
            this.OPTION(() => {
              this.CONSUME(LBracket);
              this.CONSUME(RBracket);
            });
          },
        },
        { ALT: () => this.SUBRULE(this.expression) },
      ],
    });
    this.CONSUME(Semi);
  });
  enumDefinition = this.RULE("enumDefinition", () => {
    this.CONSUME(Enum);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.CONSUME(LBrace);
    this.AT_LEAST_ONE(() => this.SUBRULE(this.enumMember));
    this.CONSUME(RBrace);
  });
  enumMember = this.RULE("enumMember", () => {
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OPTION(() => {
      this.CONSUME(Assign);
      this.SUBRULE(this.expression);
    });
    this.OPTION2(() => {
      this.CONSUME(LBrace);
      this.MANY(() => this.SUBRULE(this.item));
      this.CONSUME(RBrace);
    });
    this.CONSUME(Semi);
  });
  structDefinition = this.RULE("structDefinition", () => {
    this.OPTION(() => this.CONSUME(Abstract));
    this.CONSUME(Struct);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OPTION2(() => {
      this.CONSUME(Colon);
      this.CONSUME2(Identifier, { LABEL: "base" });
    });
    this.CONSUME(LBrace);
    this.MANY(() => this.SUBRULE(this.member));
    this.CONSUME(RBrace);
  });
  member = this.RULE("member", () => {
    this.SUBRULE(this.dataType);
    this.CONSUME(Identifier, { LABEL: "name" });
    this.OPTION(() => {
      this.CONSUME(LBracket);
      this.CONSUME(RBracket);
    });
    this.CONSUME(Semi);
  });
  constraintDefinition = this.RULE("constraintDefinition", () => {
    this.CONSUME(Constraint);
    this.OPTION(() => this.CONSUME(Identifier, { LABEL: "name" }));
    this.SUBRULE(this.opaqueBody);
    this.OPTION2(() => this.SUBRULE(this.instanceList));
  });
  opaqueBody = this.RULE("opaqueBody", () => {
    this.CONSUME(LBrace);
    this.MANY(() =>
      this.OR([
        { ALT: () => this.SUBRULE(this.opaqueBody) },
        ...[Word, NumberToken, StringToken, ...symbols.values()]
          .filter((token) => token !== LBrace && token !== RBrace)
          .map((token) => ({ ALT: () => this.CONSUME(token) })),
      ]),
    );
    this.CONSUME(RBrace);
  });
  expression = this.RULE("expression", () => {
    this.SUBRULE(this.logicalOr);
    this.OPTION(() => {
      this.CONSUME(Question);
      this.SUBRULE(this.expression);
      this.CONSUME(Colon);
      this.SUBRULE2(this.expression);
    });
  });
  logicalOr = this.binary("logicalOr", () => this.logicalAnd, [LogicOr]);
  logicalAnd = this.binary("logicalAnd", () => this.bitOr, [LogicAnd]);
  bitOr = this.binary("bitOr", () => this.bitXor, [Or]);
  bitXor = this.binary("bitXor", () => this.bitAnd, [Xor, Xnor, XnorAlt]);
  bitAnd = this.binary("bitAnd", () => this.equality, [And]);
  equality = this.binary("equality", () => this.relation, [Eq, Ne]);
  relation = this.binary("relation", () => this.shift, [Lt, Le, Gt, Ge]);
  shift = this.binary("shift", () => this.additive, [ShiftLeft, ShiftRight]);
  additive = this.binary("additive", () => this.multiplicative, [Plus, Minus]);
  multiplicative = this.binary("multiplicative", () => this.power, [Star, Slash, Percent]);
  power = this.binary("power", () => this.unary, [Power]);
  private binary(name: string, next: () => () => CstNode, operators: TokenType[]): () => CstNode {
    return this.RULE(name, () => {
      this.SUBRULE(next());
      this.MANY(() => {
        this.OR(operators.map((token) => ({ ALT: () => this.CONSUME(token) })));
        this.SUBRULE2(next());
      });
    });
  }
  unary = this.RULE("unary", () => {
    this.OR([
      {
        ALT: () => {
          this.OR2(
            [Plus, Minus, Not, Tilde, And, Or, Xor, Nand, Nor, Xnor, XnorAlt].map((token) => ({
              ALT: () => this.CONSUME(token),
            })),
          );
          this.SUBRULE(this.unary);
        },
      },
      { ALT: () => this.SUBRULE(this.primary) },
    ]);
  });
  primary = this.RULE("primary", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(NumberToken);
          this.OPTION(() => this.SUBRULE(this.castSuffix));
        },
      },
      { ALT: () => this.CONSUME(StringToken) },
      {
        ALT: () => {
          this.CONSUME(LParen);
          this.SUBRULE(this.expression);
          this.CONSUME(RParen);
          this.OPTION2(() => this.SUBRULE2(this.castSuffix));
        },
      },
      {
        ALT: () => {
          this.CONSUME(Quote);
          this.SUBRULE(this.arrayLiteral);
        },
      },
      { ALT: () => this.SUBRULE(this.concatenation) },
      {
        ALT: () => {
          this.SUBRULE(this.reference);
          this.OPTION3(() => {
            this.CONSUME2(Quote);
            this.OR2([
              {
                ALT: () => {
                  this.CONSUME2(LParen);
                  this.SUBRULE2(this.expression);
                  this.CONSUME2(RParen);
                },
              },
              { ALT: () => this.SUBRULE(this.structLiteral) },
            ]);
          });
        },
      },
      { ALT: () => this.CONSUME(Macro) },
    ]);
  });
  castSuffix = this.RULE("castSuffix", () => {
    this.CONSUME(Quote);
    this.CONSUME(LParen);
    this.SUBRULE(this.expression);
    this.CONSUME(RParen);
  });
  reference = this.RULE("reference", () => {
    this.CONSUME(Word);
    this.MANY(() => this.SUBRULE(this.subscript));
    this.OPTION(() => {
      this.CONSUME(Scope);
      this.CONSUME2(Word);
    });
    this.MANY2(() => {
      this.CONSUME(Dot);
      this.CONSUME3(Word);
      this.MANY3(() => this.SUBRULE2(this.subscript));
    });
    this.OPTION2(() => {
      this.CONSUME(Arrow);
      this.CONSUME4(Word);
    });
  });
  subscript = this.RULE("subscript", () => {
    this.CONSUME(LBracket);
    this.SUBRULE(this.expression);
    this.OPTION(() => {
      this.CONSUME(Colon);
      this.SUBRULE2(this.expression);
    });
    this.CONSUME(RBracket);
  });
  arrayLiteral = this.RULE("arrayLiteral", () => {
    this.CONSUME(LBrace);
    this.MANY_SEP({ SEP: Comma, DEF: () => this.SUBRULE(this.expression) });
    this.CONSUME(RBrace);
  });
  structLiteral = this.RULE("structLiteral", () => {
    this.CONSUME(LBrace);
    this.MANY_SEP({
      SEP: Comma,
      DEF: () => {
        this.CONSUME(Identifier);
        this.CONSUME(Colon);
        this.SUBRULE(this.expression);
      },
    });
    this.CONSUME(RBrace);
  });
  concatenation = this.RULE("concatenation", () => {
    this.CONSUME(LBrace);
    this.SUBRULE(this.expression);
    this.OR([
      { ALT: () => this.SUBRULE(this.concatenation) },
      {
        ALT: () =>
          this.MANY(() => {
            this.CONSUME(Comma);
            this.SUBRULE2(this.expression);
          }),
      },
    ]);
    this.CONSUME(RBrace);
  });
}
const parser = new RdlParser();

function nodes(cst: CstNode, name: string): CstNode[] {
  return (cst.children[name] ?? []).filter((child): child is CstNode => "children" in child);
}
function tokens(cst: CstNode, name: string): IToken[] {
  return (cst.children[name] ?? cst.children[`K_${name.toLowerCase()}`] ?? []).filter(
    (child): child is IToken => "tokenType" in child,
  );
}
function token(cst: CstNode, name: string): IToken | undefined {
  return tokens(cst, name)[0];
}
function child(cst: CstNode, name: string): CstNode | undefined {
  return nodes(cst, name)[0];
}
function allTokens(cst: CstNode): IToken[] {
  return Object.values(cst.children)
    .flatMap((children) =>
      children.flatMap((entry) => ("children" in entry ? allTokens(entry) : [entry])),
    )
    .filter(
      (entry) =>
        Number.isFinite(entry.startOffset) && entry.startOffset >= 0 && !entry.isInsertedInRecovery,
    )
    .sort((a, b) => a.startOffset - b.startOffset);
}
function hasRecovery(cst: CstNode): boolean {
  return (
    cst.recoveredNode === true ||
    Object.values(cst.children).some((children) =>
      children.some((entry) =>
        "children" in entry ? hasRecovery(entry) : entry.isInsertedInRecovery === true,
      ),
    )
  );
}
function endOf(t: IToken): number {
  return (t.endOffset ?? t.startOffset + t.image.length - 1) + 1;
}
function unescape(name: string): string {
  return name.startsWith("\\") ? name.slice(1) : name;
}

class Records {
  constructor(
    readonly text: string,
    readonly documentId: string,
    readonly diagnostics: Diagnostic[],
  ) {}
  range(start: number, end: number): SourceRange {
    return { documentId: this.documentId, start, end };
  }
  span(cst: CstNode): SourceRange {
    const list = allTokens(cst),
      first = list[0],
      last = list.at(-1);
    return this.range(first?.startOffset ?? 0, last ? endOf(last) : (first?.startOffset ?? 0));
  }
  tokenRange(t: IToken | undefined): SourceRange | undefined {
    return t && Number.isFinite(t.startOffset) && t.startOffset >= 0 && !t.isInsertedInRecovery
      ? this.range(t.startOffset, endOf(t))
      : undefined;
  }
  expression(cst: CstNode | undefined): ExpressionSyntax | undefined {
    if (!cst) return undefined;
    const range = this.span(cst);
    return { range, text: this.text.slice(range.start, range.end) };
  }
  base(
    cst: CstNode,
    kind: SyntaxNode["kind"],
    nameToken = token(cst, "name"),
    enclosing?: SourceRange,
  ): SyntaxNode {
    const range = enclosing ?? this.span(cst);
    const uncertain =
      hasRecovery(cst) ||
      this.diagnostics.some(
        (d) => d.range && d.range.start < range.end && d.range.end > range.start,
      );
    return {
      id: `${this.documentId}:${range.start}:${range.end}:${kind}`,
      kind,
      name: unescape(nameToken?.image ?? ""),
      range,
      nameRange: this.tokenRange(nameToken),
      uncertain,
    };
  }
  body(cst: CstNode): SourceRange | undefined {
    const open = token(cst, "LBrace"),
      close = token(cst, "RBrace");
    return open && close && !close.isInsertedInRecovery
      ? this.range(endOf(open), close.startOffset)
      : undefined;
  }
  storage(cst: CstNode): { external?: boolean; internal?: boolean } {
    const modes = nodes(cst, "storage")
      .flatMap(allTokens)
      .map((t) => t.image);
    return {
      external: modes.includes("external") || undefined,
      internal: modes.includes("internal") || undefined,
    };
  }
  parameters(cst: CstNode): ParameterSyntax[] {
    const list = child(cst, "parameterList");
    return list
      ? nodes(list, "parameter").map((parameter) => ({
          name: unescape(token(parameter, "name")?.image ?? ""),
          type: `${this.expression(child(parameter, "dataType"))?.text ?? ""}${token(parameter, "LBracket") ? "[]" : ""}`,
          value: this.expression(child(parameter, "expression")),
          range: this.span(parameter),
        }))
      : [];
  }
  arguments(cst: CstNode): ArgumentSyntax[] {
    const list = child(cst, "argumentList");
    return list
      ? nodes(list, "argument").flatMap((argument) => {
          const value = this.expression(child(argument, "expression"));
          return value ? [{ name: unescape(token(argument, "name")?.image ?? ""), value }] : [];
        })
      : [];
  }
  instances(
    cst: CstNode,
    component?: ComponentKind,
    type?: IToken,
    enclosing?: SourceRange,
  ): SyntaxNode[] {
    const list = child(cst, "instanceList");
    if (!list) return [];
    const entries = nodes(list, "instance"),
      args = this.arguments(list);
    return entries.map((entry) => {
      const dims = nodes(entry, "dimension"),
        rangeDim = dims.find((dim) => child(dim, "right"));
      return {
        ...this.base(
          entry,
          "instance",
          token(entry, "name"),
          entries.length === 1 ? enclosing : undefined,
        ),
        component,
        typeName: type ? unescape(type.image) : undefined,
        typeRange: this.tokenRange(type),
        arguments: args,
        dimensions: dims
          .filter((dim) => !child(dim, "right"))
          .flatMap((dim) => {
            const e = this.expression(child(dim, "left"));
            return e ? [e] : [];
          }),
        msb: rangeDim ? this.expression(child(rangeDim, "left")) : undefined,
        lsb: rangeDim ? this.expression(child(rangeDim, "right")) : undefined,
        expression: this.expression(child(entry, "reset")),
        address: this.expression(child(entry, "address")),
        stride: this.expression(child(entry, "stride")),
        alignment: this.expression(child(entry, "alignment")),
        ...this.storage(cst),
        alias: token(cst, "alias")?.image,
      };
    });
  }
  items(cst: CstNode): SyntaxNode[] {
    return nodes(cst, "item").flatMap((item) => this.item(item));
  }
  item(item: CstNode): SyntaxNode[] {
    const result = this.decodeItem(item);
    return hasRecovery(item) ? result.map((node) => ({ ...node, uncertain: true })) : result;
  }
  private decodeItem(item: CstNode): SyntaxNode[] {
    const statement = child(item, "statement");
    if (!statement) {
      const opaqueToken = token(item, "opaque");
      return opaqueToken ? [{ ...this.base(item, "unknown", opaqueToken), uncertain: true }] : [];
    }
    const range = this.span(item);
    const node = Object.values(statement.children)
      .flat()
      .find((entry): entry is CstNode => "children" in entry);
    if (!node) return [{ ...this.base(item, "unknown"), uncertain: true }];
    switch (node.name) {
      case "componentDefinition": {
        const kindNode = child(node, "componentKind");
        const component = kindNode ? (allTokens(kindNode)[0]?.image as ComponentKind) : undefined;
        const result = {
          ...this.base(node, "component", token(node, "name"), range),
          component,
          bodyRange: this.body(node),
          children: this.items(node),
          parameters: this.parameters(node),
          instances: this.instances(node, component, token(node, "name")),
          ...this.storage(node),
        };
        if (!result.name && result.instances.length === 0) {
          this.diagnostics.push({
            code: "syntax.anonymous-instance",
            severity: "error",
            phase: "syntax",
            message: "An anonymous component requires an instance.",
            range,
          });
          return [{ ...result, uncertain: true }];
        }
        return [result];
      }
      case "explicitInstance":
        return this.instances(node, undefined, token(node, "type"), range);
      case "assignment":
        return [this.assignment(node, range)];
      case "propertyDefinition":
        return [
          {
            ...this.base(node, "property", token(node, "name"), range),
            bodyRange: this.body(node),
            children: nodes(node, "propertyAttribute").map((attr) => {
              const name = token(attr, "name"),
                equal = token(attr, "Assign"),
                semi = token(attr, "Semi"),
                attrRange = this.span(attr);
              const start = equal ? endOf(equal) : attrRange.start,
                end = semi?.startOffset ?? attrRange.end;
              const raw = this.text.slice(start, end),
                trimmed = raw.trim(),
                offset = raw.indexOf(trimmed);
              return {
                ...this.base(attr, "assignment", name),
                expression: {
                  text: trimmed,
                  range: this.range(start + offset, start + offset + trimmed.length),
                },
              };
            }),
          },
        ];
      case "enumDefinition":
        return [
          {
            ...this.base(node, "enum", token(node, "name"), range),
            bodyRange: this.body(node),
            children: nodes(node, "enumMember").map((member) => ({
              ...this.base(member, "enumMember"),
              expression: this.expression(child(member, "expression")),
              bodyRange: this.body(member),
              children: this.items(member),
            })),
          },
        ];
      case "structDefinition":
        return [
          {
            ...this.base(node, "struct", token(node, "name"), range),
            bodyRange: this.body(node),
            abstract: !!token(node, "Abstract"),
            extends: token(node, "base")?.image,
            children: nodes(node, "member").map((member) => ({
              ...this.base(member, "member"),
              typeName: `${this.expression(child(member, "dataType"))?.text ?? ""}${token(member, "LBracket") ? "[]" : ""}`,
              typeRange: child(member, "dataType")
                ? this.span(child(member, "dataType")!)
                : undefined,
            })),
          },
        ];
      case "constraintDefinition": {
        this.diagnostics.push({
          code: "unsupported.constraints",
          severity: "warning",
          phase: "syntax",
          message: "Constraint syntax is retained, but constraint semantics are unsupported.",
          range,
        });
        return [{ ...this.base(node, "constraint", token(node, "name"), range), uncertain: true }];
      }
      default:
        return [{ ...this.base(node, "unknown", undefined, range), uncertain: true }];
    }
  }
  assignment(node: CstNode, range: SourceRange): SyntaxNode {
    const left = child(node, "left"),
      list = left ? allTokens(left) : [],
      arrow = list.findIndex((entry) => entry.image === "->");
    const name = arrow >= 0 ? list[arrow + 1] : list[0];
    const targetRange =
      arrow > 0 ? this.range(list[0]!.startOffset, endOf(list[arrow - 1]!)) : undefined;
    const modifier = child(node, "modifier");
    const expression = this.expression(child(node, "expression"));
    if (arrow < 0 && list.length > 1)
      this.diagnostics.push({
        code: "syntax.assignment-target",
        severity: "error",
        phase: "syntax",
        message:
          "A property assignment requires a property name or an instance followed by -> and a property name.",
        range,
      });
    return {
      ...this.base(node, "assignment", name, range),
      target: targetRange
        ? list
            .slice(0, arrow)
            .map((entry) => unescape(entry.image))
            .join("")
        : undefined,
      targetRange,
      default: !!token(node, "Default"),
      expression,
      modifier: modifier ? (allTokens(modifier)[0]?.image as SyntaxNode["modifier"]) : undefined,
    };
  }
}

/** Bound recursive grammar depth before entering the parser's synchronous call stack. */
function excessiveDepth(input: readonly IToken[]): IToken | undefined {
  let nesting = 0;
  let prefixes = 0;
  let conditionals = 0;
  for (const entry of input) {
    const image = entry.image;
    if (["(", "[", "{"].includes(image)) nesting++;
    if ([")", "]", "}"].includes(image)) nesting = Math.max(0, nesting - 1);
    if (["+", "-", "!", "~", "&", "|", "^", "~&", "~|", "~^", "^~"].includes(image)) prefixes++;
    else prefixes = 0;
    if (image === "?") conditionals++;
    if (image === ";") conditionals = 0;
    if (nesting > 64 || prefixes > 64 || conditionals > 64) return entry;
  }
  return undefined;
}

/** Tokens for expression evaluation. Offsets are UTF-16 code units in the input. */
export function tokenizeExpression(
  text: string,
): readonly { readonly text: string; readonly start: number; readonly end: number }[] {
  return lexer
    .tokenize(text)
    .tokens.map((t) => ({ text: t.image, start: t.startOffset, end: endOf(t) }));
}

export function validateExpression(text: string): boolean {
  const lexed = lexer.tokenize(text);
  if (
    lexed.errors.length ||
    (lexed.groups.invalid?.length ?? 0) ||
    lexed.tokens.length === 0 ||
    lexed.tokens.some((t) => opaque.includes(t.tokenType))
  )
    return false;
  if (excessiveDepth(lexed.tokens)) return false;
  parser.input = lexed.tokens;
  parser.expression();
  return parser.errors.length === 0;
}

export function parseDocument(text: string, documentId: string): ParsedDocument {
  const lexed = lexer.tokenize(text);
  const diagnostics: Diagnostic[] = [];
  const range = (start: number, end: number): SourceRange => ({ documentId, start, end });
  for (const t of lexed.groups.invalid ?? [])
    diagnostics.push({
      code: "syntax.invalid-token",
      severity: "error",
      phase: "syntax",
      message: `Invalid or unterminated source token ${JSON.stringify(t.image.slice(0, 40))}.`,
      range: range(t.startOffset, endOf(t)),
    });
  for (const error of lexed.errors)
    diagnostics.push({
      code: "syntax.lexical",
      severity: "error",
      phase: "syntax",
      message: error.message,
      range: range(error.offset, error.offset + error.length),
    });
  for (const t of lexed.tokens)
    if (opaque.includes(t.tokenType))
      diagnostics.push({
        code:
          t.tokenType === Perl || t.tokenType === BrokenPerl
            ? "unsupported.perl"
            : "syntax.preprocessing-required",
        severity: "warning",
        phase: "syntax",
        message:
          t.tokenType === Perl || t.tokenType === BrokenPerl
            ? "Embedded Perl is retained without execution."
            : "This source construct requires preprocessing before language analysis.",
        range: range(t.startOffset, endOf(t)),
      });
  const depth = excessiveDepth(lexed.tokens);
  if (depth) {
    diagnostics.push({
      code: "resource.syntax-depth",
      severity: "error",
      phase: "resource",
      message:
        "Source exceeds the parser limit of 64 nested delimiters, consecutive unary operators, or conditional operators per statement.",
      range: range(depth.startOffset, endOf(depth)),
    });
    return {
      nodes: [],
      diagnostics,
      comments: (lexed.groups.comments ?? []).map((t) => ({
        range: range(t.startOffset, endOf(t)),
        text: t.image,
      })),
    };
  }
  parser.input = lexed.tokens;
  const cst = parser.document();
  for (const error of parser.errors) {
    const start = Number.isFinite(error.token.startOffset) ? error.token.startOffset : text.length;
    diagnostics.push({
      code: "syntax.parse",
      severity: "error",
      phase: "syntax",
      message: error.message,
      range: range(start, Number.isFinite(error.token.endOffset) ? endOf(error.token) : start),
    });
  }
  const records = new Records(text, documentId, diagnostics);
  const result = records.items(cst);
  return {
    nodes: result,
    diagnostics,
    comments: (lexed.groups.comments ?? []).map((t) => ({
      range: range(t.startOffset, endOf(t)),
      text: t.image,
    })),
  };
}
