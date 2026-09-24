---
id: WF-001
title: Design the SystemRDL library
status: closed
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

Prefer errors as values and expose Effect directly as agreed. SystemRDL is the language authority; PeakRDL provides limited interoperability checks. The author is the intended consumer. Avoid designing a general plugin framework.

The user has delegated routine technical design choices to the agent. Resolve those choices against accepted requirements and record the reasoning, without repeated approval requests. Bring back findings that would change scope or user-visible guarantees. This explicitly permits agent resolution of the remaining technical-design ticket; it does not authorize implementation as part of this map.

## Decisions so far

- [Establish language coverage and compiler differences](./0002-language-research.md): produced a feature matrix and identified concrete ambiguity decisions.
- [Compare errors-as-values interface options](./0003-effect-research.md): verified installed Effect 4 behavior and compared interface costs.
- [Approve the first-release language boundary](./0004-language-boundary.md): accepted the five interpretation and semantic-deferral policies.
- [Choose the source and editing model](./0005-source-editing.md): accepted separate source/semantic views, explicit instance edits, and candidates bound to their preparation inputs.
- [Choose the public interface and error values](./0006-public-interface.md): accepted direct Effect use and checked application with an explicit draft policy.
- [Compare parser approaches for source-preserving editing](./0007-parser-research.md): compared viable parser approaches and documented Chevrotain's fit and implementation verification gates.
- [Review the concrete module and interface design](./0008-concrete-design.md): resolved delegated technical choices and produced the reviewed implementation design.

## Not yet specified

No unresolved design decisions block the initial implementation. Performance measurements may motivate a later effort; no latency guarantee has been selected.

## Out of scope

Implementing or publishing the library, building the GUI, generating hardware/software artifacts, executing Perl, and adding dedicated comment-authoring helpers are outside this planning effort. Existing comments must still be preserved.

Incremental analysis, a worker protocol, and cross-revision caches are deferred until measured workloads justify them. Their absence does not change the agreed browser support or source-preservation requirements.
