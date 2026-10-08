---
description: Prepare the first measurement of a lease (for example after an import), for a second person to approve.
---

Run `npm run lease -- measure --lease=<ref> --actor="<name>"`.

It needs a discount rate (set with `npm run lease -- update-lease --lease=<ref> --rate=<pct>`). Present the liability, the right-of-use asset, the number of periods and the total payments, then say it waits for `/approve`.
