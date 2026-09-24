# Errors-as-values interface research

Research date: 2026-09-23. This note preserves the research for "Compare errors-as-values interface options". The later [public-interface resolution](../wayfinder/0006-public-interface.md) accepts direct Effect use and application policy; the conceptual workflow below is not an implemented API.

## Recommendation

Use one small Effect-native interface. Return ordinary immutable records for documents, diagnostics, and analysis reports. Use Effect's `Result` for synchronous operations that can fail. Use `Effect` for analysis and preparation workflows that may resolve dependencies, yield, or be cancelled. Do not publish a second, equivalent plain-TypeScript interface initially.

This fits the owner's Effect preference and personal reuse goal. It avoids choosing between writing a new result utility and maintaining two ways to perform every operation. It does require consuming projects to accept an Effect dependency. If the owner wants the public contract independent of Effect, the ordinary-value option below is credible and should replace this proposal.

## Verified version and behavior

The repository's [package manifest](../../package.json) requests `effect` at `^4.0.0-rc.117`. Its [Bun lockfile](../../bun.lock) resolves `4.0.0-rc.117`. The installed `node_modules/effect/package.json` also reports `4.0.0-rc.117`.

On the research date, `npm view effect dist-tags --json` reported `latest` as `3.22.2`, `rc` as `4.0.0-rc.117`, and `beta` as `4.0.0-beta.107`. The installed version is a release candidate, not the version under the registry's stable `latest` tag. No dependency change is proposed here.

Context7 resolved `/effect-ts/effect` with a versioned index for `effect_4.0.0-rc.112`, but no index for the installed release. Its answers mixed that tag with the main branch. The findings below therefore also use the installed rc.117 sources and official v4 documentation. Do not copy v3 `Either` examples into this project as if they were the installed interface.

| Verified behavior                                                                                                                                        | Consequence for this library                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `Result.Result<A, E>` represents an already computed success or failure. The variants expose `success` or `failure` and use `Success` or `Failure` tags. | Synchronous edit application can return a failure value without a runtime or `try/catch`.                                      |
| `Effect.Effect<A, E, R>` describes a computation with a typed error channel.                                                                             | Expected inability to complete an operation belongs in `E`.                                                                    |
| `Effect.result` captures typed failures as `Result`, but does not capture defects or interruption.                                                       | A resulting `never` error channel does not promise that executing the computation cannot fail.                                 |
| `runPromise` rejects on failure, and `runSync` throws on failure.                                                                                        | They are not the default examples for a consumer that wants all outcomes as values.                                            |
| `runPromiseExit` and `runSyncExit` return `Exit`, which retains the failure cause.                                                                       | The application can observe typed failures, defects, and interruption without exception-based control flow for those outcomes. |
| `runSyncExit` reports an asynchronous operation as a defect. The Effect type does not track whether execution is synchronous.                            | Do not implement supposedly synchronous library helpers by running arbitrary effects synchronously.                            |
| `Effect.fromResult` converts a `Result` into an Effect.                                                                                                  | Small synchronous helpers can compose into workflows without a duplicate interface.                                            |

