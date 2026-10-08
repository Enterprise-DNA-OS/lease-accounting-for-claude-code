-- Lease Accounting for Claude Code: the records a tenant runs its leases and its AASB 16 /
-- NZ IFRS 16 lease accounting on. Reporting entities, landlords, leases with their rent steps,
-- options and rent reviews, measurements (each prepared by one person and approved by another),
-- the monthly schedule each measurement produces, month closes and lease notes.
-- Plain Postgres; runs on PGlite too. Money is numeric(14,2) in the entity's currency, ex GST.

create function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- One company in the group that reports on its own leases.
create table entities (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z0-9-]{2,12}$'),
  name text not null check (btrim(name) <> ''),
  country text not null default 'NZ' check (country in ('AU','NZ')),
  currency text not null default 'NZD' check (currency ~ '^[A-Z]{3}$'),
  year_end_month int not null default 3 check (year_end_month between 1 and 12), -- 3 = 31 March, 6 = 30 June
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index entities_code_ci on entities(lower(code));

create table lessors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index lessors_name_ci on lessors(lower(name));

-- The ledger accounts the journals post to. Change the codes to match your chart of accounts.
create table accounts (
  key text primary key,
  code text not null,
  name text not null
);

-- Policy settings the checks read. Change a value, not the code.
create table settings (
  key text primary key,
  value text not null,
  note text not null default ''
);

create table leases (
  id uuid primary key default gen_random_uuid(),
  reference text not null check (btrim(reference) <> ''),
  entity_id uuid not null references entities(id),
  lessor_id uuid references lessors(id),
  asset_class text not null default 'property' check (asset_class in ('property','vehicles','equipment','other')),
  description text not null check (btrim(description) <> ''),
  address text not null default '',
  state text not null default '' check (state in ('','NSW','VIC','QLD','WA','SA','TAS','ACT','NT','NZ')),
  retail boolean not null default false,              -- a retail shop lease under the state Retail Leases Act
  commencement_on date not null,                     -- the date the asset is available for use
  expiry_on date not null,                           -- the last day of the current contract term
  term_end_on date not null,                         -- the last day of the lease term for accounting (AASB 16 para 18)
  payment_frequency text not null default 'monthly' check (payment_frequency in ('monthly','quarterly','annually')),
  payment_timing text not null default 'advance' check (payment_timing in ('advance','arrears')),
  review_kind text not null default 'none' check (review_kind in ('none','fixed','cpi','market')),
  fixed_increase_pct numeric(6,3),
  review_every_months int not null default 12 check (review_every_months between 1 and 120),
  discount_rate_pct numeric(6,3) check (discount_rate_pct is null or discount_rate_pct between 0 and 50),
  initial_direct_costs numeric(14,2) not null default 0 check (initial_direct_costs >= 0),
  incentives numeric(14,2) not null default 0 check (incentives >= 0),
  make_good_clause boolean not null default false,
  make_good_estimate numeric(14,2) check (make_good_estimate is null or make_good_estimate >= 0),
  bank_guarantee numeric(14,2) not null default 0 check (bank_guarantee >= 0),
  guarantee_expires_on date,
  exemption text not null default 'none' check (exemption in ('none','short-term','low-value')),
  asset_value_new numeric(14,2),                     -- for a low-value claim: the asset's value when new
  landlord_expiry_notice_on date,                    -- NSW Retail Leases Act s44 notice received
  status text not null default 'active' check (status in ('active','ended','terminated')),
  ended_on date,
  owner text not null default '',                    -- who looks after this lease day to day
  source_id text unique,
  source_row jsonb,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiry_on >= commencement_on),
  check (term_end_on >= commencement_on),
  check (review_kind <> 'fixed' or fixed_increase_pct is not null)
);
create unique index leases_reference_ci on leases(lower(reference));

-- The rent per payment, from a date. The schedule reads the step in force on each payment date.
create table payment_steps (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  from_on date not null,
  amount numeric(14,2) not null check (amount >= 0),
  reason text not null default 'commencement',
  created_at timestamptz not null default now(),
  unique (lease_id, from_on)
);

