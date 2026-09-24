import { Effect, Result } from "effect";
import {
  analyze,
  authenticSourceHandle,
  authenticInstanceHandle,
  failure,
  freeze,
  nodes,
  open,
  source,
  state,
} from "./project.js";
import { parseDocument, validateExpression as parseExpression } from "./syntax.js";
import { builtinProperties, isDynamicallyAssignable } from "./properties.js";
import type {
  AcceptancePolicy,
  AnalysisReport,
  ComponentSpec,
  Diagnostic,
  EditCandidate,
  EditCommand,
  ExternalProperty,
  ExpressionSyntax,
  Failure,
  Instance,
  InstanceSpec,
  LayoutChange,
  PrepareOptions,
  ProjectSnapshot,
  SourceHandle,
  SourceRange,
  SyntaxNode,
  TextEdit,
} from "./types.js";

interface CandidateState {
  readonly base: ProjectSnapshot;
  readonly next: ProjectSnapshot;
  readonly checked: boolean;
}
const candidates = new WeakMap<EditCandidate, CandidateState>();
const record = (value: unknown): boolean =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validateExpression = (value: unknown): value is string => {
  if (typeof value !== "string" || !parseExpression(value)) return false;
  // A final line comment would consume the statement suffix outside the replacement.
  const tokens = [...value.matchAll(/"(?:\\[\s\S]|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g)];
  const last = tokens.at(-1);
  return !(last?.[0].startsWith("//") && last.index + last[0].length === value.length);
};
const ident = (text: string) =>
  typeof text === "string" &&
  /^[A-Za-z_][A-Za-z_0-9]*$/.test(text) &&
  !new Set([
    "addrmap",
    "regfile",
    "reg",
    "field",
    "mem",
    "signal",
    "property",
    "enum",
    "struct",
    "constraint",
    "default",
    "external",
    "internal",
    "abstract",
    "alias",
    "true",
    "false",
  ]).has(text);
const sameRange = (a: SourceRange, b: SourceRange) =>
  a.documentId === b.documentId && a.start === b.start && a.end === b.end;

export function literal(value: string | boolean | bigint): string {
  if (typeof value === "bigint") {
    if (value < 0n) return `(${value})`;
    return `0x${value.toString(16)}`;
  }
  if (typeof value === "boolean") return String(value);
  return `"${value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r")}"`;
}

function renderComponent(
  spec: ComponentSpec | InstanceSpec,
  level = 0,
  newline = "\n",
  unit = "    ",
): Result.Result<string, Failure> {
  if (spec?.kind === "instance") return renderInstance(spec, level, unit);
  if (
    !spec ||
    level > 128 ||
    (spec.children !== undefined && !Array.isArray(spec.children)) ||
    (spec.dimensions !== undefined && !Array.isArray(spec.dimensions)) ||
    (spec.properties !== undefined && !record(spec.properties)) ||
    !["addrmap", "regfile", "reg", "field", "mem", "signal"].includes(spec.kind) ||
    (spec.name !== undefined && !ident(spec.name)) ||
    (spec.instance !== undefined && !ident(spec.instance)) ||
    (!spec.name && !spec.instance)
  )
    return Result.fail(
      failure(
        "PrepareFailure",
        "invalid-component",
        "A component needs a valid definition name or instance name.",
      ),
    );
  const pad = unit.repeat(level);
  const body: string[] = [];
  for (const [name, expression] of Object.entries(spec.properties ?? {})) {
    if (!ident(name) || !validateExpression(expression))
      return Result.fail(
        failure("PrepareFailure", "invalid-expression", `Invalid property expression for ${name}.`),
      );
    body.push(`${pad}${unit}${name} = ${expression};`);
  }
  for (const child of spec.children ?? []) {
    const rendered = renderComponent(child, level + 1, newline, unit);
    if (Result.isFailure(rendered)) return rendered;
    body.push(rendered.success);
  }
  const dims = spec.dimensions ?? [];
  if (
    dims.some((d) => !validateExpression(d)) ||
    (spec.address !== undefined && !validateExpression(spec.address)) ||
    (spec.range && (!validateExpression(spec.range.msb) || !validateExpression(spec.range.lsb))) ||
    ((dims.length || spec.range || spec.address !== undefined) && !spec.instance)
  )
    return Result.fail(
      failure("PrepareFailure", "invalid-expression", "Invalid component placement."),
    );
  const placement =
    (spec.instance ? ` ${spec.instance}` : "") +
    dims.map((d) => `[${d}]`).join("") +
    (spec.range ? `[${spec.range.msb}:${spec.range.lsb}]` : "") +
    (spec.address !== undefined ? ` @ ${spec.address}` : "");
  return Result.succeed(
    `${pad}${spec.kind}${spec.name ? ` ${spec.name}` : ""} {${newline}${body.length ? body.join(newline) + newline : ""}${pad}}${placement};`,
  );
}
function renderInstance(
  spec: InstanceSpec,
  level = 0,
  unit = "    ",
): Result.Result<string, Failure> {
  const invalid = () =>
    Result.fail(
      failure(
        "PrepareFailure",
        "invalid-instance",
        "Expected a named type, instance name, and valid placement or argument expressions.",
      ),
    );
  if (
    !spec ||
    level > 128 ||
    !ident(spec.name) ||
    typeof spec.type !== "string" ||
    !spec.type.split("::").every(ident) ||
    (spec.arguments !== undefined && !Array.isArray(spec.arguments) && !record(spec.arguments)) ||
    (spec.dimensions !== undefined && !Array.isArray(spec.dimensions)) ||
    (spec.external !== undefined && typeof spec.external !== "boolean")
  )
    return invalid();
  const args = spec.arguments;
  let argumentsText = "";
  if (args !== undefined) {
    if (Array.isArray(args)) {
      if (!args.every(validateExpression)) return invalid();
      if (args.length) argumentsText = ` #(${args.join(", ")})`;
    } else {
      const entries = Object.entries(args);
      if (entries.some(([key, value]) => !ident(key) || !validateExpression(value)))
        return invalid();
      if (entries.length)
        argumentsText = ` #(${entries.map(([key, value]) => `.${key}(${value})`).join(", ")})`;
    }
  }
  const dimensions = spec.dimensions ?? [];
  if (
    !dimensions.every(validateExpression) ||
    [spec.address, spec.stride, spec.alignment].some(
      (value) => value !== undefined && !validateExpression(value),
    ) ||
    (spec.range !== undefined &&
      (!spec.range || !validateExpression(spec.range.msb) || !validateExpression(spec.range.lsb)))
  )
    return invalid();
  const text = `${spec.external === undefined ? "" : spec.external ? "external " : "internal "}${spec.type}${argumentsText} ${spec.name}${dimensions.map((d) => `[${d}]`).join("")}${spec.range ? `[${spec.range.msb}:${spec.range.lsb}]` : ""}${spec.address === undefined ? "" : ` @ ${spec.address}`}${spec.stride === undefined ? "" : ` += ${spec.stride}`}${spec.alignment === undefined ? "" : ` %= ${spec.alignment}`};`;
  const parsed = parseDocument(text, "fragment");
  if (
    parsed.diagnostics.some((d) => d.severity === "error") ||
    parsed.nodes.length !== 1 ||
    parsed.nodes[0]?.kind !== "instance"
  )
    return invalid();
  return Result.succeed(unit.repeat(level) + text);
}
function renderProperty(p: ExternalProperty): Result.Result<string, Failure> {
  if (
    !p ||
    !ident(p.name) ||
    typeof p.type !== "string" ||
    !/^(?:[A-Za-z_][A-Za-z_0-9]*(?:::[A-Za-z_][A-Za-z_0-9]*)*)(?:\s+unsigned)?(?:\[\])?$/.test(
      p.type,
    ) ||
    !Array.isArray(p.components) ||
    !p.components.length ||
    p.components.some(
      (c) =>
        !["all", "constraint", "addrmap", "regfile", "reg", "field", "mem", "signal"].includes(c),
    ) ||
    (p.default !== undefined && !validateExpression(p.default)) ||
    (p.constraint !== undefined && p.constraint !== "componentwidth")
  )
    return Result.fail(
      failure(
        "PrepareFailure",
        "invalid-property",
        "A property requires a name, type, and component kinds.",
      ),
    );
  const text = `property ${p.name} { type = ${p.type}; component = ${p.components.join(" | ")};${p.default === undefined ? "" : ` default = ${p.default};`}${p.constraint ? ` constraint = ${p.constraint};` : ""} };`;
  const parsed = parseDocument(text, "fragment");
  if (
    parsed.diagnostics.some((d) => d.severity === "error") ||
    parsed.nodes.length !== 1 ||
    parsed.nodes[0]?.kind !== "property"
  )
    return Result.fail(
      failure("PrepareFailure", "invalid-property", "Malformed property declaration."),
    );
  return Result.succeed(text);
}
function identifiers(text: string, name: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  const pattern = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|\\?[A-Za-z_][A-Za-z_0-9]*/g;
  for (const m of text.matchAll(pattern))
    if (m[0] === name || m[0] === `\\${name}`)
      found.push({ start: m.index, end: m.index + m[0].length });
  return found;
}
function flatten(xs: readonly Instance[]): Instance[] {
  return xs.flatMap((x) => [x, ...flatten(x.children)]);
}

export function prepare(
  snapshot: ProjectSnapshot,
  commands: readonly EditCommand[],
  options: PrepareOptions,
): Effect.Effect<EditCandidate, Failure> {
  return Effect.gen(function* () {
    const captured = state(snapshot);
    if (!captured)
      return yield* Effect.fail(
        failure("PrepareFailure", "invalid-snapshot", "Snapshot was not created by open()."),
      );
    if (
      !Array.isArray(commands) ||
      !options ||
      !["sourceOnly", "configured"].includes(options.mode) ||
      (options.mode === "configured" &&
        (!Array.isArray(options.configurations) || options.configurations.length === 0))
    )
      return yield* Effect.fail(
        failure(
          "PrepareFailure",
          "invalid-options",
          "Select source-only preparation or at least one configuration.",
        ),
      );
    const commandCopy: EditCommand[] = [];
    for (const command of commands) {
      if (!command || typeof command.kind !== "string")
        return yield* Effect.fail(
          failure("PrepareFailure", "invalid-command", "Invalid edit command."),
        );
      try {
        const copy = structuredClone(command);
        if ("target" in command) copy.target = command.target;
        if ("parent" in command) copy.parent = command.parent;
        if ("before" in command) copy.before = command.before;
        commandCopy.push(freeze(copy));
      } catch {
        return yield* Effect.fail(
          failure(
            "PrepareFailure",
            "invalid-command",
            "Commands must contain structured input records.",
          ),
        );
      }
    }
    commands = commandCopy;
    options =
      options.mode === "sourceOnly"
        ? { mode: "sourceOnly" }
        : { mode: "configured", configurations: [...options.configurations] };
    const operationDiagnostics: Diagnostic[] = [];
    const partialRenames: string[] = [];
    const view = source(snapshot);
    const files = new Map(captured.input.files.map((f) => [f.id, { ...f }]));
    const configurations = captured.input.configurations.map((c) => ({
      ...c,
      roots: [...c.roots],
    }));
    const edits: TextEdit[] = [];
    const beforeReports: AnalysisReport[] = [];
    if (options.mode === "configured") {
      for (const id of new Set(options.configurations))
        beforeReports.push(yield* analyze(snapshot, id));
    }
    const lookup = (h: SourceHandle): Result.Result<SyntaxNode, Failure> => {
      if (!h || !authenticSourceHandle(snapshot, h) || h.revision !== snapshot.revision)
        return Result.fail(
          failure("PrepareFailure", "stale-handle", "Source handle belongs to another revision."),
        );
      const file = view.documents.find((d) => d.id === h.documentId);
      const node = file && [...nodes(file.nodes)].find((n) => n.id === h.nodeId);
      if (!file || !node)
        return Result.fail(
          failure("PrepareFailure", "missing-target", "Source target does not exist."),
        );
      if (!file.writable)
        return Result.fail(
          failure("PrepareFailure", "read-only", `Document is read-only: ${file.id}`),
        );
      if (node.uncertain)
        return Result.fail(
          failure(
            "PrepareFailure",
            "uncertain-target",
            "Recovered syntax has unreliable edit boundaries.",
          ),
        );
      return Result.succeed(node);
    };
    const add = (
      range: SourceRange,
      text: string,
      preserveComments = true,
    ): Result.Result<void, Failure> => {
      const file = files.get(range.documentId);
      if (!file)
        return Result.fail(
          failure("PrepareFailure", "missing-document", `Missing document: ${range.documentId}`),
        );
      if (!file.writable)
        return Result.fail(
          failure("PrepareFailure", "read-only", `Document is read-only: ${range.documentId}`),
        );
      if (
        !Number.isSafeInteger(range.start) ||
        !Number.isSafeInteger(range.end) ||
        range.start < 0 ||
        range.end < range.start ||
        range.end > file.text.length
      )
        return Result.fail(failure("PrepareFailure", "invalid-range", "Invalid source range."));
      const comments = view.documents.find((d) => d.id === range.documentId)?.comments ?? [];
      if (
        preserveComments &&
        comments.some((c) => c.range.start < range.end && c.range.end > range.start)
      )
        return Result.fail(
          failure(
            "PrepareFailure",
            "comment-intersection",
            "This replacement would remove a comment; use a more precise target.",
          ),
        );
      edits.push({ ...range, text });
      return Result.succeed(undefined);
    };
    const append = (
      documentId: string,
      node: SyntaxNode | undefined,
      text: string,
    ): Result.Result<void, Failure> => {
      const file = files.get(documentId);
      if (!file)
        return Result.fail(
          failure("PrepareFailure", "missing-document", `Missing document: ${documentId}`),
        );
      const position = node?.bodyRange?.end ?? file.text.length;
      if (node && (!["component", "property"].includes(node.kind) || !node.bodyRange))
        return Result.fail(
          failure("PrepareFailure", "unsupported-transformation", "Target has no component body."),
        );
      const neighboringNewline = file.text.lastIndexOf("\n", Math.max(0, position - 1));
      const nextNewline =
        neighboringNewline >= 0 ? neighboringNewline : file.text.indexOf("\n", position);
      const newline = nextNewline > 0 && file.text[nextNewline - 1] === "\r" ? "\r\n" : "\n";
      const nodeStart = node?.range.start ?? 0;
      const lineStart = file.text.lastIndexOf("\n", nodeStart - 1) + 1;
      const parentIndent =
        /^\s*/.exec(file.text.slice(lineStart, nodeStart))?.[0].replace(/[\r\n]/g, "") ?? "";
      const sibling = node?.children?.[0];
      const siblingIndent = sibling
        ? /^[ \t]*/.exec(
            file.text.slice(
              file.text.lastIndexOf("\n", sibling.range.start - 1) + 1,
              sibling.range.start,
            ),
          )?.[0]
        : undefined;
      const indent = node
        ? siblingIndent && siblingIndent.length > parentIndent.length
          ? siblingIndent
          : `${parentIndent}    `
        : "";
      const formatted = text
        .split(/\r?\n/)
        .map((line) => `${indent}${line}`)
        .join(newline);
      return add(
        { documentId, start: position, end: position },
        `${position && !file.text.slice(0, position).endsWith("\n") ? newline : ""}${formatted}${newline}${node ? parentIndent : ""}`,
      );
    };
    for (const command of commands as readonly EditCommand[]) {
      if (!command || typeof command.kind !== "string")
        return yield* Effect.fail(
          failure("PrepareFailure", "invalid-command", "Invalid edit command."),
        );
      if (command.kind === "createDocument") {
        if (
          typeof command.documentId !== "string" ||
          !command.documentId ||
          files.has(command.documentId) ||
          (command.components !== undefined && !Array.isArray(command.components)) ||
          (command.roots !== undefined &&
            (!Array.isArray(command.roots) || command.roots.some((id) => typeof id !== "string")))
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "duplicate-document",
              "New document identity must be unique.",
            ),
          );
        const pieces: string[] = [];
        for (const spec of command.components ?? [])
          pieces.push(yield* Effect.fromResult(renderComponent(spec)));
        const text = pieces.length ? `${pieces.join("\n\n")}\n` : "";
        files.set(command.documentId, { id: command.documentId, text, writable: true });
        edits.push({ documentId: command.documentId, start: 0, end: 0, text });
        for (const id of command.roots ?? []) {
          const config = configurations.find((c) => c.id === id);
          if (!config)
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "unknown-configuration",
                `Unknown root configuration: ${id}`,
              ),
            );
          config.roots.push(command.documentId);
        }
        continue;
      }
      if (
        command.kind === "insertComponent" ||
        command.kind === "insertInstance" ||
        command.kind === "declareProperty"
      ) {
        if (!captured.input.files.some((f) => f.id === command.documentId))
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "missing-document",
              "Insertion targets must belong to the base snapshot.",
            ),
          );
        const parent =
          command.kind !== "declareProperty" && command.parent
            ? yield* Effect.fromResult(lookup(command.parent))
            : undefined;
        if (parent && parent.range.documentId !== command.documentId)
          return yield* Effect.fail(
            failure("PrepareFailure", "invalid-target", "Parent belongs to another document."),
          );
        const rendered = yield* Effect.fromResult(
          command.kind === "insertComponent"
            ? renderComponent(command.component)
            : command.kind === "insertInstance"
              ? renderInstance(command.instance)
              : renderProperty(command.property),
        );
        if (command.kind !== "declareProperty" && command.before) {
          const anchor = yield* Effect.fromResult(lookup(command.before));
          const siblings =
            parent?.children ??
            view.documents.find((d) => d.id === command.documentId)?.nodes ??
            [];
          if (
            anchor.range.documentId !== command.documentId ||
            !siblings.includes(anchor) ||
            (parent && (parent.kind !== "component" || !parent.bodyRange))
          )
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "invalid-anchor",
                "Insertion anchor must be a direct statement in the selected parent or document.",
              ),
            );
          const text = files.get(command.documentId)!.text;
          if (anchor.kind === "instance") {
            const fragment = parseDocument(
              text.slice(anchor.range.start, anchor.range.end),
              "anchor",
            );
            if (
              fragment.diagnostics.length ||
              fragment.nodes.length !== 1 ||
              fragment.nodes[0]?.kind !== "instance"
            )
              return yield* Effect.fail(
                failure(
                  "PrepareFailure",
                  "invalid-anchor",
                  "An instance-list entry cannot anchor a separate statement. Use its enclosing declaration.",
                ),
              );
          }
          const position = anchor.range.start;
          const lineStart = text.lastIndexOf("\n", position - 1) + 1;
          const prefix = text.slice(lineStart, position);
          const indent = /^[ \t]*$/.test(prefix) ? prefix : "";
          const nearbyNewline = text.indexOf("\n", position);
          const newline = nearbyNewline > 0 && text[nearbyNewline - 1] === "\r" ? "\r\n" : "\n";
          const formatted = rendered.split(/\r?\n/).join(newline + indent);
          yield* Effect.fromResult(
            add(
              { documentId: command.documentId, start: position, end: position },
              formatted + newline + indent,
            ),
          );
        } else {
          yield* Effect.fromResult(append(command.documentId, parent, rendered));
        }
        continue;
      }
      if (command.kind === "setInstanceProperty") {
        if (
          !command.target ||
          !authenticInstanceHandle(snapshot, command.target) ||
          command.target.revision !== snapshot.revision
        )
          return yield* Effect.fail(
            failure("PrepareFailure", "stale-handle", "Instance belongs to another revision."),
          );
        const report = beforeReports.find(
          (r) => r.configurationId === command.target.configurationId,
        );
        const instance =
          report && flatten(report.roots).find((i) => i.id === command.target.instanceId);
        if (!report || !instance || !report.coverage.complete)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "analysis-required",
              "Instance edits require complete configured analysis.",
            ),
          );
        if (
          !ident(command.property) ||
          !validateExpression(command.expression) ||
          !(
            isDynamicallyAssignable(command.property, instance.kind, captured.input.properties) ||
            (!builtinProperties[command.property] &&
              view.documents.some((d) =>
                [...nodes(d.nodes)].some(
                  (n) =>
                    n.kind === "property" &&
                    n.name === command.property &&
                    n.children?.some(
                      (p) =>
                        p.name === "component" &&
                        p.expression?.text
                          .split("|")
                          .map((c) => c.trim())
                          .some((c) => c === "all" || c === instance.kind),
                    ),
                ),
              ))
          )
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "unsupported-transformation",
              "Property cannot be assigned with this instance-only operation.",
            ),
          );
        if (/\[/.test(instance.path))
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "unsupported-transformation",
              "Indexed instance edits are not supported.",
            ),
          );
        const physicalInstance = view.documents
          .flatMap((d) => [...nodes(d.nodes)])
          .find((n) => n.kind === "instance" && sameRange(n.range, instance.source));
        if (!physicalInstance || physicalInstance.uncertain)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "unsupported-transformation",
              "Instance has no reliable physical source declaration.",
            ),
          );
        const root = report.roots.find((r) => flatten([r]).some((i) => i.id === instance.id));
        const doc = root && view.documents.find((d) => d.id === root.definition.documentId);
        const owner =
          root &&
          doc &&
          [...nodes(doc.nodes)].find(
            (n) => n.kind === "component" && sameRange(n.range, root.definition),
          );
        if (!root || !owner || owner.uncertain || !owner.bodyRange || root.id === instance.id)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "unsupported-transformation",
              "Cannot identify a writable instance-override scope.",
            ),
          );
        const target = instance.path.slice(root.path.length + 1);
        const existingAssignments = owner.children?.filter(
          (n) => n.kind === "assignment" && n.name === command.property && n.target === target,
        );
        if ((existingAssignments?.length ?? 0) > 1)
          return yield* Effect.fail(
            failure("PrepareFailure", "ambiguous-target", "Multiple instance assignments match."),
          );
        const existing = existingAssignments?.[0];
        if (existing?.uncertain)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "uncertain-target",
              "Instance assignment has unreliable edit boundaries.",
            ),
          );
        if (existing?.expression)
          yield* Effect.fromResult(add(existing.expression.range, command.expression));
        else
          yield* Effect.fromResult(
            append(
              owner.range.documentId,
              owner,
              `${target}->${command.property} = ${command.expression};`,
            ),
          );
        continue;
      }
      const node = yield* Effect.fromResult(lookup(command.target));
      const file = files.get(node.range.documentId)!;
      if (command.kind === "replaceExpression") {
        const slot = command.slot ?? "expression";
        let expression: ExpressionSyntax | undefined;
        if (typeof slot === "string") {
          if (!["expression", "address", "stride", "alignment", "msb", "lsb"].includes(slot))
            return yield* Effect.fail(
              failure("PrepareFailure", "invalid-expression", "Unknown expression slot."),
            );
          expression = node[slot];
        } else if (record(slot) && "parameter" in slot && typeof slot.parameter === "string") {
          const matches = node.parameters?.filter((p) => p.name === slot.parameter) ?? [];
          if (matches.length === 1) expression = matches[0]!.value;
        } else if (record(slot) && "argument" in slot) {
          const key = slot.argument;
          if (typeof key === "number" && Number.isSafeInteger(key) && key >= 0) {
            expression = node.arguments?.[key]?.value;
          } else if (typeof key === "string") {
            const matches = node.arguments?.filter((a) => a.name === key) ?? [];
            if (matches.length === 1) expression = matches[0]!.value;
          }
        }
        if (!expression || !validateExpression(command.expression))
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "invalid-expression",
              "Expected an existing expression and a complete replacement expression.",
            ),
          );
        yield* Effect.fromResult(add(expression.range, command.expression));
      } else if (command.kind === "setProperty" || command.kind === "removeProperty") {
        if (!ident(command.property) || node.kind !== "component" || !node.bodyRange)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "invalid-target",
              "Property editing requires a component body and valid property name.",
            ),
          );
        const assignments = (node.children ?? []).filter(
          (n) => n.kind === "assignment" && n.name === command.property && !n.target && !n.default,
        );
        if (assignments.length > 1)
          return yield* Effect.fail(
            failure("PrepareFailure", "ambiguous-target", "Multiple property assignments match."),
          );
        const assignment = assignments[0];
        if (assignment?.uncertain)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "uncertain-target",
              "Property assignment has unreliable edit boundaries.",
            ),
          );
        if (command.kind === "removeProperty") {
          if (!assignment)
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "missing-target",
                "Property is not explicitly assigned here.",
              ),
            );
          yield* Effect.fromResult(
            add(assignment.range, retainedComments(snapshot, assignment.range), false),
          );
        } else {
          if (command.expression !== undefined && !validateExpression(command.expression))
            return yield* Effect.fail(
              failure("PrepareFailure", "invalid-expression", "Malformed property expression."),
            );
          if (assignment?.expression && command.expression !== undefined)
            yield* Effect.fromResult(add(assignment.expression.range, command.expression));
          else if (assignment)
            yield* Effect.fromResult(
              add(
                assignment.range,
                `${command.property}${command.expression === undefined ? "" : ` = ${command.expression}`};`,
              ),
            );
          else
            yield* Effect.fromResult(
              append(
                node.range.documentId,
                node,
                `${command.property}${command.expression === undefined ? "" : ` = ${command.expression}`};`,
              ),
            );
        }
      } else if (command.kind === "delete") {
        let range = node.range;
        if (node.kind === "instance") {
          const allNodes = [...nodes(view.documents.find((d) => d.id === file.id)!.nodes)];
          const owner = allNodes.find((n) => n.instances?.includes(node));
          const siblings =
            owner?.instances ??
            (node.typeRange
              ? allNodes.filter(
                  (n) =>
                    n.kind === "instance" && n.typeRange && sameRange(n.typeRange, node.typeRange!),
                )
              : [node]);
          const at = siblings.indexOf(node);
          if (siblings.some((n) => n.uncertain) || owner?.uncertain)
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "uncertain-target",
                "Instance list boundaries are unreliable.",
              ),
            );
          if (siblings.length > 1 && at >= 0) {
            range =
              at < siblings.length - 1
                ? { ...range, end: siblings[at + 1]!.range.start }
                : { ...range, start: siblings[at - 1]!.range.end };
          } else if (owner && !owner.name) range = owner.range;
        }
        yield* Effect.fromResult(add(range, retainedComments(snapshot, range), false));
      } else if (command.kind === "duplicate") {
        if (
          !["component", "instance"].includes(node.kind) ||
          !node.nameRange ||
          !ident(command.name)
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "invalid-name",
              "Duplication needs a named target and a valid new name.",
            ),
          );
        const definitionOnly = node.kind === "component" && (node.instances?.length ?? 0) > 0;
        const copyEnd = definitionOnly && node.bodyRange ? node.bodyRange.end + 1 : node.range.end;
        const segments: TextEdit[] = [
          {
            documentId: file.id,
            start: node.nameRange.start - node.range.start,
            end: node.nameRange.end - node.range.start,
            text: command.name,
          },
        ];
        for (const comment of view.documents.find((d) => d.id === file.id)?.comments ?? [])
          if (comment.range.start >= node.range.start && comment.range.end <= copyEnd)
            segments.push({
              documentId: file.id,
              start: comment.range.start - node.range.start,
              end: comment.range.end - node.range.start,
              text: " ",
            });
        let copy = file.text.slice(node.range.start, copyEnd);
        for (const edit of segments.sort((a, b) => b.start - a.start))
          copy = copy.slice(0, edit.start) + edit.text + copy.slice(edit.end);
        if (definitionOnly) copy += ";";
        const newline = file.text.includes("\r\n") ? "\r\n" : "\n";
        const inlineInstance =
          node.kind === "instance" &&
          !file.text.slice(node.range.start, node.range.end).trimEnd().endsWith(";");
        yield* Effect.fromResult(
          add(
            { documentId: file.id, start: node.range.end, end: node.range.end },
            inlineInstance ? `, ${copy}` : `${newline}${copy}`,
          ),
        );
      } else if (command.kind === "editPropertyDeclaration") {
        if (!command.property || node.kind !== "property" || node.name !== command.property.name)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "invalid-target",
              "Use rename separately to change a property declaration's name.",
            ),
          );
        yield* Effect.fromResult(renderProperty(command.property));
        const attributes: Record<string, string | undefined> = {
          type: command.property.type,
          component: command.property.components.join(" | "),
          default: command.property.default,
          constraint: command.property.constraint,
        };
        for (const [key, desired] of Object.entries(attributes)) {
          const matches = node.children?.filter((child) => child.name === key) ?? [];
          if (matches.length > 1 || matches[0]?.uncertain)
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "ambiguous-target",
                "UDP attribute boundaries are ambiguous.",
              ),
            );
          const attribute = matches[0];
          if (desired === undefined) {
            if (attribute)
              yield* Effect.fromResult(
                add(attribute.range, retainedComments(snapshot, attribute.range), false),
              );
          } else if (attribute?.expression) {
            if (
              attribute.expression.text.replace(/\s+/g, " ").trim() !==
              desired.replace(/\s+/g, " ").trim()
            )
              yield* Effect.fromResult(add(attribute.expression.range, desired));
          } else {
            yield* Effect.fromResult(append(node.range.documentId, node, `${key} = ${desired};`));
          }
        }
      } else if (command.kind === "rename") {
        if (
          !["component", "instance", "property", "enum", "enumMember", "struct", "member"].includes(
            node.kind,
          ) ||
          !node.nameRange ||
          !ident(command.name) ||
          beforeReports.length === 0
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "analysis-required",
              "Rename requires configured analysis and a valid declaration name.",
            ),
          );
        if (beforeReports.some((r) => !r.coverage.complete) && !command.partial)
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "incomplete-rename",
              "Cannot establish complete reference coverage.",
            ),
          );
        const externalExpressions = [
          ...captured.input.configurations.flatMap((configuration) => [
            ...Object.values(configuration.parameters ?? {}),
            ...Object.values(configuration.macros ?? {}),
          ]),
          ...(captured.input.properties ?? []).flatMap((property) => [
            property.type,
            ...(property.default === undefined ? [] : [property.default]),
          ]),
        ];
        let topReference = false;
        if (node.kind === "component" || node.kind === "instance") {
          for (const configuration of captured.input.configurations) {
            if (configuration.top !== node.name) continue;
            const report =
              beforeReports.find((report) => report.configurationId === configuration.id) ??
              (yield* analyze(snapshot, configuration.id));
            const selection = report.topSelection;
            if (selection && !selection.generated && sameRange(selection.range, node.nameRange)) {
              topReference = true;
              break;
            }
          }
        }
        const externalReference = externalExpressions.some(
          (expression) => identifiers(expression, node.name).length > 0,
        );
        if (!command.partial && (externalReference || topReference))
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "incomplete-rename",
              "Captured configuration values or external property expressions may reference this declaration, including a configuration.top selection. These dependencies require separate updates; explicitly request a partial rename.",
            ),
          );
        const refs = beforeReports.flatMap((r) => r.references);
        const ranges = [
          node.nameRange,
          ...refs
            .filter((r) => sameRange(r.definition, node.nameRange!) && !r.generated)
            .map((r) => r.range),
        ];
        const known = [
          ...refs.filter((r) => !r.generated).map((r) => r.range),
          ...view.documents.flatMap((d) =>
            [...nodes(d.nodes)].flatMap((n) =>
              n.nameRange &&
              [
                "component",
                "instance",
                "property",
                "enum",
                "enumMember",
                "struct",
                "member",
              ].includes(n.kind)
                ? [n.nameRange]
                : [],
            ),
          ),
        ];
        const unresolved = view.documents.some((d) =>
          identifiers(d.text, node.name).some(
            (r) => !known.some((k) => sameRange(k, { ...r, documentId: d.id })),
          ),
        );
        if (
          !command.partial &&
          (unresolved || refs.some((r) => sameRange(r.definition, node.nameRange!) && r.generated))
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "incomplete-rename",
              "References remain unresolved, inactive, or macro-generated. Explicitly request a partial rename to edit only reliable targets.",
            ),
          );
        if (command.partial) {
          partialRenames.push(
            `Rename of ${node.name} to ${command.name} has explicitly partial reference coverage.`,
          );
          operationDiagnostics.push({
            code: "partial-rename",
            severity: "warning",
            phase: "semantic",
            message: `Only reliably resolved references to ${node.name} were renamed. Inactive, unresolved, or generated references may retain the previous name.${externalReference || topReference ? " Configuration values, configuration.top, or external property expressions require separate updates." : ""}`,
            range: node.nameRange,
          });
        }
        const unique = new Map(ranges.map((r) => [JSON.stringify(r), r]));
        for (const range of unique.values()) yield* Effect.fromResult(add(range, command.name));
      } else
        return yield* Effect.fail(
          failure("PrepareFailure", "invalid-command", "Unknown edit command."),
        );
    }
    const normalized: TextEdit[] = [];
    for (const [id, file] of files) {
      if (!captured.input.files.some((f) => f.id === id)) continue;
      const local = edits
        .filter((e) => e.documentId === id)
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const combined: TextEdit[] = [];
      for (const edit of local) {
        const previous = combined.at(-1);
        if (previous && edit.start < previous.end)
          return yield* Effect.fail(
            failure("PrepareFailure", "conflicting-edits", "Command source ranges overlap."),
          );
        if (
          previous &&
          edit.start === previous.start &&
          (edit.end > edit.start || previous.end > previous.start)
        )
          return yield* Effect.fail(
            failure(
              "PrepareFailure",
              "conflicting-edits",
              "Insertion conflicts with a replacement at the same anchor.",
            ),
          );
        if (
          previous &&
          edit.start === previous.start &&
          edit.end === edit.start &&
          previous.end === previous.start
        )
          combined[combined.length - 1] = { ...previous, text: previous.text + edit.text };
        else combined.push(edit);
      }
      let text = file.text;
      for (const edit of [...combined].reverse())
        text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
      files.set(id, { ...file, text });
      normalized.push(...combined);
    }
    normalized.push(
      ...edits.filter((e) => !captured.input.files.some((f) => f.id === e.documentId)),
    );
    const next = yield* Effect.fromResult(
      open({ ...captured.input, files: [...files.values()], configurations }),
    );
    const reports: AnalysisReport[] = [];
    if (options.mode === "configured")
      for (const id of new Set(options.configurations)) reports.push(yield* analyze(next, id));
    if (commands.some((command) => command.kind === "rename")) {
      const mappedRange = (range: SourceRange): SourceRange | undefined => {
        let delta = 0;
        for (const edit of normalized.filter((edit) => edit.documentId === range.documentId)) {
          if (edit.end <= range.start) {
            delta += edit.text.length - (edit.end - edit.start);
          } else if (edit.start >= range.end) break;
          else if (sameRange(edit, range))
            return {
              ...range,
              start: range.start + delta,
              end: range.start + delta + edit.text.length,
            };
          else return undefined;
        }
        return { ...range, start: range.start + delta, end: range.end + delta };
      };
      for (const before of beforeReports) {
        const after = reports.find((report) => report.configurationId === before.configurationId)!;
        for (const reference of before.references) {
          if (reference.generated) continue;
          const location = mappedRange(reference.range);
          const definition = mappedRange(reference.definition);
          if (!location || !definition) continue;
          const resolved = after.references.filter(
            (ref) => !ref.generated && sameRange(ref.range, location),
          );
          if (resolved.some((ref) => !sameRange(ref.definition, definition)))
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "rename-capture",
                "Rename would bind an existing reference to a different declaration.",
              ),
            );
          if (
            !resolved.length &&
            commands.some((command) => command.kind === "rename" && !command.partial)
          )
            return yield* Effect.fail(
              failure(
                "PrepareFailure",
                "incomplete-rename",
                "Cannot verify reference bindings after the rename.",
              ),
            );
        }
      }
    }
    const reasons: string[] = [...partialRenames];
    const changes: LayoutChange[] = [];
    if (!reports.length) reasons.push("Semantic comparison was not requested.");
    for (const after of reports) {
      const before = beforeReports.find((r) => r.configurationId === after.configurationId)!;
      if (
        !before.coverage.complete ||
        !after.coverage.complete ||
        before.model !== "complete" ||
        after.model !== "complete"
      ) {
        reasons.push(`Incomplete semantic comparison for ${after.configurationId}.`);
        continue;
      }
      const mapPoint = (range: SourceRange): number | undefined => {
        let delta = 0;
        for (const edit of normalized.filter((e) => e.documentId === range.documentId)) {
          if (edit.start > range.start) break;
          if (edit.end > range.start) {
            const rename = commands.some(
              (c) =>
                c.kind === "rename" &&
                (() => {
                  const n = lookup(c.target);
                  return (
                    Result.isSuccess(n) &&
                    n.success.nameRange &&
                    sameRange(n.success.nameRange, edit)
                  );
                })(),
            );
            return rename && edit.start === range.start ? edit.start + delta : undefined;
          }
          delta += edit.text.length - (edit.end - edit.start);
        }
        return range.start + delta;
      };
      const emitChange = (a: Instance | undefined, b: Instance | undefined) => {
        if (
          !a ||
          !b ||
          a.path !== b.path ||
          a.address !== b.address ||
          a.lsb !== b.lsb ||
          a.msb !== b.msb
        )
          changes.push({
            configurationId: after.configurationId,
            path: (b ?? a)!.path,
            ...(a && b && a.path !== b.path ? { previousPath: a.path } : {}),
            ...(a ? { before: { address: a.address, lsb: a.lsb, msb: a.msb } } : {}),
            ...(b ? { after: { address: b.address, lsb: b.lsb, msb: b.msb } } : {}),
          });
      };
      const compare = (old: readonly Instance[], fresh: readonly Instance[]) => {
        const unmatched = new Set(fresh);
        for (const a of old) {
          const point = mapPoint(a.source);
          let matches =
            point === undefined
              ? []
              : [...unmatched].filter(
                  (b) =>
                    b.kind === a.kind &&
                    b.source.documentId === a.source.documentId &&
                    b.source.start === point,
                );
          if (matches.length > 1) matches = matches.filter((b) => b.name === a.name);
          const b = matches.length === 1 ? matches[0] : undefined;
          if (matches.length > 1)
            reasons.push(
              `Ambiguous instance correspondence for ${a.path} in ${after.configurationId}.`,
            );
          if (b) {
            unmatched.delete(b);
            emitChange(a, b);
            compare(a.children, b.children);
          } else for (const removed of flatten([a])) emitChange(removed, undefined);
        }
        for (const added of unmatched) for (const i of flatten([added])) emitChange(undefined, i);
      };
      compare(before.roots, after.roots);
    }
    const candidate: EditCandidate = freeze({
      baseRevision: snapshot.revision,
      snapshot: next,
      edits: normalized,
      reports,
      diagnostics: [
        ...operationDiagnostics,
        ...(reports.length
          ? reports.flatMap((r) => r.diagnostics)
          : source(next).documents.flatMap((d) => d.diagnostics)),
      ],
      layoutChanges: changes,
      comparisonCoverage: { complete: reasons.length === 0, reasons },
    });
    candidates.set(candidate, {
      base: snapshot,
      next,
      checked:
        reports.length > 0 &&
        reports.every(
          (r) =>
            r.coverage.complete &&
            r.model === "complete" &&
            !r.diagnostics.some((d) => d.severity === "error"),
        ),
    });
    return candidate;
  });
}
function retainedComments(snapshot: ProjectSnapshot, range: SourceRange): string {
  const file = source(snapshot).documents.find((d) => d.id === range.documentId)!;
  return file.comments
    .filter((c) => c.range.start >= range.start && c.range.end <= range.end)
    .map((c) => `${c.text}${file.text.includes("\r\n") ? "\r\n" : "\n"}`)
    .join("");
}
export function apply(
  current: ProjectSnapshot,
  candidate: EditCandidate,
  policy: AcceptancePolicy = "checked",
): Result.Result<ProjectSnapshot, Failure> {
  const registered = candidates.get(candidate);
  if (!registered || registered.base !== current || !state(current))
    return Result.fail(
      failure(
        "ApplyFailure",
        "stale-candidate",
        "Candidate is unknown or was prepared against another snapshot.",
      ),
    );
  if (policy !== "checked" && policy !== "draft")
    return Result.fail(failure("ApplyFailure", "invalid-policy", "Unknown acceptance policy."));
  if (
    candidate.edits.some(
      (e) => current.files.find((f) => f.id === e.documentId)?.writable === false,
    )
  )
    return Result.fail(
      failure("ApplyFailure", "read-only", "Candidate modifies a read-only document."),
    );
  if (policy === "checked" && !registered.checked)
    return Result.fail(
      failure(
        "ApplyFailure",
        "validation-required",
        "Checked application requires complete successful validation.",
      ),
    );
  return Result.succeed(registered.next);
}
