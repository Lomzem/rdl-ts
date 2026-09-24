---
id: WF-001
title: Design the SystemRDL library
status: open
labels: ["wayfinder:map"]
parent: null
assignee: null
blocked_by: []
---

## Destination

An implementation-ready design for the author's reusable SystemRDL TypeScript library, with explicit language coverage, source-preserving editing behavior, and a small public interface. Complete the map when the user has resolved the remaining design decisions; implementation is a separate effort.

## Notes

The prior scope interview is recorded in [Library scope](../scope.md), [Acceptance examples](../acceptance.md), and [decision records](../adr/). Those accepted requirements constrain this map.

Use grilling and domain-modeling for human decisions, codebase-design for interface design, find-docs for external technology research, and Unslop for prose. The research skill referenced by Wayfinder is unavailable; use find-docs and official primary sources. Use the local specification without committing it. Research recommendations are proposals, not accepted decisions.

Prefer errors as values and consider Effect. SystemRDL is the language authority; PeakRDL provides limited interoperability checks. The author is the intended consumer. Avoid designing a general plugin framework.

## Decisions so far

- [Establish language coverage and compiler differences](./0002-language-research.md): produced a feature matrix and identified concrete ambiguity decisions.
- [Compare errors-as-values interface options](./0003-effect-research.md): verified installed Effect 4 behavior and compared interface costs; the recommendation remains subject to the public-interface decision.
- [Approve the first-release language boundary](./0004-language-boundary.md): accepted the five interpretation and semantic-deferral policies.

## Not yet specified

The exact parser implementation, source identity strategy, and incremental analysis needs depend on the source/editing model and measured fixture behavior. Package organization and the exact error representation depend on the chosen public interface. Investigate performance only against stated workloads; no latency guarantee has been selected.

## Out of scope

Implementing or publishing the library, building the GUI, generating hardware/software artifacts, executing Perl, and adding dedicated comment-authoring helpers are outside this planning effort. Existing comments must still be preserved.
