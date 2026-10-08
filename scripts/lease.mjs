#!/usr/bin/env node
// The one CLI for Lease Accounting for Claude Code. Every slash command drives this.
//   npm run lease -- help
//   npm run lease -- critical-dates --days=180
//   npm run lease -- month-end --entity=nz --month=2026-09 --json
// Human tables by default, --json for machines. Records match by id, id prefix, reference or
// part of a name; an ambiguous match lists the candidates and exits 1.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table } from './lib/format.mjs';

export const commands = {
  help: 'Show commands',
  entities: 'Reporting entities with their leases and liability today',
  lessors: 'Landlords and lessors with their leases',
  leases: 'The lease register: optional --entity --class --status=active|ended|terminated|all',
  lease: 'One lease and everything on file: --lease',
  schedule: 'The lease liability and right-of-use schedule for one lease: --lease; optional --from --to',
  balances: 'Liability (current and non-current) and right-of-use asset per lease: optional --as-at --entity',
  maturity: 'Undiscounted rent still to pay, by when it falls due: optional --as-at --entity',
  'month-end': 'The month\'s journal by account, ready to key in: --entity; optional --month=YYYY-MM --detail',
  disclosure: 'The year-end lease note numbers (AASB 16 para 53 and 58): --entity; optional --year',
  'critical-dates': 'Option deadlines, rent reviews, expiries and guarantees within --days=180 (missed ones always shown)',
  reviews: 'Rent reviews waiting for the new rent: optional --all',
  options: 'Every option with its last day and the decision: optional --entity',
  attention: 'Everything missed, due within 30 days, unchecked or breaching a rule, in one list',
  compliance: 'Every rule in docs/compliance.md checked against the records',
  'weekly-review': 'Critical dates, reviews, compliance and balances in one report',
  notes: 'Lease notes, newest first: optional --lease --limit=30',
  'add-entity': '--code --name --actor; optional --country=NZ|AU --currency --year-end-month',
  'add-lessor': '--name --actor; optional --contact --email --phone',
  'add-lease': '--reference --entity --description --commencement --expiry --rent --actor; optional --lessor --class --address --state --retail --term-end --frequency --timing --review=none|fixed|cpi|market --increase --review-every --rate --idc --incentives --make-good --make-good-estimate --guarantee --guarantee-expires --exemption --asset-value --owner',
  'update-lease': '--lease --actor with changed fields (--description --address --owner --lessor --make-good-estimate --guarantee --guarantee-expires --asset-value --rate before the first approval)',
  'add-option': '--lease --exercise-by --actor; optional --kind=renewal|termination|purchase --term-months --exercise-from --reasonably-certain',
  'add-review': 'A market or CPI review on a date: --lease --on --actor; optional --kind=market|cpi',
  'landlord-notice': 'Record a landlord\'s notice: --option (Vic s28) or --lease (NSW s44) --on --actor',
  measure: 'Prepare the first measurement of a lease (replaces an unapproved one): --lease --actor',
  approve: 'Second-person approval of a measurement: --measurement --actor (not the person who prepared it)',
  'record-review': 'Record the new rent from a review and prepare the remeasurement: --review (--cpi=pct | --amount) --actor; optional --dry-run',
  'exercise-option': 'Record an option decision and prepare the remeasurement: --option --decision=exercise|not-exercising --actor; optional --rate --date --ends-on (termination option) --dry-run',
  terminate: 'End a lease early and prepare the derecognition: --lease --on --actor; optional --payment --dry-run',
  'end-lease': 'Mark a lease that has run its term as ended: --lease --actor',
  'close-month': 'Close a month for an entity and keep its journal: --entity --month=YYYY-MM --actor',
  log: 'Lease note: --lease --note --actor; optional --kind=note|call|email|meeting',
  'draft-option-notice': 'Letter to the landlord exercising an option, to drafts/: --option',
  'draft-disclosure': 'The year-end lease note, written up, to drafts/: --entity; optional --year',
  import: 'visual-lease --file=export.csv --actor; optional --report=leases|payments --map=columns.json --country --dry-run',
  export: 'Every record, with original imported fields, to a JSON backup',
};

const CLASSES = ['property', 'vehicles', 'equipment', 'other'];
const FREQ = { monthly: 1, quarterly: 3, annually: 12 };
const TABLES = ['entities', 'lessors', 'accounts', 'settings', 'leases', 'payment_steps', 'options', 'rent_reviews', 'measurements', 'schedule', 'month_closes', 'lease_notes'];
const STATES = ['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT', 'NZ'];

// ---------------------------------------------------------------- input checks

const today = () => new Date().toISOString().slice(0, 10);
function required(o, k) {
  if (typeof o[k] !== 'string' || !o[k].trim()) throw Error(`--${k} is required`);
  return o[k].trim();
}
export function date(value, label = 'date', nullable = true) {
  if ((value === undefined || value === null || value === '') && nullable) return null;
  let s = String(value ?? '').trim();
  const au = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // AU and NZ write day first
  if (au) s = `${au[3]}-${au[2].padStart(2, '0')}-${au[1].padStart(2, '0')}`;
  const t = Date.parse(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== s) {
    throw Error(`${label} must be a real date (YYYY-MM-DD or DD/MM/YYYY), got "${value}"`);
  }
  return s;
}
export function amount(v, label = 'amount') {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(s)) throw Error(`${label} must be a positive amount with at most two decimals`);
  return Number(s);
}
function pct(v, label) {
  const s = String(v ?? '').replace(/[%\s]/g, '');
  if (!/^-?\d{1,2}(\.\d{1,3})?$/.test(s)) throw Error(`${label} must be a percentage like 6.5`);
  return Number(s);
}
function oneOf(v, choices, label) {
  if (!choices.includes(v)) throw Error(`${label} must be one of: ${choices.join(', ')}`);
  return v;
}
function intIn(v, lo, hi, label) {
  if (!/^\d+$/.test(String(v)) || Number(v) < lo || Number(v) > hi) throw Error(`${label} must be a whole number from ${lo} to ${hi}`);
  return Number(v);
}
function month(v, label = '--month') {
  if (!/^\d{4}-\d{2}$/.test(String(v)) || Number(String(v).slice(5)) < 1 || Number(String(v).slice(5)) > 12) throw Error(`${label} must be YYYY-MM`);
  return `${v}-01`;
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === null || v === undefined ? 0 : Number(v));

// Calendar months, clamped to the end of a short month (31 January + 1 month = 28 or 29 February).
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
export function addDays(iso, n) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
// How many monthly periods from commencement cover the lease term (a part month counts as one).
export function periodsIn(commencement, termEnd) {
  let n = 0;
  while (addMonths(commencement, n) <= termEnd) n++;
  return n;
}
// The first period starting on or after a date.
export function periodFrom(commencement, on) {
  let k = 0;
  while (addMonths(commencement, k) < on) k++;
  return k;
}
function args(argv) {
  const o = {}; const p = [];
  for (const a of argv) {
    if (!a.startsWith('--')) { p.push(a); continue; }
    const i = a.indexOf('=');
    const k = a.slice(2, i < 0 ? undefined : i);
    if (Object.hasOwn(o, k)) throw Error(`Repeated --${k}`);
    o[k] = i < 0 ? true : a.slice(i + 1);
  }
  return { o, p };
}

// ---------------------------------------------------------------- the arithmetic (AASB 16 / NZ IFRS 16)

// Annual rate to a monthly rate that compounds back to it.
export const monthlyRate = (annualPct) => Math.pow(1 + Number(annualPct) / 100, 1 / 12) - 1;

// The payment in each period from period `from` to the end of the term. In advance, the rent for
// f months falls on the first day of every f-th period; in arrears, on the last day of the f-th.
export function paymentsFor(lease, steps, from = 0) {
  const n = periodsIn(lease.commencement_on, lease.term_end_on);
  const f = FREQ[lease.payment_frequency];
  const sorted = [...steps].sort((a, b) => (a.from_on < b.from_on ? -1 : 1));
  const rentOn = (d) => { let a = 0; for (const s of sorted) if (s.from_on <= d) a = num(s.amount); return a; };
  const out = [];
  for (let k = from; k < n; k++) {
    const start = addMonths(lease.commencement_on, k);
    let pay = 0; let paid_on = null;
    if (lease.payment_timing === 'advance' && k % f === 0) { pay = rentOn(start); paid_on = start; }
    if (lease.payment_timing === 'arrears' && (k + 1) % f === 0) { pay = rentOn(start); paid_on = addDays(addMonths(lease.commencement_on, k + 1), -1); }
    out.push({ period_no: k, period_on: start, paid_on, payment: r2(pay) });
  }
  return out;
}

// Present value of the remaining payments at the start of the first period given.
export function presentValue(payments, annualPct, timing) {
  const i = monthlyRate(annualPct);
  const first = payments.length ? payments[0].period_no : 0;
  return r2(payments.reduce((pv, p) => pv + p.payment / Math.pow(1 + i, p.period_no - first + (timing === 'arrears' ? 1 : 0)), 0));
}

// The schedule: interest on the balance at the monthly rate, payments off it, straight-line
// depreciation of the right-of-use asset over the remaining periods. Rounding goes to the last row.
export function buildSchedule(payments, annualPct, timing, liability, rou) {
  const i = monthlyRate(annualPct);
  const rows = [];
  let L = liability; let A = rou;
  const dep = payments.length ? r2(rou / payments.length) : 0;
  payments.forEach((p, idx) => {
    const last = idx === payments.length - 1;
    const opening = r2(L);
    let interest; let closing;
    if (timing === 'advance') { interest = r2((opening - p.payment) * i); closing = r2(opening - p.payment + interest); }
    else { interest = r2(opening * i); closing = r2(opening + interest - p.payment); }
    if (last && closing !== 0) { interest = r2(interest - closing); closing = 0; }
    const d = last ? r2(A) : dep;
    A = r2(A - d); L = closing;
    rows.push({ ...p, opening, interest, closing, depreciation: d, rou_closing: A });
  });
  return rows;
}

const sumEntries = (entries) => r2(entries.reduce((s, e) => s + e.amount, 0));
const entry = (account, amt) => ({ account, amount: r2(amt) });
const clean = (entries) => entries.filter((e) => e.amount !== 0);

