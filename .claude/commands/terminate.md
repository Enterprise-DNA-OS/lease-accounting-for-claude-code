---
description: End a lease early. Takes the liability and the asset off and works out the gain or loss.
---

Ask for the last day of the lease and any termination payment.

Test first: `npm run lease -- terminate --lease=<ref> --on=<last day> --payment=<amount> --actor="<name>" --dry-run`. Show the liability and the asset coming off and the gain or loss. On a yes, run it without `--dry-run`, then `/approve` by a second person.

A lease that simply ran its term uses `npm run lease -- end-lease --lease=<ref> --actor="<name>"` instead.
