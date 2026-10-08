# Why there is no front end

Visual Lease is a database with a subscription. The tables underneath it are ordinary: a few entities, a few relationships, a handful of workflows you repeat every week. What you pay for is the layer on top that lets people who do not write SQL get at those tables. Screens, filters, dashboards, forms.

That layer used to be the whole product, because talking to a database was hard. It is not hard any more. Open this folder in Claude Code, describe what you want, and it writes the query, runs it, and explains the answer. Ask a question the dashboard never had a chart for and you still get an answer.

## What you gain

- **Better answers.** A dashboard shows what the vendor decided to chart. Here you ask your own question, in your own words, and get it answered against your own data.
- **No seats.** Everyone who needs to look can look. The bill does not grow with headcount.
- **Your data in your Postgres.** Plain tables. Back them up, query them from anything, leave any time. There is no export step because there is nothing to leave.
- **A process that matches you.** When your way of working changes, you add a command. You do not wait for a feature request to clear.

## What you give up

- **Lease abstraction from PDFs.** Visual Lease reads lease documents for you. Here you read the lease and enter the dates and amounts, or ask Claude Code to read the PDF and propose the entry for you to check.
- **A portfolio map and drag-and-drop screens.** The register is a table you ask about. `npm run view` renders it as a page.
- **A phone app and automatic email alerts.** It runs where Claude Code runs. `/attention` is the alert; a scheduled run can email it.
- **A vendor help desk and a SOC report.** This is open source. Enterprise DNA supports the installed version for businesses that want someone to call.

## Who this fits

Finance teams with tens of leases, not thousands, who need the month-end journal, the year-end note and the option dates more than a screen. If a property team works in the portfolio screens all day, keep Visual Lease. If you need the answers more than the screens, this is cheaper, faster and yours.

Installed and run for you: https://enterprisedna.co/omni/instead-of/visual-lease
