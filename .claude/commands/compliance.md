---
description: Check the lease records against the rules in docs/compliance.md (AASB 16 / NZ IFRS 16, the retail lease notices, the house controls) and report each breach with its source.
---

Run `npm run lease -- compliance`.

Report as a table: rule, lease, entity, finding, and the source from `docs/compliance.md`. Order by severity: off the balance sheet or understated first, then deadlines, then housekeeping.

For each breach, give the fix the operator can approve: the command that records the missing fact, the measurement to prepare, or the notice to draft (to `drafts/`, never sent).

If a rule in `docs/compliance.md` looks out of date, say so and stop. Do not guess at the standard or the law. The operator confirms the rule, then you update the doc and the check in `supabase/migrations/` together, with a test in `scripts/smoke.mjs`.

Nothing here is accounting or legal advice. The doc records the rules the operator has told the system to enforce, with sources.
