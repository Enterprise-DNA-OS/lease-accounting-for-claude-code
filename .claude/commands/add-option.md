---
description: Add a renewal, termination or purchase option to a lease, with its last day to exercise.
---

Run `npm run lease -- add-option --lease=<ref> --kind=renewal --term-months=<n> --exercise-by=<date> --actor="<name>"`.

Ask whether the business is reasonably certain to exercise it (AASB 16 para 19: the rent compared with the market, fit-out spent, how important the site is). If yes, add `--reasonably-certain`: the option goes into the lease term and the lease is remeasured before approval. After a measurement is approved, a change in that view goes through `/exercise-option`.
