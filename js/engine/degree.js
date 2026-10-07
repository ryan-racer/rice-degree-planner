// University-wide graduation requirements (hours, upper-level hours, writing, activity, distribution, diversity).
// Configured per school under `school.degree`; course attributes (distribution group, diversity flag) come from the
// lazily loaded course details.

import { courseMatchesSpec, courseLevel, deptOf, distGroupOf } from './match.js';
import { gpaOf, pointsFor } from './grades.js';

const isTransfer = (c) => c.source === 'transfer';
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/**
 * University rules that apply to every major and minor, as sentences: the minimum GPA across the applied courses
 * and upper-level work in residence. (Pass/Fail courses are marked on their own rows.) `result` comes from auditProgram.
 */
export function programNotes(result, school) {
  const cfg = school?.degree || {}, used = result.usedCourses, out = [];
  const g = gpaOf(used.filter((c) => !isTransfer(c)), pointsFor(school));
  if (cfg.programMinGpa && g != null && g < cfg.programMinGpa) out.push(`GPA across the courses applied here is ${g.toFixed(2)}; at least ${cfg.programMinGpa.toFixed(2)} is required.`);
  if (cfg.residency && result.program.kind === 'major') {
    const hrs = (cs) => cs.reduce((a, c) => a + (c.hours || 0), 0);
    const up = used.filter((c) => courseLevel(c.code) >= (cfg.upperLevel || 300));
    const all = hrs(up), away = hrs(up.filter(isTransfer));
    if (away > 0 && away >= all / 2) out.push(`${away} of the ${all} upper-level hours applied here are transfer credit. More than half of a major's upper-level work must be taken in residence.`);
  }
  return out;
}

/**
 * @param {object} o
 * @param {object} o.school
 * @param {object[]} o.courses     prepared courses (completed, in progress, planned)
 * @param {object[]} o.programs    declared program definitions (a degree may require more than the minimum hours)
 * @param {(code:string)=>Promise<object|null>} o.loadDetails
 */
