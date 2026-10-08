---
description: Second-person approval of a measurement, so it reaches the balance sheet and the journals.
---

Run `npm run lease -- lease --lease=<ref>` first and show the measurement waiting: reason, effective date, rate, liability, right-of-use asset, the basis, and who prepared it.

Ask the approver to confirm the inputs against the lease document and the rate. Then run `npm run lease -- approve --measurement=<lease ref or id> --actor="<approver>"`.

The CLI refuses when the approver prepared it, or when the effective month is closed. Never work around either.