Sources: [v4 Result documentation](https://effect.website/docs/v4/data-types/result), [expected errors](https://effect.website/docs/v4/error-management/expected-errors), [running effects](https://effect.website/docs/v4/getting-started/running-effects), and the installed `node_modules/effect/src/Result.ts`, `Effect.ts`, and `Exit.ts`. The installed source declarations include `Effect.result` at line 3688, `fromResult` at line 2584, `runPromiseExit` at line 17966, and `runSyncExit` at line 18159. These locations describe rc.117 only.

## Separate diagnostics from failed operations

Malformed SystemRDL is an expected document state. Opening it must retain its text and return diagnostics. An invalid UDP assignment belongs in an analysis report. Neither condition should discard the document by turning the whole operation into an opaque failure.

Use a typed operation failure when the operation cannot fulfill its promise. Examples include an ambiguous target, a stale candidate, a read-only edit, an unsupported transformation, or a candidate rejected by the consumer's acceptance policy. Each failure should include a stable discriminant and relevant source locations or identifiers. Consumers should not parse message strings to distinguish cases.

A missing include can be represented in an analysis report with incomplete coverage, because the library can still return useful source and diagnostic information. A dependency resolver can return its own expected failure value, which analysis translates into that diagnostic. Invalid configuration that prevents starting analysis is an operation failure. This keeps the distinction tied to the operation's promise, rather than the wording of an error.

Reserve defects for implementation bugs and violated internal invariants. Do not relabel those as SystemRDL validation errors. Cancellation is also distinct from an invalid document. A consumer can report or log these outcomes through `Exit` without presenting them as language diagnostics.

## Compare the options

| Choice                       | Consumer experience                                                                                                              | Maintenance cost and limits                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary TypeScript values   | Read a discriminated union directly. Asynchronous work returns a promise of that union.                                          | The library defines its own composition and cancellation conventions. Public types do not expose Effect. This is attractive if future personal consumers deliberately avoid Effect. |
| Lean Effect-native interface | Inspect `Result` for small synchronous operations. Compose longer workflows as effects. Run them at the application entry point. | Uses existing typed error and cancellation facilities. Consumers learn Effect, and a public dependency on an RC carries version-change risk. This is the recommendation.            |
| Both equivalent interfaces   | Consumers select ordinary values or Effect for each operation.                                                                   | Each operation needs matching behavior, documentation, error translation, cancellation rules, and tests. There is no demonstrated consumer need for this duplication yet.           |

Within the recommended option, plain getters and serialization do not need effects merely for consistency. Use a plain value when there is no expected failure, `Result` when a synchronous operation has one, and `Effect` when workflow execution benefits from it. This is one operation family, not two parallel implementations.

Do not expose parser passes, preprocessing internals, or caches merely because they use Effect internally. Consumers need source documents, analysis configuration, semantic results, candidate edits, and atomic acceptance. Keeping these as the interface leaves source mapping and dependency bookkeeping inside the implementation.

## Proposed use in the agreed workflows

These are conceptual operations, not executable TypeScript or finalized method names.

| Step          | Input and returned value                                                                                                         | Expected failure behavior                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Open          | Caller-supplied file identifiers and text produce a project snapshot with source documents. New documents begin with empty text. | Duplicate file identities or invalid project configuration return `Result` failures. Malformed text remains available with diagnostics.         |
| Analyze       | A snapshot and one explicit configuration produce an `Effect` yielding an analysis report.                                       | Language errors and unsupported source appear in the report with completeness information. Invalid analysis setup is a typed operation failure. |
| Inspect       | Read source declarations, elaborated instances, diagnostics, and source locations from the report and snapshot.                  | Ordinary reads return values. A fallible lookup uses a value that distinguishes absence from ambiguity.                                         |
| Prepare edits | A snapshot, explicit editing intent, and configuration produce an `Effect` yielding a candidate.                                 | An ambiguous target or unfulfillable edit promise is a typed failure. An invalid final draft is still a candidate with diagnostics.             |
| Apply         | The current snapshot, candidate, and explicit acceptance policy return `Result` containing a new snapshot.                       | Staleness, read-only modifications, or policy refusal return a failure and preserve the original snapshot. Grouped changes commit together.     |
| Save          | Serialization reads the selected snapshot's source text and returns file contents.                                               | Existing invalid drafts remain serializable. Filesystem writes and browser downloads remain consumer responsibilities.                          |

For a reset-value edit, opening and analysis retain the original expression and its source range. Preparing a replacement returns localized text edits, the candidate's diagnostics, and any reliable layout comparison. Application checks the candidate against the current snapshot and acceptance policy. Serialization returns the new source text without whole-file regeneration.

For a UDP type change with updated assignments, preparation validates the complete group. Intermediate type mismatches are not separately applied. If final validation still fails, the report retains those errors. Application accepts that candidate only under explicit draft policy. The error representation does not weaken standard UDP rules.

For a rename blocked by unresolved inactive branches, preparation must expose incomplete coverage. A distinct partial-rename intent or acceptance is required. Draft acceptance alone cannot authorize an ambiguous target or make the library claim a complete rename.

At a GUI event handler, execute the preparation workflow with `runPromiseExit` and inspect the outcome. A successful execution may contain a candidate with document diagnostics. A typed failure means the operation did not produce its promised candidate. A defect means the implementation failed. This preserves the user's errors-as-values preference without conflating all three states.

## Browser use and limits of this research

Effect documents browser support and separate platform implementations. The core proposal needs no Node filesystem imports and no Python runtime. Callers provide file contents and dependency access. See the [official v4 platform introduction](https://effect.website/docs/v4/platform/introduction).

Effect does not make a long, synchronous parser loop stop blocking the browser simply by wrapping it. Responsiveness requires measured workloads, explicit yielding where useful, or a worker. This proposal makes no bundle-size or response-time promise and does not add a worker abstraction before the implementation establishes a need.

If the GUI later uses a worker, send explicit data records and define how results cross that interface. Do not assume arbitrary Effect objects or callbacks are transportable. Numeric representation and worker encoding are separate design questions and are not resolved by choosing an error library.

## Decision outcome

The owner accepted public `Result` and `Effect` types for personal consumers, with one interface and no ordinary-TypeScript facade initially. See the linked resolution for the accepted policy. This does not authorize implementation or settle every operation's exact signature.
