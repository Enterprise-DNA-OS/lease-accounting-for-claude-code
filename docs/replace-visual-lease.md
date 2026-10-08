# Moving off Visual Lease

The move takes a day for a portfolio of a few dozen leases: two report exports, two imports, then one measurement per lease checked by a second person. Run everything with `--dry-run` first.

## 1. Export from Visual Lease

Visual Lease exports its reports to Excel. Save each as CSV.

1. **The lease report.** A portfolio or lease data report with one row per lease. Include: the lease ID, a short lease name or location code, the legal entity, the landlord, the location name, the address, the state, the asset type, the commencement date, the expiration date, the current base rent, the payment frequency and, if your accounting module holds it, the discount rate.
2. **The rent schedule.** A payment schedule report with one row per rent change: the lease ID, the payment type, the start date and the amount per payment.

Report layouts differ between accounts. The import knows the usual headings (below). If yours differ, map them with `--map=columns.json`.

## 2. Import

```bash
npm run lease -- import visual-lease --file=leases.csv --country=NZ --actor="Your Name" --dry-run
npm run lease -- import visual-lease --file=leases.csv --country=NZ --actor="Your Name"
npm run lease -- import visual-lease --file=rent-schedule.csv --report=payments --actor="Your Name"
```

`--country` sets the country for any entity the import creates (AU entities report in AUD to 30 June, NZ entities in NZD to 31 March; change either with `/customise`). Running the same file twice adds nothing. If a lease changed in Visual Lease since the last import, the import stops and names it: reconcile it by hand.

### Column map

| Field | Headings the import looks for |
|---|---|
| source_id (required) | Lease ID, Lease Number, VL Lease ID, Record ID |
| reference | Lease Name, Lease Code, Location Code, Store Number (else the lease ID) |
| entity (required) | Legal Entity, Entity, Tenant Entity, Company |
| lessor | Landlord, Lessor, Landlord Name |
| description (or address, required) | Lease Description, Location Name, Property Name, Description |
| address | Address, Street Address, Property Address |
| state | State, State/Province, Region |
| asset_type | Asset Type, Lease Type, Asset Class (real estate, vehicle, equipment) |
| commencement_on (required) | Commencement Date, Lease Commencement, Start Date |
| expiry_on (required) | Expiration Date, Lease Expiration, End Date |
| rent | Base Rent, Current Base Rent, Rent Amount |
| frequency | Payment Frequency, Rent Frequency, Frequency (monthly, quarterly, annually) |
| rate | Discount Rate, Incremental Borrowing Rate, IBR |

Rent schedule: source_id as above; from_on from Start Date, Effective Date or Payment Start; amount from Amount, Payment Amount or Rent Amount; type from Payment Type, Expense Type or Charge Type. Rows whose type is not base, minimum or fixed rent are skipped: outgoings and other charges are not lease payments (AASB 16 para 27).

A map file names the column for any field: `{ "source_id": "Ref", "entity": "Company Name", "commencement_on": "Start" }`.

## 3. Finish each lease

```bash
npm run lease -- compliance
```

shows what is missing. For each lease:

1. Set a missing discount rate: `npm run lease -- update-lease --lease=<ref> --rate=6.5 --actor="..."`. Use the rate from your last year-end file, not a new one.
2. Add options (`add-option`) and say which are in the lease term, and the CPI or market reviews still to come (`add-review`), or set the review type with `/customise`.
3. Measure (`measure`) and have a second person approve (`approve`).
4. Compare the liability and the asset with Visual Lease's figures at the last month end (`balances --as-at=<date>`). Small differences come from rounding and day counts; a large one means a missing rent step, option or review.

Once the balances agree, close the last month here (`close-month`) and stop posting from Visual Lease.

## What does not carry over

- **Measurement history.** The import measures each lease fresh from commencement with today's inputs. If a lease was remeasured in Visual Lease (a CPI review, an option), record those events here in order with `record-review` and `exercise-option` so the history matches, or agree with your auditor to carry the balance from the last year end.
- **Documents and abstracts.** Lease PDFs and the abstract fields Visual Lease extracts stay with you. Keep the PDFs in your document store and note the path with `log`.
- **Variable and non-lease charges.** Outgoings, turnover rent and service charges are skipped. They are expensed as incurred.
- **Users, workflows and alerts.** Here the alerts are `/attention` and `/critical-dates`, and the approval workflow is the second-person check.
