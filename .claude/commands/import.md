---
description: Bring leases and rent schedules across from Visual Lease report exports.
---

Follow `docs/replace-visual-lease.md`.

1. The lease report: `npm run lease -- import visual-lease --file=<leases.csv> --country=NZ|AU --actor="<name>" --dry-run`. Show what would be added. If headings differ, write a `--map=columns.json` (field to column heading) and test again.
2. On a yes, run it without `--dry-run`.
3. The rent schedule: the same with `--report=payments`. Outgoings and other charges are skipped.
4. Then for each lease: set a missing rate, add options and reviews, `/measure`, and `/approve` by a second person. Run `/compliance` to see what is still missing.