// ---------------------------------------------------------------- record matching

const LOOKUP = {
  entities: { label: 'name', key: 'code', also: 'code' },
  lessors: { label: 'name', key: 'name' },
  leases: { label: 'description', key: 'reference', also: 'address' },
};
// Exact id or reference first; then id prefix, or part of the name (for leases, the description
// or the address). More than one hit lists them all.
export async function resolve(db, kind, search) {
  const spec = LOOKUP[kind];
  if (!spec) throw Error('Unknown record type');
  if (typeof search !== 'string' || !search.trim()) throw Error('A record reference is required');
  const s = search.trim();
  const exact = await db.query(`select * from ${kind} where id::text = $1 or lower(${spec.key}) = lower($1)`, [s]);
  if (exact.length === 1) return exact[0];
  const also = spec.also ? ` or strpos(lower(t.${spec.also}), lower($1)) > 0` : '';
  const rows = await db.query(`select t.* from ${kind} t where starts_with(t.id::text, lower($1)) or strpos(lower(t.${spec.label}), lower($1)) > 0${also} order by t.${spec.key}`, [s]);
  if (rows.length === 1) return rows[0];
  if (!rows.length) throw Error(`No ${kind} matches "${s}"`);
  throw Error(`"${s}" matches more than one:\n${rows.map((r) => `  ${r[spec.key]}  ${r[spec.label]}`).join('\n')}\nUse the reference.`);
}
// Options, reviews and measurements have no reference: the id or id prefix, or the lease
// reference when that lease has exactly one open one.
async function resolveChild(db, kind, search) {
  if (typeof search !== 'string' || !search.trim()) throw Error('A record reference is required');
  const s = search.trim();
  const spec = {
    options: { open: "x.decision = 'undecided'", label: "x.kind || ' option, last day ' || x.exercise_by" },
    rent_reviews: { open: 'x.new_amount is null', label: "x.kind || ' review ' || x.effective_on" },
    measurements: { open: 'x.approved_by is null and not x.superseded', label: "x.reason || ' effective ' || x.effective_on" },
  }[kind];
  const byId = await db.query(`select * from ${kind} where starts_with(id::text, lower($1))`, [s]);
  if (byId.length === 1) return byId[0];
  const order = kind === 'rent_reviews' ? 'x.effective_on' : kind === 'options' ? 'x.exercise_by' : 'x.prepared_at';
  const rows = await db.query(`select x.*, ${spec.label} as label from ${kind} x join leases l on l.id = x.lease_id where lower(l.reference) = lower($1) and ${spec.open} order by ${order}`, [s]);
  if (rows.length === 1) return rows[0];
  if (rows.length > 1 && kind === 'rent_reviews') return rows[0]; // reviews are recorded in order: the earliest pending one
  const what = { options: 'undecided option', rent_reviews: 'pending rent review', measurements: 'unapproved measurement' }[kind];
  if (!rows.length) throw Error(`No ${what} matches "${s}". Use the id from the list.`);
  throw Error(`${s} has more than one ${what}:\n${rows.map((r) => `  ${r.id.slice(0, 8)}  ${r.label}`).join('\n')}\nUse the id.`);
}

