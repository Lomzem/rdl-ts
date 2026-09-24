# Proposed source and editing interface

This is a design sketch, not an implemented interface. The later [source/editing resolution](../wayfinder/0005-source-editing.md) records accepted behavior. Other interface details remain proposals. The sketch applies the agreed [scope](../scope.md) and [acceptance examples](../acceptance.md). Names below describe responsibilities; they are not final method signatures.

The subsequent [implementation design](../design.md) resolves the technical choices under the user's delegation and takes precedence over remaining proposals in this historical sketch.

## Recommendation

Keep original source documents as the authority for saved text. Derive syntax and semantic views from them. Expose source declarations and elaborated instances as different kinds of targets. Prepare edits against a particular project revision and apply the resulting candidate atomically.

A public interface should let callers open, inspect, create, edit, analyze, and serialize without understanding token storage, parser recovery, preprocessing internals, or an incremental computation engine. Those are implementation choices.

## Why two views are necessary

A named register definition can have several instances. Parameters can give those instances different values and layouts. Property precedence can select a dynamic assignment, a local assignment, a lexical default, or a built-in default. The effective value alone does not identify which source expression a consumer intends to change.

These are language relationships, not invented editor behavior. See local SystemRDL sections 5.1.1, 5.1.3.2 through 5.1.3.4, and 5.1.4. In particular, not every property permits a per-instance dynamic assignment.

| View      | What it answers                                                                     | What it must not imply                              |
| --------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| Source    | What declarations, instances, assignments, and expressions were written, and where? | One declaration means one elaborated instance.      |
| Analysis  | What does this configuration produce, and which inputs explain the result?          | An effective value always has one editable literal. |
| Candidate | Which source text would change, with what diagnostics and known semantic effects?   | A small textual diff has small hardware effects.    |

Analysis results should expose provenance where known: the declaration, instance statement, selected assignment or default, and preprocessing origin relevant to a value. A macro expansion may relate to several source locations. Do not invent a single writable location for it.

## Minimal conceptual operations

| Operation | Inputs                                                                                                                        | Result                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Open      | Source documents and writable/read-only flags                                                                                 | A project snapshot with recoverable source structure and diagnostics.                |
| Analyze   | Snapshot and explicit configuration                                                                                           | Available semantic results, diagnostics, and coverage of what was checked.           |
| Prepare   | Snapshot, explicit edit targets, a group of commands, and requested analysis configurations or an explicit source-only choice | A candidate snapshot, text changes, diagnostics, and available semantic comparisons. |
| Apply     | Current snapshot, candidate, and acceptance policy                                                                            | A replacement snapshot or a failure value.                                           |
| Serialize | A snapshot                                                                                                                    | Source text for its documents, without filesystem or network writes.                 |

An empty project and a create-document command support new documents through the same model. Navigation and query details still need design, but should not require direct mutation of internal syntax nodes.

The operations describe one conceptual interface, not five required classes. Whether their values are wrapped in Effect is a separate decision documented in the error-interface research.

Proposed result records, expressed as pseudocode:

```text
ProjectSnapshot
  revision
  documents: source text, document identity, writable flag
  source diagnostics and recovered structure

AnalysisReport
  project revision, configuration identity, and analysis-input identities
  analysis coverage and diagnostics
  available instances, values, layouts, and source provenance

EditCandidate
  base project revision
  identities of the analysis inputs used for validation
  candidate project snapshot
  per-document text edits
  candidate diagnostics and validation coverage
  semantic comparison with its own coverage

EditFailure
  stale target or candidate
  ambiguous target
  unsupported transformation
  conflicting edits
  read-only document
  acceptance policy not satisfied
```

Exact field names and whether some records should be opaque remain open. In particular, candidates should not let callers forge successful validation or replace their base revision to bypass stale-edit checks.

## Proposed workflow

The following is pseudocode, not runnable TypeScript:

```text
project = open the caller's ordered source documents
analysis = analyze project using the selected top-level, macros, and parameters

target = select a source assignment from the analysis provenance
candidate = prepare a replacement expression against project's revision

inspect candidate.textChanges
inspect candidate.diagnostics
inspect candidate.analysisCoverage
inspect candidate.layoutChanges, if comparison was possible

updated = apply candidate to project under the caller's acceptance policy
documents = serialize updated
the consumer stores the returned documents
```

Every operation that can fail returns a failure value through the chosen error mechanism. The pseudocode omits branches for readability, not because failures throw or disappear.

## Edit intent

Consider a register definition used by instances `a` and `b`.

- Replacing a property expression inside the shared definition can affect both instances. The target is the source assignment, and the preview should disclose the known effects.
- Setting an instance's effective property requires an explicit instance target and a supported strategy. For a property that permits dynamic assignment, a command could update or insert an assignment for `a` without changing `b`.
- If a property cannot be overridden dynamically, do not silently edit the shared definition or clone a register type. Return a failure explaining that the requested instance-only operation has no supported transformation.
- Replacing an expression such as `BASE + OFFSET` differs from changing the definition of `BASE`. The caller chooses the source target; the library does not infer it from a displayed number.

