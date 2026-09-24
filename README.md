# rdl-ts

A TypeScript library for parsing, analyzing, creating, and editing SystemRDL source in browsers and Node.js 22 or later. The library retains the original source and applies localized edits. Opening and serializing a document without edits returns exactly the supplied string, including comments, whitespace, and malformed text.

SystemRDL 2.0 defines the language rules. User Defined Properties include declaration, type, applicability, binding, default, and assignment validation. A small comparison suite uses `systemrdl-compiler` to check interoperability. Exporter requirements do not define language validity.

## Open and analyze

The application supplies virtual files and named configurations. It owns file selection, dependency resolution, storage, and the GUI. The library needs no server or Python runtime.

```ts
import { Effect, Result } from "effect";
import { analyze, open, serialize } from "@lomzem/rdl";

const opened = open({
  files: [
    {
      id: "registers.rdl",
      text: "addrmap top { reg { field { sw = rw; hw = r; } enable; } control; };\n",
    },
  ],
  configurations: [{ id: "default", roots: ["registers.rdl"] }],
});

if (Result.isSuccess(opened)) {
  const snapshot = opened.success;
  const outcome = await Effect.runPromise(Effect.result(analyze(snapshot, "default")));
  if (Result.isSuccess(outcome)) {
    const report = outcome.success;
    console.log(report.roots, report.diagnostics, report.coverage);
  }
  const filesToSave = serialize(snapshot);
}
```

Expected operation failures are values. Invalid SystemRDL produces diagnostics in a report. A report can expose a partial model while its `coverage.complete` is false. Callers must check both diagnostics and coverage before treating analysis as validation. Effect is a direct public dependency, pinned to `4.0.0-rc.117` for this release. Use `Effect.runPromiseExit` at an application boundary when defects and interruption must also be represented as values.

## Preview and apply an edit

Source nodes identify declarations and assignments. Analysis instances identify elaborated hardware. Use a source handle to change a declaration and an instance handle for a supported dynamic property override.

```ts
import { Effect, Result } from "effect";
import { apply, handle, prepare, source } from "@lomzem/rdl";

// Continue with a snapshot returned by open.
const top = source(snapshot).documents[0]?.nodes.find(
  (node) => node.kind === "component" && node.name === "top",
);
const selected = top ? handle(snapshot, top) : undefined;
if (selected && Result.isSuccess(selected)) {
  const prepared = await Effect.runPromise(
    Effect.result(
      prepare(
        snapshot,
        [
          {
            kind: "setProperty",
            target: selected.success,
            property: "desc",
            expression: '"Register block"',
          },
        ],
        { mode: "configured", configurations: ["default"] },
      ),
    ),
  );

  if (Result.isSuccess(prepared)) {
    const candidate = prepared.success;
    console.log(candidate.edits, candidate.diagnostics, candidate.layoutChanges);
    const applied = apply(snapshot, candidate);
    if (Result.isSuccess(applied)) {
      const nextSnapshot = applied.success;
      // Save serialize(nextSnapshot) using the application's storage API.
    }
  }
}
```

`prepare` leaves its input unchanged. `apply` accepts the whole command group or returns a failure. Its default checked policy requires complete validation without errors for the selected configurations. Pass `"draft"` explicitly to retain a candidate with validation errors or incomplete analysis. Source-only preparation also requires draft acceptance. Neither policy permits stale candidates, read-only changes, or unsupported transformations.

Create handles with `handle` and `instanceHandle`; copied or fabricated handles are rejected. Both helpers return `Result`. `sourceLocation` converts a physical UTF-16 range to zero-based line and column coordinates. `findInstance` accepts paths such as `top.bank[3].field` without expanding the full array. Duplicating a named definition copies its body under the new name and omits its existing inline instances.

Snapshots and candidates are immutable and bound to the captured input. Reopening files or configuration creates a new revision and invalidates previous candidates. The library cannot detect external file changes that the application has not supplied.

## Capabilities and boundaries

- Create new documents and structured component trees; insert, delete, duplicate, and rename declarations and instances.
- Edit built-in properties, UDP declarations and assignments, and source expressions. Preserve surrounding source and comments. There are no comment-authoring commands or whole-file formatting commands.
- Expand macros and conditional compilation using supplied include bindings. Preserve directives and inactive source. Macro-generated syntax cannot be a structured edit target.
- Analyze ordered roots with configuration-specific macros, parameters, and top-level selection. Caller-supplied UDP declarations stay external to serialized source. Custom validators add diagnostics without overriding standard rules.
- Represent hardware values and addresses with `bigint`. Arrays remain dimensioned descriptions; indexed lookup avoids eagerly allocating one record per element.
- Preserve unsupported source and report incomplete coverage for Perl preprocessing, constraint semantics, indexed instance-array overrides, and runtime-dependent reference selection. Perl never executes.

The first implementation reparses snapshots. Resource limits bound expansion, syntax nesting, and elaboration. Effect does not move synchronous parsing off the browser's main thread. Applications can place library calls in their own worker when needed. Saving several serialized files is an application responsibility; atomic application applies to the in-memory snapshot.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run format
bun run test:node
bunx playwright install chromium
bun run test:browser
python3 -m pip install systemrdl-compiler==1.32.2
bun run test:reference
```

Set `RDL_REFERENCE_PYTHON` to select a Python interpreter for the optional compiler comparisons. CI runs specification fixtures, TypeScript checks, lint, formatting, the build, Node 22 and Chromium edit/save tests, and the pinned comparisons. The specification itself is a local reference and is not distributed.

- [Implementation design](docs/design.md)
- [Accepted scope](docs/scope.md)
- [Acceptance examples](docs/acceptance.md)
- [Completed decision map](docs/wayfinder/0001-library-design.md)
- [Research](docs/research/README.md)
- [Initial workload examples](docs/performance.md)
- [Compiler comparison notes](docs/compatibility.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
