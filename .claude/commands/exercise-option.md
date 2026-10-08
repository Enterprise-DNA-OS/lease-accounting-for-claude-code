---
description: Record an option decision (renew, let go, end early) and prepare the remeasurement, or test what a decision would do.
---

Ask for the lease, the decision (exercise or not exercising), the date it was made and who made it.

1. If the decision changes the lease term, a revised discount rate is required (AASB 16 para 40): ask for the incremental borrowing rate at the decision date. For a termination option, ask for the last day of the lease after the early end (`--ends-on`).
2. Always test first: `npm run lease -- exercise-option --option=<lease ref or id> --decision=exercise|not-exercising --rate=<pct> --actor="<name>" --dry-run`. Show the lease term, the liability and the right-of-use asset before and after.
3. On a yes, run it without `--dry-run`, then `/draft-option-notice` if the option is being exercised, then `/approve` by a second person.

"What if we renew Albany?" is this command with `--dry-run`. Nothing is recorded.
