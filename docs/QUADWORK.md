# QuadWork Execution Plan

The main planning issue is:

- [Epic: PlotToon MVP](https://github.com/realproject7/plottoon/issues/7)

QuadWork agents should use the EPIC for context and then work through the connected phase sub-tickets.

## Execution Rules

- Work from a clean branch for each ticket or coordinated phase.
- Keep `main` as the integration branch.
- Keep changes scoped to the current ticket.
- Do not expose credentials, wallet material, provider API keys, or private operational values.
- Use placeholders in docs, tests, and examples.

## Operator Gates

Operator Gate issues represent required human decisions or environment setup. They should not request secret values in issue comments.

Current gates:

- #8: Initial repo and QuadWork run assumptions.
- #42: Integration inputs before real upload/publish work.
- #52: Real publish target approval.