async function note(db, leaseId, author, kind, text) {
  await db.query('insert into lease_notes (lease_id, author, kind, note) values ($1, $2, $3, $4)', [leaseId, author, kind, text]);
}
async function transaction(db, fn, dry = false) {
  await db.exec('begin');
  try { const r = await fn(); await db.exec(dry ? 'rollback' : 'commit'); return r; } catch (e) { await db.exec('rollback'); throw e; }
}
async function insert(db, kind, data) {
  const keys = Object.keys(data);
  return (await db.query(`insert into ${kind} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(data)))[0];
}
function writeDraft(name, text) {
  const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${randomUUID().slice(0, 8)}.md`);
  fs.writeFileSync(file, text, { flag: 'wx' });
  return file;
}
const steps = (db, leaseId) => db.query('select from_on, amount from payment_steps where lease_id = $1 order by from_on', [leaseId]);
async function lastClosed(db, entityId) {
  return (await db.query('select max(month) as m from month_closes where entity_id = $1', [entityId]))[0].m;
}
async function currentMeasurement(db, leaseId) {
  return (await db.query('select * from measurements where lease_id = $1 and approved_by is not null order by period_no desc, approved_at desc limit 1', [leaseId]))[0];
}
// The approved balances at the start of period m: the closing of period m - 1 on the schedule.
async function balancesAtPeriod(db, lease, m) {
  const row = (await db.query('select closing, rou_closing from schedule_current where lease_id = $1 and period_no = $2', [lease.id, m - 1]))[0];
  if (row) return { liability: num(row.closing), rou: num(row.rou_closing) };
  const first = (await db.query('select opening, measurement_id from schedule_current where lease_id = $1 and period_no = $2', [lease.id, m]))[0];
  if (first) {
    const mm = (await db.query('select rou_carrying from measurements where id = $1', [first.measurement_id]))[0];
    return { liability: num(first.opening), rou: num(mm.rou_carrying) };
  }
  return { liability: 0, rou: 0 };
}
// A new measurement replaces any unapproved one on the same lease.
async function saveMeasurement(db, lease, m, data, rows) {
  await db.query('update measurements set superseded = true where lease_id = $1 and approved_by is null and not superseded', [lease.id]);
  if (sumEntries(data.entries) !== 0) throw Error(`Journal does not balance (${sumEntries(data.entries)}): ${JSON.stringify(data.entries)}`);
  const row = await insert(db, 'measurements', { lease_id: lease.id, period_no: m, effective_on: addMonths(lease.commencement_on, m), ...data, entries: JSON.stringify(data.entries) });
  for (const s of rows) {
    await insert(db, 'schedule', { measurement_id: row.id, lease_id: lease.id, period_no: s.period_no, period_on: s.period_on, paid_on: s.paid_on,
      opening: s.opening, payment: s.payment, interest: s.interest, closing: s.closing, depreciation: s.depreciation, rou_closing: s.rou_closing });
  }
  return row;
}
const summary = (row, lease, extra = {}) => ({
  measurement: row.id.slice(0, 8), lease: lease.reference, reason: row.reason, effective_on: row.effective_on, discount_rate_pct: num(row.discount_rate_pct),
  liability: num(row.liability), right_of_use: num(row.rou_carrying), liability_change: num(row.liability_change), gain_loss: num(row.gain_loss),
  prepared_by: row.prepared_by, next: 'A second person approves it with approve before it reaches the journals.', ...extra,
});

// The first measurement, at commencement (AASB 16 para 23-26).
export async function measureInitial(db, lease, actor) {
  if (lease.exemption !== 'none') throw Error(`${lease.reference} is ${lease.exemption}: it is expensed, not measured`);
  if (lease.discount_rate_pct === null || lease.discount_rate_pct === undefined) throw Error(`${lease.reference} has no discount rate. Set it with update-lease --rate first.`);
  if (await currentMeasurement(db, lease.id)) throw Error(`${lease.reference} already has an approved measurement. Changes go through record-review, exercise-option or terminate.`);
  const pays = paymentsFor(lease, await steps(db, lease.id));
  const liability = presentValue(pays, lease.discount_rate_pct, lease.payment_timing);
  const mg = num(lease.make_good_estimate); const idc = num(lease.initial_direct_costs); const inc = num(lease.incentives);
  const rou = r2(liability + idc + mg - inc);
  const rows = buildSchedule(pays, lease.discount_rate_pct, lease.payment_timing, liability, rou);
  const entries = clean([entry('rou_asset', rou), entry('lease_incentive', inc), entry('lease_liability', -liability), entry('make_good_provision', -mg), entry('cash', -idc)]);
  const row = await saveMeasurement(db, lease, 0, {
    reason: 'initial', discount_rate_pct: lease.discount_rate_pct, term_end_on: lease.term_end_on, liability, rou_carrying: rou, liability_change: liability, entries, prepared_by: actor,
    basis: `Present value of ${pays.filter((p) => p.payment).length} payments over ${pays.length} months at ${num(lease.discount_rate_pct)}% a year, ${lease.payment_timing}. Right-of-use = liability ${liability} + direct costs ${idc} + make good ${mg} - incentives ${inc}.`,
  }, rows);
  return summary(row, lease, { periods: rows.length, total_payments: r2(pays.reduce((s, p) => s + p.payment, 0)) });
}

// A remeasurement from period m with revised payments or term (AASB 16 para 39-43): the
// liability is re-discounted, the right-of-use asset moves by the same amount, and anything that
// would take the asset below zero goes to profit or loss.
async function remeasure(db, lease, m, rate, reason, actor, basis) {
  if (!(await currentMeasurement(db, lease.id))) throw Error(`${lease.reference} has no approved measurement to change. Approve the first one, or use measure.`);
  const before = await balancesAtPeriod(db, lease, m);
  const pays = paymentsFor(lease, await steps(db, lease.id), m);
  if (!pays.length) throw Error(`${lease.reference} has no periods left from ${addMonths(lease.commencement_on, m)}`);
  const liability = presentValue(pays, rate, lease.payment_timing);
  const delta = r2(liability - before.liability);
  let rou = r2(before.rou + delta); let gl = 0;
  if (rou < 0) { gl = rou; rou = 0; }
  const entries = clean([entry('rou_asset', r2(delta - gl)), entry('lease_liability', -delta), entry('gain_loss', gl)]);
  const rows = buildSchedule(pays, rate, lease.payment_timing, liability, rou);
  const row = await saveMeasurement(db, lease, m, { reason, discount_rate_pct: rate, term_end_on: lease.term_end_on, liability, rou_carrying: rou, liability_change: delta, gain_loss: gl, entries, prepared_by: actor, basis }, rows);
  return summary(row, lease, { liability_before: before.liability, right_of_use_before: before.rou, periods_left: rows.length });
}

// ---------------------------------------------------------------- reads

async function entityFilter(db, o) {
  return o.entity ? (await resolve(db, 'entities', o.entity)).id : null;
}
async function balancesAt(db, asAt, entityId) {
  const a = date(asAt ?? today(), '--as-at', false);
  const year = addMonths(a, 12);
  const rows = await db.query(
    `select l.reference, e.code as entity, l.asset_class, l.description, e.currency, b.liability, b2.liability as liability_in_12_months, b.rou as right_of_use
     from leases l join entities e on e.id = l.entity_id join lease_balances($1::date) b on b.lease_id = l.id join lease_balances($2::date) b2 on b2.lease_id = l.id
     where l.exemption = 'none' and ($3::uuid is null or l.entity_id = $3) and (b.liability <> 0 or b.rou <> 0) order by e.code, l.reference`, [a, year, entityId]);
  return rows.map((r) => {
    const liability = num(r.liability); const later = num(r.liability_in_12_months);
    const current = r2(Math.min(liability, Math.max(0, liability - later)));
    return { reference: r.reference, entity: r.entity, asset_class: r.asset_class, description: r.description, currency: r.currency, liability, current, non_current: r2(liability - current), right_of_use: num(r.right_of_use) };
  });
}
async function maturityAt(db, asAt, entityId) {
  const a = date(asAt ?? today(), '--as-at', false);
  const rows = await db.query(
    `select e.code as entity, e.currency,
       coalesce(sum(s.payment) filter (where s.paid_on > $1::date and s.paid_on <= ($1::date + interval '1 year')::date), 0) as within_1_year,
       coalesce(sum(s.payment) filter (where s.paid_on > ($1::date + interval '1 year')::date and s.paid_on <= ($1::date + interval '2 years')::date), 0) as one_to_2_years,
       coalesce(sum(s.payment) filter (where s.paid_on > ($1::date + interval '2 years')::date and s.paid_on <= ($1::date + interval '5 years')::date), 0) as two_to_5_years,
       coalesce(sum(s.payment) filter (where s.paid_on > ($1::date + interval '5 years')::date), 0) as over_5_years,
       coalesce(sum(s.payment) filter (where s.paid_on > $1::date), 0) as total_undiscounted
     from schedule_current s join leases l on l.id = s.lease_id join entities e on e.id = l.entity_id
     where ($2::uuid is null or l.entity_id = $2) and not exists (select 1 from measurements t where t.lease_id = l.id and t.reason = 'termination' and t.approved_by is not null and t.effective_on <= s.period_on)
     group by e.code, e.currency order by e.code`, [a, entityId]);
  const bal = await balancesAt(db, a, entityId);
  return rows.map((r) => {
    const mine = bal.filter((b) => b.entity === r.entity);
    const liability = r2(mine.reduce((s, b) => s + b.liability, 0));
    const out = { entity: r.entity, currency: r.currency, as_at: a };
    for (const k of ['within_1_year', 'one_to_2_years', 'two_to_5_years', 'over_5_years', 'total_undiscounted']) out[k] = num(r[k]);
    return { ...out, interest_still_to_come: r2(out.total_undiscounted - liability), liability };
  });
}
async function monthEnd(db, o) {
  const e = await resolve(db, 'entities', required(o, 'entity'));
  const m = o.month ? month(o.month) : addMonths(today().slice(0, 8) + '01', -1);
  const lines = await db.query('select reference, account, account_code, account_name, amount, source from journal_lines where entity_id = $1 and month = $2 order by account_code, reference', [e.id, m]);
  if (o.detail) return lines.map((l) => ({ ...l, debit: num(l.amount) > 0 ? num(l.amount) : '', credit: num(l.amount) < 0 ? -num(l.amount) : '', amount: undefined }));
  const by = new Map();
  for (const l of lines) {
    const k = l.account;
    const cur = by.get(k) || { account_code: l.account_code, account_name: l.account_name, net: 0 };
    cur.net = r2(cur.net + num(l.amount)); by.set(k, cur);
  }
  const rows = [...by.values()].filter((r) => r.net !== 0).map((r) => ({ account_code: r.account_code, account_name: r.account_name, debit: r.net > 0 ? r.net : '', credit: r.net < 0 ? -r.net : '' }));
  const dr = r2(rows.reduce((s, r) => s + (r.debit || 0), 0)); const cr = r2(rows.reduce((s, r) => s + (r.credit || 0), 0));
  const closed = (await db.query('select closed_by, closed_at from month_closes where entity_id = $1 and month = $2', [e.id, m]))[0];
  return { entity: e.code, month: m.slice(0, 7), currency: e.currency, status: closed ? `closed by ${closed.closed_by}` : 'open', balanced: dr === cr ? 'yes' : `NO (${dr} vs ${cr})`, journal: rows, total_debits: dr, total_credits: cr };
}
function yearBounds(e, year) {
  const y = year ? intIn(year, 2000, 2100, '--year') : (() => {
    const t = today(); const ty = Number(t.slice(0, 4)); const tm = Number(t.slice(5, 7));
    return tm > e.year_end_month ? ty : ty - 1; // the most recent year end
  })();
  const end = addDays(addMonths(`${y}-${String(e.year_end_month).padStart(2, '0')}-01`, 1), -1);
  return { start: addDays(addMonths(end, -12), 1), end };
}
async function disclosure(db, o) {
  const e = await resolve(db, 'entities', required(o, 'entity'));
  const { start, end } = yearBounds(e, o.year);
  const q = (sql, extra = []) => db.query(sql, [e.id, start, end, ...extra]);
  const dep = await q(`select l.asset_class, coalesce(sum(s.depreciation),0) as depreciation from schedule_current s join leases l on l.id = s.lease_id
    where l.entity_id = $1 and s.period_on between $2 and $3 group by 1 order by 1`);
  const one = async (sql) => num((await q(sql))[0].v);
  const interest = await one('select coalesce(sum(s.interest),0) as v from schedule_current s join leases l on l.id = s.lease_id where l.entity_id = $1 and s.period_on between $2 and $3');
  const paid = await one('select coalesce(sum(s.payment),0) as v from schedule_current s join leases l on l.id = s.lease_id where l.entity_id = $1 and s.paid_on between $2 and $3');
  const shortTerm = await one("select coalesce(sum(x.amount),0) as v from exempt_payments x join leases l on l.id = x.lease_id where x.entity_id = $1 and x.paid_on between $2 and $3 and l.exemption = 'short-term'");
  const lowValue = await one("select coalesce(sum(x.amount),0) as v from exempt_payments x join leases l on l.id = x.lease_id where x.entity_id = $1 and x.paid_on between $2 and $3 and l.exemption = 'low-value'");
  const additions = await one("select coalesce(sum(m.rou_carrying),0) as v from measurements m join leases l on l.id = m.lease_id where l.entity_id = $1 and m.reason = 'initial' and m.approved_by is not null and m.effective_on between $2 and $3");
  const remeasured = await one("select coalesce(sum(m.liability_change),0) as v from measurements m join leases l on l.id = m.lease_id where l.entity_id = $1 and m.reason in ('rent review','term change','modification') and m.approved_by is not null and m.effective_on between $2 and $3");
  const bal = await balancesAt(db, end, e.id);
  const byClass = {};
  for (const b of bal) byClass[b.asset_class] = r2((byClass[b.asset_class] || 0) + b.right_of_use);
  const maturity = (await maturityAt(db, end, e.id))[0] || {};
  return {
    entity: e.code, name: e.name, currency: e.currency, year: `${start} to ${end}`,
    standard: e.country === 'AU' ? 'AASB 16 Leases' : 'NZ IFRS 16 Leases',
    'depreciation by class (para 53(a))': dep.map((d) => ({ asset_class: d.asset_class, depreciation: num(d.depreciation) })),
    'interest on lease liabilities (para 53(b))': interest,
    'short-term lease expense (para 53(c))': shortTerm,
    'low-value lease expense (para 53(d))': lowValue,
    'total cash outflow for leases (para 53(g))': r2(paid + shortTerm + lowValue),
    'additions to right-of-use assets (para 53(h))': additions,
    'remeasurements of lease liabilities in the year': remeasured,
    'right-of-use carrying amount by class at year end (para 53(j))': Object.entries(byClass).map(([asset_class, amount]) => ({ asset_class, carrying_amount: amount })),
    'lease liabilities at year end': [{ current: r2(bal.reduce((s, b) => s + b.current, 0)), non_current: r2(bal.reduce((s, b) => s + b.non_current, 0)), total: r2(bal.reduce((s, b) => s + b.liability, 0)) }],
    'maturity analysis, undiscounted (para 58)': [{ within_1_year: maturity.within_1_year ?? 0, one_to_2_years: maturity.one_to_2_years ?? 0, two_to_5_years: maturity.two_to_5_years ?? 0, over_5_years: maturity.over_5_years ?? 0, total: maturity.total_undiscounted ?? 0 }],
  };
}

const READS = {
  async entities(db) {
    return db.query(`select e.code, e.name, e.country, e.currency, e.year_end_month,
      (select count(*)::int from leases l where l.entity_id = e.id and l.status = 'active') as active_leases,
      (select coalesce(sum(b.liability),0) from lease_balances(current_date) b join leases l on l.id = b.lease_id where l.entity_id = e.id) as liability_today,
      (select max(c.month) from month_closes c where c.entity_id = e.id) as last_closed
      from entities e order by e.code`);
  },
  async lessors(db) {
    return db.query(`select o.name, o.contact_name, o.email, o.phone, (select count(*)::int from leases l where l.lessor_id = o.id and l.status = 'active') as active_leases from lessors o order by o.name`);
  },
  async leases(db, o) {
    const ent = await entityFilter(db, o);
    const status = o.status ?? 'active';
    if (status !== 'all') oneOf(status, ['active', 'ended', 'terminated'], '--status');
    if (o.class) oneOf(o.class, CLASSES, '--class');
    return db.query(`select r.reference, r.entity, r.asset_class, r.description, r.lessor, r.commencement_on, r.term_end_on, r.exemption, r.rent, r.per, r.liability, r.rou,
      case when r.exemption <> 'none' then 'exempt' when r.measured is null then 'NOT MEASURED' when r.measured then 'approved' else 'awaiting approval' end as measurement
      from lease_register r join leases l on l.id = r.id
      where ($1::uuid is null or l.entity_id = $1) and ($2::text = 'all' or r.status = $2) and ($3::text is null or r.asset_class = $3) order by r.entity, r.reference`, [ent, status, o.class ?? null]);
  },
  async lease(db, o) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    const reg = (await db.query('select * from lease_register where id = $1', [l.id]))[0];
    return {
      lease: { ...reg, address: l.address, retail: l.retail, payment_timing: l.payment_timing, review: l.review_kind, fixed_increase_pct: l.fixed_increase_pct, discount_rate_pct: l.discount_rate_pct,
        make_good: l.make_good_clause ? (l.make_good_estimate ?? 'clause, no estimate') : 'none', bank_guarantee: l.bank_guarantee, guarantee_expires_on: l.guarantee_expires_on },
      rent_steps: await db.query('select from_on, amount, reason from payment_steps where lease_id = $1 order by from_on', [l.id]),
      options: await db.query('select id, kind, term_months, exercise_from, exercise_by, reasonably_certain, decision, decided_on, decided_by, landlord_notice_on from options where lease_id = $1 order by exercise_by', [l.id]),
      reviews: await db.query('select id, kind, effective_on, new_amount, cpi_pct, recorded_on, recorded_by from rent_reviews where lease_id = $1 order by effective_on', [l.id]),
      measurements: await db.query("select id, reason, effective_on, discount_rate_pct, liability, rou_carrying, liability_change, gain_loss, prepared_by, coalesce(approved_by, case when superseded then 'replaced' else 'AWAITING APPROVAL' end) as approved_by from measurements where lease_id = $1 order by prepared_at", [l.id]),
      next_12_months: await db.query('select period_on, paid_on, opening, payment, interest, closing, depreciation, rou_closing from schedule_current where lease_id = $1 and period_on >= $2 order by period_no limit 12', [l.id, addMonths(today(), -1)]),
      notes: await db.query('select created_at::date as on, author, kind, note from lease_notes where lease_id = $1 order by created_at desc limit 10', [l.id]),
    };
  },
  async schedule(db, o) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    return db.query(`select period_no, period_on, paid_on, opening, payment, interest, closing, depreciation, rou_closing from schedule_current
      where lease_id = $1 and ($2::date is null or period_on >= $2) and ($3::date is null or period_on <= $3) order by period_no`, [l.id, date(o.from, '--from'), date(o.to, '--to')]);
  },
  async balances(db, o) {
    const rows = await balancesAt(db, o['as-at'], await entityFilter(db, o));
    const totals = new Map();
    for (const r of rows) {
      const t = totals.get(r.entity) || { reference: 'TOTAL', entity: r.entity, asset_class: '', description: '', currency: r.currency, liability: 0, current: 0, non_current: 0, right_of_use: 0 };
      for (const k of ['liability', 'current', 'non_current', 'right_of_use']) t[k] = r2(t[k] + r[k]);
      totals.set(r.entity, t);
    }
    return [...rows, ...totals.values()];
  },
  async maturity(db, o) { return maturityAt(db, o['as-at'], await entityFilter(db, o)); },
  'month-end': monthEnd,
  disclosure,
  async 'critical-dates'(db, o) {
    const days = o.days ? intIn(o.days, 0, 3650, '--days') : 180;
    return db.query(`select reference, entity, description, event, due_on, due_on - current_date as days, detail, owner from critical_dates
      where due_on <= current_date + $1::int and (due_on >= current_date or event in ('option: last day to exercise','rent review','bank guarantee expires')) order by due_on`, [days]);
  },
  async reviews(db, o) {
    return db.query(`select id, reference, entity, description, kind, effective_on, days, current_rent, new_amount, cpi_pct, recorded_by from review_book
      where ($1::boolean or new_amount is null) order by effective_on`, [Boolean(o.all)]);
  },
  async options(db, o) {
    const ent = await entityFilter(db, o);
    return db.query(`select x.id, l.reference, e.code as entity, l.description, x.kind, x.term_months, x.exercise_by, x.exercise_by - current_date as days_left,
      x.reasonably_certain as in_lease_term, x.decision, x.decided_on, x.decided_by
      from options x join leases l on l.id = x.lease_id join entities e on e.id = l.entity_id
      where l.status = 'active' and ($1::uuid is null or l.entity_id = $1) order by x.exercise_by`, [ent]);
  },
  async attention(db) {
    const findings = await db.query('select rule as item, record as lease, entity, finding as why, severity from compliance_findings order by severity, rule, record');
    const soon = await db.query(`select event as item, reference as lease, entity, format('%s %s (%s days)%s', detail, due_on, due_on - current_date, case when owner <> '' then ', ' || owner else '' end) as why, 3 as severity
      from critical_dates where due_on between current_date and current_date + 30 order by due_on`);
    return [...findings, ...soon];
  },
  async compliance(db) {
    return db.query('select rule, record, entity, finding from compliance_findings order by severity, rule, record');
  },
  async 'weekly-review'(db) {
    return {
      critical_dates_90_days: await READS['critical-dates'](db, { days: '90' }),
      reviews_waiting: await READS.reviews(db, {}),
      compliance: await READS.compliance(db),
      balances_today: (await READS.balances(db, {})).filter((r) => r.reference === 'TOTAL').map(({ reference, asset_class, description, ...r }) => r),
    };
  },
  async notes(db, o) {
    const id = o.lease ? (await resolve(db, 'leases', o.lease)).id : null;
    return db.query(`select n.created_at::date as on, l.reference, n.author, n.kind, n.note from lease_notes n join leases l on l.id = n.lease_id
      where ($1::uuid is null or n.lease_id = $1) order by n.created_at desc limit $2`, [id, o.limit ? intIn(o.limit, 1, 1000, '--limit') : 30]);
  },
};

