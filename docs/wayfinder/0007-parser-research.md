---
id: WF-007
title: Compare parser approaches for source-preserving editing
status: closed
labels: ["wayfinder:research"]
parent: WF-001
assignee: lomzem
blocked_by: [WF-005, WF-006]
---

## Question

Which browser-compatible parsing approach best supports SystemRDL grammar, lossless source retention, preprocessing provenance, and recovery from malformed input without exposing parser internals to consumers? Compare a small number of viable approaches using current primary documentation and the agreed requirements. Identify whether a focused prototype is necessary before choosing.

## Resolution comment

See [Parser options for source-preserving editing](../research/parser-options.md). The investigation compares handwritten parsing, Chevrotain, and ANTLR variants. It recommends private Chevrotain 13.2.0 with independent source/trivia and preprocessing provenance records. Recovery output alone cannot authorize edits. Early implementation gates cover grammar ambiguity, recovery, Unicode offsets, macro origins, and browser execution.

Research context: branch `research/parser-options`, commit `4903689`; imported on the working branch as `97ebb0f`. No parser code, dependency changes, executable prototype, or measurements were produced.
