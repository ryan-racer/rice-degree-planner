import test from 'node:test';
import assert from 'node:assert/strict';
import { gpaOf, projectedGpa, GRADES, pointsFor, POINTS } from '../js/engine/grades.js';

const c = (grade, hours = 3, status = 'completed', extra = {}) => ({ code: 'X 101', grade, hours, status, ...extra });

test('gpaOf averages graded attempts and skips the rest', () => {
  assert.equal(gpaOf([c('A'), c('B')]), 3.5);
  assert.equal(gpaOf([c('A+'), c('F')]), (4.33 + 0) / 2);
  assert.equal(gpaOf([c('A', 4), c('B', 2)]), (16 + 6) / 6);
  assert.equal(gpaOf([c('A'), c('P'), c('TR'), c('W'), c('A', 3, 'in-progress'), c('A', 3, 'planned')]), 4);
  assert.equal(gpaOf([c('P')]), null);
  assert.equal(gpaOf([]), null);
  assert.deepEqual(GRADES.slice(0, 3), ['A+', 'A', 'A-']);
});

test('schools can override grade points (Rice counts A+ as 4.0)', () => {
  assert.equal(POINTS['A+'], 4.33, 'default scale unchanged');
  assert.equal(pointsFor({})['A+'], 4.33);
  assert.equal(pointsFor({ gradePoints: { 'A+': 4 } })['A+'], 4);
  assert.equal(gpaOf([c('A+'), c('F')], pointsFor({ gradePoints: { 'A+': 4 } })), 2);
});

test('projectedGpa counts assumed grades for in-progress courses', () => {
  const done = c('B', 3, 'completed', { key: 'HIST 101#0', code: 'HIST 101' });
  const ip = c('', 3, 'in-progress', { key: 'MATH 101#1', code: 'MATH 101' });
  assert.equal(projectedGpa([done, ip], {}), 3);
  assert.equal(projectedGpa([done, ip], { 'MATH 101#1': 'A' }), 3.5);
  assert.equal(projectedGpa([done, ip], { 'MATH 101': 'A' }), 3.5, 'code key works too');
  assert.equal(projectedGpa([done, ip], { 'MATH 101#1': '' }), 3, 'blank means no assumption');
  assert.equal(projectedGpa([done, ip], { 'MATH 101#1': 'P' }), 3, 'pass/fail stays out of the GPA');
  assert.equal(projectedGpa([done, ip], { 'NOPE 999': 'A' }), 3, 'unknown keys are ignored');
});