// ---------------------------------------------------------------- writes

async function addLease(db, o, actor) {
  const e = await resolve(db, 'entities', required(o, 'entity'));
  const lessor = o.lessor ? await resolve(db, 'lessors', o.lessor) : null;
  const commencement = date(required(o, 'commencement'), '--commencement', false);
  const expiry = date(required(o, 'expiry'), '--expiry', false);
  const termEnd = o['term-end'] ? date(o['term-end'], '--term-end', false) : expiry;
  if (expiry < commencement || termEnd < commencement) throw Error('The lease must end after it starts');
  const review = oneOf(o.review ?? 'none', ['none', 'fixed', 'cpi', 'market'], '--review');
  const every = o['review-every'] ? intIn(o['review-every'], 1, 120, '--review-every') : 12;
  const exemption = oneOf(o.exemption ?? 'none', ['none', 'short-term', 'low-value'], '--exemption');
  const data = {
    reference: required(o, 'reference'), entity_id: e.id, lessor_id: lessor?.id ?? null, asset_class: oneOf(o.class ?? 'property', CLASSES, '--class'),
    description: required(o, 'description'), address: o.address ?? '', state: o.state ? oneOf(String(o.state).toUpperCase(), STATES, '--state') : (e.country === 'NZ' ? 'NZ' : ''),
    retail: Boolean(o.retail), commencement_on: commencement, expiry_on: expiry, term_end_on: termEnd,
    payment_frequency: oneOf(o.frequency ?? 'monthly', Object.keys(FREQ), '--frequency'), payment_timing: oneOf(o.timing ?? 'advance', ['advance', 'arrears'], '--timing'),
    review_kind: review, fixed_increase_pct: review === 'fixed' ? pct(required(o, 'increase'), '--increase') : null, review_every_months: every,
    discount_rate_pct: o.rate ? pct(o.rate, '--rate') : null, initial_direct_costs: o.idc ? amount(o.idc, '--idc') : 0, incentives: o.incentives ? amount(o.incentives, '--incentives') : 0,
    make_good_clause: Boolean(o['make-good'] || o['make-good-estimate']), make_good_estimate: o['make-good-estimate'] ? amount(o['make-good-estimate'], '--make-good-estimate') : null,
    bank_guarantee: o.guarantee ? amount(o.guarantee, '--guarantee') : 0, guarantee_expires_on: date(o['guarantee-expires'], '--guarantee-expires'),
    exemption, asset_value_new: o['asset-value'] ? amount(o['asset-value'], '--asset-value') : null, owner: o.owner ?? '',
  };
  if ((await db.query('select 1 from leases where lower(reference) = lower($1)', [data.reference])).length) throw Error(`Lease ${data.reference} already exists`);
  const l = await insert(db, 'leases', data);
  const rent = amount(required(o, 'rent'), '--rent');
  await addSteps(db, l, rent, commencement);
  await addReviews(db, l, every);
  await note(db, l.id, actor, 'system', `Lease added: ${l.description}, ${commencement} to ${expiry}, ${rent} ${l.payment_frequency} in ${l.payment_timing}.`);
  const out = { lease: l.reference, entity: e.code, term: `${commencement} to ${termEnd}`, periods: periodsIn(commencement, termEnd), exemption };
  if (exemption === 'none' && l.discount_rate_pct !== null) Object.assign(out, await measureInitial(db, l, actor));
  else if (exemption === 'none') out.next = 'Set the discount rate with update-lease --rate, then measure.';
  return out;
}
// Fixed increases are known payments: they go in as rent steps now (AASB 16 para 27(a)).
export async function addSteps(db, l, rent, from, upTo = l.term_end_on) {
  await db.query('insert into payment_steps (lease_id, from_on, amount, reason) values ($1, $2, $3, $4) on conflict (lease_id, from_on) do nothing', [l.id, from, rent, from === l.commencement_on ? 'commencement' : 'term change']);
  if (l.review_kind !== 'fixed') return;
  let amt = rent; let k = periodFrom(l.commencement_on, from) + l.review_every_months;
  while (addMonths(l.commencement_on, k) <= upTo) {
    amt = r2(amt * (1 + num(l.fixed_increase_pct) / 100));
    await db.query('insert into payment_steps (lease_id, from_on, amount, reason) values ($1, $2, $3, $4) on conflict (lease_id, from_on) do nothing', [l.id, addMonths(l.commencement_on, k), amt, `fixed increase ${num(l.fixed_increase_pct)}%`]);
    k += l.review_every_months;
  }
}
// CPI and market reviews: a pending review on each anniversary inside the term.
export async function addReviews(db, l, every, from = 0) {
  if (!['cpi', 'market'].includes(l.review_kind)) return;
  for (let k = Math.max(every, Math.ceil((from + 1) / every) * every); addMonths(l.commencement_on, k) <= l.term_end_on; k += every) {
    await db.query('insert into rent_reviews (lease_id, effective_on, kind) values ($1, $2, $3) on conflict (lease_id, effective_on) do nothing', [l.id, addMonths(l.commencement_on, k), l.review_kind]);
  }
}

