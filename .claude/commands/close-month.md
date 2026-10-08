---
description: Close a month for an entity once its measurements are approved and its reviews recorded, and keep the journal.
---

Run `npm run lease -- close-month --entity=<code> --month=<YYYY-MM> --actor="<name>"`.

The CLI refuses while a measurement effective in or before the month waits for approval, or a review in effect has no new rent, and lists them. Report what blocks it and the command that clears each one. Never work around a refusal.

Once closed, nothing effective in that month can be approved: a later change is prepared from the first open month.
