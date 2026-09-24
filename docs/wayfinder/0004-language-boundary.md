---
id: WF-004
title: Approve the first-release language boundary
status: closed
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: lomzem
blocked_by: [WF-002]
---

## Question

Does the researched supported/deferred feature matrix implement the agreed scope, and how should the library handle the concrete specification ambiguities identified by research?

## Review material

[Language coverage research](../research/language-coverage.md) contains the matrix and evidence behind the policies below.

## Resolution comment

The user accepted all five policies:

1. Preserve the undefined preprocessor `if` directive and report it as unsupported. Interpret defined conditional directives, including `ifdef` and `ifndef`.
2. Share root declarations across ordered input files. Each input and its included files form a compilation unit with local macro and root-default state. Caller-provided macro definitions initialize each unit.
3. Accept empty array literals. Document this as an intentional interpretation of conflicting specification text, consistent with the compiler. Section 1 gives Annex B grammar precedence, so this is not a claim that literal application of that precedence rule permits the empty form.
4. Report concatenation of reserved-enum values as unsupported. Do not invent numeric encodings for those values.
5. Defer semantic support for constraint blocks, overrides of individual instance-array elements, and runtime-dependent reference selection. Preserve source and report limitations. Whole-array assignments, ordinary references, and UDP `componentwidth` constraints remain supported.

These policies specialize the previously agreed language scope. They do not accept exporter restrictions or make compiler behavior the language authority. The exact interoperability dependency pin remains an implementation-planning choice; this resolution does not claim that compiler fixtures have run.