async function approve(db, o, actor) {
  const m = await resolveChild(db, 'measurements', required(o, 'measurement'));
  if (m.approved_by) throw Error(`That measurement was already approved by ${m.approved_by}`);
  if (m.superseded) throw Error('That measurement was replaced by a later one. Approve the latest.');
  if (m.prepared_by.trim().toLowerCase() === actor.trim().toLowerCase()) throw Error(`${actor} prepared this measurement. A second person approves it.`);
  const l = (await db.query('select * from leases where id = $1', [m.lease_id]))[0];
  const closed = await lastClosed(db, l.entity_id);
  if (closed && m.effective_on.slice(0, 7) <= closed.slice(0, 7)) throw Error(`${m.effective_on.slice(0, 7)} is closed for this entity. A change effective in a closed month cannot be approved; prepare it from the first open month.`);
  await db.query('update schedule set superseded = true where lease_id = $1 and measurement_id <> $2 and period_no >= $3 and not superseded', [l.id, m.id, m.period_no]);
  await db.query('update measurements set approved_by = $2, approved_at = now() where id = $1', [m.id, actor]);
  if (m.reason === 'termination') await db.query("update leases set status = 'terminated', ended_on = $2 where id = $1", [l.id, addDays(m.effective_on, -1)]);
  await note(db, l.id, actor, 'system', `Approved the ${m.reason} measurement effective ${m.effective_on} prepared by ${m.prepared_by}: liability ${m.liability}, right-of-use ${m.rou_carrying}.`);
  return { lease: l.reference, measurement: m.id.slice(0, 8), reason: m.reason, effective_on: m.effective_on, liability: num(m.liability), right_of_use: num(m.rou_carrying), approved_by: actor };
}

async function recordReview(db, o, actor) {
  const r = await resolveChild(db, 'rent_reviews', required(o, 'review'));
  if (r.new_amount !== null) throw Error(`That review was recorded on ${r.recorded_on}`);
  const earlier = (await db.query('select effective_on from rent_reviews where lease_id = $1 and new_amount is null and effective_on < $2 order by effective_on limit 1', [r.lease_id, r.effective_on]))[0];
  if (earlier) throw Error(`The review on ${earlier.effective_on} comes first. Record reviews in order.`);
  const l = (await db.query('select * from leases where id = $1', [r.lease_id]))[0];
  const before = (await db.query('select amount from payment_steps where lease_id = $1 and from_on < $2 order by from_on desc limit 1', [l.id, r.effective_on]))[0];
  if (!before) throw Error('No rent on file before this review');
  if (Boolean(o.cpi) === Boolean(o.amount)) throw Error('Give either --cpi (the CPI change in %) or --amount (the new rent per payment)');
  const cpi = o.cpi ? pct(o.cpi, '--cpi') : null;
  const newAmount = cpi !== null ? r2(num(before.amount) * (1 + cpi / 100)) : amount(o.amount, '--amount');
  await db.query("insert into payment_steps (lease_id, from_on, amount, reason) values ($1, $2, $3, $4) on conflict (lease_id, from_on) do update set amount = excluded.amount, reason = excluded.reason", [l.id, r.effective_on, newAmount, `${r.kind} review`]);
  await db.query('update rent_reviews set new_amount = $2, cpi_pct = $3, recorded_on = $4, recorded_by = $5 where id = $1', [r.id, newAmount, cpi, today(), actor]);
  const out = { lease: l.reference, review: `${r.kind} ${r.effective_on}`, rent_before: num(before.amount), rent_after: newAmount };
  if (l.exemption !== 'none') return { ...out, next: 'Exempt lease: the new rent is expensed as paid.' };
  const cur = await currentMeasurement(db, l.id);
  const m = periodFrom(l.commencement_on, r.effective_on);
  const res = await remeasure(db, l, m, num(cur.discount_rate_pct), 'rent review', actor,
    `${r.kind.toUpperCase()} review effective ${r.effective_on}: rent ${num(before.amount)} to ${newAmount}${cpi !== null ? ` (CPI ${cpi}%)` : ''}. Remaining payments re-discounted at the unchanged rate ${num(cur.discount_rate_pct)}% (AASB 16 para 42(b) and 43).`);
  await db.query('update rent_reviews set measurement_id = $2 where id = $1', [r.id, (await db.query('select id from measurements where lease_id = $1 and approved_by is null and not superseded', [l.id]))[0].id]);
  await note(db, l.id, actor, 'system', `Recorded the ${r.kind} review effective ${r.effective_on}: rent ${num(before.amount)} to ${newAmount}.`);
  return { ...out, ...res, dry_run: Boolean(o['dry-run']) };
}

// An option decision changes the lease term when it differs from what the term assumed: a
// revised discount rate is required (AASB 16 para 20-21, 40).
async function exerciseOption(db, o, actor) {
  const x = await resolveChild(db, 'options', required(o, 'option'));
  if (x.decision !== 'undecided') throw Error(`That option was already decided (${x.decision}) on ${x.decided_on}`);
  const decision = oneOf(String(required(o, 'decision')).replace('-', ' '), ['exercise', 'not exercising'], '--decision');
  const on = date(o.date ?? today(), '--date', false);
  const l = (await db.query('select * from leases where id = $1', [x.lease_id]))[0];
  await db.query('update options set decision = $2, decided_on = $3, decided_by = $4 where id = $1', [x.id, decision, on, actor]);
  await note(db, l.id, actor, 'system', `${x.kind} option (last day ${x.exercise_by}): decision ${decision}.`);
  const out = { lease: l.reference, option: `${x.kind}, last day ${x.exercise_by}`, decision, decided_on: on };
  let newEnd = null;
  if (x.kind === 'renewal' && decision === 'exercise') {
    const newExpiry = addDays(addMonths(addDays(l.expiry_on, 1), x.term_months), -1);
    await db.query('update leases set expiry_on = $2 where id = $1', [l.id, newExpiry]);
    if (!x.reasonably_certain) newEnd = newExpiry;
  }
  if (x.kind === 'renewal' && decision === 'not exercising' && x.reasonably_certain) newEnd = l.expiry_on;
  if (x.kind === 'termination' && decision === 'exercise') {
    const ends = date(required(o, 'ends-on'), '--ends-on (the last day of the lease after the early end)', false);
    if (ends < l.term_end_on) newEnd = ends;
  }
  if (!newEnd || l.exemption !== 'none') return { ...out, lease_term_end: l.term_end_on, next: newEnd ? 'Exempt lease: nothing to remeasure.' : 'The lease term already assumed this. Nothing to remeasure.' };
  const rate = pct(required(o, 'rate'), '--rate (the revised discount rate at the decision date, AASB 16 para 40)');
  const oldEnd = l.term_end_on;
  const m = periodFrom(l.commencement_on, on);
  await db.query('update leases set term_end_on = $2 where id = $1', [l.id, newEnd]);
  const fresh = (await db.query('select * from leases where id = $1', [l.id]))[0];
  if (newEnd > oldEnd) {
    const last = (await db.query('select amount from payment_steps where lease_id = $1 order by from_on desc limit 1', [l.id]))[0];
    if (fresh.review_kind === 'fixed') await addSteps(db, fresh, num(last.amount), (await db.query('select max(from_on) as f from payment_steps where lease_id = $1', [l.id]))[0].f, newEnd);
    await addReviews(db, fresh, fresh.review_every_months, periodsIn(fresh.commencement_on, oldEnd) - 1);
  }
  const res = await remeasure(db, fresh, m, rate, 'term change', actor,
    `${x.kind} option ${decision === 'exercise' ? 'exercised' : 'not exercised'} on ${on}: lease term end ${oldEnd} to ${newEnd}. Remaining payments re-discounted at the revised rate ${rate}% (AASB 16 para 40).`);
  return { ...out, lease_term_end_before: oldEnd, lease_term_end_after: newEnd, ...res, dry_run: Boolean(o['dry-run']) };
}

// Early termination: the liability and the asset come off, and the difference (with any
// termination payment) is a gain or loss.
async function terminate(db, o, actor) {
  const l = await resolve(db, 'leases', required(o, 'lease'));
  if (l.status !== 'active') throw Error(`${l.reference} is already ${l.status}`);
  const on = date(required(o, 'on'), '--on', false);
  const pay = o.payment ? amount(o.payment, '--payment') : 0;
  if (l.exemption !== 'none') {
    await db.query("update leases set status = 'terminated', ended_on = $2 where id = $1", [l.id, on]);
    await note(db, l.id, actor, 'system', `Exempt lease terminated ${on}.`);
    return { lease: l.reference, ended_on: on, next: 'Exempt lease: nothing on the balance sheet to take off.' };
  }
  if (!(await currentMeasurement(db, l.id))) throw Error(`${l.reference} has no approved measurement to take off`);
  const m = periodFrom(l.commencement_on, addDays(on, 1));
  const bal = await balancesAtPeriod(db, l, m);
  const cost = num((await db.query("select coalesce(sum((x->>'amount')::numeric),0) as v from measurements m cross join lateral jsonb_array_elements(m.entries) x where m.lease_id = $1 and m.approved_by is not null and x->>'account' = 'rou_asset'", [l.id]))[0].v);
  const accum = r2(cost - bal.rou);
  const gl = r2(bal.rou - bal.liability + pay);
  const entries = clean([entry('lease_liability', bal.liability), entry('rou_accum_dep', accum), entry('rou_asset', -cost), entry('cash', -pay), entry('gain_loss', gl)]);
  const row = await saveMeasurement(db, l, m, { reason: 'termination', discount_rate_pct: null, term_end_on: on, liability: 0, rou_carrying: 0, liability_change: -bal.liability, gain_loss: gl, entries, prepared_by: actor,
    basis: `Terminated ${on}: liability ${bal.liability} and right-of-use ${bal.rou} (cost ${cost} less depreciation ${accum}) derecognised${pay ? `, termination payment ${pay}` : ''}. ${gl > 0 ? 'Loss' : 'Gain'} ${Math.abs(gl)}.` }, []);
  await note(db, l.id, actor, 'system', `Termination prepared, effective ${on}.`);
  return { ...summary(row, l), liability_before: bal.liability, right_of_use_before: bal.rou, dry_run: Boolean(o['dry-run']) };
}

