# SystemRDL library design

This design resolves routine technical choices delegated by the user. It implements the accepted [scope](./scope.md) and [decision map](./wayfinder/0001-library-design.md). It records the implementation contract; passing tests provide evidence for specific behaviors, not complete language conformance. Public names and records below are the initial implementation contract; private algorithms may change without changing that contract.

## Interface

Expose one operation family. Ordinary records contain source text, diagnostics, and available analysis. Effect is a public dependency. Keep parser types, token structures, caches, and mutation private.

| Operation   | Inputs                                         | Output and contract                                                                                                                                               |
| ----------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`      | `ProjectInput`                                 | `Result<ProjectSnapshot, InputError>`. Capture inputs and recover available source structure. Malformed SystemRDL produces diagnostics, not loss of the document. |
| `source`    | Snapshot                                       | Read-only source documents and recoverable declarations, assignments, expressions, and instance statements with source handles.                                   |
| `analyze`   | Snapshot, configuration ID                     | `Effect<AnalysisReport, AnalysisFailure>`. Interpret one configuration and retain useful partial results.                                                         |
| `prepare`   | Snapshot, command group, preparation options   | `Effect<EditCandidate, PrepareFailure>`. Construct and validate the final candidate without changing the input.                                                   |
| `apply`     | Current snapshot, candidate, acceptance policy | `Result<ProjectSnapshot, ApplyFailure>`. Default to checked acceptance. Return the candidate's new snapshot or a failure, never a partially applied group.        |
| `serialize` | Snapshot                                       | Read-only file identity/source-text records. No storage access, whole-file regeneration, or requirement that source be valid.                                     |

Preparation options explicitly select either a nonempty list of configuration IDs to validate or source-only preparation. Source-only mode cannot perform a semantic operation whose promise requires analysis. Plain lookup helpers return an optional value or a Result for ambiguous/invalid requests; they do not introduce another runtime abstraction.

The application runs effects at its own execution boundary. Use `runPromiseExit` when it wants failures, defects, and interruption as values. Library internals do not run an application's effects synchronously. See [verified Effect behavior](./research/error-interface.md).

Publish one ESM package with TypeScript declarations and no Node filesystem imports in the browser entry point. Initial runtime targets are modern evergreen browsers and Node.js 22 or later, consistent with the selected parser. Keep Effect at the researched 4.0.0-rc.117 and Chevrotain at 13.2.0 when adding implementation dependencies, with a lockfile. Broader runtime/version compatibility is not a first-release promise. The implementation pins these versions in the package manifest and lockfile.

## Captured inputs and freshness

`ProjectInput` contains:

- A finite collection of virtual files, each with an opaque document ID, source string, and writable flag.
- Named configurations, each with ordered root document IDs, explicit top-level selection when provided, initial macro definitions, and parameter overrides.
- Explicit include bindings from an including document ID and expanded include spelling to another supplied document ID. Resolution can differ by configuration. The caller implements filesystem, URL, or search-path lookup before opening the project.
- Caller-supplied UDP declaration records with external origin IDs.
- Optional custom validator registrations with stable IDs and versions.

There is no live filesystem or network resolver inside a snapshot in the first release. A missing include yields a diagnostic and incomplete analysis. The caller can supply the missing file and bindings by opening revised inputs. This keeps synchronous application meaningful and works in Node.js and the browser without platform adapters in the core.

Opening revised input creates a new opaque revision. Changes to any file, configuration, permission, include binding, external UDP declaration, or validator registration invalidate existing candidates, even when the changed file was inactive. This conservative rule avoids dependency-sensitive invalidation complexity in the first release.

Copy input arrays and records and expose immutable views. Do not rely solely on TypeScript's `readonly` modifier. Snapshot and candidate authenticity is private; callers cannot fabricate validation success or change a candidate's base revision.

The library detects changes in supplied snapshots, not unreported changes in external storage. Callers must refresh inputs when external files or configuration change. Validators must not depend on mutable captured state.

## Source and analysis records

`SourceHandle` identifies a recovered source node within one snapshot. `InstanceHandle` identifies an elaborated instance within one analysis, including its configuration. Human-readable instance paths support display and lookup, but are not stable source identity.

`AnalysisReport` contains snapshot/configuration identities, diagnostics, validation coverage, model availability, and available instances with source provenance. Source provenance identifies physical source locations and, where relevant, declaration, instance, assignment/default, include chain, macro invocation, and macro-definition origins. Logical locations supplied by `line` are additional display information; they never replace physical edit locations.

Model availability and validation coverage are separate. A completed validation pass may find language errors. An incomplete pass may expose useful instances but cannot certify validity. Store reasons for incomplete coverage, rather than inferring coverage from the presence or absence of diagnostics.

Keep physical recovery notes distinct from configuration-specific diagnostics. An inactive branch or macro-dependent raw fragment may be unparseable in isolation without making the selected expanded configuration invalid. Checked acceptance uses applicable diagnostics and coverage for its required configurations, not every exploratory physical-source note.

Use physical ranges measured in UTF-16 code units, matching JavaScript strings. Retain line/column information for diagnostics with a documented zero-based convention. Preserve original line endings and string contents. The library accepts source strings; byte encoding and filesystem metadata belong to the caller.

Expose arrays as dimensioned instance descriptions with indexed navigation. Do not eagerly expand enormous register arrays merely to open a document. Any enumerating query must honor an explicit limit and disclose truncation.

## Numeric and property values

Use `bigint` for evaluated integral values and addresses. Preserve the SystemRDL type and bit width needed for sizing, casting, truncation, and overflow. Offsets into source strings are JavaScript numbers; hardware numbers do not silently convert to them.

The value model distinguishes integers, booleans, strings, reserved enumerations, user-enum members, arrays, structs, and component/property references. User enums retain type and member identity in addition to numeric value. Keep source expressions separate from evaluated values. Do not flatten references or enums into JSON primitives.

A UDP query reports binding separately from value availability. Distinguish an unbound UDP, a bound property without a value, a value selected from its declared default, and an explicit assignment. Also distinguish a legitimately undefined value from one unavailable because analysis was incomplete. Preserve the origin of effective values, including lexical defaults and dynamic assignments.

External UDP declarations occupy the same root property namespace as source declarations. Duplicate declarations produce diagnostics identifying both origins; neither silently overrides the other. External declarations do not appear in serialization. If source declarations exist, callers should omit corresponding external declarations and attach any extra validation separately.

## Diagnostics and operation failures

Diagnostics have stable codes, severity, phase, message, primary physical location when available, related locations, and origin. Distinguish syntax errors, semantic errors, unsupported features, missing inputs, resource limits, and custom validation. Do not require consumers to parse message strings.

| Failure family    | Expected cases                                                                                                                                |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `InputError`      | Duplicate document/configuration identity or invalid input record.                                                                            |
| `AnalysisFailure` | Unknown or unusable requested configuration.                                                                                                  |
| `PrepareFailure`  | Stale or ambiguous handle, missing target, conflicting commands, malformed command fragment, unsupported transformation, or read-only target. |
| `ApplyFailure`    | Stale candidate, read-only target, or acceptance policy not satisfied.                                                                        |

Malformed documents, wrong UDP values, unresolved includes, and unsupported constructs stay in diagnostic-bearing reports where useful output is possible. Expected resolver/loading failures occur in the caller, which supplies files or a missing-input state. Defects remain implementation defects, and interruption remains interruption; neither is relabeled as a language error.

Custom validators are pure synchronous callbacks over read-only analysis. They return additional diagnostics or an expected validator-failure value. They cannot remove or downgrade standard diagnostics. A validator failure makes custom validation incomplete and blocks checked acceptance. A thrown callback exception is a defect, observed through Effect's execution result. Registration IDs and versions are part of the snapshot.

## Commands and candidate application

Command families cover the accepted operations: create a document; insert, delete, or duplicate a component definition or instance; edit a UDP declaration; set/remove a property assignment; replace an address, field-position, or parameter expression; and rename a declaration or instance with reference updates.

Structured component specifications contain names, kinds, nested declarations/instances, properties, and placement expressions. Expressions may be supplied as source text, parsed as a complete expression fragment before insertion. Typed literal helpers provide safe string escaping and exact numeric literals. This avoids making callers assemble whole SystemRDL statements for ordinary GUI edits.

Reject a fragment that is not exactly the required syntactic category. Use new source input through `open` for arbitrary text edits, including incomplete typing. Structured commands can still create semantically invalid drafts. This prevents expression text from accidentally inserting unrelated declarations.

Commands target base-snapshot handles. A created document may contain an initial structured declaration tree and explicitly names the configurations that add it as a root. New nested content can be supplied as one tree, so a group does not need handles to nodes that do not exist yet. Separate commands cannot implicitly target another command's new node in the first release.

Reject overlapping replacements and inconsistent commands. Coalesce independent insertions at the same reliable anchor in the caller's command order. Analyze the complete resulting source, not each intermediate command. Perform read-only checks during preparation and again during application.

An instance-only property command inserts or updates an override only when the supported language permits it. Otherwise fail. Do not clone a shared type or edit its definition as a fallback. A complete rename needs complete reference coverage for its stated configurations. An explicitly partial rename reports uncovered regions; draft acceptance alone does not make a rename partial.

Candidates carry the base revision, next snapshot, per-document text changes, required validation configurations, reports, and semantic comparisons. Application uses those private requirements, never a replacement report supplied by the caller. Checked policy requires complete validation and no errors. Source-only candidates need explicit draft acceptance or a new configured preparation. Warnings do not block checked application.

Compare before/after layouts under the same configuration and report address and field-position changes where both sides can be analyzed. Carry command provenance to match renamed targets and identify additions and deletions. Do not treat a newly created target as the previous target merely because it occupies the same path. Each comparison reports its own coverage and reasons for missing results. An empty list of changes with incomplete coverage is not proof that hardware layout is unchanged.

Atomic application is an in-memory guarantee. Serializing multiple documents does not provide a filesystem or browser-storage transaction. Consumers own saving and undo history; prior immutable snapshots remain available to support their own undo behavior.

## Formatting and comments

Default new documents to LF, four-space indentation, and a final newline. For inserted text in existing documents, infer line endings and indentation from reliable neighboring syntax, falling back to the parent and these defaults. Do not introduce a configurable whole-file formatter in the first release.

Value replacement changes only the required expression range. If comments inside that range cannot be retained without changing the intended expression, return an unsupported-transformation failure rather than deleting them silently.

Deletion preserves preceding/trailing comments and comments within the deleted construct, retaining comment text and order. Remove syntax tokens, not adjacent trivia by guessed ownership. Remove a whole line only when it contains deleted syntax and whitespace with no comment. Retained orphan comments appear in the preview. Decline deletion when recovery cannot establish trustworthy boundaries.

Duplication copies syntax but does not duplicate comments by default. Treat omitted comments as token separators where needed, then format only the newly generated copy. Existing source is untouched. There are no dedicated comment-authoring commands.

## Internal modules

| Module       | Responsibility and private state                                                                                                                          |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source       | Original strings, line indexes, physical tokens/trivia, recovered source structure, snapshot-bound identities, and localized text application.            |
| Preprocessor | Configuration-local compilation units, conditional state, macros, includes, expansion tokens, and many-to-many physical provenance.                       |
| Syntax       | Grammar recognition and recovery over source or expanded tokens. Report uncertain/synthetic/skipped regions rather than treating them as writable syntax. |
| Semantics    | Namespaces, types, expression evaluation, UDP binding, property rules, instantiation, address/field allocation, and semantic provenance.                  |
| Editing      | Command targeting, transformation requirements, candidate construction, validation, and semantic comparisons.                                             |
| Project      | Input capture, public operations, Effect workflow composition, and checked/draft application.                                                             |

These are internal responsibilities, not a public plugin system or a requirement for six classes. Share immutable value types and diagnostics. Keep dependency direction from project/editing toward analysis and source storage; the source module does not know about GUI state or storage.

## Parser and preprocessing approach

Use a private Chevrotain CST parser with a separate raw-source store, token/trivia inventory, and origin mapping. The [parser research](./research/parser-options.md) records the alternatives and exact dependency candidate. Do not reconstruct documents by pretty-printing the CST.

Keep physical source inspection distinct from configuration-specific expanded parsing. Physical inspection recognizes directives and macro invocations as source constructs or opaque regions. Macro-dependent syntax that cannot be understood before expansion remains unavailable for structured targeting; do not fabricate a complete raw syntax tree. Preprocessing produces tokens with provenance for expanded parsing and semantic analysis. Inactive branches remain in original source.

Recovery may insert or skip tokens to continue analysis. Such tokens never alter saved source or authorize structural edits. Only reliable physical ranges can be edited. Macro-generated declarations remain outside automatic structured editing, as agreed.

Respect the accepted compilation-unit policies and retain `line` mappings separately from physical source. Include guards operate through macro/conditional state; do not reject every repeated filename as a cycle. Bound expansion and nesting with explicit resource limits, reporting incomplete analysis if exhausted. Permit at least the standard's required 15 include levels.

Begin with full parsing/analysis per snapshot and configuration. Cache only within immutable snapshots as needed. Do not implement incremental parsing, cross-revision semantic caches, or a worker protocol before measurements justify them. Effect workflows yield between documents/phases where possible; wrapping a synchronous parser does not make that parse interruptible or move it off the browser's main thread.

## Validation and implementation sequence

Use specification-derived fixtures as the primary tests. Add a limited `systemrdl-compiler==1.32.2` comparison suite in development/CI, with no exporter dependency and no Python in the runtime package. Keep source preservation tests independent of that compiler. Document every intentional interpretation and observed discrepancy.

1. Establish source snapshots, error/report records, and browser-safe package imports. Prove no-edit text identity, invalid-source retention, exact integers, and simple named/anonymous grammar handling.
2. Exercise parser recovery and physical provenance using comments, malformed declarations, includes, macro expansion, and inactive branches. Verify that synthetic or ambiguous ranges cannot become edit targets. These are early implementation gates for the reversible parser choice.
3. Add name/type/expression semantics, property precedence, complete UDP rules, and address/field allocation with positive and negative fixtures. Preserve partial-model reporting throughout.
4. Implement localized commands, instance/shared intent, group validation, stale-candidate rejection, and read-only behavior. Compare known layout effects before/after.
5. Complete the supported-feature matrix and limited interoperability suite. Measure synthetic small/large projects and arrays before making performance claims.

Formatting checks apply to code and documentation. TypeScript implementation also requires oxlint, appropriate type checks, behavior tests, and the repository's code-review pipeline. This document does not claim those implementation checks have run.

## Deferred implementation choices

Exact private token IDs, storage optimization, and helper-function layout are routine implementation choices. Worker execution and incremental analysis are measurement-driven follow-ups, not launch requirements. If early gates show the chosen parser cannot meet the accepted guarantees, replace it behind the private syntax module or bring back the specific guarantee at issue. No broad scope re-interview is needed.
