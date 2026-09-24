---
id: WF-006
title: Choose the public interface and error values
status: closed
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: lomzem
blocked_by: [WF-003, WF-004, WF-005]
---

## Question

Which small interface should consumers use to open, inspect, create, edit, validate, and serialize documents? Should callers use Effect directly or ordinary TypeScript result values, and how should explicit draft acceptance be expressed?

## Review material

[Errors-as-values interface research](../research/error-interface.md) compares public dependency options. [Proposed source and editing interface](../research/source-editing-interface.md) sketches the consumer workflow. The resolution below records accepted choices; exact signatures remain to be designed.

## Resolution comment

The user accepted exposing Effect directly and the resulting dependency for consuming projects. Use plain records for documents, diagnostics, and analysis results; Effect's Result for synchronous fallible operations; and Effect for analysis and preparation workflows that may resolve dependencies or support cancellation. Do not maintain a second equivalent ordinary-TypeScript interface initially.

Applying a candidate defaults to checked acceptance: complete validation for the selected configurations and no error diagnostics. Warnings remain visible and do not block application. A consumer can explicitly enable draft acceptance for errors or incomplete validation. That policy cannot override stale targets, read-only files, or unsupported transformations.

Document diagnostics remain separate from operation failures. Successfully preparing an invalid draft returns the candidate and its errors. The choice does not imply every function needs an Effect wrapper or promise that defects become language diagnostics. Exact operation signatures, error variants, and implementation modules remain design work.