create table options (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  kind text not null default 'renewal' check (kind in ('renewal','termination','purchase')),
  term_months int check (term_months is null or term_months between 1 and 600),
  exercise_from date,
  exercise_by date not null,                          -- last day to give notice
  reasonably_certain boolean not null default false,  -- included in the lease term (AASB 16 para 18-19)
  decision text not null default 'undecided' check (decision in ('undecided','exercise','not exercising')),
  decided_on date,
  decided_by text,
  landlord_notice_on date,                            -- Victorian Retail Leases Act s28 notice received
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'renewal' or term_months is not null)
);

-- CPI and market reviews. new_amount is null until the new rent is known and recorded.
create table rent_reviews (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  effective_on date not null,
  kind text not null check (kind in ('cpi','market')),
  new_amount numeric(14,2),
  cpi_pct numeric(6,3),
  recorded_on date,
  recorded_by text,
  measurement_id uuid,
  created_at timestamptz not null default now(),
  unique (lease_id, effective_on)
);

-- One measurement of the lease: the first one at commencement, then one for each remeasurement,
-- modification or termination. Each one is prepared by one person and approved by another; the
-- schedule only counts once it is approved. entries holds the journal (debit positive).
create table measurements (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  effective_on date not null,                         -- start of the first period it applies to
  period_no int not null default 0,                   -- that period's number, counted from commencement
  reason text not null check (reason in ('initial','rent review','term change','modification','termination')),
  discount_rate_pct numeric(6,3),
  term_end_on date,
  liability numeric(14,2) not null,                   -- the lease liability after this measurement
  rou_carrying numeric(14,2) not null,                -- the right-of-use asset after it
  liability_change numeric(14,2) not null default 0,
  gain_loss numeric(14,2) not null default 0,
  entries jsonb not null default '[]'::jsonb,
  basis text not null default '',
  prepared_by text not null check (btrim(prepared_by) <> ''),
  prepared_at timestamptz not null default now(),
  approved_by text,
  approved_at timestamptz,
  superseded boolean not null default false,          -- a draft replaced before anyone approved it
  check (approved_by is null or lower(btrim(approved_by)) <> lower(btrim(prepared_by)))
);

create table schedule (
  id uuid primary key default gen_random_uuid(),
  measurement_id uuid not null references measurements(id) on delete cascade,
  lease_id uuid not null references leases(id) on delete cascade,
  period_no int not null,
  period_on date not null,                            -- first day of the period
  paid_on date,                                       -- when this period's payment falls, if any
  opening numeric(14,2) not null,
  payment numeric(14,2) not null default 0,
  interest numeric(14,2) not null default 0,
  closing numeric(14,2) not null,
  depreciation numeric(14,2) not null default 0,
  rou_closing numeric(14,2) not null,
  superseded boolean not null default false,          -- replaced by a later approved measurement
  unique (measurement_id, period_no)
);
create index schedule_lease_period on schedule(lease_id, period_on);

create table month_closes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  month date not null check (extract(day from month) = 1),
  closed_by text not null,
  closed_at timestamptz not null default now(),
  journal jsonb not null,
  unique (entity_id, month)
);

create table lease_notes (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references leases(id) on delete cascade,
  author text not null,
  kind text not null default 'note' check (kind in ('note','call','email','meeting','import','system')),
  note text not null check (btrim(note) <> ''),
  created_at timestamptz not null default now()
);

create trigger entities_touch before update on entities for each row execute function touch_updated_at();
create trigger lessors_touch before update on lessors for each row execute function touch_updated_at();
create trigger leases_touch before update on leases for each row execute function touch_updated_at();
create trigger options_touch before update on options for each row execute function touch_updated_at();

insert into accounts (key, code, name) values
  ('rou_asset', '1610', 'Right-of-use assets at cost'),
  ('rou_accum_dep', '1615', 'Right-of-use assets accumulated depreciation'),
  ('lease_liability', '2410', 'Lease liabilities'),
  ('make_good_provision', '2420', 'Make good provision'),
  ('lease_incentive', '1220', 'Lease incentive receivable'),
  ('cash', '1010', 'Bank / rent payable'),
  ('interest_expense', '6810', 'Interest on lease liabilities'),
  ('depreciation_expense', '6820', 'Depreciation of right-of-use assets'),
  ('exempt_lease_expense', '6830', 'Short-term and low-value lease expense'),
  ('gain_loss', '6890', 'Gain or loss on lease changes');

