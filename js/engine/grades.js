// Grade points, shared by the engine and the UI. Grades without an entry (P, S, TR, W, ...) do not affect a GPA.
export const POINTS = { 'A+': 4.33, A: 4, 'A-': 3.67, 'B+': 3.33, B: 3, 'B-': 2.67, 'C+': 2.33, C: 2, 'C-': 1.67, 'D+': 1.33, D: 1, 'D-': 0.67, F: 0 };

/** Letter grades in order, for what-if grade pickers. */
export const GRADES = Object.keys(POINTS);

/** A school's grade-point table: the default scale with the school's `gradePoints` overrides applied. */
export function pointsFor(school) { return { ...POINTS, ...(school?.gradePoints || {}) }; }

/** Grade point average over graded, finished attempts (failed ones included); null when nothing is graded. */
export function gpaOf(courses, points = POINTS) {
  let pts = 0, hrs = 0;
  for (const c of courses) {
    if (c.status === 'planned' || c.status === 'in-progress' || points[c.grade] == null) continue;
    const h = c.hours || 0;
    pts += points[c.grade] * h; hrs += h;
  }
  return hrs ? pts / hrs : null;
}

/**
 * Projected GPA if in-progress courses earned assumed grades.
 * @param {object[]} courses prepared courses (with key, hours, status)
 * @param {object} assumptions { [courseKey|code]: grade } — '' or missing means "no assumption"
 * A non-GPA assumption (P, S, ...) leaves the course out of the GPA, as the Registrar would.
 */
export function projectedGpa(courses, assumptions = {}, points = POINTS) {
  const mapped = (courses || []).map((c, i) => {
    const g = assumptions[c.key] ?? assumptions[`${c.code}#${i}`] ?? assumptions[c.code];
    if (g == null || g === '') return c;
    if (points[g] == null) return { ...c, grade: g };
    return { ...c, grade: g, status: 'completed' };
  });
  return gpaOf(mapped, points);
}
