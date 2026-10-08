# The rules this system checks

`/compliance` (and `npm run lease -- compliance`) checks the records against the rules below. The arithmetic in `scripts/lease.mjs` follows the measurement rules in the first table. Each rule has a code, what it checks, and where it comes from.

AASB 16 *Leases* (Australia) and NZ IFRS 16 *Leases* (New Zealand) are both IFRS 16 with local additions, and the paragraph numbers below are the same in all three. Nothing here is accounting or legal advice. Standards, Acts and policies change: confirm each one against the source before relying on it, and when one changes, update this file and the check in `supabase/migrations/` (or the arithmetic in `scripts/lease.mjs`) together, with a test in `scripts/smoke.mjs`.

Checked against the sources on 8 October 2026.

## How a lease is measured (what `measure`, `record-review`, `exercise-option` and `terminate` do)

| What | How this system does it | Source |
|---|---|---|
| Lease term | The contract term, plus any renewal option the business is reasonably certain to exercise (`add-option --reasonably-certain`) | AASB 16 para 18 and 19 |
| Lease liability at commencement | Present value of the payments not yet made, at the discount rate on the lease (the incremental borrowing rate), monthly compounding of the annual rate, in advance or in arrears as the lease says | AASB 16 para 26 |
| Lease payments | Base rent, including fixed increases known at commencement. CPI and market changes are left out until they take effect. Outgoings, GST and other non-lease charges are left out | AASB 16 para 27 and 28 |
| Right-of-use asset at commencement | The liability, plus initial direct costs, plus the make good estimate, less lease incentives received | AASB 16 para 24 |
| Depreciation | Straight line over the lease term, monthly | AASB 16 para 31 and 32 |
| Interest | The monthly rate on the balance after any payment in advance, or on the opening balance for payments in arrears | AASB 16 para 36 |
| CPI or market review | When the new rent takes effect, the remaining payments are re-discounted at the unchanged rate, and the asset moves by the change in the liability | AASB 16 para 39, 42(b) and 43 |
| Option decision that changes the lease term | The remaining payments are re-discounted at a revised rate at the decision date, and the asset moves by the change | AASB 16 para 20, 21, 39 and 40 |
| Asset reduced below zero by a remeasurement | The asset stops at zero and the rest goes to profit or loss | AASB 16 para 39 |
| Early termination | The liability and the asset come off, and the difference (with any termination payment) is a gain or loss | AASB 16 para 46(a) |
| Short-term and low-value leases | Not on the balance sheet; the rent is expensed when paid | AASB 16 para 5 and 6 |
| Year-end note | Depreciation by class, interest, short-term and low-value expense, total cash outflow, additions, carrying amount by class | AASB 16 para 53 |
| Maturity analysis | Undiscounted payments within 1 year, 1 to 2, 2 to 5, over 5 years | AASB 16 para 58, AASB 7 / NZ IFRS 7 para 39 and B11 |

Monthly periods start on the commencement date. A change that takes effect part way through a period is measured from the start of the next period.

## The checks (what `compliance` reports)

| Code | What it finds | Severity | Source |
|---|---|---|---|
| MEASURE-MISSING | A lease that has started, is not exempt, and has never been measured: it is missing from the balance sheet | 1 | AASB 16 para 22 |
| MEASURE-UNAPPROVED | A measurement prepared and not yet approved by a second person: it is not in the balances or the journals | 1 | House control (see `CLAUDE.md`) |
| RATE-MISSING | A lease that must be measured has no discount rate | 1 | AASB 16 para 26 |
| REVIEW-NOT-RECORDED | A CPI or market review has taken effect and the new rent is not recorded: the liability is understated | 1 | AASB 16 para 42(b) |
| SHORT-TERM-INVALID | A lease treated as short-term whose term is 12 months or more, or that has a purchase option | 1 | AASB 16 para 5(a) and Appendix A, "short-term lease" |
| LOW-VALUE-INVALID | A low-value claim on a property lease, with no value-when-new on file, or above the policy in `settings.low_value_threshold` | 1 | AASB 16 para 5(b), B3 to B8; IFRS 16 Basis for Conclusions BC100 (US$5,000 or less when new) |
| OPTION-MISSED | An option's last day has passed with no decision recorded | 1 | The lease; AASB 16 para 20 and 21 |
| OPTION-DUE | An option's last day is within `settings.option_warning_days` (90) with no decision | 2 | The lease |
| OPTION-REASSESS | An option decision that the lease term does not yet reflect | 1 | AASB 16 para 20, 21 and 40 |
| HOLDING-OVER | The lease term has ended and the lease is still active | 2 | AASB 16 para 18 (the new term needs a decision) |
| MAKE-GOOD-MISSING | A make good clause with no cost estimate | 2 | AASB 16 para 24(d); AASB 137 / NZ IAS 37 |
| GUARANTEE-EXPIRY | A bank guarantee expiring before the lease ends, within `settings.guarantee_warning_days` (60) | 2 | The lease (the landlord can usually call a default if it lapses) |
| VIC-S28-NOTICE | A Victorian retail lease option due within 120 days with no section 28 notice from the landlord recorded | 2 | Retail Leases Act 2003 (Vic) s28, as amended by the Retail Leases Amendment Act 2020 |
| NSW-S44-NOTICE | A NSW retail lease expiring within 6 months with no section 44 notice from the landlord recorded | 2 | Retail Leases Act 1994 (NSW) s44 |
| MONTH-NOT-CLOSED | Last month has lease journals and is not closed | 2 | House control |

### The retail lease notices, in plain words

- **Victoria, section 28.** Where a retail lease has an option to renew, the landlord must give the tenant written notice of the last day to exercise it, with the rent for the first 12 months of the new term and other details, at least three months before that day. If the notice does not come in time, the option stays open until three months after the tenant receives it. Source: Retail Leases Act 2003 (Vic) s28 and s28(1A), in force from 1 October 2020. Record the notice with `landlord-notice --option`.
- **New South Wales, section 44.** Between six and twelve months before a retail lease expires, the landlord must tell the tenant in writing either the terms it offers for a renewal or that there will be no renewal. If it does not, the tenant can extend the lease to six months after the notice is given. Source: Retail Leases Act 1994 (NSW) s44. Record the notice with `landlord-notice --lease`.

Both are tenant protections: the system reports them so the business does not give up a right it still has. New Zealand has no equivalent retail lease Act; the lease itself governs.

## House controls

- **Two people on every measurement.** The person who prepares a measurement cannot approve it. The database refuses (a check on `measurements`) and so does the CLI.
- **Closed months stay closed.** `close-month` keeps the journal, refuses while a measurement waits or a review is unrecorded, and nothing effective in a closed month can be approved afterwards.
- **Imports wait for a check.** An imported lease is not measured until someone runs `measure` and a second person approves it.
