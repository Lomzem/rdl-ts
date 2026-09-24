---
id: WF-003
title: Compare errors-as-values interface options
status: closed
labels: ["wayfinder:research"]
parent: WF-001
assignee: lomzem
blocked_by: []
---

## Question

For the installed Effect version and browser consumers, what are the costs and benefits of an Effect-native interface versus ordinary TypeScript result values? Which verified error-handling mechanisms preserve the distinction between operation failures, diagnostics, incomplete analysis, and unexpected defects?

## Resolution comment

See [Errors-as-values interface research](../research/error-interface.md). The installed and locked version is Effect 4.0.0-rc.117. The report verifies its Result and Effect behavior against installed sources and official documentation and compares three interface options. It recommends plain records, Result for synchronous failures, and Effect for workflows, without a duplicate facade. Choosing that public dependency remains an open human decision.

Research context: branch `research/effect-interface`, commit `931f63f`; imported on the working branch as `5be2a09`. No executable library code or runtime benchmarks were produced.
