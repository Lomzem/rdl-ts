---
id: WF-005
title: Choose the source and editing model
status: closed
labels: ["wayfinder:grilling"]
parent: WF-001
assignee: lomzem
blocked_by: [WF-002]
---

## Question

How should source documents, elaborated instances, and candidate edits relate so the caller can target source changes explicitly, preserve text, inspect semantic changes, and apply atomic groups without confusing shared definitions with individual instances?

## Review material

[Proposed source and editing interface](../research/source-editing-interface.md) includes a conceptual workflow, candidate records, alternatives, and revision/input validation requirements. The resolution below identifies the accepted behavior; detailed interface signatures remain proposals.

## Resolution comment

The user accepted three behaviors:

1. Keep source and semantic views separate. Callers explicitly target shared definitions or individual instances. Analysis exposes the source of effective values where known.
2. For an instance-only change, insert or update a supported per-instance override. If no supported transformation exists, return an error value. Do not silently modify the shared definition or clone it.
3. Bind candidates to the exact inputs used to prepare and validate them. Changes to source files, included files, analysis configuration, or external UDP declarations make the candidate stale and require preparation again. Applying an accepted candidate returns a new project snapshot and leaves the previous snapshot unchanged.

This decision does not choose final method signatures, the public Effect dependency, parser implementation, or a persistent identity scheme across arbitrary text edits.
