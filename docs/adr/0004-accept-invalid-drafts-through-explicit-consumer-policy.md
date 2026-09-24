# Accept invalid drafts through explicit consumer policy

Structured editing prepares candidate changes without altering the current document. Candidates report text changes, validation diagnostics, and analysis completeness. Accepting a candidate with errors or incomplete validation requires an explicit consumer policy, which may apply throughout an editing session. Language errors remain errors even when a consumer retains an invalid draft.

Rejecting every invalid result would prevent repairs that leave other errors unresolved. Silently applying invalid changes would make correctness depend on every consumer remembering to inspect diagnostics. Candidate edits and an explicit acceptance policy support both draft editing and consumers that require fully validated results.

Grouped changes apply entirely or leave the document unchanged, with validation of the final candidate. Draft acceptance cannot waive ambiguous targets or operation-specific requirements. A partial rename must remain explicitly partial.
