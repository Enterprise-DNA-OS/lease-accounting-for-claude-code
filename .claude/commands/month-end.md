---
description: The month's lease journal by account for one entity, ready to key into Xero, MYOB or any ledger.
---

Ask which entity and month if not given (default: last month).

Run `npm run lease -- month-end --entity=<code> --month=<YYYY-MM>`. Add `--detail` when the operator wants it by lease.

Present the journal as a table of account code, account name, debit, credit, with the totals and whether it balances. Say whether the month is open or closed. If anything in `attention` would change this month (an unapproved measurement or an unrecorded review), say so first: the journal is not final until those are done.

The account codes come from the `accounts` table. If they do not match the ledger, offer `/customise` to change them.
