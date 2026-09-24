import { Result } from "effect";
import { evaluateExpression, integer, isInteger, type ExpressionContext } from "./expressions.js";
import { builtinProperties } from "./properties.js";
import { preprocess } from "./preprocess.js";
import { parseDocument, tokenizeExpression } from "./syntax.js";
import type {
  AnalysisReport,
  ComponentKind,
  Diagnostic,
  ExpandedUnit,
  ExpressionSyntax,
  Instance,
  PropertyValue,
  ProjectInput,
  RdlValue,
  SourceRange,
  SourceProvenance,
  SymbolReference,
  SyntaxNode,
} from "./types.js";

interface Scope {
  parent?: Scope;
  nodes: Map<string, SyntaxNode>;
  types: Map<string, SyntaxNode>;
  values: Map<string, RdlValue>;
  defaults: Map<string, { node: SyntaxNode; scope: Scope }>;
  owner?: MutableInstance;
}
interface Udp {
  name: string;
  type: string;
  components: readonly string[];
  default?: ExpressionSyntax;
  constraint?: string;
  range?: SourceRange;
  scope: Scope;
}
interface MutableInstance {
  id: string;
  path: string;
  name: string;
  kind: ComponentKind;
  definition: SourceRange;
  source: SourceRange;
  properties: Record<string, PropertyValue>;
  children: MutableInstance[];
  dimensions: bigint[];
  address?: bigint;
  size?: bigint;
  stride?: bigint;
  lsb?: bigint;
  msb?: bigint;
  alias?: string;
  interruptType?: Instance["interruptType"];
  nonsticky?: boolean;
  syntax: SyntaxNode;
  declaration: SyntaxNode;
  scope: Scope;
  parent?: MutableInstance;
}
const componentKinds = new Set(["addrmap", "regfile", "reg", "field", "mem", "signal"]);
const powerOfTwo = (n: bigint) => n > 0n && (n & (n - 1n)) === 0n;
const roundUp = (n: bigint, alignment: bigint) =>
  alignment > 0n ? ((n + alignment - 1n) / alignment) * alignment : n;