export async function auditDegree({ school, courses, programs = [], loadDetails }) {
  const cfg = school.degree;
  if (!cfg) return null;
  const info = new Map();
  await Promise.all([...new Set(courses.map((c) => c.code))].map(async (code) => info.set(code, await loadDetails(code))));
  const matches = (c, specs) => (specs || []).some((s) => courseMatchesSpec(c, s));
  const notes = []; // { about: 'hours' | 'dist:<group>' | 'gpa', text }
  const note = (about, text) => notes.push({ about, text });
  const list = (cs) => [...new Set(cs.map((c) => c.code))];
  const isUpper = (c) => courseLevel(c.code) >= (cfg.upperLevel || 300);
  // A course must carry a minimum number of hours to meet a general education requirement. Transfer credit is
  // held to its own (usually lower) minimum, because converted quarter or ECTS units rarely come out whole.
  const bigEnough = (c, rule) => { const min = rule.minHours || 0; return c.hours >= (isTransfer(c) ? Math.min(min, cfg.transferMinHours ?? min) : min); };

  // Hours. A course passed twice earns credit once unless it is repeatable; some departments count only up to a cap.
  const counted = new Map(), over = new Set(); // per hour cap: hours counted so far, and caps that were exceeded
  const seen = new Set(), repeated = [];
  let total = 0, upper = 0, inResidence = 0, upperInResidence = 0;
  for (const c of [...courses].sort((a, b) => (b.hours || 0) - (a.hours || 0))) {
    let h = c.hours || 0;
    if (!c.generic && !/repeatable for credit/i.test(info.get(c.code)?.d || '')) {
      if (seen.has(c.code)) { repeated.push(c); continue; }
      seen.add(c.code);
    }
    const cap = (cfg.hourCaps || []).find((k) => matches(c, k.from));
    if (cap) { const room = Math.max(0, cap.max - (counted.get(cap) || 0)); if (h > room) over.add(cap); h = Math.min(h, room); counted.set(cap, (counted.get(cap) || 0) + h); }
    total += h;
    if (isUpper(c)) upper += h;
    if (!isTransfer(c)) { inResidence += h; if (isUpper(c)) upperInResidence += h; }
  }
  const again = list(repeated);
  if (again.length) note('hours', `${again.join(', ')} ${plural(again.length, 'appears', 'appear')} more than once. A repeated course earns credit once unless it is repeatable for credit.`);
  for (const cap of over) note('hours', `Only ${cap.max} hours of ${cap.label} count toward the degree.`);
  const round = (n) => Math.round(n * 1000) / 1000;
  const needHours = Math.max(cfg.hours || 120, ...programs.map((p) => p.degreeHours || 0));

  const items = [];
  const one = (id, name, pool, detail) => items.push({ id, name, have: Math.min(1, pool.length), need: 1, satisfied: pool.length >= 1, courses: pool, detail });
  if (cfg.writing) one('writing', cfg.writing.name, courses.filter((c) => matches(c, cfg.writing.from) && bigEnough(c, cfg.writing)));
  if (cfg.activity) one('activity', cfg.activity.name, courses.filter((c) => matches(c, cfg.activity.from) && bigEnough(c, cfg.activity)));
  const dist = {};
  if (cfg.distribution) {
    const d = cfg.distribution;
    for (const g of d.groups) {
      const inGroup = courses.filter((c) => distGroupOf(info.get(c.code)) === g && !(d.excludeDepts || []).includes(deptOf(c.code)));
      const pool = inGroup.filter((c) => bigEnough(c, d));
      const small = list(inGroup.filter((c) => !bigEnough(c, d)));
      if (small.length) note(`dist:${g}`, `${small.join(', ')} ${plural(small.length, 'is a', 'are')} Group ${g} ${plural(small.length, 'course')} but ${plural(small.length, 'carries', 'carry')} too few hours to count toward distribution (${d.minHours} required, ${cfg.transferMinHours ?? d.minHours} for transfer credit).`);
      const depts = new Set(pool.map((c) => deptOf(c.code)));
      const countOk = pool.length >= d.courses, deptOk = depts.size >= Math.min(d.minDepartments || 1, d.courses);
      // Courses still needed: the count shortfall, or one more from another department when the count is met.
      const need = Math.max(d.courses - pool.length, countOk && !deptOk ? 1 : 0, 0);
      dist[g] = { have: Math.min(pool.length, d.courses), target: d.courses, need, satisfied: countOk && deptOk, departments: depts.size, courses: pool,
        detail: countOk && !deptOk ? `needs a second department (all from ${[...depts][0]})` : '' };
    }
  }
  if (cfg.diversity) one('diversity', cfg.diversity.name, courses.filter((c) => info.get(c.code)?.ad && bigEnough(c, cfg.diversity)));

  const tally = (have, need = 0) => ({ have: round(have), need, satisfied: round(have) >= need });
  // Hours in residence only differ from total hours for students with transfer credit.
  const residency = cfg.residency && courses.some(isTransfer) ? { hours: tally(inResidence, cfg.residency.hours), upper: tally(upperInResidence, cfg.residency.upperLevelHours) } : null;
  const gpa = gpaOf(courses.filter((c) => !isTransfer(c)), pointsFor(school));
  if (cfg.minGpa && gpa != null && gpa < cfg.minGpa) note('gpa', `Cumulative GPA is ${gpa.toFixed(2)}; graduation requires at least ${cfg.minGpa.toFixed(2)}.`);

  return {
    residency, gpa, notes,
    hours: tally(total, needHours),
    upper: tally(upper, cfg.upperLevelHours),
    items, dist,
    distNeed: Object.fromEntries(Object.entries(dist).map(([g, v]) => [g, v.need])),
    // When the count is met but every course is from one department, the extra course must come from another.
    distAvoid: Object.fromEntries(Object.entries(dist).filter(([, v]) => v.detail).map(([g, v]) => [g, [...new Set(v.courses.map((c) => c.code.split(' ')[0]))]])),
    missing: items.filter((i) => !i.satisfied).map((i) => i.id),
  };
}
