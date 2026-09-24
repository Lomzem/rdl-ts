import type {
  Configuration,
  Diagnostic,
  ExpandedUnit,
  ExpansionOrigin,
  PreprocessResult,
  ProjectInput,
  SourceRange,
} from "./types.js";

interface Macro {
  body: string;
  parameters?: string[];
  defaults?: (string | undefined)[];
  source?: SourceRange;
}
interface Conditional {
  parent: boolean;
  taken: boolean;
  active: boolean;
  otherwise: boolean;
}
const ignored = new Set([
  "begin_keywords",
  "end_keywords",
  "celldefine",
  "endcelldefine",
  "default_nettype",
  "nounconnected_drive",
  "nounconnecteddrive",
  "pragma",
  "resetall",
  "timescale",
  "unconnected_drive",
  "unconnecteded_drive",
]);
const directives = new Set([
  "define",
  "undef",
  "ifdef",
  "ifndef",
  "if",
  "elsif",
  "else",
  "endif",
  "include",
  "line",
  ...ignored,
]);
const identifier = /^[a-zA-Z_][a-zA-Z_0-9$]*/;

function newlineAt(text: string, start: number): number {
  for (let i = start; i < text.length; i++) if (text[i] === "\r" || text[i] === "\n") return i;
  return -1;
}
function afterNewline(text: string, position: number): number {
  return position >= text.length
    ? position
    : position + (text.startsWith("\r\n", position) ? 2 : 1);
}

/** Split macro arguments without treating commas in strings or nested expressions as separators. */
function argumentsAt(text: string, start: number): { values: string[]; end: number } | undefined {
  const values: string[] = [];
  const stack = [")"];
  let from = start + 1;
  for (let i = from; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') {
      i = quotedEnd(text, i) - 1;
      continue;
    }
    if (text.startsWith("//", i)) {
      const end = newlineAt(text, i);
      if (end < 0) return undefined;
      i = end;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return undefined;
      i = end + 1;
      continue;
    }
    if ("([{".includes(char)) stack.push(char === "(" ? ")" : char === "[" ? "]" : "}");
    else if (")]}".includes(char)) {
      if (stack.pop() !== char) return undefined;
      if (stack.length === 0) {
        values.push(text.slice(from, i).trim());
        return { values, end: i + 1 };
      }
    } else if (char === "," && stack.length === 1) {
      values.push(text.slice(from, i).trim());
      from = i + 1;
    }
  }
  return undefined;
}
function quotedEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i + 1;
  }
  return text.length;
}
function withoutLineComments(text: string, removeBlock = false): string {
  let output = "";
  for (let i = 0; i < text.length;) {
    if (text[i] === '"') {
      const end = quotedEnd(text, i);
      output += text.slice(i, end);
      i = end;
    } else if (text.startsWith("/*", i)) {
      const close = text.indexOf("*/", i + 2);
      const end = close < 0 ? text.length : close + 2;
      output += removeBlock && close >= 0 ? " " : text.slice(i, end);
      i = end;
    } else if (text.startsWith("//", i)) {
      const end = newlineAt(text, i);
      if (end < 0) break;
      output += "\n";
      i = end + 1;
    } else output += text[i++]!;
  }
  return output;
}
function substitute(
  body: string,
  values: ReadonlyMap<string, string>,
  limit: number,
): string | undefined {
  let out = "";
  let stringify = false;
  for (let i = 0; i < body.length;) {
    if (out.length > limit) return undefined;
    if (body.startsWith('`\\`"', i)) {
      out += '\\"';
      i += 4;
      continue;
    }
    if (body.startsWith('`"', i)) {
      stringify = !stringify;
      out += '"';
      i += 2;
      continue;
    }
    if (body.startsWith("``", i)) {
      i += 2;
      continue;
    }
    if (!stringify && body[i] === "\\") {
      const end = i + 1 + (/^[A-Za-z_][A-Za-z_0-9]*/.exec(body.slice(i + 1))?.[0].length ?? 0);
      out += body.slice(i, end);
      i = end;
      continue;
    }
    if (!stringify && body[i] === '"') {
      const end = quotedEnd(body, i);
      out += body.slice(i, end);
      i = end;
      continue;
    }
    if (body.startsWith("//", i)) {
      out += body.slice(i);
      break;
    }
    if (body.startsWith("/*", i)) {
      const end = body.indexOf("*/", i + 2);
      const next = end < 0 ? body.length : end + 2;
      out += body.slice(i, next);
      i = next;
      continue;
    }
    const token = identifier.exec(body.slice(i));
    if (token) {
      out += values.get(token[0]) ?? token[0];
      i += token[0].length;
    } else out += body[i++]!;
  }
  return out;
}

