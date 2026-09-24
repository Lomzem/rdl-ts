---
id: WF-006
title: Choose the public interface and error values
status: open
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: null
blocked_by: [WF-003, WF-004, WF-005]
---

## Question

Which small interface should consumers use to open, inspect, create, edit, validate, and serialize documents? Should callers use Effect directly or ordinary TypeScript result values, and how should explicit draft acceptance be expressed?

## Review material

[Errors-as-values interface research](../research/error-interface.md) compares public dependency options. [Proposed source and editing interface](../research/source-editing-interface.md) sketches the consumer workflow. Neither document is an accepted interface design.
