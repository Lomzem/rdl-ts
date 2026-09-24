# Local decision tracker

This repository uses Markdown issues because no tracker integration is configured. This is a local fallback convention, not an installed tracker package.

Each issue has a stable `id`, `title`, `status`, `labels`, `parent`, `assignee`, and `blocked_by` in frontmatter. The map has no parent. Other issues name the map as their parent. Dependencies refer to stable issue IDs because this tracker has no native dependency mechanism.

An open, unassigned child whose blockers are closed is available to work on. Claim an issue by setting its assignee before work. Read child frontmatter to find available issues; the map does not duplicate their list. Record a resolution as an appended comment, close the issue, and add a named link to the map. Human decision issues stay open until the user decides.

Research branches preserve findings independently. Resolution comments link to the durable research document and record its branch and commit. Research may establish facts and recommendations; it does not approve proposed interfaces or scope changes.
