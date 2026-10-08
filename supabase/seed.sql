-- Demo data: a fictional dental group with clinics in New Zealand, Victoria, New South Wales and
-- Queensland, a support office, a scanner, a car, a storage unit and a printer on lease.
-- Every name, address and amount is invented. Dates are relative to the first day of this month,
-- so the CPI review nobody recorded, the option deadline in six weeks, the guarantee about to
-- expire and the lease still running past its term are always there.
-- scripts/seed.mjs then adds the rent steps and reviews, measures each lease and approves it.
-- Safe to run twice: every row has a fixed id.

insert into entities (id, code, name, country, currency, year_end_month) values
('e0000000-0000-0000-0000-000000000001','HDG-NZ','Harbourside Dental Ltd','NZ','NZD',3),
('e0000000-0000-0000-0000-000000000002','HDG-AU','Harbourside Dental Pty Ltd','AU','AUD',6)
on conflict do nothing;

insert into lessors (id, name, contact_name, email, phone) values
('10000000-0000-0000-0000-000000000001','Ponsonby Road Holdings Ltd','Grace Liu','grace@ponsonbyholdings.example.co.nz','09 555 0101'),
('10000000-0000-0000-0000-000000000002','Albany Village Trust','Rob Hartley','rob@albanyvillage.example.co.nz','09 555 0102'),
('10000000-0000-0000-0000-000000000003','Lambton Quay Property Ltd','Anika Shah','leasing@lambtonquay.example.co.nz','04 555 0103'),
('10000000-0000-0000-0000-000000000004','Swan Street Plaza Pty Ltd','Tom Nguyen','tom@swanstplaza.example.com.au','03 5550 0104'),
('10000000-0000-0000-0000-000000000005','Church Street Centre Pty Ltd','Fiona Kelly','fiona@churchstcentre.example.com.au','02 5550 0105'),
('10000000-0000-0000-0000-000000000006','Southern Cross Equipment Finance Pty Ltd','Accounts','accounts@scef.example.com.au','1300 555 106'),
('10000000-0000-0000-0000-000000000007','Kauri Fleet Leasing Ltd','Fleet desk','fleet@kaurifleet.example.co.nz','0800 555 107'),
('10000000-0000-0000-0000-000000000008','Onehunga Self Storage Ltd','Front desk','hello@onehungastorage.example.co.nz','09 555 0108'),
('10000000-0000-0000-0000-000000000009','Copytech NZ Ltd','Accounts','accounts@copytech.example.co.nz','0800 555 109'),
('10000000-0000-0000-0000-000000000010','Fortitude Valley Developments Pty Ltd','Sophie Grant','sophie@fvdev.example.com.au','07 5550 0110'),
('10000000-0000-0000-0000-000000000011','Riccarton Medical Centre Ltd','Hamish Bell','hamish@riccartonmed.example.co.nz','03 555 0111')
on conflict do nothing;

-- m(n) = the first day of the month n months from this one.
insert into leases (id, reference, entity_id, lessor_id, asset_class, description, address, state, retail, commencement_on, expiry_on, term_end_on,
  payment_frequency, payment_timing, review_kind, fixed_increase_pct, review_every_months, discount_rate_pct, initial_direct_costs, incentives,
  make_good_clause, make_good_estimate, bank_guarantee, guarantee_expires_on, exemption, asset_value_new, owner)
select v.id::uuid, v.ref, v.entity::uuid, v.lessor::uuid, v.class, v.description, v.address, v.state, v.retail,
  (date_trunc('month', current_date) + make_interval(months => v.start_m))::date,
  (date_trunc('month', current_date) + make_interval(months => v.start_m + v.term_m) - interval '1 day')::date,
  (date_trunc('month', current_date) + make_interval(months => v.start_m + v.term_m) - interval '1 day')::date,
  v.freq, v.timing, v.review, v.increase, v.every, v.rate, v.idc, v.incentives, v.mg_clause, v.mg_estimate, v.guarantee,
  case when v.guarantee_days is null then null else current_date + v.guarantee_days end, v.exemption, v.asset_value, v.owner
