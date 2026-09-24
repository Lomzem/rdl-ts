---
id: WF-008
title: Review the concrete module and interface design
status: closed
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: lomzem
blocked_by: [WF-007]
---

## Question

Does the proposed concrete design implement the accepted scope with a small interface? Review operation signatures, diagnostic and failure values, source and analysis records, numeric representation, source identities, formatting and deletion rules, preprocessing provenance, and internal module responsibilities. Resolve any behavior-changing tradeoffs using concrete workflows; leave routine private implementation choices to implementation.

Use the accepted resolutions as constraints. Do not repeat the scope interview or reconsider Effect coupling without new evidence. Identify remaining decision work before declaring the map implementation-ready.

## Delegation

The user delegated routine technical choices after accepting the public-interface policy. The agent may resolve this technical-design ticket from research and review. User-visible scope changes still require discussion. The ticket retains its original type to preserve its history; the map's Notes record this exception to the usual human-decision workflow.

## Resolution comment

The agent resolved the delegated technical choices in [SystemRDL library design](../design.md). It specifies the operation family and error records, complete virtual-input snapshots, revision-bound handles/candidates, exact numeric values, configuration-specific diagnostics, localized commands, source formatting/comment retention, internal modules, and the implementation sequence.

Select Chevrotain 13.2.0 privately, with raw-source and preprocessing-origin records independent of the CST. Use the researched Effect 4.0.0-rc.117 and compiler 1.32.2 pins for initial implementation/runtime and limited interoperability checks respectively. No dependency changes occurred in planning. Reversible parser selection is subject to explicit early implementation checks, not a claim of measured suitability.

Two subagents reviewed the concrete design. The review clarified independent semantic-comparison coverage, identity across additions/deletions, and the difference between raw recovery notes and diagnostics applicable to an analyzed configuration. Both reviewers were satisfied after correction.

The remaining private algorithm choices and measurement-driven optimization do not block implementation. This resolution closes design planning under the user's delegation; it does not report an implemented or tested library.
