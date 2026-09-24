import { Effect, Result } from "effect";
import { parseDocument } from "./syntax.js";
import { analyzeInput } from "./semantics.js";
import type {
  AnalysisReport,
  Configuration,
  Failure,
  Instance,
  InstanceHandle,
  ProjectInput,
  ProjectSnapshot,
  RdlValue,
  SourceHandle,
  SourceLocation,
  SourceRange,
  SourceView,
  SyntaxNode,
} from "./types.js";

interface State {
  readonly input: ProjectInput;
  readonly view: SourceView;
}
const states = new WeakMap<ProjectSnapshot, State>();
let revision = 0;
const isArray = (value: unknown): boolean => Array.isArray(value);
const record = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const sourceHandles = new WeakMap<SourceHandle, ProjectSnapshot>();
const instanceHandles = new WeakMap<InstanceHandle, AnalysisReport>();
const analysisReports = new WeakSet<AnalysisReport>();
const indexedInstances = new WeakMap<Instance, AnalysisReport>();
export function authenticSourceHandle(snapshot: ProjectSnapshot, h: SourceHandle): boolean {
  return !!h && sourceHandles.get(h) === snapshot;
}
export function authenticInstanceHandle(snapshot: ProjectSnapshot, h: InstanceHandle): boolean {
  const report = h && instanceHandles.get(h);
  return (
    !!report &&
    report.revision === snapshot.revision &&
    report.configurationId === h.configurationId
  );
}

export function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export const failure = (tag: Failure["_tag"], code: string, message: string): Failure => ({
  _tag: tag,
  code,
  message,
});

/** Captures a complete virtual-file input. Source errors remain inspectable. */
export function open(input: ProjectInput): Result.Result<ProjectSnapshot, Failure> {
  const fail = (message: string) => Result.fail(failure("InputError", "invalid-input", message));
  if (!input || !isArray(input.files) || !isArray(input.configurations))
    return fail("Expected files and configurations arrays.");
  const fileIds = new Set<string>();
  for (const file of input.files) {
    if (
      !file ||
      typeof file.id !== "string" ||
      !file.id ||
      typeof file.text !== "string" ||
      (file.writable !== undefined && typeof file.writable !== "boolean")
    )
      return fail("Invalid source file.");
    if (fileIds.has(file.id)) return fail(`Duplicate document identity: ${file.id}`);
    fileIds.add(file.id);
  }
  const configIds = new Set<string>();
  for (const c of input.configurations) {
    if (
      !c ||
      typeof c.id !== "string" ||
      !c.id ||
      !isArray(c.roots) ||
      c.roots.some((x) => typeof x !== "string")
    )
      return fail("Invalid configuration.");
    if (configIds.has(c.id)) return fail(`Duplicate configuration identity: ${c.id}`);
    configIds.add(c.id);
    if (c.top !== undefined && typeof c.top !== "string")
      return fail("Top-level name must be a string.");
    for (const values of [c.macros, c.parameters])
      if (
        values !== undefined &&
        (!record(values) || Object.values(values).some((x) => typeof x !== "string"))
      )
        return fail("Macro and parameter expressions must be strings.");
    if (c.includes !== undefined && !isArray(c.includes))
      return fail("Include bindings must be an array.");
    const bindings = new Set<string>();
    for (const binding of c.includes ?? []) {
      if (
        !binding ||
        [binding.from, binding.request, binding.to].some((x) => typeof x !== "string")
      )
        return fail("Invalid include binding.");
      const key = JSON.stringify([binding.from, binding.request]);
      if (bindings.has(key)) return fail("Duplicate include binding.");
      bindings.add(key);
    }
  }
  if (input.properties !== undefined && !isArray(input.properties))
    return fail("External properties must be an array.");
  for (const p of input.properties ?? []) {
    if (
      !p ||
      typeof p.name !== "string" ||
      typeof p.type !== "string" ||
      typeof p.origin !== "string" ||
      !isArray(p.components) ||
      p.components.some(
        (x) =>
          !["all", "constraint", "addrmap", "regfile", "reg", "field", "mem", "signal"].includes(x),
      ) ||
      (p.constraint !== undefined && p.constraint !== "componentwidth") ||
      (p.default !== undefined && typeof p.default !== "string")
    )
      return fail("Invalid external property declaration.");
  }
  if (input.validators !== undefined && !isArray(input.validators))
    return fail("Validators must be an array.");
  const validators = new Set<string>();
  for (const v of input.validators ?? []) {
    if (
      !v ||
      typeof v.id !== "string" ||
      !v.id ||
      typeof v.version !== "string" ||
      typeof v.validate !== "function" ||
      validators.has(v.id)
    )
      return fail("Invalid or duplicate validator registration.");
    validators.add(v.id);
  }
  if (input.limits !== undefined && !record(input.limits))
    return fail("Resource limits must be a record.");
  for (const [key, value] of Object.entries(input.limits ?? {})) {
    if (
      !["includeDepth", "expandedCharacters", "instances"].includes(key) ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      (key === "includeDepth" && value < 15)
    )
      return fail(
        "Resource limits must be positive safe integers; includeDepth must be at least 15.",
      );
  }
  const captured: ProjectInput = freeze({
    files: input.files.map((f) => ({ id: f.id, text: f.text, writable: f.writable ?? true })),
    configurations: input.configurations.map((c) => ({
      id: c.id,
      roots: [...c.roots],
      ...(c.top === undefined ? {} : { top: c.top }),
      macros: { ...c.macros },
      parameters: { ...c.parameters },
      includes: (c.includes ?? []).map((b) => ({ from: b.from, request: b.request, to: b.to })),
    })),
    properties: (input.properties ?? []).map((p) => ({
      name: p.name,
      type: p.type,
      origin: p.origin,
      components: [...p.components],
      default: p.default,
      constraint: p.constraint,
    })),
    validators: (input.validators ?? []).map((v) => ({
      id: v.id,
      version: v.version,
      validate: v.validate,
    })),
    limits: { ...input.limits },
  });
  const snapshot = freeze({
    revision: `rdl:${++revision}`,
    files: captured.files,
    configurations: captured.configurations,
  });
  const view: SourceView = freeze({
    documents: captured.files.map((f) => ({ ...f, ...parseDocument(f.text, f.id) })),
  });
  states.set(snapshot, { input: captured, view });
  return Result.succeed(snapshot);
}