insert into settings (key, value, note) values
  ('low_value_threshold', '5000', 'Most an asset can be worth when new for the low-value exemption. IFRS 16 BC100 mentions US$5,000 or less; set your own policy in your currency.'),
  ('option_warning_days', '90', 'How far ahead an undecided option deadline shows as due.'),
  ('guarantee_warning_days', '60', 'How far ahead an expiring bank guarantee shows.');

-- ---------------------------------------------------------------- views

-- The schedule that counts: approved measurements, rows not replaced by a later one.
create view schedule_current with (security_invoker = true) as
select s.* from schedule s join measurements m on m.id = s.measurement_id
where m.approved_by is not null and not s.superseded;

-- Liability and right-of-use asset at the end of a day, per lease.
create function lease_balances(as_at date)
returns table (lease_id uuid, liability numeric, rou numeric)
language sql stable as $$
  select l.id,
    case when exists (select 1 from measurements t where t.lease_id = l.id and t.reason = 'termination' and t.approved_by is not null and t.effective_on <= as_at) then 0
      else coalesce(
        (select s.closing from schedule_current s where s.lease_id = l.id and (s.period_on + interval '1 month')::date <= as_at + 1 order by s.period_on desc limit 1),
        (select s.opening from schedule_current s where s.lease_id = l.id and s.period_on <= as_at order by s.period_on limit 1), 0)
        -- a payment already made inside a period that has not ended yet
        - coalesce((select sum(s.payment) from schedule_current s where s.lease_id = l.id and s.period_on <= as_at
            and (s.period_on + interval '1 month')::date > as_at + 1 and s.paid_on <= as_at), 0) end,
    case when exists (select 1 from measurements t where t.lease_id = l.id and t.reason = 'termination' and t.approved_by is not null and t.effective_on <= as_at) then 0
      else coalesce(
        (select s.rou_closing from schedule_current s where s.lease_id = l.id and (s.period_on + interval '1 month')::date <= as_at + 1 order by s.period_on desc limit 1),
        (select m.rou_carrying from measurements m where m.lease_id = l.id and m.approved_by is not null and m.reason = 'initial' and m.effective_on <= as_at limit 1), 0) end
  from leases l
$$;

-- Every lease with its rent today, its balances today and the next date that matters.
create view lease_register with (security_invoker = true) as
select l.id, l.reference, e.code as entity, l.asset_class, l.description, l.state, o.name as lessor,
  l.commencement_on, l.expiry_on, l.term_end_on, l.exemption, l.status, l.owner, e.currency,
  (select p.amount from payment_steps p where p.lease_id = l.id and p.from_on <= greatest(current_date, l.commencement_on) order by p.from_on desc limit 1) as rent,
  l.payment_frequency as per,
  b.liability, b.rou,
  (select m.approved_by is not null from measurements m where m.lease_id = l.id and not m.superseded order by m.prepared_at desc limit 1) as measured
from leases l join entities e on e.id = l.entity_id left join lessors o on o.id = l.lessor_id
left join lease_balances(current_date) b on b.lease_id = l.id;

-- Every date that matters on a lease, past ones that still need action included.
create view critical_dates with (security_invoker = true) as
select l.id as lease_id, l.reference, e.code as entity, l.description, l.owner, 'option: last day to exercise'::text as event,
  o.exercise_by as due_on, format('%s option%s, %s', o.kind, coalesce(' for ' || o.term_months || ' months', ''), o.decision) as detail, o.id as record_id