const ceilPower = (n: bigint) => {
  let p = 1n;
  while (p < n) p <<= 1n;
  return p;
};
export function analyzeInput(
  input: ProjectInput,
  revision: string,
  configurationId: string,
): AnalysisReport {
  const config = input.configurations.find((c) => c.id === configurationId);
  const diagnostics: Diagnostic[] = [],
    references: SymbolReference[] = [],
    reasons: string[] = [];
  if (!config)
    return {
      revision,
      configurationId,
      diagnostics: [
        {
          code: "configuration.unknown",
          severity: "error",
          phase: "semantic",
          message: `Unknown configuration '${configurationId}'.`,
        },
      ],
      coverage: { complete: false, reasons: ["Unknown configuration"] },
      model: "unavailable",
      roots: [],
      references,
    };
  const expanded = preprocess(input, config);
  diagnostics.push(...expanded.diagnostics);
  if (!expanded.complete) reasons.push("Preprocessing is incomplete.");
  const units = new Map<string, ExpandedUnit>(expanded.units.map((unit) => [unit.root, unit]));
  function physical(range: SourceRange): SourceRange {
    const unit = units.get(range.documentId);
    if (!unit) return range;
    const origin = unit.origins.find((o) => o.start <= range.start && o.end > range.start);
    if (!origin) return range;
    if (origin.generated) return origin.source;
    const start = origin.source.start + range.start - origin.start;
    const last = unit.origins.find((o) => o.start < range.end && o.end >= range.end);
    const end =
      last && !last.generated && last.source.documentId === origin.source.documentId
        ? last.source.start + range.end - last.start
        : Math.min(origin.source.end, start + range.end - range.start);
    return { documentId: origin.source.documentId, start, end };
  }
  function generated(range: SourceRange) {
    return (
      units
        .get(range.documentId)
        ?.origins.some((o) => o.generated && o.start < range.end && o.end > range.start) ?? false
    );
  }
  function provenance(range: SourceRange): SourceProvenance {
    const unit = units.get(range.documentId),
      origins =
        unit?.origins.filter((origin) => origin.start < range.end && origin.end > range.start) ??
        [];
    const first = origins[0];
    const chain = [
      ...new Map(
        origins
          .flatMap((origin) => origin.chain ?? [])
          .map((source) => [`${source.documentId}:${source.start}:${source.end}`, source]),
      ).values(),
    ];
    const lineOffset =
      first && !first.generated && unit
        ? (unit.text.slice(first.start, range.start).match(/\r\n|\r|\n/g)?.length ?? 0)
        : 0;
    return {
      range: physical(range),
      generated: origins.some((origin) => origin.generated),
      ...(chain.length ? { chain } : {}),
      ...(first?.logical
        ? { logical: { file: first.logical.file, line: first.logical.line + lineOffset } }
        : {}),
    };
  }
  function diagnostic(code: string, message: string, range?: SourceRange, incomplete = false) {
    diagnostics.push({
      code,
      severity: "error",
      phase: incomplete ? "resource" : "semantic",
      message,
      ...(range ? { range: physical(range), provenance: provenance(range) } : {}),
    });
    if (incomplete) reasons.push(message);
  }
  const referenceKeys = new Set<string>();
  function reference(name: string, definition: SourceRange, range: SourceRange) {
    const record: SymbolReference = {
      name,
      definition: physical(definition),
      range: physical(range),
      generated: generated(range),
      provenance: provenance(range),
    };
    // Different bindings or expansion provenance remain distinct, even at one physical range.
    const key = JSON.stringify(record);
    if (referenceKeys.has(key)) return;
    referenceKeys.add(key);
    references.push(record);
  }
  const rootScope: Scope = {
    nodes: new Map(),
    types: new Map(),
    values: new Map(),
    defaults: new Map(),
  };
  const declarationScopes = new Map<SyntaxNode, Scope>(),
    udps = new Map<string, Udp>();
  const rootNodes: SyntaxNode[] = [];
  const unitNodes: { nodes: readonly SyntaxNode[]; scope: Scope }[] = [];
  const unitOrder = new Map(expanded.units.map((unit, index) => [unit.root, index]));
  function declaredBefore(definition: SourceRange, use: SourceRange) {
    const a = unitOrder.get(definition.documentId),
      b = unitOrder.get(use.documentId);
    return (
      a === undefined || b === undefined || a < b || (a === b && definition.start <= use.start)
    );
  }
  for (const unit of expanded.units) {
    const parsed = parseDocument(unit.text, unit.root);
    diagnostics.push(
      ...parsed.diagnostics.map((d) => ({
        ...d,
        ...(d.range ? { range: physical(d.range), provenance: provenance(d.range) } : {}),
      })),
    );
    if (parsed.diagnostics.some((d) => d.severity === "error"))
      reasons.push("Syntax recovery prevented complete semantic analysis.");
    rootNodes.push(...parsed.nodes);
    unitNodes.push({
      nodes: parsed.nodes,
      scope: {
        parent: rootScope,
        nodes: rootScope.nodes,
        types: rootScope.types,
        values: rootScope.values,
        defaults: new Map(),
      },
    });
  }
  function lookup(
    scope: Scope,
    name: string,
    type = false,
  ): { node?: SyntaxNode; value?: RdlValue; scope: Scope } | undefined {
    for (let current: Scope | undefined = scope; current; current = current.parent) {
      if (type) {
        if (current.types.has(name)) return { node: current.types.get(name)!, scope: current };
        continue;
      }
      if (current.values.has(name))
        return { value: current.values.get(name)!, node: current.nodes.get(name), scope: current };
      if (current.nodes.has(name)) return { node: current.nodes.get(name)!, scope: current };
    }
    return undefined;
  }
  const roots: MutableInstance[] = [],
    building = new Set<SyntaxNode>();
  const declaredValueTypes = new Map<string, SyntaxNode>();
  const rangeKey = (range: SourceRange) => `${range.documentId}:${range.start}:${range.end}`;
  function collectTypes(nodes: readonly SyntaxNode[]) {
    for (const node of nodes) {
      if (node.kind === "enum" || node.kind === "struct")
        declaredValueTypes.set(rangeKey(physical(node.nameRange ?? node.range)), node);
      collectTypes(node.children ?? []);
    }
  }
  collectTypes(rootNodes);
  const evaluating = new Set<SyntaxNode>();
  function pathReferences(
    owner: MutableInstance | undefined,
    _path: string,
    range: SourceRange,
    text = _path,
  ) {
    const tokens = tokenizeExpression(text);
    for (let start = 0; start < tokens.length; start++) {
      const initial = tokens[start]!,
        previous = tokens[start - 1]?.text,
        next = tokens[start + 1]?.text;
      if (
        !/^\\?[A-Za-z_$][A-Za-z0-9_$]*$/.test(initial.text) ||
        [".", "::", "->"].includes(previous ?? "") ||
        ["::", "'", ":"].includes(next ?? "")
      )
        continue;
      let index = start,
        prefix = "";
      while (index < tokens.length) {
        const token = tokens[index]!;
        if (!/^\\?[A-Za-z_$][A-Za-z0-9_$]*$/.test(token.text)) break;
        const name = token.text.replace(/^\\/, "");
        prefix += prefix ? "." + name : name;
        const target = resolveInstance(owner, prefix);
        if (target)
          reference(name, target.syntax.nameRange ?? target.syntax.range, {
            ...range,
            start: range.start + token.start,
            end: range.start + token.end,
          });
        index++;
        while (tokens[index]?.text === "[") {
          let depth = 0;
          do {
            const text = tokens[index++]?.text;
            if (text === "[") depth++;
            if (text === "]") depth--;
          } while (index < tokens.length && depth > 0);
        }
        if (tokens[index]?.text !== ".") break;
        index++;
      }
      start = Math.max(start, index - 1);
    }
  }
  function typeReferences(scope: Scope, name: string, range: SourceRange, text: string) {
    const definition = lookup(scope, name, true)?.node;
    if (!definition) return;
    const tokens = tokenizeExpression(text);
    for (let index = 0; index < tokens.length; index++) {
      const token = tokens[index]!,
        previous = tokens[index - 1]?.text;
      if (
        token.text.replace(/^\\/, "") !== name ||
        [".", "::", "->"].includes(previous ?? "") ||
        tokens[index + 1]?.text === ":"
      )
        continue;
      reference(name, definition.nameRange ?? definition.range, {
        ...range,
        start: range.start + token.start,
        end: range.start + token.end,
      });
    }
  }
  function context(scope: Scope, expression?: ExpressionSyntax): ExpressionContext {
    return {
      reference: (path) => {
        if (expression) pathReferences(scope.owner, path, expression.range, expression.text);
      },
      resolve: (name) => {
        const [head, ...tail] = name.split(/::/);
        const found = lookup(scope, head!) ?? lookup(scope, head!, true);
        if (expression && found?.node && ["enum", "struct", "component"].includes(found.node.kind))
          typeReferences(scope, head!, expression.range, expression.text);
        if (found && expression && found.node) {
          if (!declaredBefore(found.node.range, expression.range))
            diagnostic(
              "name.before-declaration",
              `Identifier '${head}' is used before declaration.`,
              expression.range,
            );
          if (!["enum", "struct", "component"].includes(found.node.kind)) {
            const tokens = tokenizeExpression(expression.text);
            for (let index = 0; index < tokens.length; index++) {
              const token = tokens[index]!;
              if (
                token.text.replace(/^\\/, "") !== head ||
                [".", "::", "->"].includes(tokens[index - 1]?.text ?? "") ||
                tokens[index + 1]?.text === ":"
              )
                continue;
              reference(head!, found.node.nameRange ?? found.node.range, {
                ...expression.range,
                start: expression.range.start + token.start,
                end: expression.range.start + token.end,
              });
            }
          }
        }
        if (found?.value !== undefined && tail.length === 0) return found.value;
        if (found?.node?.kind === "enum") {
          if (tail.length === 0) return { kind: "reference", path: `@enum:${head}` };
          const member = found.node.children?.find((n) => n.name === tail[0]);
          if (!member) return undefined;
          if (expression) {
            const tokens = tokenizeExpression(expression.text);
            for (let index = 0; index + 2 < tokens.length; index++)
              if (
                tokens[index]!.text.replace(/^\\/, "") === head &&
                tokens[index + 1]!.text === "::" &&
                tokens[index + 2]!.text.replace(/^\\/, "") === member.name
              ) {
                const token = tokens[index + 2]!;
                reference(member.name, member.nameRange ?? member.range, {
                  ...expression.range,
                  start: expression.range.start + token.start,
                  end: expression.range.start + token.end,
                });
              }
          }
          if (evaluating.has(member)) {
            diagnostic("expression.cycle", "Circular enumeration value.", member.range);
            return undefined;
          }
          evaluating.add(member);
          let next = 0n;
          const seenValues = new Set<bigint>();
          for (const item of found.node.children ?? []) {
            const value = item.expression ? evalExpr(item.expression, found.scope) : integer(next);
            if (!isInteger(value)) {
              diagnostic("enum.type", "Enumeration values must be integers.", item.range);
              evaluating.delete(member);
              return undefined;
            }
            if (seenValues.has(value.value))
              diagnostic("enum.duplicate-value", "Enumeration values must be unique.", item.range);
            seenValues.add(value.value);
            next = value.value + 1n;
            if (item === member) {
              evaluating.delete(member);
              return {
                kind: "enum",
                type: head!,
                member: item.name,
                value: value.value,
                width: value.width,
                typeDefinition: physical(found.node.nameRange ?? found.node.range),
              };
            }
          }
          evaluating.delete(member);
          return undefined;
        }
        const instance = resolveInstance(scope.owner, name);
        if (instance) {
          if (expression) pathReferences(scope.owner, name, expression.range, expression.text);
          if (expression && !declaredBefore(instance.syntax.range, expression.range))
            diagnostic(
              "name.before-declaration",
              `Instance '${name}' is used before declaration.`,
              expression.range,
            );
          return { kind: "reference", path: instance.path };
        }
        if (name.includes("->")) {
          const [path, property] = name.split("->");
          const target = resolveInstance(scope.owner, path!);
          if (target) {
            if (expression) pathReferences(scope.owner, path!, expression.range, expression.text);
            return { kind: "reference", path: target.path, property: property! };
          }
        }
        // Retain symbolic references until layout, after checking source declaration order.
        if (
          found?.node?.kind === "instance" ||
          found?.node?.instances?.some((n) => n.name === head)
        )
          return {
            kind: "reference",
            path: found.scope.owner ? `${found.scope.owner.path}.${name}` : name,
          };
        return undefined;
      },
      struct: (name, members) => {
        if (expression) typeReferences(scope, name, expression.range, expression.text);
        const found = lookup(scope, name, true);
        if (!found?.node || found.node.kind !== "struct") return undefined;
        if (found.node.abstract) {
          diagnostic(
            "struct.abstract",
            `Cannot instantiate abstract struct '${name}'.`,
            expression?.range,
          );
          return undefined;
        }
        const fields = structMembers(found.node, found.scope);
        const values: Record<string, RdlValue> = {};
        for (const key of Object.keys(members))
          if (!fields.some((f) => f.name === key))
            diagnostic("struct.member", `Unknown member '${key}' in '${name}'.`, expression?.range);
        for (const field of fields) {
          let value =
            members[field.name] ??
            (field.expression
              ? evalExpr(field.expression, found.scope)
              : defaultValue(field.typeName ?? "", found.scope));
          if (value === undefined) {
            diagnostic("struct.member", `Member '${field.name}' has no value.`, expression?.range);
            continue;
          }
          value = coerce(field.typeName ?? "", value, found.scope, expression?.range);
          if (value !== undefined) values[field.name] = value;
        }
        return {
          kind: "struct",
          type: name,
          members: values,
          typeDefinition: physical(found.node.nameRange ?? found.node.range),
        };
      },
    };
  }
  function evalExpr(expression: ExpressionSyntax, scope: Scope): RdlValue | undefined {
    return evalText(expression.text, scope, expression);
  }
  function evalText(
    text: string,
    scope: Scope,
    expression?: ExpressionSyntax,
  ): RdlValue | undefined {
    const result = evaluateExpression(text, context(scope, expression));
    if (Result.isFailure(result)) {
      diagnostic(
        result.failure.code === "expression.nonconstant"
          ? "unsupported.runtime-reference"
          : result.failure.code === "expression.reserved-enum-concat"
            ? "unsupported.reserved-enum-concat"
            : result.failure.code,
        result.failure.message,
        expression?.range,
        [
          "expression.resource",
          "expression.nonconstant",
          "expression.reserved-enum-concat",
        ].includes(result.failure.code),
      );
      return undefined;
    }
    return result.success;
  }
  function structMembers(
    node: SyntaxNode,
    scope: Scope,
    chain: Set<SyntaxNode> = new Set(),
  ): SyntaxNode[] {
    if (chain.has(node)) {
      diagnostic("struct.cycle", "Circular struct inheritance.", node.range);
      return [];
    }
    chain.add(node);
    let members: SyntaxNode[] = [];
    if (node.extends) {
      const base = lookup(scope, node.extends, true);
      if (base?.node?.kind !== "struct")
        diagnostic("struct.base", `Unknown base struct '${node.extends}'.`, node.range);
      else members = structMembers(base.node, base.scope, chain);
    }
    const own = (node.children ?? []).filter((n) => n.kind === "member");
    const seenNames = new Set(members.map((member) => member.name));
    for (const member of own) {
      if (seenNames.has(member.name))
        diagnostic("struct.duplicate", `Duplicate struct member '${member.name}'.`, member.range);
      seenNames.add(member.name);
    }
    return [...members, ...own];
  }
  function normalizeType(type: string) {
    return type
      .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, " ")
      .replace(/\s+/g, " ")
      .replace(/\s*\[\s*\]/g, "[]")
      .trim()
      .replace(/^longint(?=\[|$)/, "longint unsigned")
      .replace(/^bit unsigned/, "bit");
  }
  function defaultValue(type: string, scope: Scope): RdlValue | undefined {
    type = normalizeType(type);
    if (type === "boolean") return false;
    if (type === "string") return "";
    if (type.endsWith("[]")) return [];
    const node = lookup(scope, type, true)?.node;
    if (node?.kind === "struct") return undefined;
    return undefined;
  }
  function compatible(type: string, value: RdlValue, scope: Scope): boolean {
    type = normalizeType(type);
    if (type.endsWith("[]"))
      return Array.isArray(value) && value.every((v) => compatible(type.slice(0, -2), v, scope));
    if (type.includes("|")) return type.split("|").some((t) => compatible(t, value, scope));
    if (["bit", "number", "longint unsigned", "boolean"].includes(type))
      return isInteger(value) || typeof value === "boolean";
    if (type === "string") return typeof value === "string";
    if (type === "ref" || componentKinds.has(type))
      return typeof value === "object" && "kind" in value && value.kind === "reference";
    if (type === "enumtype")
      return (
        typeof value === "object" &&
        "kind" in value &&
        value.kind === "reference" &&
        value.path.startsWith("@enum:")
      );
    if (typeof value === "object" && "kind" in value && value.kind === "enum") {
      if (value.type !== type) return false;
      const definition = lookup(scope, type, true)?.node;
      if (!definition) return !value.typeDefinition;
      const range = physical(definition.nameRange ?? definition.range);
      return (
        !!value.typeDefinition &&
        value.typeDefinition.documentId === range.documentId &&
        value.typeDefinition.start === range.start &&
        value.typeDefinition.end === range.end
      );
    }
    if (typeof value === "object" && "kind" in value && value.kind === "struct") {
      const expected = lookup(scope, type, true)?.node;
      if (expected?.kind !== "struct") return false;
      let actual = value.typeDefinition
        ? declaredValueTypes.get(rangeKey(value.typeDefinition))
        : lookup(scope, value.type, true)?.node;
      const seen = new Set<SyntaxNode>();
      while (actual && !seen.has(actual)) {
        if (actual === expected) return true;
        seen.add(actual);
        if (!actual.extends) break;
        actual = lookup(declarationScopes.get(actual) ?? scope, actual.extends, true)?.node;
      }
    }
    return false;
  }
  function coerce(
    type: string,
    value: RdlValue,
    scope: Scope,
    range?: SourceRange,
  ): RdlValue | undefined {
    type = normalizeType(type);
    if (!compatible(type, value, scope)) {
      diagnostic("property.type", `Value is incompatible with '${type}'.`, range);
      return undefined;
    }
    if (type === "boolean") return isInteger(value) ? value.value !== 0n : value;
    if (["bit", "number", "longint unsigned"].includes(type))
      return typeof value === "boolean"
        ? integer(value ? 1n : 0n, type === "longint unsigned" ? 64n : 1n)
        : type === "longint unsigned" && isInteger(value)
          ? integer(value.value)
          : value;
    if (type.endsWith("[]") && Array.isArray(value))
      return value.map((v) => coerce(type.slice(0, -2), v, scope, range)!);
    return value;
  }
  function register(nodes: readonly SyntaxNode[], scope: Scope) {
    for (const node of nodes) {
      declarationScopes.set(node, { ...scope, defaults: new Map(scope.defaults) });
      if (["component", "enum", "struct"].includes(node.kind) && node.name) {
        if (scope.types.has(node.name))
          diagnostic(
            "name.duplicate",
            `Duplicate declaration '${node.name}'.`,
            node.nameRange ?? node.range,
          );
        else scope.types.set(node.name, node);
      }
      if (node.kind === "instance") {
        if (scope.nodes.has(node.name))
          diagnostic(
            "name.duplicate",
            `Duplicate instance '${node.name}'.`,
            node.nameRange ?? node.range,
          );
        else scope.nodes.set(node.name, node);
      }
      for (const instance of node.instances ?? []) {
        if (scope.nodes.has(instance.name))
          diagnostic(
            "name.duplicate",
            `Duplicate instance '${instance.name}'.`,
            instance.nameRange ?? instance.range,
          );
        else scope.nodes.set(instance.name, instance);
        declarationScopes.set(instance, scope);
      }
      if (node.kind === "assignment" && node.default)
        scope.defaults.set(node.name, { node, scope });
      if (node.kind === "constraint") {
        diagnostic(
          "unsupported.constraint",
          "Constraint blocks are preserved but not evaluated.",
          node.range,
        );
        reasons.push("Constraint blocks are not evaluated.");
      }
      if (node.kind === "unknown" || node.uncertain) {
        reasons.push("Uncertain source structure.");
      }
      if (node.kind === "property") registerUdp(node, scope);
    }
  }
  function registerUdp(node: SyntaxNode, scope: Scope) {
    if (scope !== rootScope && scope.parent !== rootScope)
      diagnostic(
        "udp.scope",
        "User-defined properties must be declared in the root scope.",
        node.range,
      );
    const attributes = new Map<string, SyntaxNode>();
    for (const attribute of node.children ?? []) {
      if (attributes.has(attribute.name))
        diagnostic(
          "udp.attribute",
          `Duplicate UDP attribute '${attribute.name}'.`,
          attribute.range,
        );
      attributes.set(attribute.name, attribute);
      if (!["type", "component", "default", "constraint"].includes(attribute.name))
        diagnostic("udp.attribute", `Unknown UDP attribute '${attribute.name}'.`, attribute.range);
    }
    const typeText = attributes.get("type")?.expression?.text;
    const type = typeText === undefined ? undefined : normalizeType(typeText),
      components = attributes
        .get("component")
        ?.expression?.text.split("|")
        .map((s) => s.trim());
    if (!type || !components?.length) {
      diagnostic(
        "udp.required",
        "UDP declarations require type and component attributes.",
        node.range,
      );
      return;
    }
    for (const component of components)
      if (!componentKinds.has(component) && component !== "all" && component !== "constraint")
        diagnostic("udp.component", `Invalid UDP component '${component}'.`, node.range);
    if (udps.has(node.name) || builtinProperties[node.name])
      diagnostic(
        "udp.duplicate",
        `Property '${node.name}' is already defined.`,
        node.nameRange ?? node.range,
      );
    else
      udps.set(node.name, {
        name: node.name,
        type,
        components,
        default: attributes.get("default")?.expression,
        constraint: attributes.get("constraint")?.expression?.text,
        range: node.nameRange ?? node.range,
        scope,
      });
  }
  for (const property of input.properties ?? []) {
    if (udps.has(property.name) || builtinProperties[property.name])
      diagnostic("udp.duplicate", `External property '${property.name}' is already defined.`);
    else
      udps.set(property.name, {
        name: property.name,
        type: normalizeType(property.type),
        components: property.components,
        default:
          property.default === undefined
            ? undefined
            : {
                text: property.default,
                range: { documentId: property.origin, start: 0, end: property.default.length },
              },
        constraint: property.constraint,
        scope: rootScope,
      });
  }
  for (const unit of unitNodes) register(unit.nodes, unit.scope);
  for (const udp of udps.values()) {
    const type = normalizeType(udp.type).replace(/\[\]$/, "");
    if (
      ![
        "bit",
        "number",
        "longint unsigned",
        "boolean",
        "string",
        "ref",
        "addrmap",
        "regfile",
        "reg",
        "field",
        "mem",
      ].includes(type) &&
      !["enum", "struct"].includes(lookup(udp.scope, type, true)?.node?.kind ?? "")
    )
      diagnostic("udp.type", `Unknown UDP type '${udp.type}'.`, udp.range);
    if (
      udp.constraint &&
      (udp.constraint !== "componentwidth" || !["bit", "number"].includes(udp.type))
    )
      diagnostic(
        "udp.constraint",
        "componentwidth is only valid for scalar bit properties.",
        udp.range,
      );
    if (udp.range) {
      const declaration = rootNodes.find(
        (node) => node.kind === "property" && node.name === udp.name,
      );
      const attribute = declaration?.children?.find((node) => node.name === "type");
      if (attribute?.expression)
        typeReferences(udp.scope, type, attribute.expression.range, attribute.expression.text);
    }
    if (udp.default) {
      const value = evalExpr(udp.default, udp.scope);
      if (value !== undefined) coerce(udp.type, value, udp.scope, udp.default.range);
    }
  }
  const audited = new Set<SyntaxNode>();
  function audit(
    nodes: readonly SyntaxNode[],
    scope: Scope,
    component?: ComponentKind,
    parameterNames = new Set<string>(),
  ) {
    const local: Scope = {
      parent: scope,
      nodes: new Map(),
      types: new Map(),
      values: new Map(),
      defaults: new Map(),
    };
    for (const node of nodes)
      if (["component", "struct", "enum"].includes(node.kind) && node.name)
        local.types.set(node.name, node);
    for (const node of nodes) {
      if (audited.has(node)) continue;
      audited.add(node);
      if (node.kind === "struct") {
        for (const member of structMembers(node, local)) {
          const type = normalizeType(member.typeName ?? "").replace(/\[\]$/, "");
          const text =
            units.get(member.range.documentId)?.text.slice(member.range.start, member.range.end) ??
            type;
          typeReferences(local, type, member.range, text);
        }
      }
      for (const parameter of node.parameters ?? []) {
        const type = normalizeType(parameter.type).replace(/\[\]$/, "");
        const text =
          units
            .get(parameter.range.documentId)
            ?.text.slice(parameter.range.start, parameter.range.end) ?? type;
        typeReferences(local, type, parameter.range, text);
      }
      if (
        node.kind === "enum" &&
        !(node.children ?? []).some(
          (member) =>
            member.expression &&
            [...parameterNames].some((name) =>
              new RegExp(`\\b${name}\\b`).test(member.expression!.text),
            ),
        )
      ) {
        let next = 0n;
        const seen = new Set<bigint>(),
          names = new Set<string>();
        for (const member of node.children ?? []) {
          if (names.has(member.name))
            diagnostic(
              "enum.duplicate-name",
              `Duplicate enumerator '${member.name}'.`,
              member.range,
            );
          names.add(member.name);
          const value = member.expression ? evalExpr(member.expression, local) : integer(next);
          if (!isInteger(value)) {
            if (value !== undefined)
              diagnostic("enum.type", "Enumeration values must be integers.", member.range);
            continue;
          }
          if (seen.has(value.value))
            diagnostic("enum.duplicate-value", "Enumeration values must be unique.", member.range);
          seen.add(value.value);
          next = value.value + 1n;
        }
      }
      if (node.kind === "component")
        audit(
          node.children ?? [],
          local,
          node.component,
          new Set([...parameterNames, ...(node.parameters ?? []).map((p) => p.name)]),
        );
      if (node.kind === "assignment" && !node.target) {
        const builtin = builtinProperties[node.name],
          udp = udps.get(node.name);
        if (
          component &&
          !node.default &&
          (builtin
            ? !builtin.components.includes(component)
            : udp && !udp.components.includes(component) && !udp.components.includes("all"))
        )
          diagnostic(
            "property.component",
            `Property '${node.name}' is not allowed on ${component}.`,
            node.range,
          );
        if (udp?.range && !declaredBefore(udp.range, node.range))
          diagnostic(
            "name.before-declaration",
            `Property '${node.name}' is used before declaration.`,
            node.range,
          );
        if (
          node.expression &&
          (builtin || udp) &&
          ![...parameterNames].some((name) =>
            new RegExp(`\\b${name}\\b`).test(node.expression!.text),
          )
        ) {
          const result = evaluateExpression(node.expression.text, context(local, node.expression));
          if (Result.isSuccess(result))
            coerce(
              builtin?.type ?? udp!.type,
              result.success,
              udp?.scope ?? local,
              node.expression.range,
            );
          else if (!["expression.name", "expression.nonconstant"].includes(result.failure.code))
            diagnostic(
              result.failure.code,
              result.failure.message,
              node.expression.range,
              result.failure.code === "expression.resource",
            );
        }
      }
      if (node.kind === "assignment" && !builtinProperties[node.name] && !udps.has(node.name))
        diagnostic("property.unknown", `Unknown property '${node.name}'.`, node.range);
      if (node.kind === "instance" && node.typeName) {
        const definition = lookup(local, node.typeName, true)?.node;
        if (definition && node.typeRange)
          reference(node.typeName, definition.nameRange ?? definition.range, node.typeRange);
      }
    }
  }
  audit(rootNodes, rootScope);
  let instanceCount = 0;
  function resolveInstance(
    owner: MutableInstance | undefined,
    path: string,
  ): MutableInstance | undefined {
    const parts = path.replace(/\[[^\]]+\]/g, "").split(".");
    for (let base = owner; base; base = base.parent) {
      let current: MutableInstance | undefined =
        parts[0] === base.name ? base : base.children.find((c) => c.name === parts[0]);
      for (const part of parts.slice(1)) current = current?.children.find((c) => c.name === part);
      if (current) return current;
    }
    let current = roots.find((r) => r.name === parts[0]);
    for (const part of parts.slice(1)) current = current?.children.find((c) => c.name === part);
    return current;
  }
  function builtinDefaults(kind: ComponentKind): Record<string, PropertyValue> {
    const props: Record<string, PropertyValue> = {};
    for (const [name, rule] of Object.entries(builtinProperties))
      if (rule.components.includes(kind))
        props[name] = {
          binding: "builtin",
          state: rule.default === undefined ? "undefined" : "known",
          origin: "builtin",
          ...(rule.default === undefined ? {} : { value: rule.default }),
        };
    for (const [name] of udps)
      props[name] = { binding: "unbound", state: "undefined", origin: "unbound" };
    return props;
  }
  function assign(
    instance: MutableInstance,
    node: SyntaxNode,
    scope: Scope,
    origin: "assignment" | "default" | "dynamic",
  ) {
    const name = node.name,
      builtin = builtinProperties[name],
      udp = udps.get(name);
    if (!builtin && !udp) {
      diagnostic("property.unknown", `Unknown property '${name}'.`, node.nameRange ?? node.range);
      return;
    }
    if (
      builtin
        ? !builtin.components.includes(instance.kind)
        : !udp!.components.includes(instance.kind) && !udp!.components.includes("all")
    ) {
      diagnostic(
        "property.component",
        `Property '${name}' is not allowed on ${instance.kind}.`,
        node.range,
      );
      return;
    }
    if (origin === "dynamic" && builtin && !builtin.dynamic) {
      diagnostic(
        "property.dynamic",
        `Property '${name}' cannot be assigned dynamically.`,
        node.range,
      );
      return;
    }
    if (udp?.range && !declaredBefore(udp.range, node.range))
      diagnostic(
        "name.before-declaration",
        `Property '${name}' is used before its declaration.`,
        node.range,
      );
    if (udp?.range && node.nameRange) reference(name, udp.range, node.nameRange);
    let value: RdlValue | undefined;
    if (node.expression) value = evalExpr(node.expression, scope);
    else if (builtin) {
      if (builtin.type.includes("boolean")) value = true;
      else diagnostic("property.value", `Property '${name}' requires a value.`, node.range);
    } else if (udp?.default) value = evalExpr(udp.default, udp.scope);
    if (value !== undefined)
      value = coerce(
        builtin?.type ?? udp!.type,
        value,
        udp?.scope ?? scope,
        node.expression?.range ?? node.range,
      );
    if (node.modifier) {
      if (name !== "intr")
        diagnostic(
          "interrupt.modifier",
          "Interrupt modifiers require the intr property.",
          node.range,
        );
      else if (node.modifier === "nonsticky") instance.nonsticky = true;
      else instance.interruptType = node.modifier;
    }
    const state = value !== undefined ? "known" : node.expression ? "unavailable" : "undefined";
    instance.properties[name] = {
      binding: builtin ? "builtin" : "bound",
      state,
      origin: !node.expression && udp?.default ? "default" : origin,
      ...(value === undefined ? {} : { value }),
      range: physical(node.range),
      provenance: provenance(node.range),
    };
  }
  function instantiate(
    declaration: SyntaxNode,
    syntax: SyntaxNode,
    parent: MutableInstance | undefined,
    caller: Scope,
    inheritedParameters?: Readonly<Record<string, string>>,
  ): MutableInstance | undefined {
    if (++instanceCount > (input.limits?.instances ?? 100_000)) {
      diagnostic("resource.instances", "Instance analysis limit exceeded.", syntax.range, true);
      return undefined;
    }
    if (building.size >= 128) {
      diagnostic(
        "resource.instantiation-depth",
        "Component instantiation nesting exceeds the analysis limit.",
        syntax.range,
        true,
      );
      return undefined;
    }
    if (building.has(declaration)) {
      diagnostic(
        "instance.cycle",
        `Recursive component instantiation '${declaration.name}'.`,
        syntax.range,
      );
      return undefined;
    }
    building.add(declaration);
    const definitionScope = declarationScopes.get(declaration) ?? caller;
    const scope: Scope = {
      parent: definitionScope,
      nodes: new Map(),
      types: new Map(),
      values: new Map(),
      defaults: new Map(),
    };
    const name = syntax.name || declaration.name || "top";
    const instance: MutableInstance = {
      id: `${configurationId}:${parent ? parent.path + "." : ""}${name}`,
      path: parent ? `${parent.path}.${name}` : name,
      name,
      kind: declaration.component!,
      definition: physical(declaration.range),
      source: physical(syntax.range),
      properties: builtinDefaults(declaration.component!),
      children: [],
      dimensions: [],
      syntax,
      declaration,
      scope,
      parent,
      ...(syntax.alias ? { alias: syntax.alias } : {}),
    };
    scope.owner = instance;
    instance.properties.name = {
      binding: "builtin",
      state: "known",
      origin: "builtin",
      value: name,
    };
    if (syntax.typeRange && !declaredBefore(declaration.range, syntax.typeRange))
      diagnostic(
        "name.before-declaration",
        `Type '${declaration.name}' is used before its declaration.`,
        syntax.typeRange,
      );
    let positional = 0;
    const argumentsByName = new Map<string, ExpressionSyntax>();
    for (const argument of syntax.arguments ?? []) {
      const parameter = argument.name ?? declaration.parameters?.[positional++]?.name;
      if (!parameter || !declaration.parameters?.some((p) => p.name === parameter)) {
        diagnostic(
          "parameter.unknown",
          `Unknown parameter '${parameter ?? ""}'.`,
          argument.value.range,
        );
        continue;
      }
      if (argumentsByName.has(parameter))
        diagnostic(
          "parameter.duplicate",
          `Duplicate parameter '${parameter}'.`,
          argument.value.range,
        );
      argumentsByName.set(parameter, argument.value);
    }
    for (const parameter of declaration.parameters ?? []) {
      const override = inheritedParameters?.[parameter.name];
      const expression = argumentsByName.get(parameter.name) ?? parameter.value;
      const value =
        override !== undefined
          ? evalText(override, caller)
          : expression
            ? evalExpr(expression, argumentsByName.has(parameter.name) ? caller : scope)
            : undefined;
      if (value === undefined)
        diagnostic(
          "parameter.value",
          `Parameter '${parameter.name}' requires a value.`,
          override === undefined ? parameter.range : undefined,
        );
      else {
        const converted = coerce(
          parameter.type,
          value,
          scope,
          override === undefined ? parameter.range : undefined,
        );
        if (converted !== undefined) scope.values.set(parameter.name, converted);
      }
    }
    register(declaration.children ?? [], scope);
    const defaults: { node: SyntaxNode; scope: Scope }[] = [];
    for (let s: Scope | undefined = definitionScope; s; s = s.parent)
      defaults.unshift(...s.defaults.values());
    for (const item of defaults) {
      const rule = builtinProperties[item.node.name],
        udp = udps.get(item.node.name);
      if (
        rule?.components.includes(instance.kind) ||
        udp?.components.includes(instance.kind) ||
        udp?.components.includes("all")
      )
        assign(instance, item.node, item.scope, "default");
    }
    const assigned = new Set<string>();
    for (const child of declaration.children ?? [])
      if (child.kind === "assignment" && !child.default && !child.target) {
        if (assigned.has(child.name))
          diagnostic("property.duplicate", `Duplicate assignment to '${child.name}'.`, child.range);
        assigned.add(child.name);
        assign(instance, child, scope, "assignment");
      }
    if (syntax.expression)
      assign(instance, { ...syntax, kind: "assignment", name: "reset" }, caller, "assignment");
    for (const dimension of syntax.dimensions ?? []) {
      const value = evalExpr(dimension, caller);
      if (!isInteger(value) || value.value < 1n)
        diagnostic(
          "array.dimension",
          "Array dimensions must be positive integers.",
          dimension.range,
        );
      else instance.dimensions.push(value.value);
    }
    if (instance.kind === "field" || instance.kind === "signal") {
      if (instance.dimensions.length > 1)
        diagnostic(
          "field.array",
          "Fields and signals cannot have multiple array dimensions.",
          syntax.range,
        );
      const widthProperty = instance.kind === "field" ? "fieldwidth" : "signalwidth";
      const definedWidth = instance.properties[widthProperty];
      if (
        instance.dimensions[0] &&
        definedWidth?.origin !== "builtin" &&
        isInteger(definedWidth?.value) &&
        definedWidth.value.value !== instance.dimensions[0]
      )
        diagnostic(
          "component.width",
          "Instance width differs from its predefined width.",
          syntax.range,
        );
      if (instance.dimensions[0])
        instance.properties[instance.kind === "field" ? "fieldwidth" : "signalwidth"] = {
          binding: "builtin",
          state: "known",
          origin: "assignment",
          value: integer(instance.dimensions[0]),
          range: physical(syntax.range),
        };
      instance.dimensions = [];
    }
    for (const child of declaration.children ?? []) {
      if (child.kind === "component")
        for (const statement of child.instances ?? []) {
          const value = instantiate(child, statement, instance, scope);
          if (value) instance.children.push(value);
        }
      if (child.kind === "instance") {
        const found = lookup(scope, child.typeName ?? "", true);
        if (!found?.node || found.node.kind !== "component")
          diagnostic(
            "instance.type",
            `Unknown component type '${child.typeName}'.`,
            child.typeRange ?? child.range,
          );
        else {
          if (child.typeRange)
            reference(child.typeName!, found.node.nameRange ?? found.node.range, child.typeRange);
          const value = instantiate(found.node, child, instance, scope);
          if (value) instance.children.push(value);
        }
      }
    }
    const dynamicAssignments = new Set<string>();
    for (const child of declaration.children ?? [])
      if (child.kind === "assignment" && child.target) {
        const key = child.target + "->" + child.name;
        if (dynamicAssignments.has(key))
          diagnostic(
            "property.duplicate",
            `Duplicate dynamic assignment to '${key}'.`,
            child.range,
          );
        dynamicAssignments.add(key);
        dynamic(instance, child, scope);
      }
    building.delete(declaration);
    return instance;
  }
  function dynamic(owner: MutableInstance, node: SyntaxNode, scope: Scope) {
    if (node.target!.includes("[")) {
      diagnostic(
        "unsupported.array-assignment",
        "Assignments to individual instance-array elements are not supported.",
        node.range,
      );
      reasons.push("Indexed instance-array property assignment.");
      return;
    }
    const target = resolveInstance(owner, node.target!);
    if (!target) {
      diagnostic(
        "reference.missing",
        `Unknown dynamic assignment target '${node.target}'.`,
        node.targetRange ?? node.range,
      );
      return;
    }
    if (node.targetRange)
      pathReferences(
        owner,
        node.target!,
        node.targetRange,
        units
          .get(node.targetRange.documentId)
          ?.text.slice(node.targetRange.start, node.targetRange.end) ?? node.target!,
      );
    assign(target, node, scope, "dynamic");
  }
  for (const node of rootNodes) {
    if (node.kind === "component" && node.component === "signal")
      for (const syntax of node.instances ?? []) {
        const value = instantiate(node, syntax, undefined, rootScope);
        if (value) roots.push(value);
      }
    if (node.kind === "instance") {
      const definition = lookup(rootScope, node.typeName ?? "", true)?.node;
      if (definition?.component === "signal") {
        const value = instantiate(definition, node, undefined, rootScope);
        if (value) roots.push(value);
      }
    }
  }
  const explicitRoots = rootNodes.filter(
    (n) => n.kind === "instance" || (n.kind === "component" && n.instances?.length),
  );
  let topNode = config.top
    ? (rootScope.types.get(config.top) ?? rootScope.nodes.get(config.top))
    : [...rootNodes].reverse().find((n) => n.kind === "component" && n.component === "addrmap");
  if (config.top && !topNode)
    diagnostic("top.unknown", `Unknown top-level component '${config.top}'.`);
  if (topNode?.kind === "instance") {
    const type = lookup(rootScope, topNode.typeName ?? "", true)?.node;
    if (type?.kind === "component") {
      const value = instantiate(type, topNode, undefined, rootScope, config.parameters);
      if (value) roots.push(value);
    }
  } else if (topNode?.kind === "component") {
    if (topNode.component !== "addrmap")
      diagnostic("top.kind", "The selected top-level component must be an addrmap.", topNode.range);
    const selected = topNode.instances?.[0] ?? topNode;
    const value = instantiate(topNode, selected, undefined, rootScope, config.parameters);
    if (value) roots.push(value);
  } else if (!config.top)
    for (const node of explicitRoots) {
      const definition =
        node.kind === "component" ? node : lookup(rootScope, node.typeName ?? "", true)?.node;
      if (definition?.kind !== "component") continue;
      for (const syntax of node.kind === "component" ? (node.instances ?? []) : [node]) {
        const value = instantiate(definition, syntax, undefined, rootScope);
        if (value) roots.push(value);
      }
    }
  if (roots.length === 0 && !diagnostics.some((d) => d.severity === "error"))
    diagnostic("top.missing", "No address map is available for elaboration.");
  for (const node of rootNodes)
    if (node.kind === "assignment" && node.target) {
      const owner = roots.find((root) => root.kind === "addrmap");
      if (owner) dynamic(owner, node, rootScope);
    }
  function intProperty(instance: MutableInstance, name: string, fallback = 0n): bigint {
    const value = instance.properties[name]?.value;
    return isInteger(value) ? value.value : fallback;
  }
  function boolProperty(instance: MutableInstance, name: string): boolean {
    return instance.properties[name]?.value === true;
  }
  function enumProperty(instance: MutableInstance, name: string, fallback = ""): string {
    const value = instance.properties[name]?.value;
    return typeof value === "object" && "kind" in value && value.kind === "enum"
      ? value.member
      : fallback;
  }
  function evaluateNumber(
    expression: ExpressionSyntax | undefined,
    scope: Scope,
  ): bigint | undefined {
    if (!expression) return undefined;
    const value = evalExpr(expression, scope);
    if (!isInteger(value)) {
      if (value !== undefined)
        diagnostic("layout.integer", "Layout expressions must be integers.", expression.range);
      return undefined;
    }
    return value.value;
  }
  function layout(
    instance: MutableInstance,
    msb0 = false,
    addressing = "regalign",
    inheritedAlignment = 1n,
  ) {
    if (instance.syntax.stride && !instance.dimensions.length)
      diagnostic(
        "array.stride",
        "A stride requires an instance array.",
        instance.syntax.stride.range,
      );
    if (instance.syntax.address && instance.syntax.alignment)
      diagnostic(
        "address.conflict",
        "Fixed address and alignment operators cannot be combined.",
        instance.syntax.range,
      );
    if (instance.kind === "addrmap") {
      msb0 = boolProperty(instance, "msb0");
      if (
        instance.properties.msb0?.origin === "builtin" &&
        instance.properties.lsb0?.origin === "builtin"
      ) {
        const firstField = (node: MutableInstance): MutableInstance | undefined => {
          for (const child of node.children) {
            if (child.kind === "field") return child;
            if (child.kind !== "addrmap") {
              const found = firstField(child);
              if (found) return found;
            }
          }
          return undefined;
        };
        const field = firstField(instance);
        if (field?.syntax.msb && field.syntax.lsb) {
          const left = evaluateNumber(field.syntax.msb, field.parent?.scope ?? field.scope),
            right = evaluateNumber(field.syntax.lsb, field.parent?.scope ?? field.scope);
          if (left !== undefined && right !== undefined && left !== right) msb0 = left < right;
        }
        instance.properties[msb0 ? "msb0" : "lsb0"] = {
          binding: "builtin",
          state: "known",
          origin: "builtin",
          value: true,
        };
      }
      addressing = enumProperty(instance, "addressing", "regalign");
    }
    const alignment = intProperty(instance, "alignment", inheritedAlignment);
    if (!powerOfTwo(alignment))
      diagnostic(
        "layout.alignment",
        "Alignment must be a positive power of two.",
        instance.declaration.range,
      );
    for (const child of instance.children) layout(child, msb0, addressing, alignment);
    if (instance.kind === "reg") {
      const width = intProperty(instance, "regwidth", 32n);
      let access = intProperty(instance, "accesswidth", width);
      if (!powerOfTwo(width) || width < 8n)
        diagnostic(
          "register.width",
          "Register width must be a power of two of at least eight bits.",
          instance.declaration.range,
        );
      if (!powerOfTwo(access) || access < 8n || access > width) {
        diagnostic(
          "register.accesswidth",
          "Access width must be a power of two between eight and the register width.",
          instance.declaration.range,
        );
        access = width;
      }
      if (instance.properties.accesswidth?.state !== "known")
        instance.properties.accesswidth = {
          binding: "builtin",
          state: "known",
          origin: "builtin",
          value: integer(width),
        };
      instance.size = width / 8n;
      let next = msb0 ? width - 1n : 0n;
      const placed: MutableInstance[] = [];
      for (const field of instance.children.filter((c) => c.kind === "field")) {
        const explicitMsb = evaluateNumber(field.syntax.msb, instance.scope),
          explicitLsb = evaluateNumber(field.syntax.lsb, instance.scope);
        const fieldWidth = intProperty(field, "fieldwidth", 1n);
        if (explicitMsb !== undefined && explicitLsb !== undefined) {
          field.msb = explicitMsb;
          field.lsb = explicitLsb;
          if (explicitMsb !== explicitLsb && explicitMsb < explicitLsb !== msb0)
            diagnostic(
              "field.bit-order",
              "Explicit field range conflicts with its address map bit order.",
              field.syntax.range,
            );
          const actual =
            (explicitMsb > explicitLsb ? explicitMsb - explicitLsb : explicitLsb - explicitMsb) +
            1n;
          const specified = field.properties.fieldwidth;
          if (
            specified?.origin !== "builtin" &&
            isInteger(specified?.value) &&
            specified.value.value !== actual
          )
            diagnostic(
              "component.width",
              "Explicit field range differs from predefined fieldwidth.",
              field.syntax.range,
            );
          field.properties.fieldwidth = {
            binding: "builtin",
            state: "known",
            origin: "assignment",
            value: integer(actual),
            range: physical(field.syntax.range),
          };
        } else {
          field.lsb = next;
          field.msb = msb0 ? next - fieldWidth + 1n : next + fieldWidth - 1n;
        }
        const low = field.lsb < field.msb ? field.lsb : field.msb,
          high = field.lsb > field.msb ? field.lsb : field.msb;
        if (low < 0n || high >= width || fieldWidth < 1n)
          diagnostic("field.bounds", "Field lies outside its register.", field.syntax.range);
        for (const other of placed) {
          const olow = other.lsb! < other.msb! ? other.lsb! : other.msb!,
            ohigh = other.lsb! > other.msb! ? other.lsb! : other.msb!;
          if (low <= ohigh && high >= olow) {
            const sw = enumProperty(field, "sw"),
              osw = enumProperty(other, "sw");
            if (!((sw === "r" && osw === "w") || (sw === "w" && osw === "r")))
              diagnostic(
                "field.overlap",
                `Field '${field.name}' overlaps '${other.name}'.`,
                field.syntax.range,
              );
          }
        }
        placed.push(field);
        next = msb0 ? low - 1n : high + 1n;
      }
      if (!placed.length)
        diagnostic(
          "component.empty",
          "A register must contain fields.",
          instance.declaration.range,
        );
    } else if (instance.kind === "mem") {
      const width = intProperty(instance, "memwidth", 32n),
        entries = intProperty(instance, "mementries", 1n);
      if (width < 1n || entries < 1n)
        diagnostic(
          "memory.size",
          "Memory width and entry count must be positive.",
          instance.declaration.range,
        );
      instance.size = ((width + 7n) / 8n) * entries;
      if (!instance.syntax.external && !instance.declaration.external)
        diagnostic("memory.external", "Memory instances must be external.", instance.syntax.range);
      let next = 0n;
      for (const child of instance.children.filter((c) => c.kind === "reg")) {
        child.address = evaluateNumber(child.syntax.address, instance.scope) ?? next;
        child.stride = evaluateNumber(child.syntax.stride, instance.scope) ?? child.size ?? 0n;
        next = child.address + child.stride * child.dimensions.reduce((a, b) => a * b, 1n);
        if (next > instance.size)
          diagnostic(
            "memory.bounds",
            "Virtual registers exceed memory capacity.",
            child.syntax.range,
          );
        for (const field of child.children.filter((c) => c.kind === "field"))
          if ((field.msb ?? 0n) >= width || (field.lsb ?? 0n) >= width)
            diagnostic(
              "memory.fieldwidth",
              "Virtual fields exceed the memory word width.",
              field.syntax.range,
            );
      }
    } else if (["addrmap", "regfile"].includes(instance.kind)) {
      let next = 0n;
      const placed: MutableInstance[] = [];
      for (const child of instance.children.filter((c) => !["field", "signal"].includes(c.kind))) {
        const size = child.size ?? 0n,
          count = child.dimensions.reduce((a, b) => a * b, 1n);
        const stride = evaluateNumber(child.syntax.stride, instance.scope) ?? size;
        if (stride < size)
          diagnostic(
            "array.stride",
            "Array stride is smaller than the element size.",
            child.syntax.range,
          );
        child.stride = stride;
        const span = count > 0n ? stride * (count - 1n) + size : 0n;
        let boundary =
          addressing === "compact"
            ? child.kind === "reg"
              ? intProperty(child, "accesswidth", 32n) / 8n
              : 1n
            : child.kind === "reg"
              ? size
              : 1n;
        if (addressing === "fullalign" && child.dimensions.length) boundary = ceilPower(span);
        boundary = boundary > alignment ? boundary : alignment;
        const requestedAlign = evaluateNumber(child.syntax.alignment, instance.scope);
        if (requestedAlign !== undefined) {
          if (!powerOfTwo(requestedAlign))
            diagnostic(
              "layout.alignment",
              "Instance alignment must be a positive power of two.",
              child.syntax.range,
            );
          boundary = requestedAlign;
        }
        const explicit = evaluateNumber(child.syntax.address, instance.scope);
        child.address = explicit ?? roundUp(next, boundary);
        for (const other of placed) {
          const otherCount = other.dimensions.reduce((a, b) => a * b, 1n),
            otherEnd =
              other.address! + (other.stride ?? 0n) * (otherCount - 1n) + (other.size ?? 0n);
          if (
            child.address < otherEnd &&
            other.address! < child.address + span &&
            !child.alias &&
            !other.alias
          )
            diagnostic(
              "address.overlap",
              `Instance '${child.name}' overlaps '${other.name}'.`,
              child.syntax.range,
            );
        }
        placed.push(child);
        next = child.address + span > next ? child.address + span : next;
      }
      instance.size = next;
      if (!placed.length)
        diagnostic(
          "component.empty",
          `${instance.kind} must contain addressable components.`,
          instance.declaration.range,
        );
    }
    const allowed: Record<ComponentKind, ComponentKind[]> = {
      addrmap: ["addrmap", "regfile", "reg", "mem", "signal"],
      regfile: ["regfile", "reg", "signal"],
      reg: ["field", "signal"],
      field: [],
      mem: ["reg", "signal"],
      signal: [],
    };
    for (const child of instance.children)
      if (!allowed[instance.kind].includes(child.kind))
        diagnostic(
          "component.nesting",
          `${child.kind} cannot be instantiated inside ${instance.kind}.`,
          child.syntax.range,
        );
  }
  function inheritedProperties(instance: MutableInstance, memoryAccess?: PropertyValue) {
    if (instance.kind === "mem") memoryAccess = instance.properties.sw;
    if (instance.kind === "field" && memoryAccess && instance.properties.sw?.origin === "builtin")
      instance.properties.sw = { ...memoryAccess, origin: "default" };
    for (const marker of ["field_reset", "cpuif_reset"]) {
      const signals = instance.children.filter(
        (child) => child.kind === "signal" && boolProperty(child, marker),
      );
      if (signals.length > 1)
        diagnostic(
          "signal.reset-duplicate",
          `Only one ${marker} signal is permitted per lexical scope.`,
          instance.syntax.range,
        );
    }
    if (instance.kind === "field" && instance.properties.resetsignal?.state === "undefined") {
      let reset: MutableInstance | undefined;
      for (let scope = instance.parent; scope && !reset; scope = scope.parent)
        reset = scope.children.find(
          (child) => child.kind === "signal" && boolProperty(child, "field_reset"),
        );
      reset ??= roots.find((root) => root.kind === "signal" && boolProperty(root, "field_reset"));
      if (reset)
        instance.properties.resetsignal = {
          binding: "builtin",
          state: "known",
          origin: "default",
          value: { kind: "reference", path: reset.path },
        };
    }
    for (const child of instance.children) inheritedProperties(child, memoryAccess);
  }
  for (const marker of ["field_reset", "cpuif_reset"])
    if (roots.filter((root) => root.kind === "signal" && boolProperty(root, marker)).length > 1)
      diagnostic("signal.reset-duplicate", `Only one global ${marker} signal is permitted.`);
  for (const root of roots) inheritedProperties(root);
  for (const root of roots) layout(root);
  function isExternal(instance: MutableInstance): boolean {
    if (instance.syntax.internal || instance.declaration.internal) return false;
    if (instance.syntax.external || instance.declaration.external) return true;
    return (
      !!instance.parent &&
      ["reg", "regfile", "mem"].includes(instance.parent.kind) &&
      isExternal(instance.parent)
    );
  }
  function sameValue(a: RdlValue | undefined, b: RdlValue | undefined): boolean {
    if (isInteger(a) && isInteger(b)) return a.value === b.value;
    return (
      JSON.stringify(a, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) ===
      JSON.stringify(b, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
    );
  }
  function validate(instance: MutableInstance) {
    for (const child of instance.children) validate(child);
    const groups = new Set<string>();
    if (
      instance.kind === "signal" &&
      !boolProperty(instance, "async") &&
      !boolProperty(instance, "sync")
    )
      instance.properties.sync = {
        binding: "builtin",
        state: "known",
        origin: "builtin",
        value: true,
      };
    if (boolProperty(instance, "intr")) {
      instance.interruptType ??= "level";
      if (instance.nonsticky) {
        if (boolProperty(instance, "sticky") || boolProperty(instance, "stickybit"))
          diagnostic(
            "interrupt.sticky",
            "nonsticky cannot be combined with sticky or stickybit.",
            instance.syntax.range,
          );
      } else if (
        !boolProperty(instance, "sticky") &&
        instance.properties.stickybit?.origin === "builtin"
      )
        instance.properties.stickybit = {
          binding: "builtin",
          state: "known",
          origin: "builtin",
          value: true,
        };
    } else if (instance.interruptType || instance.nonsticky)
      diagnostic(
        "interrupt.modifier",
        "Interrupt modifiers require intr=true.",
        instance.syntax.range,
      );
    const donttest = instance.properties.donttest?.value,
      dontcompare = instance.properties.dontcompare?.value;
    if (instance.kind === "field") {
      const width = intProperty(instance, "fieldwidth", 1n);
      for (const mask of [donttest, dontcompare])
        if (isInteger(mask) && mask.width !== width)
          diagnostic(
            "field.maskwidth",
            "Field verification mask width must equal the field width.",
            instance.syntax.range,
          );
      if (
        (donttest === true && dontcompare !== false && dontcompare !== undefined) ||
        (dontcompare === true && donttest !== false && donttest !== undefined) ||
        (isInteger(donttest) &&
          isInteger(dontcompare) &&
          (donttest.value & dontcompare.value) !== 0n)
      )
        diagnostic(
          "property.exclusive",
          "donttest and dontcompare may not select the same bits.",
          instance.syntax.range,
        );
    } else {
      if (isInteger(donttest) || isInteger(dontcompare))
        diagnostic(
          "property.type",
          "Non-field verification exclusions require boolean values.",
          instance.syntax.range,
        );
      if (donttest === true && dontcompare === true)
        diagnostic(
          "property.exclusive",
          "donttest and dontcompare are mutually exclusive.",
          instance.syntax.range,
        );
    }
    for (const [name, property] of Object.entries(instance.properties)) {
      const rule = builtinProperties[name],
        udp = udps.get(name),
        value = property.value;
      if (
        rule?.group &&
        rule.group !== "donttest dontcompare" &&
        property.origin !== "builtin" &&
        property.state === "known" &&
        value !== false
      ) {
        if (groups.has(rule.group))
          diagnostic(
            "property.exclusive",
            `Properties ${rule.group} are mutually exclusive.`,
            instance.declaration.range,
          );
        groups.add(rule.group);
      }
      if (udp?.constraint === "componentwidth" && isInteger(value)) {
        const width = intProperty(
          instance,
          instance.kind === "field"
            ? "fieldwidth"
            : instance.kind === "signal"
              ? "signalwidth"
              : instance.kind === "reg"
                ? "regwidth"
                : "memwidth",
        );
        if (width > 0n && value.value >> width)
          diagnostic(
            "udp.componentwidth",
            `Property '${name}' exceeds its component width.`,
            instance.declaration.range,
          );
      }
      if (name === "reset" && isInteger(value)) {
        const width = intProperty(instance, "fieldwidth", 1n);
        if (width <= 1_000_000n && value.value >> width)
          diagnostic("field.reset", "Reset value exceeds the field width.", instance.syntax.range);
      }
      const checkReference = (v: RdlValue, expected: string) => {
        if (Array.isArray(v)) {
          for (const item of v) checkReference(item, expected.replace(/\[\]$/, ""));
          return;
        }
        if (typeof v === "object" && "kind" in v && v.kind === "struct") {
          const definition = lookup(instance.scope, v.type, true);
          if (definition?.node)
            for (const member of structMembers(definition.node, definition.scope)) {
              const value = v.members[member.name];
              if (value !== undefined) checkReference(value, member.typeName ?? "");
            }
          return;
        }
        if (
          typeof v !== "object" ||
          !("kind" in v) ||
          v.kind !== "reference" ||
          v.path.startsWith("@enum:")
        )
          return;
        let prefix = "";
        for (const segment of v.path.split(".")) {
          const name = segment.replace(/\[.*$/, "");
          prefix += prefix ? "." + name : name;
          const array = resolveInstance(instance, prefix),
            indices = [...segment.matchAll(/\[([0-9]+)\]/g)].map((m) => BigInt(m[1]!));
          if (
            array &&
            ((indices.length && indices.length !== array.dimensions.length) ||
              indices.some((index, i) => index >= (array.dimensions[i] ?? 0n)))
          )
            diagnostic(
              "reference.index",
              "Instance array reference index is outside its dimensions.",
              instance.syntax.range,
            );
        }
        const target = resolveInstance(instance, v.path);
        if (!target) {
          diagnostic(
            "reference.missing",
            `Reference '${v.path}' cannot be resolved.`,
            instance.declaration.range,
          );
          return;
        }
        const fieldWidth = intProperty(instance, "fieldwidth", 1n);
        const targetWidth = v.property
          ? 1n
          : intProperty(target, target.kind === "signal" ? "signalwidth" : "fieldwidth", 1n);
        if (!udp) {
          const runtimeProperties = new Set([
            "anded",
            "ored",
            "xored",
            "swacc",
            "swmod",
            "intr",
            "halt",
            "overflow",
            "underflow",
            "incrthreshold",
            "decrthreshold",
            "threshold",
            "incrsaturate",
            "decrsaturate",
            "saturate",
            "hwset",
            "hwclr",
            "we",
            "wel",
            "incr",
            "decr",
            "hwenable",
            "hwmask",
            "next",
            "reset",
            "resetsignal",
            "enable",
            "mask",
            "haltenable",
            "haltmask",
            "swwe",
            "swwel",
            "incrvalue",
            "decrvalue",
          ]);
          if (v.property && !runtimeProperties.has(v.property))
            diagnostic(
              "reference.property",
              `Property '${v.property}' is not a hardware reference target.`,
              instance.syntax.range,
            );
          if (
            [
              "reset",
              "next",
              "hwenable",
              "hwmask",
              "enable",
              "mask",
              "haltenable",
              "haltmask",
              "incrvalue",
              "decrvalue",
              "incrthreshold",
              "decrthreshold",
              "incrsaturate",
              "decrsaturate",
              "saturate",
              "threshold",
            ].includes(name) &&
            targetWidth !== fieldWidth
          )
            diagnostic(
              "reference.width",
              `Property '${name}' requires a reference of matching width.`,
              instance.syntax.range,
            );
          if (
            [
              "we",
              "wel",
              "hwset",
              "hwclr",
              "swwe",
              "swwel",
              "incr",
              "decr",
              "resetsignal",
            ].includes(name) &&
            targetWidth !== 1n
          )
            diagnostic(
              "reference.width",
              `Property '${name}' requires a one-bit reference.`,
              instance.syntax.range,
            );
          if (name === "resetsignal" && (target.kind !== "signal" || v.property))
            diagnostic(
              "reference.type",
              "resetsignal must reference a signal.",
              instance.syntax.range,
            );
          if (name === "reset" && (!["field", "signal"].includes(target.kind) || v.property))
            diagnostic(
              "reference.type",
              "A reset reference must name a field or signal.",
              instance.syntax.range,
            );
          if (["reset", "next"].includes(name) && target === instance)
            diagnostic(
              "reference.self",
              `Property '${name}' cannot reference its own field.`,
              instance.syntax.range,
            );
        }
        if (componentKinds.has(expected) && target.kind !== expected)
          diagnostic(
            "reference.type",
            `Reference must target a ${expected}.`,
            instance.declaration.range,
          );
        if (boolProperty(instance, "ispresent") && !boolProperty(target, "ispresent"))
          diagnostic(
            "reference.absent",
            `Reference '${v.path}' targets an absent instance.`,
            instance.declaration.range,
          );
      };
      if (value !== undefined) checkReference(value, udp?.type ?? rule?.type ?? "ref");
    }
    if (instance.kind === "field") {
      const width = intProperty(instance, "fieldwidth", 1n),
        sw = enumProperty(instance, "sw"),
        hw = enumProperty(instance, "hw");
      const readable = ["r", "rw", "wr", "rw1"].includes(sw),
        writable = ["w", "rw", "wr", "w1", "rw1"].includes(sw);
      if (
        (boolProperty(instance, "rclr") ||
          boolProperty(instance, "rset") ||
          instance.properties.onread?.state === "known") &&
        !readable
      )
        diagnostic(
          "field.read-access",
          "Read side effects require software read access.",
          instance.syntax.range,
        );
      if (
        (boolProperty(instance, "woclr") ||
          boolProperty(instance, "woset") ||
          instance.properties.onwrite?.state === "known") &&
        !writable
      )
        diagnostic(
          "field.write-access",
          "Write side effects require software write access.",
          instance.syntax.range,
        );
      if (["w1", "rw1"].includes(hw))
        diagnostic(
          "field.hw-access",
          "Write-once access is only supported for software.",
          instance.syntax.range,
        );
      for (const name of [
        "incrvalue",
        "decrvalue",
        "incrsaturate",
        "decrsaturate",
        "saturate",
        "incrthreshold",
        "decrthreshold",
        "threshold",
      ]) {
        const value = instance.properties[name]?.value;
        if (isInteger(value) && width <= 1_000_000n && value.value >> width)
          diagnostic(
            "counter.width",
            `Property '${name}' exceeds field width.`,
            instance.syntax.range,
          );
      }
      for (const name of ["incrwidth", "decrwidth"]) {
        const value = intProperty(instance, name, 1n);
        if (value < 1n || value > width)
          diagnostic(
            "counter.width",
            `Property '${name}' must be within the field width.`,
            instance.syntax.range,
          );
      }
      const encode = instance.properties.encode?.value;
      if (
        typeof encode === "object" &&
        "kind" in encode &&
        encode.kind === "reference" &&
        encode.path.startsWith("@enum:")
      ) {
        const enumName = encode.path.slice(6),
          definition = lookup(instance.scope, enumName, true)?.node;
        for (const member of definition?.children ?? []) {
          const value = context(instance.scope).resolve?.(`${enumName}::${member.name}`);
          if (
            typeof value === "object" &&
            "kind" in value &&
            value.kind === "enum" &&
            value.value !== undefined &&
            width <= 1_000_000n &&
            value.value >> width
          )
            diagnostic(
              "enum.width",
              "Encoded enumeration values exceed the field width.",
              instance.syntax.range,
            );
        }
      }
      if (
        boolProperty(instance, "singlepulse") &&
        (intProperty(instance, "fieldwidth", 1n) !== 1n ||
          intProperty(instance, "reset", -1n) !== 0n)
      )
        diagnostic(
          "field.singlepulse",
          "singlepulse requires a one-bit field with reset zero.",
          instance.declaration.range,
        );
      if (
        enumProperty(instance, "hw") === "w" &&
        ["rw", "wr", "w", "rw1", "w1"].includes(enumProperty(instance, "sw")) &&
        !boolProperty(instance, "intr") &&
        !boolProperty(instance, "counter") &&
        !boolProperty(instance, "sticky") &&
        !boolProperty(instance, "stickybit") &&
        (instance.properties.we?.value === false || instance.properties.we?.value === undefined) &&
        (instance.properties.wel?.value === false || instance.properties.wel?.value === undefined)
      )
        diagnostic(
          "field.access",
          "Hardware write-only fields with software write access require a write enable.",
          instance.declaration.range,
        );
    }
    if (instance.alias) {
      const primary = resolveInstance(instance.parent, instance.alias);
      if (!primary || primary.kind !== "reg" || instance.kind !== "reg")
        diagnostic(
          "alias.target",
          "Aliases must name an existing register.",
          instance.syntax.range,
        );
      else if (intProperty(primary, "regwidth") !== intProperty(instance, "regwidth"))
        diagnostic(
          "alias.width",
          "Alias and primary register widths must match.",
          instance.syntax.range,
        );
    }
    if (instance.alias) {
      const primary = resolveInstance(instance.parent, instance.alias);
      if (primary) {
        if (
          (instance.syntax.external ||
            instance.syntax.internal ||
            instance.declaration.external ||
            instance.declaration.internal) &&
          isExternal(instance) !== isExternal(primary)
        )
          diagnostic(
            "alias.storage",
            "An explicitly declared alias storage type must match its primary register.",
            instance.syntax.range,
          );
        const allowed = new Set([
          "desc",
          "name",
          "onread",
          "onwrite",
          "rclr",
          "rset",
          "sw",
          "woclr",
          "woset",
        ]);
        const compare = (alias: MutableInstance, original: MutableInstance) => {
          for (const name of Object.keys(builtinProperties))
            if (
              !allowed.has(name) &&
              !sameValue(alias.properties[name]?.value, original.properties[name]?.value)
            )
              diagnostic(
                "alias.property",
                `Alias property '${name}' must match the primary.`,
                alias.syntax.range,
              );
        };
        compare(instance, primary);
        for (const field of instance.children.filter((c) => c.kind === "field")) {
          const target = primary.children.find((c) => c.name === field.name);
          if (target) compare(field, target);
          if (!target || target.lsb !== field.lsb || target.msb !== field.msb)
            diagnostic(
              "alias.fields",
              "Alias fields must match primary field names and positions.",
              field.syntax.range,
            );
        }
      }
    }
    if (instance.kind === "mem") {
      const sw = enumProperty(instance, "sw"),
        readable = ["r", "rw", "wr", "rw1"].includes(sw),
        writable = ["w", "rw", "wr", "rw1", "w1"].includes(sw);
      const registers = instance.children.filter((child) => child.kind === "reg");
      for (let i = 0; i < registers.length; i++) {
        const reg = registers[i]!,
          start = reg.address ?? 0n,
          count = reg.dimensions.reduce((a, b) => a * b, 1n),
          end = start + (reg.stride ?? reg.size ?? 0n) * (count - 1n) + (reg.size ?? 0n);
        for (const other of registers.slice(0, i)) {
          const ostart = other.address ?? 0n,
            ocount = other.dimensions.reduce((a, b) => a * b, 1n),
            oend = ostart + (other.stride ?? other.size ?? 0n) * (ocount - 1n) + (other.size ?? 0n);
          if (start < oend && ostart < end)
            diagnostic("memory.overlap", "Virtual registers overlap.", reg.syntax.range);
        }
        for (const field of reg.children.filter((child) => child.kind === "field")) {
          const access = enumProperty(field, "sw");
          if (
            (!readable && ["r", "rw", "wr", "rw1"].includes(access)) ||
            (!writable && ["w", "rw", "wr", "rw1", "w1"].includes(access))
          )
            diagnostic(
              "memory.access",
              "Virtual field access exceeds its memory's access permissions.",
              field.syntax.range,
            );
        }
      }
    }
  }
  for (const root of roots) validate(root);
  function output(instance: MutableInstance, base = 0n): Instance {
    const address =
      instance.address === undefined
        ? instance.parent === undefined && instance.kind === "addrmap"
          ? 0n
          : undefined
        : base + instance.address;
    const children = instance.children
      .filter((c) => c.properties.ispresent?.value !== false)
      .map((child) => output(child, address ?? base));
    if (
      instance.children.length &&
      !children.length &&
      instance.properties.ispresent?.value !== false
    )
      diagnostic(
        "component.empty",
        "A present component cannot have only absent children.",
        instance.declaration.range,
      );
    return {
      id: instance.id,
      path: instance.path,
      name: instance.name,
      kind: instance.kind,
      definition: instance.definition,
      source: instance.source,
      definitionProvenance: provenance(instance.declaration.range),
      sourceProvenance: provenance(instance.syntax.range),
      properties: instance.properties,
      children,
      dimensions: instance.dimensions,
      ...(address === undefined ? {} : { address }),
      ...(instance.size === undefined ? {} : { size: instance.size }),
      ...(instance.stride === undefined ? {} : { stride: instance.stride }),
      ...(instance.lsb === undefined ? {} : { lsb: instance.lsb }),
      ...(instance.msb === undefined ? {} : { msb: instance.msb }),
      ...(instance.alias === undefined ? {} : { alias: instance.alias }),
      ...(instance.interruptType === undefined ? {} : { interruptType: instance.interruptType }),
    };
  }
  const result = roots.filter((r) => r.properties.ispresent?.value !== false).map((r) => output(r));
  return {
    revision,
    configurationId,
    diagnostics,
    coverage: { complete: reasons.length === 0, reasons: [...new Set(reasons)] },
    model:
      result.length === 0
        ? "unavailable"
        : diagnostics.some((d) => d.severity === "error") || reasons.length
          ? "partial"
          : "complete",
    roots: result,
    references,
  };
}
export { isDynamicallyAssignable } from "./properties.js";