/** Internal lookup also validates that snapshots came from this library instance. */
export function state(snapshot: ProjectSnapshot): State | undefined {
  return states.get(snapshot);
}
export function source(snapshot: ProjectSnapshot): SourceView {
  const found = states.get(snapshot);
  if (!found) throw new TypeError("Invalid project snapshot. Use open() to create a snapshot.");
  return found.view;
}
export function serialize(
  snapshot: ProjectSnapshot,
): readonly { readonly id: string; readonly text: string }[] {
  return freeze(source(snapshot).documents.map((f) => ({ id: f.id, text: f.text })));
}
export function* nodes(children: readonly SyntaxNode[]): Generator<SyntaxNode> {
  for (const node of children) {
    yield node;
    yield* nodes(node.children ?? []);
    yield* nodes(node.instances ?? []);
  }
}
export function handle(
  snapshot: ProjectSnapshot,
  node: SyntaxNode,
): Result.Result<SourceHandle, Failure> {
  const registered = state(snapshot);
  if (!registered || !registered.view.documents.some((d) => [...nodes(d.nodes)].includes(node)))
    return Result.fail(
      failure("InputError", "stale-node", "Node does not belong to this snapshot."),
    );
  const h = freeze({
    revision: snapshot.revision,
    documentId: node.range.documentId,
    nodeId: node.id,
  });
  sourceHandles.set(h, snapshot);
  return Result.succeed(h);
}
export function instanceHandle(
  report: AnalysisReport,
  instance: Instance,
): Result.Result<InstanceHandle, Failure> {
  const contains = (xs: readonly Instance[]): boolean =>
    xs.some((i) => i === instance || contains(i.children));
  if (
    !analysisReports.has(report) ||
    (!contains(report.roots) && indexedInstances.get(instance) !== report)
  )
    return Result.fail(
      failure("InputError", "stale-instance", "Instance does not belong to this analysis report."),
    );
  const h = freeze({
    revision: report.revision,
    configurationId: report.configurationId,
    instanceId: instance.id,
  });
  instanceHandles.set(h, report);
  return Result.succeed(h);
}
/** Resolves UTF-16 ranges to zero-based physical line and column positions. */
export function sourceLocation(
  snapshot: ProjectSnapshot,
  range: SourceRange,
): Result.Result<SourceLocation, Failure> {
  const captured = state(snapshot);
  if (!captured)
    return Result.fail(
      failure("InputError", "invalid-snapshot", "Snapshot was not created by open()."),
    );
  const file = range && captured.input.files.find((f) => f.id === range.documentId);
  if (
    !file ||
    !Number.isSafeInteger(range.start) ||
    !Number.isSafeInteger(range.end) ||
    range.start < 0 ||
    range.end < range.start ||
    range.end > file.text.length
  )
    return Result.fail(
      failure(
        "InputError",
        "invalid-range",
        "Expected a physical range within a supplied document.",
      ),
    );
  const position = (offset: number) => {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset; i++) {
      if (file.text[i] === "\r") {
        if (file.text[i + 1] === "\n") {
          if (i + 1 >= offset) continue;
          i++;
        }
        line++;
        lineStart = i + 1;
      } else if (file.text[i] === "\n") {
        line++;
        lineStart = i + 1;
      }
    }
    return { line, column: offset - lineStart };
  };
  return Result.succeed(
    freeze({ documentId: file.id, start: position(range.start), end: position(range.end) }),
  );
}
export function findInstance(report: AnalysisReport, path: string): Instance | undefined {
  if (typeof path !== "string") return undefined;
  let siblings = report.roots;
  let found: Instance | undefined;
  const parts = path.split(".");
  for (const part of parts) {
    const match = /^([A-Za-z_][A-Za-z_0-9$]*)((?:\[\d+\])*)$/.exec(part);
    if (!match) return undefined;
    found = siblings.find((i) => i.name === match[1]);
    if (!found) return undefined;
    const indices = [...match[2]!.matchAll(/\[(\d+)\]/g)].map((m) => BigInt(m[1]!));
    if (indices.length) {
      if (
        indices.length !== found.dimensions.length ||
        found.stride === undefined ||
        found.stride < 0n
      )
        return undefined;
      let linear = 0n;
      for (let i = 0; i < indices.length; i++) {
        if (indices[i]! >= found.dimensions[i]!) return undefined;
        linear = linear * found.dimensions[i]! + indices[i]!;
      }
      const offset = linear * found.stride;
      const oldPath = found.path;
      const newPath = oldPath + indices.map((i) => `[${i}]`).join("");
      const remapPath = (p: string) =>
        p === oldPath || p.startsWith(`${oldPath}.`) ? newPath + p.slice(oldPath.length) : p;
      const remapValue = (value: RdlValue): RdlValue => {
        if (!value || typeof value !== "object") return value;
        if (Array.isArray(value)) return value.map((v) => remapValue(v));
        const record = value as Exclude<RdlValue, readonly RdlValue[] | string | boolean>;
        if (record.kind === "reference") return { ...record, path: remapPath(record.path) };
        if (record.kind === "struct")
          return {
            ...record,
            members: Object.fromEntries(
              Object.entries(record.members).map(([k, v]) => [k, remapValue(v)]),
            ),
          };
        return value;
      };
      const clone = (i: Instance, element: boolean): Instance => {
        const next: Instance = freeze({
          ...i,
          id: `${report.configurationId}:${remapPath(i.path)}`,
          path: remapPath(i.path),
          dimensions: element ? [] : i.dimensions,
          ...(i.address === undefined ? {} : { address: i.address + offset }),
          properties: Object.fromEntries(
            Object.entries(i.properties).map(([k, v]) => [
              k,
              v.value === undefined ? v : { ...v, value: remapValue(v.value) },
            ]),
          ),
          children: i.children.map((child) => clone(child, false)),
        });
        if (analysisReports.has(report)) indexedInstances.set(next, report);
        return next;
      };
      found = clone(found, true);
    }
    siblings = found.children;
  }
  return found;
}
export function analyze(
  snapshot: ProjectSnapshot,
  configurationId: string,
): Effect.Effect<AnalysisReport, Failure> {
  return Effect.gen(function* () {
    const captured = state(snapshot);
    if (!captured)
      return yield* Effect.fail(
        failure("AnalysisFailure", "invalid-snapshot", "Snapshot was not created by open()."),
      );
    if (!captured.input.configurations.some((c: Configuration) => c.id === configurationId))
      return yield* Effect.fail(
        failure(
          "AnalysisFailure",
          "unknown-configuration",
          `Unknown configuration: ${configurationId}`,
        ),
      );
    yield* Effect.yieldNow;
    const initial = freeze(analyzeInput(captured.input, snapshot.revision, configurationId));
    const diagnostics = [...initial.diagnostics];
    const reasons = [...initial.coverage.reasons];
    for (const validator of captured.input.validators ?? []) {
      const checked = validator.validate(initial);
      if (Result.isFailure(checked)) {
        reasons.push(`Validator ${validator.id} failed.`);
        diagnostics.push({
          code: "validator-failed",
          severity: "error",
          phase: "custom",
          message: checked.failure.message,
          origin: validator.id,
        });
      } else {
        for (const diagnostic of checked.success)
          diagnostics.push({ ...diagnostic, phase: "custom", origin: validator.id });
      }
    }
    const report: AnalysisReport = freeze({
      ...initial,
      diagnostics,
      coverage: { complete: initial.coverage.complete && reasons.length === 0, reasons },
      model:
        diagnostics.some((d) => d.severity === "error") && initial.model === "complete"
          ? ("partial" as const)
          : initial.model,
    });
    analysisReports.add(report);
    return report;
  });
}
