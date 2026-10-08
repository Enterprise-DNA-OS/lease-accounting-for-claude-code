#!/usr/bin/env node
// Loads supabase/seed.sql (a fictional dental group), then does what the finance team would have
// done by now: rent steps and reviews on file, every lease measured by one person and approved by
// another, last year's CPI review on the Ponsonby clinic recorded, and the Australian entity's
// last month closed. The Fortitude Valley clinic started this month and waits for its approval.
// Safe to run twice.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { run, addSteps, addReviews, addMonths } from './lease.mjs';

const PREPARER = { 'HDG-NZ': 'Mere Tane', 'HDG-AU': 'Liam Walsh' };
const APPROVER = 'James Okafor';

export async function seed(db) {
  await db.exec('begin');
  try {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase', 'seed.sql'), 'utf8'));
    await db.exec('commit');
  } catch (e) {
    await db.exec('rollback');
    throw e;
  }
  const leases = await db.query("select l.*, e.code as entity from leases l join entities e on e.id = l.entity_id where l.id::text like 'a0000000-%' order by l.reference");
  for (const l of leases) {
    const first = (await db.query('select amount from payment_steps where lease_id = $1 order by from_on limit 1', [l.id]))[0];
    await addSteps(db, l, Number(first.amount), l.commencement_on);
    await addReviews(db, l, l.review_every_months);
  }
  for (const l of leases) {
    if (l.exemption !== 'none') continue;
    if ((await db.query('select 1 from measurements where lease_id = $1', [l.id])).length) continue;
    await run(db, ['measure', `--lease=${l.reference}`, `--actor=${PREPARER[l.entity]}`]);
    if (l.reference !== 'L-11') await run(db, ['approve', `--measurement=${l.reference}`, `--actor=${APPROVER}`]);
  }
  // Last year's CPI review on the Ponsonby clinic, recorded and approved.
  const review = (await db.query("select r.id from rent_reviews r join leases l on l.id = r.lease_id where l.reference = 'L-01' and r.new_amount is null order by r.effective_on limit 1"))[0];
  const ponsonby = leases.find((l) => l.reference === 'L-01');
  if (review && ponsonby && (await db.query('select 1 from rent_reviews where id = $1 and effective_on = $2', [review.id, addMonths(ponsonby.commencement_on, 12)])).length) {
    await run(db, ['record-review', `--review=${review.id}`, '--cpi=4.1', '--actor=Mere Tane']);
    await run(db, ['approve', '--measurement=L-01', `--actor=${APPROVER}`]);
  }
  const lastMonth = addMonths(new Date().toISOString().slice(0, 8) + '01', -1).slice(0, 7);
  const au = (await db.query("select id from entities where code = 'HDG-AU'"))[0];
  if (au && !(await db.query('select 1 from month_closes where entity_id = $1', [au.id])).length) {
    await run(db, ['close-month', '--entity=HDG-AU', `--month=${lastMonth}`, `--actor=${APPROVER}`]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const db = await getDb();
  try {
    await seed(db);
    console.log('Demo dental group loaded (existing records kept).');
  } finally {
    await db.close();
  }
}
