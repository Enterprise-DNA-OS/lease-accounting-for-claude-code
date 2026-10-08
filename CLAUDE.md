# Lease Accounting for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs attention, what is late or wrong | `/attention` |
| The Monday lease meeting | `/weekly-review` |
| What is coming up: options, reviews, expiries, guarantees | `/critical-dates` |
| Options and who has decided | `/options` |
| Reviews waiting for the new rent | `/reviews` |
| The liability and the asset, at a date | `/balances` |
| Rent still to pay, by year | `/maturity` |
| The month's journal | `/month-end` |
| Close a month | `/close-month` |
| The year-end note numbers | `/disclosure` |
| Are we compliant, what breaches a rule | `/compliance` |
| A list of leases | `/leases` |
| Everything on one lease | `/lease` |
| The schedule for one lease | `/schedule` |
| A new lease | `/add-lease` |
| An option on a lease | `/add-option` |
| The CPI or market review came in | `/record-review` |
| We decided on an option, or what if we did | `/exercise-option` |
| The landlord sent a s28 or s44 notice | `/landlord-notice` |
| Measure a lease (after an import) | `/measure` |
| Check and approve a measurement | `/approve` |
| We are leaving early | `/terminate` |
| Note a call, email or meeting | `/log` |
| The letter exercising an option | `/draft-option-notice` |
| Write up the leases note | `/draft-disclosure` |
| Bring data across from Visual Lease | `/import` |
| A backup | `/export` |
| Change a field, an account code, a policy | `/customise` |
| A new dashboard | `/new-view` |

If an ask fits nothing here, run the CLI directly (`npm run lease -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- The person who prepares a measurement never approves it. The CLI and the database refuse; do not work around them.
- Never change a closed month. A change is prepared from the first open month.
- Never guess a discount rate, a rent or a date. Ask, and take it from the lease or the rate the finance lead sets.
- Never record an option decision the business has not made. Use `--dry-run` for what-ifs.
- Lease records and rates are confidential. Exports stay in `exports/` (ignored by git) and drafts in `drafts/`.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Visual Lease.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/visual-lease
