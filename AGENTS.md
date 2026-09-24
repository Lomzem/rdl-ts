## TypeScript Rules

- Always `oxlint` and `oxfmt` your code
- When writing any TypeScript code, consider whether `effect` could be used to improve the code quality. In general, the owner of the repository prefers `effect` code. Use Context7 to research up to date and idiomatic `effect` patterns

## Review Rules

This following review pipeline should only be completed for significant, non-trivial code. For trivial code, this pipeline could be skipped.

1. When making a significant change, have a subagent review the code. Modify and re-review code until reviewer is satisfied.
2. Then, push your branch to GitHub. Have Coderabbit review it. If Coderabbit rate limits, sleep until Coderabbit rate limit ends. Use `gh` CLI to inspect/babysit the Pull Request. Keep looping with Coderabbit until Coderabbit is satisfied. Do not stop the loop just because of rate limits; wait the rate limits out.
