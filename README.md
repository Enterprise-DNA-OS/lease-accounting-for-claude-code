<h1 align="center">Lease Accounting for Claude Code</h1>

<p align="center">
  <strong>The open-source lease register and AASB 16 lease accounting system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Visual Lease data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=visual-lease">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/visual-lease?utm_source=github&utm_medium=readme&utm_campaign=visual-lease">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#instead-of-visual-lease">Instead of Visual Lease</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Lease Accounting for Claude Code does the job you pay Visual Lease for, as a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask for what you want in plain language. It runs the right query, and it can answer questions the Visual Lease dashboard cannot.

Visual Lease publishes no prices: its pricing page asks you to request a quote, and the bill is set by how many leases you hold and which modules (lease management, lease accounting, abstraction, implementation) you take. A group with a few dozen sites pays it every year for a register of dates and a schedule of numbers. Check your own invoice.

Want the same thing with a web front end, or built on a different stack? That is a customisation, and it is exactly what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=visual-lease).

It covers the part of Visual Lease a tenant's finance team runs its month and its year end on: the lease register by entity, rent steps, fixed, CPI and market reviews, options and their last days, the AASB 16 and NZ IFRS 16 measurement of every lease (each one prepared by one person and approved by another), the monthly schedule, the month-end journal by account, the year-end note with the maturity analysis, and the Victorian and NSW retail lease notices. It is built for Australian and New Zealand groups with five to a hundred leases (clinics, stores, branches, offices, vehicles, equipment) and for the accounting firms that do their lease accounting for them.

### Ten questions Visual Lease's screens do not answer in one go

1. What is our lease liability and right-of-use asset today, current and non-current, per entity? (`balances`)
2. Which CPI reviews have taken effect and still are not in the books, and by how much is the liability understated? (`reviews`, `compliance`)
3. If we renew Albany for five years at today's borrowing rate, what happens to the balance sheet? (`exercise-option --dry-run`)
4. What is this month's journal for each entity, by account code, ready to key in? (`month-end`)
5. Which option deadlines fall in the next six months, who owns each one, and has anyone decided? (`critical-dates`, `options`)
6. What rent do we still owe, undiscounted, within a year, one to two, two to five and over five years? (`maturity`)
7. Which leases are treated as short-term or low-value and no longer qualify? (`compliance`)
8. Which bank guarantees lapse before their lease ends? (`compliance`)
9. Which Victorian or NSW retail leases are owed a landlord notice that has not arrived? (`compliance`)
10. What goes in the year-end leases note, paragraph by paragraph? (`disclosure`, `draft-disclosure`)

## Why no front end

- The front end was only ever there because the database was hard to talk to. That is no longer true.
- Your data sits in plain Postgres tables you own. Any tool can read them. No export, no lock-in.
- No seats, no tiers, no add-ons. Read [docs/why-no-front-end.md](docs/why-no-front-end.md) for the honest trade-offs too.

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/lease-accounting-for-claude-code.git
cd lease-accounting-for-claude-code
npm install
npm run demo
```

Then open the folder in Claude Code and type `/attention`. Next try `/balances`, then `/month-end`, then `/exercise-option` with "what if we renew Albany?".

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee.

## The commands

| Command | What it does |
|---|---|
| `/attention` | Everything off the books, missed, due within 30 days or breaching a rule, in one list |
| `/weekly-review` | The Monday lease note: critical dates, reviews waiting, breaches, balances |
| `/critical-dates` | Option deadlines, rent reviews, expiries and bank guarantees coming up |
| `/options` | Every option with its last day, whether it is in the lease term, and the decision |
| `/reviews` | Rent reviews waiting for the new rent |
| `/balances` | Liability (current and non-current) and right-of-use asset per lease, at any date |
| `/maturity` | Undiscounted rent still to pay, by when it falls due |
| `/month-end` | The month's journal by account code, ready to key into the ledger |
| `/close-month` | Close a month once everything in it is approved, and keep the journal |
| `/disclosure` | The year-end note numbers, by AASB 16 paragraph |
| `/compliance` | Every rule in `docs/compliance.md` checked, with its source |
| `/leases` | The lease register |
| `/lease` | One lease's whole file |
| `/schedule` | The monthly liability and right-of-use schedule for a lease |
| `/add-lease` | Put a lease on the register and measure it |
| `/add-option` | Add a renewal, termination or purchase option |
| `/record-review` | Record a CPI or market review and prepare the remeasurement |
| `/exercise-option` | Record an option decision, or test what one would do |
| `/landlord-notice` | Record a Victorian s28 or NSW s44 notice from the landlord |
| `/measure` | Prepare a lease's first measurement |
| `/approve` | The second-person approval that puts a measurement in the books |
| `/terminate` | End a lease early and work out the gain or loss |
| `/log` | A lease note: call, email or meeting |
| `/draft-option-notice` | Draft the letter exercising an option to `drafts/`. Never sends |
| `/draft-disclosure` | Draft the year-end leases note to `drafts/` |
| `/import` | Bring leases and rent schedules across from Visual Lease |
| `/export` | Every record to a JSON backup |
| `/customise` | Add a field, change an account code or a policy, in plain words |
| `/new-view` | Add an HTML dashboard |

Behind them is one CLI, `npm run lease -- help`, with 36 commands and `--json` on every one. `npm run view` renders the week, the lease register and the options book as branded HTML; `npm run docs` renders each lease's schedule, each entity's month-end journal and a critical dates report.

### Your first hour: ten things to ask for

1. "What needs attention this week?"
2. "Record the Ponsonby CPI review at 3.2% and show me what it does to the liability."
3. "James, approve the Ponsonby remeasurement."
4. "What if we renew Albany for five years at 6.4%?"
5. "Give me September's journal for the NZ company."
6. "Close September for HDG-NZ."
7. "Which option deadlines do we have before Christmas, and who owns them?"
8. "Draft the year-end leases note for the Australian company."
9. "Change the lease liability account to 2450 to match our chart of accounts." (`/customise`)
10. "Bring across our Visual Lease portfolio report." (`/import`)

## Instead of Visual Lease

Export the lease report and the rent schedule from Visual Lease to CSV, then `npm run lease -- import visual-lease --file=leases.csv --country=NZ --dry-run --actor="Your Name"`, then the rent schedule with `--report=payments`. Every imported lease waits for a measurement and a second-person approval. The whole path, the column map and what does not carry over: [docs/replace-visual-lease.md](docs/replace-visual-lease.md). The measurement rules and checks, with their sources: [docs/compliance.md](docs/compliance.md).

## Architecture

```
lease-accounting-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/                  the CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema
  supabase/seed.sql         demo data
  docs/                     the thesis and the migration guide
```

## Built for coding agents

The database, CLI and command recipes work with Claude Code, Codex, OpenCode or Cursor. Ask your coding agent for a new command and have it implement and test the change against the same records.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, a small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Lease Accounting for Claude Code for your business, migrates your Visual Lease data, connects it to the rest of your tools, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=visual-lease)
- Read more: [enterprisedna.co/omni/instead-of/visual-lease](https://enterprisedna.co/omni/instead-of/visual-lease?utm_source=github&utm_medium=readme&utm_campaign=visual-lease)

## License

MIT. Copyright (c) 2026 Enterprise DNA.
