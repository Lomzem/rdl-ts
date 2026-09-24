---
id: WF-002
title: Establish language coverage and compiler differences
status: closed
labels: ["wayfinder:research"]
parent: WF-001
assignee: lomzem
blocked_by: []
---

## Question

What feature matrix follows from the local SystemRDL specification and agreed scope, what current compiler version is a reproducible interoperability reference, and which documented compiler differences require explicit decisions rather than silently replacing specification rules?

## Resolution comment

See [Language coverage research](../research/language-coverage.md). The report translates the agreed scope into a feature matrix, proposes compiler 1.32.2 for limited interoperability checks, identifies three concrete semantic deferrals, and records specification conflicts. UDP binding states and exact integer semantics constrain the interface. Proposed interpretations and the precise first-release boundary still need the user's decision.

Research context: branch `research/language-coverage`, commit `bdfa1ab`; imported on the working branch as `0bd42b3`. The investigation read documentation and tagged grammar. No compiler fixtures were executed.