async function closeMonth(db, o, actor) {
  const e = await resolve(db, 'entities', required(o, 'entity'));
  const m = month(required(o, 'month'));
  const end = addDays(addMonths(m, 1), -1);
  if (end >= today()) throw Error(`${m.slice(0, 7)} has not ended yet`);
  if ((await db.query('select 1 from month_closes where entity_id = $1 and month = $2', [e.id, m])).length) throw Error(`${m.slice(0, 7)} is already closed for ${e.code}`);
  const later = await lastClosed(db, e.id);
  if (later && later > m) throw Error(`${later.slice(0, 7)} is closed already; months close in order`);
  const drafts = await db.query('select l.reference, m.reason, m.effective_on from measurements m join leases l on l.id = m.lease_id where l.entity_id = $1 and m.approved_by is null and not m.superseded and m.effective_on <= $2', [e.id, end]);
  if (drafts.length) throw Error(`Measurements waiting for approval in or before ${m.slice(0, 7)}:\n${drafts.map((d) => `  ${d.reference}  ${d.reason} ${d.effective_on}`).join('\n')}`);
  const open = await db.query('select l.reference, r.kind, r.effective_on from rent_reviews r join leases l on l.id = r.lease_id where l.entity_id = $1 and r.new_amount is null and r.effective_on <= $2 and l.status = $3 and r.effective_on <= l.term_end_on', [e.id, end, 'active']);
  if (open.length) throw Error(`Rent reviews in effect with no new rent recorded:\n${open.map((r) => `  ${r.reference}  ${r.kind} ${r.effective_on}`).join('\n')}\nRecord them first, or the journal understates the liability.`);
  const journal = await monthEnd(db, { entity: e.id, month: m.slice(0, 7) });
  if (journal.balanced !== 'yes') throw Error(`The journal does not balance: ${journal.balanced}`);
  await insert(db, 'month_closes', { entity_id: e.id, month: m, closed_by: actor, journal: JSON.stringify(journal.journal) });
  return { entity: e.code, month: m.slice(0, 7), closed_by: actor, total_debits: journal.total_debits, lines: journal.journal.length };
}

const WRITES = {
  async 'add-entity'(db, o) {
    const country = oneOf(String(o.country ?? 'NZ').toUpperCase(), ['AU', 'NZ'], '--country');
    const code = required(o, 'code').toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) throw Error('--code must be 2 to 12 letters, digits or dashes');
    return insert(db, 'entities', { code, name: required(o, 'name'), country, currency: String(o.currency ?? (country === 'AU' ? 'AUD' : 'NZD')).toUpperCase(),
      year_end_month: o['year-end-month'] ? intIn(o['year-end-month'], 1, 12, '--year-end-month') : (country === 'AU' ? 6 : 3) });
  },
  async 'add-lessor'(db, o) {
    return insert(db, 'lessors', { name: required(o, 'name'), contact_name: o.contact ?? '', email: o.email ?? '', phone: o.phone ?? '' });
  },
  'add-lease': addLease,
  async 'update-lease'(db, o, actor) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    const set = {};
    if (o.description) set.description = o.description;
    if (o.address !== undefined) set.address = String(o.address);
    if (o.owner !== undefined) set.owner = String(o.owner);
    if (o.lessor) set.lessor_id = (await resolve(db, 'lessors', o.lessor)).id;
    if (o['make-good-estimate']) { set.make_good_estimate = amount(o['make-good-estimate'], '--make-good-estimate'); set.make_good_clause = true; }
    if (o.guarantee) set.bank_guarantee = amount(o.guarantee, '--guarantee');
    if (o['guarantee-expires']) set.guarantee_expires_on = date(o['guarantee-expires'], '--guarantee-expires');
    if (o['asset-value']) set.asset_value_new = amount(o['asset-value'], '--asset-value');
    if (o.rate) {
      if (await currentMeasurement(db, l.id)) throw Error('The rate is fixed once a measurement is approved. A revised rate comes with exercise-option.');
      set.discount_rate_pct = pct(o.rate, '--rate');
    }
    if (!Object.keys(set).length) throw Error('Nothing to change');
    const keys = Object.keys(set);
    await db.query(`update leases set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [l.id, ...Object.values(set)]);
    await note(db, l.id, actor, 'system', `Updated ${keys.join(', ')}.`);
    const out = { lease: l.reference, changed: keys.join(', ') };
    const draft = (await db.query("select 1 from measurements where lease_id = $1 and approved_by is null and not superseded and reason = 'initial'", [l.id])).length;
    if ((draft || set.discount_rate_pct !== undefined) && l.exemption === 'none' && !(await currentMeasurement(db, l.id)) && keys.some((k) => ['discount_rate_pct', 'make_good_estimate'].includes(k))) {
      Object.assign(out, await measureInitial(db, (await db.query('select * from leases where id = $1', [l.id]))[0], actor));
    } else if (set.make_good_estimate !== undefined && await currentMeasurement(db, l.id)) {
      out.next = 'The make good estimate changed after approval. Adjust the provision and the asset through a modification your accountant agrees (AASB 137); this repo records the estimate only.';
    }
    return out;
  },
  async 'add-option'(db, o, actor) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    const kind = oneOf(o.kind ?? 'renewal', ['renewal', 'termination', 'purchase'], '--kind');
    const term = kind === 'renewal' ? intIn(required(o, 'term-months'), 1, 600, '--term-months') : null;
    const certain = Boolean(o['reasonably-certain']);
    if (certain && await currentMeasurement(db, l.id)) throw Error('This lease is already measured. A change in what is reasonably certain goes through exercise-option.');
    const x = await insert(db, 'options', { lease_id: l.id, kind, term_months: term, exercise_from: date(o['exercise-from'], '--exercise-from'), exercise_by: date(required(o, 'exercise-by'), '--exercise-by', false), reasonably_certain: certain });
    const out = { lease: l.reference, option: x.id.slice(0, 8), kind, exercise_by: x.exercise_by, in_lease_term: certain };
    if (certain && kind === 'renewal') {
      const newEnd = addDays(addMonths(addDays(l.term_end_on, 1), term), -1);
      await db.query('update leases set term_end_on = $2 where id = $1', [l.id, newEnd]);
      const fresh = (await db.query('select * from leases where id = $1', [l.id]))[0];
      const last = (await db.query('select amount, from_on from payment_steps where lease_id = $1 order by from_on desc limit 1', [l.id]))[0];
      if (fresh.review_kind === 'fixed') await addSteps(db, fresh, num(last.amount), last.from_on, newEnd);
      await addReviews(db, fresh, fresh.review_every_months);
      out.lease_term_end = newEnd;
      if (fresh.exemption === 'none' && fresh.discount_rate_pct !== null) Object.assign(out, await measureInitial(db, fresh, actor));
    }
    await note(db, l.id, actor, 'system', `Added a ${kind} option, last day ${x.exercise_by}${certain ? ', included in the lease term' : ''}.`);
    return out;
  },
  async 'add-review'(db, o, actor) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    const on = date(required(o, 'on'), '--on', false);
    if (on <= l.commencement_on || on > l.term_end_on) throw Error('A review falls inside the lease term, after commencement');
    const r = await insert(db, 'rent_reviews', { lease_id: l.id, effective_on: on, kind: oneOf(o.kind ?? 'market', ['market', 'cpi'], '--kind') });
    await note(db, l.id, actor, 'system', `Added a ${r.kind} review on ${on}.`);
    return { lease: l.reference, review: r.id.slice(0, 8), kind: r.kind, effective_on: on };
  },
  async 'landlord-notice'(db, o, actor) {
    const on = date(required(o, 'on'), '--on', false);
    if (o.option) {
      const x = await resolveChild(db, 'options', o.option);
      await db.query('update options set landlord_notice_on = $2 where id = $1', [x.id, on]);
      await note(db, x.lease_id, actor, 'system', `Landlord's option notice (Retail Leases Act 2003 (Vic) s28) received ${on}.`);
      return { option: x.id.slice(0, 8), landlord_notice_on: on };
    }
    const l = await resolve(db, 'leases', required(o, 'lease'));
    await db.query('update leases set landlord_expiry_notice_on = $2 where id = $1', [l.id, on]);
    await note(db, l.id, actor, 'system', `Landlord's expiry notice (Retail Leases Act 1994 (NSW) s44) received ${on}.`);
    return { lease: l.reference, landlord_expiry_notice_on: on };
  },
  async measure(db, o, actor) { return measureInitial(db, await resolve(db, 'leases', required(o, 'lease')), actor); },
  approve,
  'record-review': recordReview,
  'exercise-option': exerciseOption,
  terminate,
  async 'end-lease'(db, o, actor) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    if (l.status !== 'active') throw Error(`${l.reference} is already ${l.status}`);
    if (l.term_end_on >= today()) throw Error(`${l.reference} runs to ${l.term_end_on}. To end it early, use terminate.`);
    await db.query("update leases set status = 'ended', ended_on = term_end_on where id = $1", [l.id]);
    await note(db, l.id, actor, 'system', `Lease ended at the end of its term, ${l.term_end_on}.`);
    return { lease: l.reference, ended_on: l.term_end_on };
  },
  'close-month': closeMonth,
  async log(db, o, actor) {
    const l = await resolve(db, 'leases', required(o, 'lease'));
    await note(db, l.id, actor, oneOf(o.kind ?? 'note', ['note', 'call', 'email', 'meeting'], '--kind'), required(o, 'note'));
    return { lease: l.reference, logged: o.kind ?? 'note' };
  },
};

// ---------------------------------------------------------------- drafts (never sent)

