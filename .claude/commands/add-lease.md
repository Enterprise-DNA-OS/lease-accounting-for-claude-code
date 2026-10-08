---
description: Put a new lease on the register, with its rent, reviews and options, and measure it for approval.
---

Collect from the lease document (ask for anything missing, never guess): reference, entity, landlord, what is leased and where, commencement date (when the asset is available for use), expiry, rent per payment and how often, in advance or arrears, the review type (fixed with the percentage, CPI, market, none), incentives, make good clause and estimate, bank guarantee and its expiry, the state if Australian and whether it is a retail lease.

Ask for the discount rate: the incremental borrowing rate at commencement (AASB 16 para 26). If the lease is 12 months or less with no purchase option, or the asset is worth little new, ask whether the entity takes the short-term or low-value exemption.

Run `npm run lease -- add-lease ... --actor="<name>"`. A lease with a rate is measured at once and waits for `/approve`. Then add each option with `/add-option`.
