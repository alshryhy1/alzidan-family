/**
 * Smoke: توحيد انتهاء الأخبار (مسار C / NEWS-001).
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require(join(__dirname, '../assets/js/modules/events/event-visibility.js'));

const vis = globalThis.AlzidanEventVisibility;
if (!vis) {
  console.error('FAIL: AlzidanEventVisibility missing');
  process.exit(1);
}

function dayOffsetIso(daysFromToday) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + daysFromToday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function createdDaysAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

const now = new Date();
const cases = [
  [
    'death day-2 visible',
    { type: 'death', event_date: dayOffsetIso(-2), created_at: createdDaysAgo(2) },
    true,
  ],
  [
    'death day-3 hidden',
    { type: 'death', event_date: dayOffsetIso(-3), created_at: createdDaysAgo(3) },
    false,
  ],
  [
    'happy yesterday hidden',
    {
      type: 'marriage',
      event_date: dayOffsetIso(-1),
      created_at: createdDaysAgo(1),
      details: JSON.stringify({ v: 1, kind: 'happy_notice', showDays: 7 }),
    },
    false,
  ],
  [
    'null date aged out',
    {
      type: 'gathering',
      event_date: null,
      created_at: createdDaysAgo(8),
      details: JSON.stringify({ v: 1, kind: 'happy_notice', showDays: 7 }),
    },
    false,
  ],
  [
    'null date fresh',
    {
      type: 'gathering',
      event_date: null,
      created_at: createdDaysAgo(1),
      details: JSON.stringify({ v: 1, kind: 'happy_notice', showDays: 7 }),
    },
    true,
  ],
];

let failed = 0;
for (const [name, row, expect] of cases) {
  const got = vis.isFamilyEventPubliclyVisible(row, now);
  if (got !== expect) {
    failed += 1;
    console.error(`FAIL: ${name} expected=${expect} got=${got}`);
  } else {
    console.log(`OK: ${name}`);
  }
}

if (failed) process.exit(1);
console.log(`\nAll ${cases.length} cases passed.`);