async function draftOptionNotice(db, o) {
  const x = await resolveChild(db, 'options', required(o, 'option'));
  const l = (await db.query('select * from leases where id = $1', [x.lease_id]))[0];
  const e = (await db.query('select * from entities where id = $1', [l.entity_id]))[0];
  const lessor = l.lessor_id ? (await db.query('select * from lessors where id = $1', [l.lessor_id]))[0] : null;
  const days = Math.round((Date.parse(x.exercise_by) - Date.parse(today())) / 86400000);
  const text = `# DRAFT: notice exercising the ${x.kind} option, ${l.reference}

Draft only. Nothing has been sent. Check the lease for how notice must be given (in writing, to which address, signed by whom) and serve it the way the lease requires, well before ${x.exercise_by}${days >= 0 ? ` (${days} days away)` : ' (THE LAST DAY HAS PASSED: get advice before serving)'}.

To: ${lessor ? `${lessor.contact_name || lessor.name}, ${lessor.name}` : '[landlord]'}${lessor?.email ? ` <${lessor.email}>` : ''}
From: ${e.name}
Premises: ${l.description}${l.address ? `, ${l.address}` : ''}
Subject: Notice of exercise of option${x.term_months ? ` for a further term of ${x.term_months / 12 === Math.floor(x.term_months / 12) ? `${x.term_months / 12} years` : `${x.term_months} months`}` : ''}

Dear ${lessor?.contact_name ? lessor.contact_name.split(' ')[0] : 'Sir or Madam'},

We refer to the lease of the premises above between ${lessor ? lessor.name : '[landlord]'} as landlord and ${e.name} as tenant, for the term ending ${l.expiry_on}.

${x.kind === 'renewal' ? `Under the lease, the tenant gives notice that it exercises its option to renew the lease for a further term${x.term_months ? ` of ${x.term_months} months` : ''}, starting ${addDays(l.expiry_on, 1)}, on the terms the lease provides.` : x.kind === 'termination' ? 'Under the lease, the tenant gives notice that it exercises its option to end the lease early, on the date and terms the lease provides.' : 'Under the lease, the tenant gives notice that it exercises its option to buy the leased asset on the terms the lease provides.'}

Please confirm receipt of this notice in writing.

Yours sincerely,

[Name]
[Title], for and on behalf of ${e.name}
`;
  return { file: writeDraft(`option-notice-${l.reference}`, text), lease: l.reference, exercise_by: x.exercise_by };
}

async function draftDisclosure(db, o) {
  const d = await disclosure(db, o);
  const money = (n) => Number(n || 0).toLocaleString('en-NZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const dep = d['depreciation by class (para 53(a))'];
  const car = d['right-of-use carrying amount by class at year end (para 53(j))'];
  const liab = d['lease liabilities at year end'][0];
  const mat = d['maturity analysis, undiscounted (para 58)'][0];
  const text = `# DRAFT: Leases note, ${d.name}, ${d.year}

Draft only, prepared from the lease records under ${d.standard}. Amounts in ${d.currency}, rounded to the dollar. The accountant reviews it against the full financial statements, adds the comparative year, and decides what is material, before it goes in the accounts.

## Right-of-use assets

| Class | Carrying amount at year end | Depreciation for the year |
|---|---:|---:|
${[...new Set([...car.map((c) => c.asset_class), ...dep.map((x) => x.asset_class)])].map((cls) => `| ${cls} | ${money(car.find((c) => c.asset_class === cls)?.carrying_amount)} | ${money(dep.find((x) => x.asset_class === cls)?.depreciation)} |`).join('\n')}

Additions to right-of-use assets in the year: ${money(d['additions to right-of-use assets (para 53(h))'])}.

## Lease liabilities

| | Amount |
|---|---:|
| Current | ${money(liab.current)} |
| Non-current | ${money(liab.non_current)} |
| Total | ${money(liab.total)} |

### Maturity analysis (undiscounted contractual cash flows)

| Within 1 year | 1 to 2 years | 2 to 5 years | Over 5 years | Total |
|---:|---:|---:|---:|---:|
| ${money(mat.within_1_year)} | ${money(mat.one_to_2_years)} | ${money(mat.two_to_5_years)} | ${money(mat.over_5_years)} | ${money(mat.total)} |

## Amounts recognised in profit or loss

| | Amount |
|---|---:|
| Interest on lease liabilities | ${money(d['interest on lease liabilities (para 53(b))'])} |
| Expense relating to short-term leases | ${money(d['short-term lease expense (para 53(c))'])} |
| Expense relating to leases of low-value assets | ${money(d['low-value lease expense (para 53(d))'])} |

Total cash outflow for leases in the year: ${money(d['total cash outflow for leases (para 53(g))'])}.

## Accounting policy (adapt to the entity)

The entity recognises a right-of-use asset and a lease liability at the commencement date of each lease, other than short-term leases and leases of low-value assets, which are expensed on a straight-line basis. The lease liability is measured at the present value of the lease payments not yet paid, discounted at the entity's incremental borrowing rate. The right-of-use asset is measured at cost, comprising the initial lease liability, initial direct costs and the estimated cost of restoration, less lease incentives received, and is depreciated on a straight-line basis over the lease term. The liability is remeasured when payments change with an index or a market rent review, or when the assessment of an option changes.
`;
  return { file: writeDraft(`lease-note-${d.entity}-${d.year.slice(-10)}`, text), entity: d.entity, year: d.year };
}

// ---------------------------------------------------------------- import from Visual Lease

// Visual Lease reports export to Excel or CSV with the columns the report was set up with.
// These are the usual headings; --map=columns.json overrides any.
export const VISUAL_LEASE_FIELDS = {
  leases: {
    source_id: ['Lease ID', 'Lease Number', 'VL Lease ID', 'Record ID'],
    reference: ['Lease Name', 'Lease Code', 'Location Code', 'Store Number'],
    entity: ['Legal Entity', 'Entity', 'Tenant Entity', 'Company'],
    lessor: ['Landlord', 'Lessor', 'Landlord Name'],
    description: ['Lease Description', 'Location Name', 'Property Name', 'Description'],
    address: ['Address', 'Street Address', 'Property Address'],
    state: ['State', 'State/Province', 'Region'],
    asset_type: ['Asset Type', 'Lease Type', 'Asset Class'],
    commencement_on: ['Commencement Date', 'Lease Commencement', 'Start Date'],
    expiry_on: ['Expiration Date', 'Lease Expiration', 'End Date'],
    rent: ['Base Rent', 'Current Base Rent', 'Rent Amount'],
    frequency: ['Payment Frequency', 'Rent Frequency', 'Frequency'],
    rate: ['Discount Rate', 'Incremental Borrowing Rate', 'IBR'],
  },
  payments: {
    source_id: ['Lease ID', 'Lease Number', 'VL Lease ID', 'Record ID'],
    from_on: ['Start Date', 'Effective Date', 'Payment Start'],
    amount: ['Amount', 'Payment Amount', 'Rent Amount'],
    type: ['Payment Type', 'Expense Type', 'Charge Type'],
  },
};
const FREQ_MAP = { monthly: 'monthly', month: 'monthly', quarterly: 'quarterly', quarter: 'quarterly', annually: 'annually', annual: 'annually', yearly: 'annually' };
const CLASS_MAP = { 'real estate': 'property', property: 'property', building: 'property', office: 'property', retail: 'property', vehicle: 'vehicles', vehicles: 'vehicles', fleet: 'vehicles', equipment: 'equipment', 'it equipment': 'equipment' };

async function importVisualLease(db, o, actor) {
  const report = oneOf(o.report ?? 'leases', ['leases', 'payments'], '--report');
  const fields = VISUAL_LEASE_FIELDS[report];
  const rows = parseCsv(fs.readFileSync(required(o, 'file'), 'utf8'));
  if (!rows.length) throw Error('The CSV has no rows');
  let map = {};
  if (o.map) {
    map = JSON.parse(fs.readFileSync(required(o, 'map'), 'utf8'));
    for (const [k, v] of Object.entries(map)) if (!(k in fields) || typeof v !== 'string' || !v.trim()) throw Error(`Unknown or empty map field: ${k}`);
    for (const col of Object.values(map)) if (!Object.keys(rows[0]).some((h) => h.toLowerCase() === col.toLowerCase())) throw Error(`Mapped column not in the file: ${col}`);
  }
  const read = (row, k) => String(map[k] ? pick(row, map[k]) : pick(row, ...fields[k])).trim();
  const country = oneOf(String(o.country ?? 'NZ').toUpperCase(), ['AU', 'NZ'], '--country');
  if (report === 'payments') return importPayments(db, rows, read, o, actor);
  const seen = new Set();
  const input = rows.map((row, i) => {
    const line = `Row ${i + 2}`;
    const source_id = read(row, 'source_id'); const entity = read(row, 'entity'); const description = read(row, 'description') || read(row, 'address');
    if (!source_id || !entity || !description) throw Error(`${line}: a lease id, an entity and a description or address are required. Map your headings with --map.`);
    if (seen.has(source_id.toLowerCase())) throw Error(`${line}: lease ${source_id} appears twice`);
    seen.add(source_id.toLowerCase());
    const freqRaw = read(row, 'frequency').toLowerCase();
    const frequency = freqRaw ? FREQ_MAP[freqRaw] : 'monthly';
    if (!frequency) throw Error(`${line}: payment frequency "${read(row, 'frequency')}" is not one this import knows (monthly, quarterly, annually)`);
    const typeRaw = read(row, 'asset_type').toLowerCase();
    const asset_class = typeRaw ? (CLASS_MAP[typeRaw] ?? 'other') : 'property';
    const state = read(row, 'state').toUpperCase();
    const sorted = Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
    const data = {
      source_id, reference: read(row, 'reference') || source_id, description, address: read(row, 'address'), state: STATES.includes(state) ? state : (country === 'NZ' ? 'NZ' : ''),
      asset_class, commencement_on: date(read(row, 'commencement_on'), `${line} commencement date`, false), expiry_on: date(read(row, 'expiry_on'), `${line} expiration date`, false),
      payment_frequency: frequency, discount_rate_pct: read(row, 'rate') ? pct(read(row, 'rate'), `${line} discount rate`) : null, source_row: row,
    };
    data.term_end_on = data.expiry_on;
    data.source_hash = createHash('sha256').update(JSON.stringify({ ...data, source_row: sorted })).digest('hex');
    return { data, entity, lessor: read(row, 'lessor'), rent: read(row, 'rent') ? amount(read(row, 'rent'), `${line} base rent`) : null, line };
  });
  return transaction(db, async () => {
    let added = 0; let unchanged = 0; const entitiesAdded = []; const lessorsAdded = [];
    for (const { data, entity, lessor, rent, line } of input) {
      const old = (await db.query('select source_hash from leases where source_id = $1', [data.source_id]))[0];
      if (old) {
        if (old.source_hash !== data.source_hash) throw Error(`Lease ${data.source_id} changed in Visual Lease since the last import. Reconcile it by hand before importing again.`);
        unchanged++; continue;
      }
      let e = (await db.query('select * from entities where lower(name) = lower($1) or lower(code) = lower($1)', [entity]))[0];
      if (!e) {
        let code = entity.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 10) || 'ENTITY';
        while ((await db.query('select 1 from entities where lower(code) = lower($1)', [code])).length) code = `${code.slice(0, 10)}X`;
        e = await insert(db, 'entities', { code, name: entity, country, currency: country === 'AU' ? 'AUD' : 'NZD', year_end_month: country === 'AU' ? 6 : 3 });
        entitiesAdded.push(`${code} ${entity}`);
      }
      let lessorId = null;
      if (lessor) {
        let x = (await db.query('select id from lessors where lower(name) = lower($1)', [lessor]))[0];
        if (!x) { x = await insert(db, 'lessors', { name: lessor }); lessorsAdded.push(lessor); }
        lessorId = x.id;
      }
      if ((await db.query('select 1 from leases where lower(reference) = lower($1)', [data.reference])).length) throw Error(`${line}: a lease called ${data.reference} is already here. Map a unique reference column.`);
      const l = await insert(db, 'leases', { ...data, entity_id: e.id, lessor_id: lessorId });
      if (rent !== null) await db.query('insert into payment_steps (lease_id, from_on, amount, reason) values ($1, $2, $3, $4)', [l.id, l.commencement_on, rent, 'imported base rent']);
      await note(db, l.id, actor, 'import', 'Imported from a Visual Lease report. Original columns kept on the record.');
      added++;
    }
    return { report: 'leases', added, unchanged, entities_added: entitiesAdded.join(', ') || 'none', lessors_added: lessorsAdded.join(', ') || 'none', dry_run: Boolean(o['dry-run']),
      next: 'Import the rent schedule next (--report=payments). Then set any missing discount rates, add options and reviews, run measure on each lease and have a second person approve. See docs/replace-visual-lease.md.' };
  }, Boolean(o['dry-run']));
}

