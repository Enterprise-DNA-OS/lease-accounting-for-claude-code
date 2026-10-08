---
description: Record the new rent from a CPI or market review and prepare the remeasurement for a second person to approve.
---

Ask for the lease and either the CPI change in percent or the new rent per payment. Ask who is recording it.

1. Run a test first: `npm run lease -- record-review --review=<lease ref or id> --cpi=<pct> --actor="<name>" --dry-run` (or `--amount=<new rent>`). Show the rent before and after, the liability before and after, and the change to the right-of-use asset.
2. On a yes, run it without `--dry-run`.
3. Say that it waits for a second person: `/approve`.

A lease with several pending reviews takes the earliest first. The discount rate does not change for a CPI or market review (AASB 16 para 43).
