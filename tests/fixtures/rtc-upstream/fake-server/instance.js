#!/usr/bin/env node
// Each test subprocess has independent memory. Shared mode uses one atomic Postgres counter.
import pg from 'pg';
import { startFakeServer } from './server.js';
const { RTC_TEST_PASSES_JSON, RTC_TEST_LIMIT, RTC_TEST_MODE,
  RTC_TEST_DB_URL, RTC_TEST_SCHEMA } = process.env;
if (!RTC_TEST_PASSES_JSON || !Number.isInteger(Number(RTC_TEST_LIMIT))) process.exit(2);
const passes = JSON.parse(RTC_TEST_PASSES_JSON);
const max = Number(RTC_TEST_LIMIT);
let pool;
let increment;
if (RTC_TEST_MODE === 'postgres') {
  const u = new URL(RTC_TEST_DB_URL || '');
  if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(u.hostname) ||
    !/^hub_test_[a-f0-9]{12}$/.test(RTC_TEST_SCHEMA || '')) process.exit(2);
  pool = new pg.Pool({ connectionString: RTC_TEST_DB_URL,
    options: '-c search_path=' + RTC_TEST_SCHEMA, max: 5 });
  await pool.query('CREATE TABLE IF NOT EXISTS rtc_fake_limits (token TEXT PRIMARY KEY, used INTEGER NOT NULL)');
  increment = async (token) => {
    const r = await pool.query('INSERT INTO rtc_fake_limits (token, used) VALUES ($1, 1) ' +
      'ON CONFLICT (token) DO UPDATE SET used = rtc_fake_limits.used + 1 RETURNING used', [token]);
    return r.rows[0].used;
  };
}
const fake = await startFakeServer({ passes, rateLimit: { max, increment } });
process.stdout.write(fake.url + '\n');
const stop = async () => {
  await fake.close();
  if (pool) await pool.end();
  process.exit(0);
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