The first release need not automate every legal rewrite. It should clearly report which requested transformations it cannot perform.

## Source identity and revisions

Recommend source handles bound to a snapshot revision. An elaborated instance handle additionally identifies its analysis configuration and instance path or equivalent identity. An instance path alone is not a stable source identity.

Preparing an edit checks its handles. Applying a candidate checks the base revision and current file permissions. If the source has changed, fail with a stale-candidate value and require preparation against the new snapshot. Do not silently rebase edits in the first release.

Validation must also identify the exact inputs it used: included-file contents, ordered root files, configuration, and caller-supplied UDP declarations or validation rules. Freeze those inputs for analysis, or invalidate the result when they change. An unchanged main document does not make validation current if an included file or external declaration changed. Resolver functions alone are not identities for the contents they return.

This prevents an offset captured before a text change from modifying unrelated text. Long-lived GUI selection identity across arbitrary edits is a later consumer need to investigate, not a promise implied by these handles.

## Candidate validation and acceptance

Keep these separate:

- Whether the edit target and transformation are mechanically reliable.
- Whether the resulting source has language errors.
- Whether analysis covered enough of the project to support a semantic claim.

A valid structured transformation can create an invalid draft. It must still report UDP type errors and other language errors. An acceptance policy may allow that draft, but cannot make an ambiguous edit target reliable or turn a partial rename into a complete one.

Recommend a checked policy that requires no error diagnostics and complete validation for the explicitly requested configurations. A draft policy deliberately accepts errors or incomplete validation. Neither policy certifies configurations that were not analyzed. Warnings remain visible and need not block the checked policy.

Source-only preparation reports semantic validation as unperformed. Checked application must obtain the required validation against the candidate's inputs or fail; an absent report is never evidence of success. Validation coverage and language validity are separate: a completed validation pass can discover errors, even when no valid elaborated model can be produced.

This is a proposed expression of the accepted draft behavior, not a newly approved default. Do not promise to block only newly introduced diagnostics; matching errors across changed or partially parsed source is not a simple correctness criterion.

For a group, construct and analyze the final candidate rather than demanding valid intermediate steps. Reject conflicts between edits, stale targets, and writes to read-only documents without partially changing the project. Atomic application concerns the library's in-memory documents. Atomic disk or browser-storage writes remain the consumer's responsibility.

## Semantic comparisons

Compare before and after under the same specified configurations. Show changes in calculated addresses and field positions when the two analyses provide sufficient information. Preserve source spelling and avoid inserting explicit addresses without instruction.

Do not equate the absence of reported changes with proof of no changes. Mark comparison coverage explicitly when either side is incomplete. Instance matching after renames, creation, or deletion needs operation provenance, not merely comparison of path strings. Bound the comparison to the observed configuration; inactive variants require their own analysis.

## Numeric values and documentation

SystemRDL includes unsigned 64-bit values and explicitly sized bit values. Its unsigned expression semantics include width-dependent truncation and two's-complement results. See local specification sections 4.6, 6.2.1, and 7.

Recommend exact integer storage, with SystemRDL type and width information where required. A bare JavaScript number cannot represent the entire required domain. `bigint` is a candidate representation, but using it alone does not implement SystemRDL's sizing and casting rules. Retain the written expression separately from its evaluated value.

Edit `name` and `desc` as properties. Preserve comments as source text without adding comment-authoring helpers. New documents and inserted content use a default formatting policy; existing unrelated text remains intact. Exact comment ownership on deletion must be documented rather than guessed from proximity.

## Alternatives considered

| Approach                                           | Benefit                                                  | Cost for this project                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Regenerate source from the semantic model          | Simple output from resolved values.                      | Loses expression spelling, inactive branches, comments, and shared source structure unless a separate source model is rebuilt. |
| Expose mutable syntax trees directly               | Consumers can perform arbitrary tree changes.            | Every consumer must understand invalidation, source preservation, and multi-file edit consistency.                             |
| Preserve source and expose revision-bound commands | Centralizes validation, provenance, and localized edits. | Requires a source representation and explicit mappings to semantic results.                                                    |

Recommend the third approach. Keep the parser and storage strategy private so the first implementation can be simple and profiling can justify later changes.

## Decisions for review

- Accept separate source and semantic views with explicit targets and revision-bound candidates?
- Accept refusing unsupported instance-only transformations rather than automatically cloning definitions?
- Choose the Effect/result representation after reviewing the error-interface research, and confirm the checked versus draft acceptance policy.

The document proposes behavior, not an implementation plan. No parser library or incremental architecture has been selected.