from (values
  ('a0000000-0000-0000-0000-000000000001','L-01','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','property','Ponsonby clinic','212 Ponsonby Road, Auckland','NZ',false,-26,72,'monthly','advance','cpi',null::numeric,12,6.8,4500.00,0.00,true,25000.00,0.00,null::int,'none',null::numeric,'Mere Tane'),
  ('a0000000-0000-0000-0000-000000000002','L-02','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','property','Albany clinic','Unit 4, 18 Library Lane, Albany, Auckland','NZ',false,-54,72,'monthly','advance','fixed',3.0,12,5.9,0.00,12000.00,true,18000.00,0.00,null,'none',null,'Mere Tane'),
  ('a0000000-0000-0000-0000-000000000003','L-03','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','property','Support office','Level 6, 99 Lambton Quay, Wellington','NZ',false,-20,60,'monthly','advance','market',null,36,7.1,3000.00,0.00,true,null,0.00,null,'none',null,'James Okafor'),
  ('a0000000-0000-0000-0000-000000000004','L-04','e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','property','Richmond clinic','Shop 3, 410 Swan Street, Richmond VIC','VIC',true,-57,60,'monthly','advance','fixed',3.5,12,6.2,0.00,0.00,true,30000.00,30000.00,40,'none',null,'Liam Walsh'),
  ('a0000000-0000-0000-0000-000000000005','L-05','e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000005','property','Parramatta clinic','Shop 12, 150 Church Street, Parramatta NSW','NSW',true,-55,60,'monthly','advance','fixed',4.0,12,6.0,0.00,0.00,true,28000.00,25000.00,400,'none',null,'Liam Walsh'),
  ('a0000000-0000-0000-0000-000000000006','L-06','e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000006','equipment','CBCT scanner, Richmond','Shop 3, 410 Swan Street, Richmond VIC','VIC',false,-14,48,'monthly','arrears','none',null,12,8.5,0.00,0.00,false,null,0.00,null,'none',null,'Liam Walsh'),
  ('a0000000-0000-0000-0000-000000000007','L-07','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000007','vehicles','Toyota RAV4 hybrid, practice manager','','NZ',false,-10,36,'monthly','advance','none',null,12,9.2,0.00,0.00,false,null,0.00,null,'none',null,'Mere Tane'),
  ('a0000000-0000-0000-0000-000000000008','L-08','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000008','property','Records storage unit','Unit 41, 7 Neilson Street, Onehunga','NZ',false,-3,9,'monthly','advance','none',null,12,null,0.00,0.00,false,null,0.00,null,'short-term',null,'Mere Tane'),
  ('a0000000-0000-0000-0000-000000000009','L-09','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','equipment','Reception printer, Ponsonby','212 Ponsonby Road, Auckland','NZ',false,-8,36,'quarterly','advance','none',null,12,null,0.00,0.00,false,null,0.00,null,'low-value',3200.00,'Mere Tane'),
  ('a0000000-0000-0000-0000-000000000010','L-10','e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000010','property','Site office during the Brisbane fit-out','22 Ann Street, Fortitude Valley QLD','QLD',false,-6,24,'monthly','advance','none',null,12,null,0.00,0.00,false,null,0.00,null,'short-term',null,'Liam Walsh'),
  ('a0000000-0000-0000-0000-000000000011','L-11','e0000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000010','property','Fortitude Valley clinic','Ground floor, 22 Ann Street, Fortitude Valley QLD','QLD',false,0,84,'monthly','advance','cpi',null,12,6.4,6500.00,40000.00,true,45000.00,60000.00,2555,'none',null,'Liam Walsh'),
  ('a0000000-0000-0000-0000-000000000012','L-12','e0000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000011','property','Riccarton clinic','Suite 2, 123 Riccarton Road, Christchurch','NZ',false,-61,60,'monthly','advance','none',null,12,5.2,0.00,0.00,true,15000.00,0.00,null,'none',null,'Mere Tane')
) as v(id, ref, entity, lessor, class, description, address, state, retail, start_m, term_m, freq, timing, review, increase, every, rate, idc, incentives, mg_clause, mg_estimate, guarantee, guarantee_days, exemption, asset_value, owner)
on conflict do nothing;

-- The rent at commencement. Fixed increases and CPI reviews are added by scripts/seed.mjs.
insert into payment_steps (lease_id, from_on, amount, reason)
select l.id, l.commencement_on, v.rent, 'commencement'
from (values ('L-01',9500.00),('L-02',7200.00),('L-03',11800.00),('L-04',8900.00),('L-05',10400.00),('L-06',2350.00),
  ('L-07',890.00),('L-08',420.00),('L-09',360.00),('L-10',3100.00),('L-11',9800.00),('L-12',6100.00)) as v(ref, rent)
join leases l on l.reference = v.ref
on conflict do nothing;

insert into options (id, lease_id, kind, term_months, exercise_from, exercise_by, reasonably_certain) values
('b1000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','renewal',72,null,(date_trunc('month', current_date) + interval '40 months')::date,false),
('b2000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000002','renewal',60,current_date - 140,current_date + 45,false),
('b4000000-0000-0000-0000-000000000004','a0000000-0000-0000-0000-000000000004','renewal',60,current_date - 100,current_date + 75,false),
('bb000000-0000-0000-0000-000000000011','a0000000-0000-0000-0000-000000000011','renewal',84,null,(date_trunc('month', current_date) + interval '78 months')::date,false)
on conflict do nothing;

insert into lease_notes (id, lease_id, author, kind, note, created_at) values
('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','Mere Tane','call','Rob at Albany Village says they would like us to stay and will hold the rent at the fixed 3% for the option term. Board to decide at the next meeting.',now() - interval '12 days'),
('d0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000012','Mere Tane','email','Hamish at Riccarton is drafting a new two year lease. We are staying month to month on the old rent until it is signed.',now() - interval '9 days'),
('d0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000004','Liam Walsh','note','The bank guarantee renews annually. Ask the bank for the renewal letter before it lapses.',now() - interval '30 days')
on conflict do nothing;
