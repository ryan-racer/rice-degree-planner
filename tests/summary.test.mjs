import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCourses, auditProgram, auditAll } from '../js/engine/audit.js';
import { buildSummary, stillNeeded } from '../js/engine/summary.js';
import { school, prog, c } from './helpers.mjs';

const program = prog([
  { type: 'all', name: 'Core', items: ['CS 101', 'CS 201'] },
  { type: 'choose', name: 'Elective', count: 1, from: ['CS 301', 'CS 310'] },
]);
const other = prog([{ type: 'all', name: 'Core', items: ['CS 101', 'CS 999'] }], { id: 'q', name: 'Other' });

test('stillNeeded names the unfilled slots', () => {
  const courses = prepareCourses([c('CS 101')], school);
  const r = auditProgram(program, courses);
  const lines = stillNeeded(r.tree);
  assert.ok(lines.some((l) => l.includes('CS 201')), JSON.stringify(lines));
  assert.ok(lines.some((l) => l.includes('Elective') && l.includes('CS 301')), JSON.stringify(lines));
  assert.equal(stillNeeded(auditProgram(program, prepareCourses([c('CS 101'), c('CS 201'), c('CS 301')], school)).tree).length, 0);
});

test('buildSummary covers programs, degree, and closest alternatives', () => {
  const courses = prepareCourses([c('CS 101', 'completed', { grade: 'A', hours: 4, source: 'transcript' })], school);
  const declared = auditProgram(program, courses);
  const ranked = auditAll([other], courses);
  const text = buildSummary({
    school: { name: 'Rice University', degree: { writing: { short: 'FWIS' } } },
    courses, declaredResults: [declared], ranked, catalogYear: '2024-2025', date: '2026-10-06',
    degree: { hours: { have: 90, need: 120 }, upper: { have: 30, need: 48 }, dist: { I: { have: 2, target: 3, detail: '' } }, items: [{ id: 'writing', name: 'FWIS', satisfied: true }] },
  });
  assert.match(text, /Rice University Degree Planner summary — 2026-10-06/);
  assert.match(text, /Catalog: 2024-2025/);
  assert.match(text, /Transcript: 1 courses, GPA 4\.00/);
  assert.match(text, /Program \(BS\): \d+% complete, 2 requirements to go/);
  assert.match(text, /CS 201/);
  assert.match(text, /90\/120 hours; 30\/48 upper-level hours/);
  assert.match(text, /Distribution: DI 2\/3/);
  assert.match(text, /Also required: done: FWIS/);
  assert.match(text, /Closest other programs:\n  - Other \(BS, major\): 1 to go/);
  assert.match(text, /not an official audit/);
});