from options o join leases l on l.id = o.lease_id join entities e on e.id = l.entity_id
where o.decision = 'undecided' and l.status = 'active'
union all
select l.id, l.reference, e.code, l.description, l.owner, 'rent review', r.effective_on, format('%s review, new rent not recorded', r.kind), r.id
from rent_reviews r join leases l on l.id = r.lease_id join entities e on e.id = l.entity_id
where r.new_amount is null and l.status = 'active' and r.effective_on <= l.term_end_on
union all
select l.id, l.reference, e.code, l.description, l.owner, 'lease expires', l.expiry_on, format('contract term ends; accounting term ends %s', l.term_end_on), l.id
from leases l join entities e on e.id = l.entity_id where l.status = 'active'
union all
select l.id, l.reference, e.code, l.description, l.owner, 'bank guarantee expires', l.guarantee_expires_on, format('guarantee of %s', l.bank_guarantee), l.id
from leases l join entities e on e.id = l.entity_id where l.status = 'active' and l.guarantee_expires_on is not null
union all
select l.id, l.reference, e.code, l.description, l.owner, 'NSW s44 notice window opens', (l.expiry_on - interval '12 months')::date,
  'landlord must offer renewal or say no renewal 6 to 12 months before expiry', l.id
from leases l join entities e on e.id = l.entity_id
where l.status = 'active' and l.retail and l.state = 'NSW' and l.landlord_expiry_notice_on is null;

-- Pending rent reviews, with the rent they replace.
create view review_book with (security_invoker = true) as
select r.id, l.reference, e.code as entity, l.description, r.kind, r.effective_on, r.effective_on - current_date as days,
  (select p.amount from payment_steps p where p.lease_id = l.id and p.from_on < r.effective_on order by p.from_on desc limit 1) as current_rent,
  r.new_amount, r.cpi_pct, r.recorded_on, r.recorded_by
from rent_reviews r join leases l on l.id = r.lease_id join entities e on e.id = l.entity_id
where l.status = 'active' and r.effective_on <= l.term_end_on;

-- Rent on short-term and low-value leases: expensed as paid (AASB 16 para 6).
create view exempt_payments with (security_invoker = true) as
select l.id as lease_id, l.reference, l.entity_id, d::date as paid_on,
  (select p.amount from payment_steps p where p.lease_id = l.id and p.from_on <= d::date order by p.from_on desc limit 1) as amount
from leases l
cross join lateral generate_series(l.commencement_on::timestamp, least(l.term_end_on, coalesce(l.ended_on, l.term_end_on))::timestamp,
  case l.payment_frequency when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '12 months' end) d
where l.exemption <> 'none';

-- Every journal line, by entity and month: the measurement entries, then interest, payments and
-- depreciation from the schedule, then the exempt lease expense. Debit positive.
create view journal_lines with (security_invoker = true) as
with lines as (
  select l.entity_id, date_trunc('month', m.effective_on)::date as month, l.reference, x.account, x.amount::numeric as amount, m.reason as source
  from measurements m join leases l on l.id = m.lease_id
  cross join lateral jsonb_to_recordset(m.entries) as x(account text, amount numeric)
  where m.approved_by is not null and not m.superseded
  union all
  select l.entity_id, date_trunc('month', s.period_on)::date, l.reference, 'interest_expense', s.interest, 'interest' from schedule_current s join leases l on l.id = s.lease_id
  union all
  select l.entity_id, date_trunc('month', s.period_on)::date, l.reference, 'lease_liability', -s.interest, 'interest' from schedule_current s join leases l on l.id = s.lease_id
  union all
  select l.entity_id, date_trunc('month', s.paid_on)::date, l.reference, 'lease_liability', s.payment, 'payment' from schedule_current s join leases l on l.id = s.lease_id where s.payment <> 0
  union all
  select l.entity_id, date_trunc('month', s.paid_on)::date, l.reference, 'cash', -s.payment, 'payment' from schedule_current s join leases l on l.id = s.lease_id where s.payment <> 0
  union all
  select l.entity_id, date_trunc('month', s.period_on)::date, l.reference, 'depreciation_expense', s.depreciation, 'depreciation' from schedule_current s join leases l on l.id = s.lease_id
  union all
  select l.entity_id, date_trunc('month', s.period_on)::date, l.reference, 'rou_accum_dep', -s.depreciation, 'depreciation' from schedule_current s join leases l on l.id = s.lease_id
  union all
  select x.entity_id, date_trunc('month', x.paid_on)::date, x.reference, 'exempt_lease_expense', x.amount, 'exempt lease' from exempt_payments x
  union all
  select x.entity_id, date_trunc('month', x.paid_on)::date, x.reference, 'cash', -x.amount, 'exempt lease' from exempt_payments x
)
select lines.entity_id, e.code as entity, lines.month, lines.reference, lines.account, a.code as account_code, a.name as account_name, lines.amount, lines.source
from lines join entities e on e.id = lines.entity_id left join accounts a on a.key = lines.account
where lines.amount <> 0;