/** Preprocess captured virtual files. Original source strings are never modified. */
export function preprocess(input: ProjectInput, configuration: Configuration): PreprocessResult {
  const files = new Map(input.files.map((file) => [file.id, file.text]));
  const diagnostics: Diagnostic[] = [];
  const units: ExpandedUnit[] = [];
  let complete = true;
  let remaining = input.limits?.expandedCharacters ?? 2_000_000;
  const depthLimit = input.limits?.includeDepth ?? 64;
  let exhausted = false;
  let workRemaining = Math.max(1, remaining) * 8;
  const report = (
    code: string,
    message: string,
    range?: SourceRange,
    related?: readonly SourceRange[],
  ) => {
    complete = false;
    diagnostics.push({
      code,
      message,
      range,
      related,
      severity: "error",
      phase: code === "expansion-limit" || code === "include-depth" ? "resource" : "preprocess",
    });
  };
  for (const root of configuration.roots) {
    const macros = new Map<string, Macro>(
      Object.entries(configuration.macros ?? {}).map(([name, body]) => [name, { body }]),
    );
    const chunks: string[] = [];
    const origins: ExpansionOrigin[] = [];
    let length = 0;
    let callDepth = 0;
    const append = (
      text: string,
      source: SourceRange,
      generated: boolean,
      chain: readonly SourceRange[],
      logical?: { readonly file: string; readonly line: number },
    ) => {
      if (!text || exhausted) return;
      if (text.length > remaining) {
        report("expansion-limit", "Expanded character limit exceeded.", source);
        exhausted = true;
        return;
      }
      remaining -= text.length;
      chunks.push(text);
      const previous = origins.at(-1);
      if (
        previous &&
        !generated &&
        !previous.generated &&
        previous.source.documentId === source.documentId &&
        previous.source.end === source.start &&
        previous.chain === (chain.length ? chain : undefined) &&
        previous.logical === undefined &&
        logical === undefined
      ) {
        origins[origins.length - 1] = {
          ...previous,
          end: length + text.length,
          source: { ...source, start: previous.source.start },
        };
      } else
        origins.push({
          start: length,
          end: length + text.length,
          source,
          generated,
          logical,
          chain: chain.length ? chain : undefined,
        });
      length += text.length;
    };
    // Expansion uses the same lexical scanner as source, with separate recursion tracking.
    const process = (
      text: string,
      documentId: string,
      chain: readonly SourceRange[],
      depth: number,
      expansion: readonly string[] = [],
      generatedSource?: SourceRange,
      generatedLogical?: { readonly file: string; readonly line: number },
    ) => {
      if (++callDepth > 128) {
        callDepth--;
        report("expansion-limit", "Preprocessor nesting limit exceeded.", generatedSource);
        return;
      }
      const conditions: Conditional[] = [];
      if (!generatedSource) {
        const perl = text.indexOf("<%");
        if (perl >= 0)
          report("unsupported-perl", "Embedded Perl execution is unsupported.", {
            documentId,
            start: perl,
            end: Math.min(text.length, perl + 2),
          });
      }
      let logicalFile: string | undefined;
      let logicalLine = 1;
      let logicalOffset = 0;
      const logicalAt = (offset: number) => {
        if (generatedSource) return generatedLogical;
        if (logicalFile === undefined) return undefined;
        while (logicalOffset < offset) {
          if (
            text[logicalOffset] === "\r" ||
            (text[logicalOffset] === "\n" && text[logicalOffset - 1] !== "\r")
          )
            logicalLine++;
          logicalOffset++;
        }
        return { file: logicalFile, line: logicalLine };
      };
      const range = (start: number, end: number): SourceRange =>
        generatedSource ?? { documentId, start, end };
      const active = () => conditions.at(-1)?.active ?? true;
      const emit = (start: number, end: number) => {
        if (active())
          append(
            text.slice(start, end),
            range(start, end),
            generatedSource !== undefined,
            chain,
            logicalAt(start),
          );
      };
      for (let i = 0; i < text.length && !exhausted;) {
        const start = i;
        if (--workRemaining < 0) {
          report("expansion-limit", "Preprocessor work limit exceeded.", range(i, i));
          exhausted = true;
          break;
        }
        if (text.startsWith("<%", i)) {
          const end = text.indexOf("%>", i + 2);
          i = end < 0 ? text.length : end + 2;
          if (generatedSource)
            report("unsupported-perl", "Embedded Perl execution is unsupported.", range(start, i));
          if (active()) append(" ", range(start, i), true, chain);
          continue;
        }
        if (text.startsWith("//", i)) {
          const end = newlineAt(text, i);
          i = end < 0 ? text.length : end;
          emit(start, i);
          continue;
        }
        if (text.startsWith("/*", i)) {
          const end = text.indexOf("*/", i + 2);
          i = end < 0 ? text.length : end + 2;
          if (end < 0)
            report("unterminated-comment", "Unterminated block comment.", range(start, i));
          emit(start, i);
          continue;
        }
        if (text[i] === '"') {
          i = quotedEnd(text, i);
          emit(start, i);
          continue;
        }
        if (text[i] === "\\") {
          i += 1 + (/^[A-Za-z_][A-Za-z_0-9]*/.exec(text.slice(i + 1))?.[0].length ?? 0);
          emit(start, i);
          continue;
        }
        if (text[i] !== "`") {
          i++;
          while (i < text.length && !'`"\\/<'.includes(text[i]!)) i++;
          emit(start, i);
          continue;
        }
        const nameMatch = identifier.exec(text.slice(i + 1));
        if (!nameMatch) {
          i++;
          if (active())
            report(
              "invalid-directive",
              "Expected a macro or directive name after the backtick.",
              range(start, i),
            );
          continue;
        }
        const name = nameMatch[0];
        i += name.length + 1;
        if (directives.has(name)) {
          let end = newlineAt(text, i);
          if (end < 0) end = text.length;
          if (name === "define")
            while (end < text.length && /\\\r?$/.test(text.slice(i, end))) {
              const next = newlineAt(text, afterNewline(text, end));
              end = next < 0 ? text.length : next;
            }
          if (["ifdef", "ifndef", "elsif", "undef"].includes(name)) {
            const argumentToken = /^[ \t]*[a-zA-Z_][a-zA-Z_0-9$]*/.exec(text.slice(i, end));
            end = i + (argumentToken?.[0].length ?? 0);
          } else if (
            ["else", "endif", "resetall", "celldefine", "endcelldefine", "end_keywords"].includes(
              name,
            )
          )
            end = i;
          const raw = text
            .slice(i, end)
            .replace(/\\(?:\r\n|\r|\n)/g, "\n")
            .replace(/\r$/, "");
          const argument = withoutLineComments(raw, true).trim();
          const location = range(start, end);
          i = end;
          if (name === "ifdef" || name === "ifndef" || name === "if") {
            const parent = active();
            if (name === "if")
              report(
                "unsupported-if",
                "The nonstandard `if directive has no defined supported interpretation.",
                location,
              );
            const valid = /^[a-zA-Z_][a-zA-Z_0-9$]*$/.test(argument);
            if (name !== "if" && !valid)
              report(
                "conditional-name",
                "Conditional directive requires one macro name.",
                location,
              );
            const matched = name !== "if" && valid && macros.has(argument) === (name === "ifdef");
            conditions.push({
              parent,
              taken: matched,
              active: parent && matched,
              otherwise: false,
            });
          } else if (name === "elsif" || name === "else") {
            const condition = conditions.at(-1);
            if (!condition || condition.otherwise)
              report("conditional-order", `Unexpected \`${name}.`, location);
            else {
              const valid =
                name === "else" ? argument === "" : /^[a-zA-Z_][a-zA-Z_0-9$]*$/.test(argument);
              if (!valid)
                report("conditional-name", "Invalid conditional directive argument.", location);
              const matched = valid && (name === "else" || macros.has(argument));
              condition.active = condition.parent && !condition.taken && matched;
              condition.taken ||= matched;
              condition.otherwise = name === "else";
            }
          } else if (name === "endif") {
            if (!conditions.pop()) report("conditional-order", "Unexpected `endif.", location);
            if (argument) report("directive-argument", "`endif takes no argument.", location);
          } else if (active()) {
            if (name === "define") {
              const definition = /^\s*([a-zA-Z_][a-zA-Z_0-9$]*)/.exec(raw);
              if (!definition) report("macro-definition", "Expected a macro name.", location);
              else {
                const macroName = definition[1]!;
                let offset = definition[0].length;
                let parameters: string[] | undefined;
                let defaults: (string | undefined)[] | undefined;
                if (raw[offset] === "(") {
                  const args = argumentsAt(raw, offset);
                  if (!args) {
                    report("macro-definition", "Unterminated macro parameter list.", location);
                    continue;
                  }
                  const entries =
                    args.values.length === 1 && args.values[0] === "" ? [] : args.values;
                  parameters = [];
                  defaults = [];
                  for (const entry of entries) {
                    const parameter = /^([a-zA-Z_][a-zA-Z_0-9$]*)(?:\s*=\s*([\s\S]*))?$/.exec(
                      entry,
                    );
                    if (!parameter || parameters.includes(parameter[1]!)) {
                      report("macro-definition", "Invalid or duplicate macro parameter.", location);
                      continue;
                    }
                    parameters.push(parameter[1]!);
                    defaults.push(parameter[2]);
                  }
                  offset = args.end;
                }
                const body = withoutLineComments(raw.slice(offset)).trimStart();
                const previous = macros.get(macroName);
                if (
                  previous &&
                  (previous.body !== body ||
                    JSON.stringify(previous.parameters) !== JSON.stringify(parameters) ||
                    JSON.stringify(previous.defaults) !== JSON.stringify(defaults))
                ) {
                  diagnostics.push({
                    code: "macro-redefinition",
                    severity: "warning",
                    phase: "preprocess",
                    message: `Macro ${macroName} was redefined.`,
                    range: location,
                    related: previous.source ? [previous.source] : undefined,
                  });
                }
                macros.set(macroName, { body, parameters, defaults, source: location });
              }
            } else if (name === "undef") {
              if (!/^[a-zA-Z_][a-zA-Z_0-9$]*$/.test(argument))
                report("macro-name", "`undef requires one macro name.", location);
              else macros.delete(argument);
            } else if (name === "include") {
              let request = argument;
              const includeOrigins: SourceRange[] = [];
              if (request.startsWith("`")) {
                const chunkCount = chunks.length,
                  originCount = origins.length,
                  oldLength = length,
                  oldRemaining = remaining;
                process(request, documentId, chain, depth, expansion, location, logicalAt(start));
                request = chunks.splice(chunkCount).join("").trim();
                for (const origin of origins.splice(originCount))
                  includeOrigins.push(...(origin.chain ?? []));
                length = oldLength;
                remaining = oldRemaining;
              }
              const quoted = /^"([^"\r\n]+)"$/.exec(request);
              const binding =
                quoted &&
                configuration.includes?.find(
                  (item) => item.from === documentId && item.request === quoted[1],
                );
              const included = binding && files.get(binding.to);
              if (!quoted)
                report(
                  "include-path",
                  "`include requires a quoted file name or object macro containing one.",
                  location,
                );
              else if (!binding || typeof included !== "string")
                report(
                  "missing-include",
                  `No supplied include binding for ${quoted[1]}.`,
                  location,
                );
              else if (depth >= depthLimit)
                report("include-depth", "Include nesting limit exceeded.", location);
              else
                process(included, binding.to, [...chain, location, ...includeOrigins], depth + 1);
            } else if (name === "line") {
              const match = /^(\d+)\s+"([^"\r\n]*)"\s+[012]$/.exec(argument);
              if (!match || Number(match[1]) < 1 || !Number.isSafeInteger(Number(match[1])))
                report("line-directive", 'Expected `line number "filename" level.', location);
              else {
                logicalFile = match[2]!;
                logicalLine = Number(match[1]);
                logicalOffset = afterNewline(text, end);
                i = logicalOffset;
              }
            }
          }
          // Keep a separator even for directives at EOF so adjoining tokens cannot fuse.
          if (active()) append(" ", location, true, chain);
          continue;
        }
        if (!active()) continue;
        const macro = macros.get(name);
        if (!macro) {
          report("undefined-macro", `Undefined macro ${name}.`, range(start, i));
          append(" ", range(start, i), true, chain);
          continue;
        }
        if (expansion.includes(name) || expansion.length >= 128) {
          report("macro-recursion", `Recursive macro expansion of ${name}.`, range(start, i));
          continue;
        }
        const values = new Map<string, string>();
        const argumentOrigins: SourceRange[] = [];
        if (macro.parameters) {
          while (/\s/.test(text[i] ?? "") && i < text.length) i++;
          const args = text[i] === "(" ? argumentsAt(text, i) : undefined;
          if (!args) {
            report("macro-arguments", `Expected argument list for ${name}.`, range(start, i));
            continue;
          }
          i = args.end;
          const actual = macro.parameters.length === 0 && args.values[0] === "" ? [] : args.values;
          if (actual.length > macro.parameters.length) {
            report("macro-arity", `Too many arguments for ${name}.`, range(start, i));
            continue;
          }
          let valid = true;
          macro.parameters.forEach((parameter, index) => {
            const value = actual[index] || macro.defaults?.[index];
            if (value === undefined && index >= actual.length) {
              valid = false;
              report("macro-arity", `Missing argument ${parameter} for ${name}.`, range(start, i));
            }
            const chunkCount = chunks.length;
            const originCount = origins.length;
            const oldLength = length;
            const oldRemaining = remaining;
            process(
              value ?? "",
              documentId,
              chain,
              depth,
              expansion,
              range(start, i),
              logicalAt(start),
            );
            const expanded = chunks.splice(chunkCount).join("");
            for (const origin of origins.splice(originCount))
              argumentOrigins.push(...(origin.chain ?? []));
            length = oldLength;
            remaining = oldRemaining;
            values.set(parameter, expanded);
          });
          if (!valid) continue;
        }
        const invocation = range(start, i);
        const nextChain = [
          ...chain,
          invocation,
          ...(macro.source ? [macro.source] : []),
          ...argumentOrigins,
        ];
        const body = substitute(macro.body, values, remaining);
        if (body === undefined || body.length > remaining) {
          report("expansion-limit", "Expanded character limit exceeded.", invocation);
          exhausted = true;
          continue;
        }
        process(
          body,
          documentId,
          nextChain,
          depth,
          [...expansion, name],
          invocation,
          logicalAt(start),
        );
      }
      if (conditions.length)
        report(
          "unterminated-conditional",
          "Conditional block has no matching `endif.",
          range(text.length, text.length),
        );
      callDepth--;
    };
    const source = files.get(root);
    if (source === undefined) report("missing-root", `Root document ${root} was not supplied.`);
    else process(source, root, [], 0);
    units.push({ root, text: chunks.join(""), origins });
  }
  return { units, diagnostics, complete };
}
