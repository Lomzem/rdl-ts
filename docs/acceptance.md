# Acceptance examples

These examples make the confirmed scope concrete. The implementation tests exercise these requirements. Passing them is not a claim of complete language conformance.

## Create a new document

Start with an empty source document. Use structured operations to add an address map, a register, a field, and a UDP declaration and assignment. Serialize valid SystemRDL text, then parse and analyze it again. The resulting components and property values match those authored. Subsequent no-edit serialization preserves the generated text exactly.

## Preserve an unchanged document

Open and serialize a supplied document containing comments, unusual whitespace, and mixed line endings. The resulting source text is identical to the supplied text.

## Edit a property value

Change `reset = 8'h00;` to `reset = 8'h01;`. Preserve the surrounding text, including any adjacent comment. Editing `name` or `desc` uses the same property-editing capability. Dedicated comment-authoring helpers are not required.

## Validate a UDP assignment

Prepare an assignment of a string to an integer UDP. Report the standard type error as a diagnostic value. Do not change the current document while preparing the candidate. An explicit draft policy may accept the candidate, but the error remains an error.

## Apply a grouped change

Prepare a UDP type change together with corresponding assignment changes. Validate the final candidate. Apply all changes together or leave every source document unchanged.

## Refuse modification of a read-only file

Prepare a group that edits both a writable document and a caller-designated read-only document. Applying the group returns a failure value. Neither document changes.

## Expose an address change

Insert a register before registers with implicit addresses. When analysis is complete, the preview identifies the resulting address changes as well as the text changes. It does not add explicit addresses without instruction. If analysis cannot establish the effects, report that the semantic comparison is incomplete.

## Disclose an incomplete rename

A declaration has a possible reference in an inactive conditional branch. Do not claim a complete rename when reference coverage is unresolved. Require explicit acceptance of the partial operation or enough configuration coverage to resolve it.

## Retain unsupported source

Open a document containing embedded Perl. Preserve its text without executing Perl, report the analysis limitation, and refuse structured operations that require interpreting it. Do not present an incomplete instance model as complete.

## Repair an invalid draft

A document contains two errors. Under an explicit draft policy, accept a reliably targeted repair to one error while reporting the remaining error. Do not require an unrelated error to be fixed before the repair can be retained.