-- One row per breach. Rule codes are explained, with sources, in docs/compliance.md.
create view compliance_findings with (security_invoker = true) as
select 'MEASURE-MISSING'::text as rule, l.reference as record, e.code as entity,
  format('%s lease from %s is not exempt and has no measurement: it is off the balance sheet', l.asset_class, l.commencement_on) as finding, 1 as severity
from leases l join entities e on e.id = l.entity_id
where l.status = 'active' and l.exemption = 'none' and l.commencement_on <= current_date
  and not exists (select 1 from measurements m where m.lease_id = l.id and not m.superseded)
union all
select 'MEASURE-UNAPPROVED', l.reference, e.code, format('%s measurement effective %s, prepared by %s, waits for a second person', m.reason, m.effective_on, m.prepared_by), 1
from measurements m join leases l on l.id = m.lease_id join entities e on e.id = l.entity_id
where m.approved_by is null and not m.superseded
union all
select 'RATE-MISSING', l.reference, e.code, 'No discount rate on file for a lease that must be measured', 1
from leases l join entities e on e.id = l.entity_id where l.status = 'active' and l.exemption = 'none' and l.discount_rate_pct is null
union all
select 'REVIEW-NOT-RECORDED', l.reference, e.code, format('%s review took effect %s (%s days ago) and the new rent is not recorded: the liability is understated', r.kind, r.effective_on, current_date - r.effective_on), 1
from rent_reviews r join leases l on l.id = r.lease_id join entities e on e.id = l.entity_id
where r.new_amount is null and r.effective_on <= current_date and l.status = 'active' and r.effective_on <= l.term_end_on
union all
select 'SHORT-TERM-INVALID', l.reference, e.code, format('Treated as short-term but the lease term is %s months%s', ((l.term_end_on - l.commencement_on + 1) / 30.44)::int,
  case when exists (select 1 from options o where o.lease_id = l.id and o.kind = 'purchase') then ' and it has a purchase option' else '' end), 1
from leases l join entities e on e.id = l.entity_id
where l.status = 'active' and l.exemption = 'short-term'
  and (l.term_end_on >= (l.commencement_on + interval '12 months')::date or exists (select 1 from options o where o.lease_id = l.id and o.kind = 'purchase'))
union all
select 'LOW-VALUE-INVALID', l.reference, e.code,
  case when l.asset_class = 'property' then 'A property lease cannot be low-value'
       when l.asset_value_new is null then 'Treated as low-value with no value-when-new on file'
       else format('Treated as low-value but the asset is worth %s new, above the %s policy', l.asset_value_new, (select value from settings where key = 'low_value_threshold')) end, 1
from leases l join entities e on e.id = l.entity_id
where l.status = 'active' and l.exemption = 'low-value'
  and (l.asset_class = 'property' or l.asset_value_new is null or l.asset_value_new > (select value::numeric from settings where key = 'low_value_threshold'))
union all
select 'OPTION-MISSED', l.reference, e.code, format('Last day to exercise the %s option was %s (%s days ago) and no decision is recorded', o.kind, o.exercise_by, current_date - o.exercise_by), 1
from options o join leases l on l.id = o.lease_id join entities e on e.id = l.entity_id
where o.decision = 'undecided' and o.exercise_by < current_date and l.status = 'active'
union all
select 'OPTION-DUE', l.reference, e.code, format('Last day to exercise the %s option is %s, in %s days, and nobody has decided', o.kind, o.exercise_by, o.exercise_by - current_date), 2
from options o join leases l on l.id = o.lease_id join entities e on e.id = l.entity_id
where o.decision = 'undecided' and o.exercise_by between current_date and current_date + (select value::int from settings where key = 'option_warning_days') and l.status = 'active'
union all
select 'OPTION-REASSESS', l.reference, e.code,
  case when o.decision = 'exercise' then format('Renewal option exercised %s but the lease term still ends %s: remeasure with a revised rate', o.decided_on, l.term_end_on)
       else format('Renewal option not being exercised but the lease term still includes it (ends %s): remeasure with a revised rate', l.term_end_on) end, 1