async function importPayments(db, rows, read, o, actor) {
  const input = rows.map((row, i) => {
    const line = `Row ${i + 2}`;
    const source_id = read(row, 'source_id');
    if (!source_id) throw Error(`${line}: a lease id is required. Map your headings with --map.`);
    return { source_id, from_on: date(read(row, 'from_on'), `${line} start date`, false), amount: amount(read(row, 'amount'), `${line} amount`), type: read(row, 'type'), line };
  });
  return transaction(db, async () => {
    let added = 0; let unchanged = 0; let skipped = 0;
    for (const p of input) {
      if (p.type && !/base|rent|minimum|fixed/i.test(p.type)) { skipped++; continue; }
      const l = (await db.query('select * from leases where lower(source_id) = lower($1) or lower(reference) = lower($1)', [p.source_id]))[0];
      if (!l) throw Error(`${p.line}: lease ${p.source_id} is not here. Import the lease report first.`);
      const had = (await db.query('select amount from payment_steps where lease_id = $1 and from_on = $2', [l.id, p.from_on]))[0];
      if (had && num(had.amount) === p.amount) { unchanged++; continue; }
      if (had) throw Error(`${p.line}: ${l.reference} already has a different rent from ${p.from_on}. Reconcile it by hand.`);
      await insert(db, 'payment_steps', { lease_id: l.id, from_on: p.from_on, amount: p.amount, reason: 'imported rent schedule' });
      added++;
    }
    return { report: 'payments', rent_steps_added: added, unchanged, skipped_not_base_rent: skipped, dry_run: Boolean(o['dry-run']),
      next: 'Outgoings, GST and variable charges are skipped: they are not lease payments under AASB 16 para 27. Run measure on each lease next.' };
  }, Boolean(o['dry-run']));
}

// ---------------------------------------------------------------- dispatch

const OPTIONS = {
  entities: [], lessors: [], leases: ['entity', 'class', 'status'], lease: ['lease'], schedule: ['lease', 'from', 'to'], balances: ['as-at', 'entity'], maturity: ['as-at', 'entity'],
  'month-end': ['entity', 'month', 'detail'], disclosure: ['entity', 'year'], 'critical-dates': ['days'], reviews: ['all'], options: ['entity'], attention: [], compliance: [], 'weekly-review': [], notes: ['lease', 'limit'],
  'add-entity': ['code', 'name', 'country', 'currency', 'year-end-month'], 'add-lessor': ['name', 'contact', 'email', 'phone'],
  'add-lease': ['reference', 'entity', 'description', 'commencement', 'expiry', 'rent', 'lessor', 'class', 'address', 'state', 'retail', 'term-end', 'frequency', 'timing', 'review', 'increase', 'review-every', 'rate', 'idc', 'incentives', 'make-good', 'make-good-estimate', 'guarantee', 'guarantee-expires', 'exemption', 'asset-value', 'owner'],
  'update-lease': ['lease', 'description', 'address', 'owner', 'lessor', 'make-good-estimate', 'guarantee', 'guarantee-expires', 'asset-value', 'rate'],
  'add-option': ['lease', 'kind', 'term-months', 'exercise-from', 'exercise-by', 'reasonably-certain'], 'add-review': ['lease', 'on', 'kind'], 'landlord-notice': ['option', 'lease', 'on'],
  measure: ['lease'], approve: ['measurement'], 'record-review': ['review', 'cpi', 'amount', 'dry-run'], 'exercise-option': ['option', 'decision', 'rate', 'date', 'ends-on', 'dry-run'],
  terminate: ['lease', 'on', 'payment', 'dry-run'], 'end-lease': ['lease'], 'close-month': ['entity', 'month'], log: ['lease', 'note', 'kind'],
  'draft-option-notice': ['option'], 'draft-disclosure': ['entity', 'year'], import: ['file', 'map', 'dry-run', 'report', 'country'], export: [],
};
const FLAGS = ['json', 'dry-run', 'all', 'detail', 'retail', 'make-good', 'reasonably-certain'];
const DRY = ['record-review', 'exercise-option', 'terminate'];

export async function run(db, argv) {
  const { o, p } = args(argv);
  const command = p[0] || 'help';
  if (!(command in commands)) throw Error(`Unknown command "${command}". Run help.`);
  if (command === 'help') return Object.entries(commands).map(([name, usage]) => ({ command: name, usage }));
  const allowed = [...OPTIONS[command], 'json', ...(command in WRITES || command === 'import' ? ['actor'] : [])];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw Error(`Unknown option --${k} for ${command}`);
  for (const k of FLAGS) if (Object.hasOwn(o, k) && o[k] !== true) throw Error(`--${k} takes no value`);
  if (p.length > (command === 'import' ? 2 : 1)) throw Error('Unexpected extra argument');

  if (command in READS) return READS[command](db, o);
  if (command === 'draft-option-notice') return draftOptionNotice(db, o);
  if (command === 'draft-disclosure') return draftDisclosure(db, o);
  if (command === 'export') {
    const backup = { format: 'lease-accounting-for-claude-code/v1', exported_at: new Date().toISOString(), records: {} };
    for (const t of TABLES) backup.records[t] = await db.query(`select * from ${t} order by 1`);
    const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'exports');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `lease-accounting-${today()}-${randomUUID().slice(0, 8)}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2) + '\n', { flag: 'wx' });
    return { file, leases: backup.records.leases.length, measurements: backup.records.measurements.length, schedule_rows: backup.records.schedule.length };
  }
  const actor = required(o, 'actor');
  if (command === 'import') {
    if (p[1] !== 'visual-lease') throw Error('Supported import: visual-lease');
    return importVisualLease(db, o, actor);
  }
  return transaction(db, () => WRITES[command](db, o, actor), DRY.includes(command) && Boolean(o['dry-run']));
}

// ---------------------------------------------------------------- output

const HIDE = new Set(['entity_id', 'lessor_id', 'lease_id', 'measurement_id', 'source_row', 'source_hash', 'created_at', 'updated_at']);
export function human(result) {
  if (Array.isArray(result)) {
    if (!result.length) return '  (none)';
    const cols = Object.keys(result[0]).filter((k) => !HIDE.has(k) && result.some((r) => r[k] !== undefined));
    return table(result, cols.map((key) => ({ key, label: key, width: ['finding', 'why', 'note', 'usage', 'detail', 'basis'].includes(key) ? 130 : 60,
      align: result.every((r) => r[key] === '' || r[key] === null || r[key] === undefined || (typeof r[key] === 'number') || /^-?\d+(\.\d+)?$/.test(String(r[key]))) && !/(_on|period_no|^id$)/.test(key) ? 'right' : 'left',
      format: (v) => (key === 'id' ? String(v ?? '').slice(0, 8) : v && typeof v === 'object' ? JSON.stringify(v) : v === true ? 'yes' : v === false ? 'no' : String(v ?? '')) })));
  }
  if (result && typeof result === 'object') {
    return Object.entries(result).map(([k, v]) => (v && typeof v === 'object' ? `\n${k}\n${'='.repeat(k.length)}\n${human(Array.isArray(v) ? v : [v])}\n` : `${k}: ${v ?? ''}`)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return String(result);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  try {
    db = await getDb();
    const result = await run(db, process.argv.slice(2));
    console.log(process.argv.includes('--json') ? JSON.stringify(result, null, 2) : human(result));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
