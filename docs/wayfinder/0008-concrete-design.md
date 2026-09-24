---
id: WF-008
title: Review the concrete module and interface design
status: open
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: null
blocked_by: [WF-007]
---

## Question

Does the proposed concrete design implement the accepted scope with a small interface? Review operation signatures, diagnostic and failure values, source and analysis records, numeric representation, source identities, formatting and deletion rules, preprocessing provenance, and internal module responsibilities. Resolve any behavior-changing tradeoffs using concrete workflows; leave routine private implementation choices to implementation.

Use the accepted resolutions as constraints. Do not repeat the scope interview or reconsider Effect coupling without new evidence. Identify remaining decision work before declaring the map implementation-ready.