from options o join leases l on l.id = o.lease_id join entities e on e.id = l.entity_id
where o.kind = 'renewal' and l.status = 'active' and l.exemption = 'none'
  and ((o.decision = 'exercise' and l.term_end_on < l.expiry_on)
    or (o.decision = 'not exercising' and o.reasonably_certain and l.term_end_on > l.expiry_on))
union all
select 'HOLDING-OVER', l.reference, e.code, format('The lease term ended %s and the lease is still active: record the new term, a month-to-month arrangement or the end', l.term_end_on), 2
from leases l join entities e on e.id = l.entity_id where l.status = 'active' and l.term_end_on < current_date
union all
select 'MAKE-GOOD-MISSING', l.reference, e.code, 'The lease has a make good clause and no estimate of the cost: the asset and the provision are both missing it', 2
from leases l join entities e on e.id = l.entity_id where l.status = 'active' and l.make_good_clause and l.make_good_estimate is null
union all
select 'GUARANTEE-EXPIRY', l.reference, e.code, format('Bank guarantee of %s expires %s, before the lease ends %s', l.bank_guarantee, l.guarantee_expires_on, l.expiry_on), 2
from leases l join entities e on e.id = l.entity_id
where l.status = 'active' and l.guarantee_expires_on is not null and l.guarantee_expires_on < l.expiry_on
  and l.guarantee_expires_on <= current_date + (select value::int from settings where key = 'guarantee_warning_days')
union all
select 'VIC-S28-NOTICE', l.reference, e.code, format('Victorian retail lease: no section 28 notice from the landlord is recorded for the option due %s. If none arrives at least 3 months before, the option stays open until 3 months after it does', o.exercise_by), 2
from options o join leases l on l.id = o.lease_id join entities e on e.id = l.entity_id
where l.retail and l.state = 'VIC' and o.kind = 'renewal' and o.decision = 'undecided' and o.landlord_notice_on is null
  and o.exercise_by <= current_date + 120 and l.status = 'active'
union all
select 'NSW-S44-NOTICE', l.reference, e.code, format('NSW retail lease expires %s and no section 44 notice from the landlord is recorded. Without it the tenant can extend to 6 months after the notice is given', l.expiry_on), 2
from leases l join entities e on e.id = l.entity_id
where l.retail and l.state = 'NSW' and l.status = 'active' and l.landlord_expiry_notice_on is null
  and l.expiry_on <= (current_date + interval '6 months')::date
union all
select 'MONTH-NOT-CLOSED', e.code, e.code, format('%s has journals in %s and the month is not closed', e.name, to_char(date_trunc('month', current_date) - interval '1 month', 'YYYY-MM')), 2
from entities e
where exists (select 1 from journal_lines j where j.entity_id = e.id and j.month = (date_trunc('month', current_date) - interval '1 month')::date)
  and not exists (select 1 from month_closes c where c.entity_id = e.id and c.month = (date_trunc('month', current_date) - interval '1 month')::date);

alter table entities enable row level security;
alter table lessors enable row level security;
alter table accounts enable row level security;
alter table settings enable row level security;
alter table leases enable row level security;
alter table payment_steps enable row level security;
alter table options enable row level security;
alter table rent_reviews enable row level security;
alter table measurements enable row level security;
alter table schedule enable row level security;
alter table month_closes enable row level security;
alter table lease_notes enable row level security;
revoke all on entities, lessors, accounts, settings, leases, payment_steps, options, rent_reviews, measurements, schedule, month_closes, lease_notes from public;
revoke all on schedule_current, lease_register, critical_dates, review_book, exempt_payments, journal_lines, compliance_findings from public;
