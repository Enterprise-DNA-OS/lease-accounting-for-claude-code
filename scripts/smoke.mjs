#!/usr/bin/env node
// npm test: a temp database, migrate, seed, every command, the arithmetic, the rules and the gates.
// Prints PASS. TEST_DATABASE_URL runs the same checks against a real, empty, disposable Postgres.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, commands, resolve, date, amount, human, addMonths, addDays, periodsIn, periodFrom, monthlyRate, paymentsFor, presentValue, buildSchedule } from './lease.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lease-test-'));
process.env.DATA_DIR = path.join(dir, 'db');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.OUTPUT_DIR = dir;

let db;
const visited = new Set();
const call = (c, o = {}, p = []) => {
  visited.add(c);
  return run(db, [c, ...p, ...Object.entries(o).map(([k, v]) => (v === true ? `--${k}` : `--${k}=${v}`))]);
};
const fails = (c, o, re, p = []) => assert.rejects(() => call(c, o, p), re);
const shell = (file, argv = []) => {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', file), ...argv], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
};
const today = new Date().toISOString().slice(0, 10);
const m0 = today.slice(0, 8) + '01';
const lastMonth = addMonths(m0, -1).slice(0, 7);
const prep = { actor: 'Mere Tane' };
const boss = { actor: 'James Okafor' };
const rules = async () => (await call('compliance')).map((r) => `${r.rule} ${r.record}`).sort();
const near = (a, b, tol = 0.011) => assert(Math.abs(Number(a) - Number(b)) <= tol, `${a} is not ${b}`);
const sum = (rows, k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
// The ledger must agree with the schedule: the liability and asset accounts, summed over every
// journal up to a month end, equal the balances the schedule gives at that date.
async function ledgerTiesOut(entity, monthEnd) {
  const lines = await db.query('select account, sum(amount) as total from journal_lines where entity = $1 and month <= $2 group by account', [entity, monthEnd]);
  const acct = (k) => Number(lines.find((l) => l.account === k)?.total || 0);
  const bal = await call('balances', { 'as-at': monthEnd, entity });
  const t = bal.find((r) => r.reference === 'TOTAL') || { liability: 0, right_of_use: 0 };
  near(-acct('lease_liability'), t.liability, 0.05);
  near(acct('rou_asset') + acct('rou_accum_dep'), t.right_of_use, 0.05);
}

try {
  db = await getDb();
  if (db.mode === 'postgres') assert.equal((await db.query("select tablename from pg_tables where schemaname = 'public'")).length, 0, 'TEST_DATABASE_URL must be an empty, disposable database');
  assert.equal((await migrate(db)).ran.length, 1);
  assert.equal((await migrate(db)).ran.length, 0, 'migrate is safe to rerun');
  await seed(db);
  const counts = async () => (await db.query('select (select count(*) from leases)::int as l, (select count(*) from measurements)::int as m, (select count(*) from schedule)::int as s, (select count(*) from payment_steps)::int as p, (select count(*) from rent_reviews)::int as r')) [0];
  const once = await counts();
  await seed(db);
  assert.deepEqual(await counts(), once, 'seed is idempotent');
  assert.equal(once.l, 12);

  // ---------------------------------------------------------------- the arithmetic
  assert.equal(addMonths('2025-01-31', 1), '2025-02-28');
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29');
  assert.equal(addMonths('2025-03-31', -1), '2025-02-28');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(periodsIn('2025-07-01', '2030-06-30'), 60, 'a five-year lease is 60 monthly periods');
  assert.equal(periodsIn('2025-07-15', '2025-08-20'), 2, 'a part month counts as a period');
  assert.equal(periodFrom('2025-07-01', '2026-07-01'), 12);
  assert.equal(periodFrom('2025-07-01', '2026-07-02'), 13, 'a change mid-period starts at the next period');
  near(Math.pow(1 + monthlyRate(6), 12), 1.06, 1e-12);
  // Present value against the annuity formula: 60 payments of 1,000 at 6% a year.
  const lease = { commencement_on: '2025-07-01', term_end_on: '2030-06-30', payment_frequency: 'monthly', payment_timing: 'arrears' };
  const i = monthlyRate(6);
  const annuity = 1000 * (1 - Math.pow(1 + i, -60)) / i;
  const arrears = paymentsFor(lease, [{ from_on: '2025-07-01', amount: 1000 }]);
  near(presentValue(arrears, 6, 'arrears'), annuity);
  const advance = paymentsFor({ ...lease, payment_timing: 'advance' }, [{ from_on: '2025-07-01', amount: 1000 }]);
  near(presentValue(advance, 6, 'advance'), annuity * (1 + i), 0.02);
  assert.equal(presentValue(arrears, 0, 'arrears'), 60000, 'at a zero rate the liability is the sum of the payments');
  const quarterly = paymentsFor({ ...lease, payment_frequency: 'quarterly', payment_timing: 'advance' }, [{ from_on: '2025-07-01', amount: 3000 }]);
  assert.equal(quarterly.filter((p) => p.payment).length, 20);
  assert.deepEqual(quarterly.slice(0, 4).map((p) => p.payment), [3000, 0, 0, 3000]);
  const qArrears = paymentsFor({ ...lease, payment_frequency: 'quarterly' }, [{ from_on: '2025-07-01', amount: 3000 }]);
  assert.equal(qArrears[2].paid_on, '2025-09-30', 'quarterly in arrears is paid on the last day of the quarter');
  const stepped = paymentsFor(lease, [{ from_on: '2025-07-01', amount: 1000 }, { from_on: '2026-07-01', amount: 1030 }]);
  assert.equal(stepped[11].payment, 1000); assert.equal(stepped[12].payment, 1030);
  for (const [pays, timing] of [[arrears, 'arrears'], [advance, 'advance'], [stepped, 'arrears']]) {
    const pv = presentValue(pays, 6, timing);
    const rows = buildSchedule(pays, 6, timing, pv, pv + 2500);
    assert.equal(rows.at(-1).closing, 0, 'the liability runs to zero');
    assert.equal(rows.at(-1).rou_closing, 0, 'the asset runs to zero');
    near(sum(rows, 'depreciation'), pv + 2500, 0.001);
    near(sum(rows, 'interest'), sum(pays, 'payment') - pv, 0.001);
  }

  // ---------------------------------------------------------------- inputs and matching
  assert.equal(date('31/03/2026'), '2026-03-31', 'AU and NZ dates are day first');
  assert.throws(() => date('2026-02-30'), /real date/);
  assert.equal(amount('$12,500.50'), 12500.5);
  assert.throws(() => amount('-5'), /positive amount/);
  assert.equal((await resolve(db, 'leases', 'l-02')).description, 'Albany clinic');
  assert.equal((await resolve(db, 'leases', 'riccarton')).reference, 'L-12');
  assert.equal((await resolve(db, 'entities', 'nz')).code, 'HDG-NZ');
  await assert.rejects(() => resolve(db, 'leases', 'clinic'), /matches more than one/);
  await assert.rejects(() => resolve(db, 'leases', 'nowhere'), /No leases matches/);

  // ---------------------------------------------------------------- reads
  for (const c of ['help', 'entities', 'lessors', 'leases', 'balances', 'maturity', 'critical-dates', 'reviews', 'options', 'attention', 'compliance', 'notes']) {
    assert(Array.isArray(await call(c)), c);
  }
  assert.equal((await call('leases', { entity: 'HDG-AU' })).length, 5);
  assert.equal((await call('leases', { class: 'property', status: 'all' })).length, 9);
  assert.equal((await call('leases')).find((r) => r.reference === 'L-11').measurement, 'awaiting approval');
  const one = await call('lease', { lease: 'L-01' });
  assert.equal(one.measurements.length, 2, 'Ponsonby: the first measurement and last year\'s CPI review');
  assert(one.rent_steps.some((s) => s.reason === 'cpi review'));
  const sched = await call('schedule', { lease: 'L-06' });
  assert.equal(sched.length, 48); assert.equal(Number(sched.at(-1).closing), 0);
  assert.equal(sched[0].paid_on, addDays(addMonths(sched[0].period_on, 1), -1), 'the scanner is paid in arrears');
  const steps = (await call('lease', { lease: 'L-02' })).rent_steps;
  assert.equal(steps.length, 6, 'six years of fixed 3% steps on file');
  near(steps[1].amount, 7416);
  assert.equal((await call('options')).length, 4);
  assert.equal((await call('reviews')).length, 11, 'Ponsonby 4, Fortitude Valley 6, the support office market review 1');
  assert.equal((await call('reviews', { all: true })).length, 12);
  const crit = await call('critical-dates', { days: '120' });
  assert(crit.some((r) => r.reference === 'L-01' && r.event === 'rent review' && r.days < 0), 'a missed review stays on the list');
  assert(crit.some((r) => r.reference === 'L-02' && r.event === 'option: last day to exercise'));

  const bal = await call('balances');
  for (const r of bal) near(r.current + r.non_current, r.liability, 0.001);
  assert.equal(bal.find((r) => r.reference === 'L-05').non_current, 0, 'a lease ending within 12 months is all current');
  assert(!bal.some((r) => r.reference === 'L-11'), 'an unapproved measurement is not on the balance sheet');
  for (const m of await call('maturity')) assert(m.interest_still_to_come > 0, `${m.entity}: undiscounted rent exceeds the liability`);

  const auClosed = await call('month-end', { entity: 'HDG-AU', month: lastMonth });
  assert.equal(auClosed.balanced, 'yes'); assert.match(auClosed.status, /closed by James Okafor/);
  for (const e of ['HDG-NZ', 'HDG-AU']) {
    for (let k = -30; k <= 0; k++) {
      const m = addMonths(m0, k).slice(0, 7);
      assert.equal((await call('month-end', { entity: e, month: m })).balanced, 'yes', `${e} ${m} balances`);
    }
  }
  assert((await call('month-end', { entity: 'HDG-NZ', month: lastMonth, detail: true })).some((l) => l.reference === 'L-08' && l.source === 'exempt lease'), 'the storage unit is expensed as paid');
  await ledgerTiesOut('HDG-NZ', addDays(m0, -1));
  await ledgerTiesOut('HDG-AU', addDays(m0, -1));
  await ledgerTiesOut('HDG-NZ', addDays(addMonths(m0, -12), -1));

  const nzNote = await call('disclosure', { entity: 'nz' });
  assert.equal(nzNote.standard, 'NZ IFRS 16 Leases');
  assert.match(nzNote.year, /-04-01 to .*-03-31$/);
  assert(nzNote['interest on lease liabilities (para 53(b))'] > 0);
  const auNote = await call('disclosure', { entity: 'au', year: addMonths(m0, -12).slice(0, 4) });
  assert.match(auNote.year, /-07-01 to .*-06-30$/);
  assert.equal(auNote.standard, 'AASB 16 Leases');
  const liab = auNote['lease liabilities at year end'][0];
  near(liab.current + liab.non_current, liab.total, 0.001);

  // ---------------------------------------------------------------- the rules
  assert.deepEqual(await rules(), [
    'GUARANTEE-EXPIRY L-04', 'HOLDING-OVER L-12', 'MAKE-GOOD-MISSING L-03', 'MEASURE-UNAPPROVED L-11', 'MONTH-NOT-CLOSED HDG-NZ', 'NSW-S44-NOTICE L-05',
    'OPTION-DUE L-02', 'OPTION-DUE L-04', 'REVIEW-NOT-RECORDED L-01', 'SHORT-TERM-INVALID L-10', 'VIC-S28-NOTICE L-04',
  ]);
  const attention = await call('attention');
  assert.equal(attention[0].severity, 1);

  // ---------------------------------------------------------------- the gates
  await fails('approve', { measurement: 'L-11', actor: 'liam walsh' }, /prepared this measurement/);
  await fails('close-month', { entity: 'HDG-NZ', month: lastMonth, ...boss }, /no new rent recorded/);
  await fails('close-month', { entity: 'HDG-AU', month: lastMonth, ...boss }, /already closed/);
  await fails('close-month', { entity: 'HDG-AU', month: m0.slice(0, 7), ...boss }, /has not ended yet/);
  await fails('measure', { lease: 'L-02', ...prep }, /already has an approved measurement/);
  await fails('measure', { lease: 'L-08', ...prep }, /short-term: it is expensed/);
  await fails('update-lease', { lease: 'L-02', rate: '7', ...prep }, /rate is fixed/);
  await fails('add-option', { lease: 'L-02', 'exercise-by': '2030-01-01', 'term-months': '12', 'reasonably-certain': true, ...prep }, /goes through exercise-option/);
  await fails('exercise-option', { option: 'L-02', decision: 'exercise', ...prep }, /--rate/);
  await fails('record-review', { review: 'L-01', ...prep }, /either --cpi/);
  await fails('leases', { colour: 'red' }, /Unknown option --colour/);
  await fails('leases', { all: 'yes' }, /Unknown option --all/);
  await fails('reviews', { all: 'yes' }, /takes no value/);
  await fails('add-lessor', { name: 'X' }, /--actor is required/);
  await fails('import', { file: 'x.csv', ...prep }, /Supported import: visual-lease/, ['pipedrive']);

  // Approve the new clinic: it joins the balance sheet.
  const l11 = await call('approve', { measurement: 'L-11', actor: 'James Okafor' });
  assert(l11.liability > 600000);
  assert(!(await rules()).includes('MEASURE-UNAPPROVED L-11'));
  assert((await call('balances', { entity: 'au' })).some((r) => r.reference === 'L-11'));

  // The CPI review: a test run changes nothing, the real one prepares a remeasurement at the old rate.
  const before = (await call('lease', { lease: 'L-01' })).lease.liability;
  const dry = await call('record-review', { review: 'L-01', cpi: '3.2', 'dry-run': true, ...prep });
  assert.equal(dry.dry_run, true);
  assert.equal((await call('reviews')).filter((r) => r.reference === 'L-01' && r.effective_on <= today).length, 1, 'a dry run records nothing');
  const rev = await call('record-review', { review: 'L-01', cpi: '3.2', ...prep });
  near(rev.rent_after, r2(rev.rent_before * 1.032));
  assert.equal(rev.discount_rate_pct, 6.8, 'a CPI change keeps the original rate');
  assert(rev.liability_change > 0);
  near(rev.right_of_use - rev.right_of_use_before, rev.liability_change);
  assert((await rules()).includes('MEASURE-UNAPPROVED L-01'));
  await fails('close-month', { entity: 'HDG-NZ', month: lastMonth, ...boss }, /waiting for approval/);
  await call('approve', { measurement: 'L-01', ...boss });
  assert.notEqual((await call('lease', { lease: 'L-01' })).lease.liability, before);
  await ledgerTiesOut('HDG-NZ', addDays(m0, -1));
  const closed = await call('close-month', { entity: 'HDG-NZ', month: lastMonth, ...boss });
  assert(closed.lines > 0);
  assert(!(await rules()).includes('MONTH-NOT-CLOSED HDG-NZ'));

  // The Albany option: what if we renew? A test run, then the decision at a revised rate.
  const whatIf = await call('exercise-option', { option: 'L-02', decision: 'exercise', rate: '6.4', 'dry-run': true, ...prep });
  assert.equal(whatIf.lease_term_end_after, addDays(addMonths(addDays(whatIf.lease_term_end_before, 1), 60), -1));
  assert(whatIf.liability > whatIf.liability_before * 2, 'five more years of rent');
  assert.equal((await call('options')).find((x) => x.reference === 'L-02').decision, 'undecided', 'a dry run decides nothing');
  const renewed = await call('exercise-option', { option: 'L-02', decision: 'exercise', rate: '6.4', ...prep });
  assert.equal(renewed.discount_rate_pct, 6.4);
  await call('approve', { measurement: 'L-02', ...boss });
  const albany = await call('lease', { lease: 'L-02' });
  assert.equal(albany.lease.term_end_on, renewed.lease_term_end_after);
  assert.equal(albany.rent_steps.length, 11, 'fixed 3% steps run on into the renewal');
  assert(!(await rules()).some((r) => r.endsWith('L-02')));

  // Richmond: the landlord's s28 notice arrives; Parramatta: the s44 notice.
  await call('landlord-notice', { option: 'L-04', on: today, ...prep });
  await call('landlord-notice', { lease: 'L-05', on: today, ...prep });
  const after = await rules();
  assert(!after.includes('VIC-S28-NOTICE L-04') && !after.includes('NSW-S44-NOTICE L-05'));
  // Richmond: let the option go.
  const lapse = await call('exercise-option', { option: 'L-04', decision: 'not-exercising', ...prep });
  assert.match(lapse.next, /Nothing to remeasure/);
  assert(!(await rules()).includes('OPTION-DUE L-04'));

  // Make good on the support office, after approval: the estimate is kept and the accountant told.
  const mg = await call('update-lease', { lease: 'L-03', 'make-good-estimate': '22000', ...prep });
  assert.match(mg.next, /AASB 137/);
  assert(!(await rules()).includes('MAKE-GOOD-MISSING L-03'));
  // Riccarton ran its term.
  await call('end-lease', { lease: 'L-12', ...prep });
  await fails('end-lease', { lease: 'L-12', ...prep }, /already ended/);
  assert(!(await rules()).includes('HOLDING-OVER L-12'));

  // Terminate the car early: liability and asset come off, the difference is a gain or loss.
  const term = await call('terminate', { lease: 'L-07', on: addDays(addMonths(m0, 2), -1), payment: '1500', ...prep });
  near(term.gain_loss, term.right_of_use_before - term.liability_before + 1500);
  await fails('approve', { measurement: 'L-07', ...prep }, /prepared this measurement/);
  await call('approve', { measurement: 'L-07', ...boss });
  assert.equal((await call('leases', { status: 'terminated' })).length, 1);
  assert.equal(Number((await db.query("select liability from lease_balances($1::date) where lease_id = (select id from leases where reference = 'L-07')", [addMonths(m0, 3)]))[0].liability), 0);
  await ledgerTiesOut('HDG-NZ', addDays(addMonths(m0, 3), -1));
  for (const k of [0, 1, 2, 3]) assert.equal((await call('month-end', { entity: 'nz', month: addMonths(m0, k).slice(0, 7) })).balanced, 'yes');

  // A new lease from scratch: entity, lessor, fixed increases, measured on entry.
  await call('add-entity', { code: 'HDG-WA', name: 'Harbourside Dental WA Pty Ltd', country: 'AU', ...prep });
  await fails('add-entity', { code: 'x', name: 'Bad', ...prep }, /--code/);
  await call('add-lessor', { name: 'Hay Street Mall Pty Ltd', contact: 'Ben Ross', ...prep });
  const perth = await call('add-lease', { reference: 'L-20', entity: 'HDG-WA', lessor: 'hay street', description: 'Perth clinic', commencement: addMonths(m0, 1), expiry: addDays(addMonths(m0, 61), -1),
    rent: '9000', review: 'fixed', increase: '3.5', rate: '6.6', idc: '2000', 'make-good-estimate': '20000', incentives: '15000', state: 'WA', retail: true, owner: 'Liam Walsh', ...prep });
  assert.equal(perth.periods, 60);
  near(perth.right_of_use, perth.liability + 2000 + 20000 - 15000);
  await fails('add-lease', { reference: 'l-20', entity: 'HDG-WA', description: 'Again', commencement: m0, expiry: addMonths(m0, 12), rent: '1', ...prep }, /already exists/);
  await call('add-option', { lease: 'L-20', 'exercise-by': addMonths(m0, 55), 'term-months': '60', 'reasonably-certain': true, ...prep });
  const perth2 = await call('lease', { lease: 'L-20' });
  assert.equal(perth2.lease.term_end_on, addDays(addMonths(m0, 121), -1), 'a reasonably certain renewal is in the lease term');
  assert.equal(perth2.measurements.filter((m) => m.approved_by === 'AWAITING APPROVAL').length, 1, 'the draft was remeasured, not doubled');
  await call('add-review', { lease: 'L-20', on: addMonths(m0, 61), ...prep });
  await fails('add-review', { lease: 'L-20', on: addMonths(m0, 200), ...prep }, /inside the lease term/);
  await call('approve', { measurement: 'L-20', ...boss });
  const sl = await call('add-lease', { reference: 'L-21', entity: 'HDG-WA', description: 'Laptop', class: 'equipment', commencement: m0, expiry: addMonths(m0, 24), rent: '60', exemption: 'low-value', 'asset-value': '9000', ...prep });
  assert.equal(sl.exemption, 'low-value');
  assert((await rules()).includes('LOW-VALUE-INVALID L-21'), 'a laptop worth 9,000 new is above the policy');
  await call('add-lease', { reference: 'L-22', entity: 'HDG-WA', description: 'Car park', commencement: m0, expiry: addMonths(m0, 36), rent: '300', ...prep });
  assert((await rules()).includes('RATE-MISSING L-22'));
  assert((await rules()).includes('MEASURE-MISSING L-22'));
  const rated = await call('update-lease', { lease: 'L-22', rate: '7', ...prep });
  assert(rated.liability > 0, 'setting the rate measures the lease');

  await call('log', { lease: 'L-02', note: 'Board agreed to renew Albany.', kind: 'meeting', ...prep });
  assert.equal((await call('notes', { lease: 'L-02', limit: '1' }))[0].kind, 'meeting');

  // Drafts never send, and carry no em dash.
  const notice = await call('draft-option-notice', { option: 'L-01' });
  const text = fs.readFileSync(notice.file, 'utf8');
  assert.match(text, /Draft only/); assert.match(text, /Ponsonby Road Holdings Ltd/);
  const note = await call('draft-disclosure', { entity: 'HDG-NZ' });
  const noteText = fs.readFileSync(note.file, 'utf8');
  assert.match(noteText, /Maturity analysis/); assert.match(noteText, /NZ IFRS 16/);
  for (const t of [text, noteText]) assert(!t.includes('\u2014'), 'no em dash');

  // Import from Visual Lease: a test run, the leases, the rent schedule, a rerun, a change.
  const portfolio = path.join(REPO_ROOT, 'fixtures', 'visual-lease-portfolio.csv');
  const payments = path.join(REPO_ROOT, 'fixtures', 'visual-lease-rent-schedule.csv');
  const dryImport = await call('import', { file: portfolio, 'dry-run': true, ...prep }, ['visual-lease']);
  assert.equal(dryImport.added, 3); assert.equal((await db.query("select count(*)::int as n from leases where source_id like 'VL-%'"))[0].n, 0);
  await fails('import', { file: payments, report: 'payments', ...prep }, /Import the lease report first/, ['visual-lease']);
  const imported = await call('import', { file: portfolio, ...prep }, ['visual-lease']);
  assert.equal(imported.added, 3); assert.match(imported.lessors_added, /Octagon Chambers/);
  assert.equal((await call('import', { file: portfolio, ...prep }, ['visual-lease'])).unchanged, 3, 'a second import adds nothing');
  const rent = await call('import', { file: payments, report: 'payments', ...prep }, ['visual-lease']);
  assert.equal(rent.rent_steps_added, 1); assert.equal(rent.unchanged, 3); assert.equal(rent.skipped_not_base_rent, 1);
  const dun = await call('lease', { lease: 'DUN-01' });
  assert.equal(dun.rent_steps.length, 2); assert.equal(dun.lease.asset_class, 'property');
  assert.equal((await call('lease', { lease: 'FLEET-02' })).lease.asset_class, 'vehicles');
  assert((await rules()).includes('RATE-MISSING TGA-01'));
  assert((await call('measure', { lease: 'DUN-01', ...prep })).liability > 0);
  const changed = path.join(dir, 'changed.csv');
  fs.writeFileSync(changed, fs.readFileSync(portfolio, 'utf8').replace('7650.00,Monthly,6.9', '7700.00,Monthly,6.9'));
  await fails('import', { file: changed, ...prep }, /changed in Visual Lease/, ['visual-lease']);
  const mapped = path.join(dir, 'mapped.csv');
  fs.writeFileSync(mapped, 'Ref,Co,Site,Start,End,Rent\nX-1,HDG-NZ,Napier clinic,01/01/2026,31/12/2030,5000\n');
  const mapFile = path.join(dir, 'map.json');
  fs.writeFileSync(mapFile, JSON.stringify({ source_id: 'Ref', entity: 'Co', description: 'Site', commencement_on: 'Start', expiry_on: 'End', rent: 'Rent' }));
  assert.equal((await call('import', { file: mapped, map: mapFile, ...prep }, ['visual-lease'])).added, 1);
  fs.writeFileSync(mapFile, JSON.stringify({ colour: 'Ref' }));
  await fails('import', { file: mapped, map: mapFile, ...prep }, /Unknown or empty map field/, ['visual-lease']);

  const backup = await call('export');
  assert(fs.existsSync(backup.file)); assert(backup.leases >= 19);
  const report = await call('weekly-review');
  assert(Array.isArray(report.compliance) && Array.isArray(report.balances_today));
  assert.equal(typeof human(report), 'string');
  assert.equal(typeof human(await call('help')), 'string');

  // The shell entry points, the views and the documents.
  const cli = shell('lease.mjs', ['entities', '--json']);
  assert(JSON.parse(cli).length >= 3);
  const viewsOut = shell('view.mjs');
  assert.match(viewsOut, /views[\\/]week\.html/); assert.match(viewsOut, /views[\\/]register\.html/);
  const docsOut = shell('docs.mjs');
  assert.match(docsOut, /lease-schedule/); assert.match(docsOut, /month-end-journal/); assert.match(docsOut, /critical-dates-report/);
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'lease.mjs'), 'lease', '--lease=clinic'], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 1, 'an ambiguous match exits 1'); assert.match(r.stderr, /matches more than one/);

  const missed = Object.keys(commands).filter((c) => !visited.has(c));
  assert.deepEqual(missed, [], `commands never exercised: ${missed.join(', ')}`);
  console.log(`PASS (${Object.keys(commands).length} commands, ${db.mode})`);
} finally {
  if (db) await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function r2(n) { return Math.round(n * 100) / 100; }
