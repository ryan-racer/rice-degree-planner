import programs from './programs.bundle.js'; // generated from programs/*.js by tools/gen-index.mjs
import crosslist from './crosslist.js';
import catalog from './catalog.js';
import sample from './sample.js';
import { catalogYears, currentCatalogYear, overlays } from './catalog-years.js';
import variants from './variants.bundle.js'; // exact per-year definitions, generated from variants/<year>/*.js
import scheduleTerms from './schedule.js';
import sectionTerms, { generated as sectionDataDate } from './section-terms.js';

/** Resolve a requirement node by its audit path ("1.o0.2": index, any-option, index). */
function nodeAt(requirements, path) {
  let list = requirements, node = null;
  for (const part of path.split('.')) {
    if (part.startsWith('o')) { node = node?.options?.[Number(part.slice(1))]; }
    else { node = list?.[Number(part)]; }
    if (!node) return null;
    list = node.requirements || null;
  }
  return node;
}

const yearCache = new Map();
/**
 * Programs as they stood in a given catalog year. Older years start from the current definitions and restore the
 * course options that existed then; programs that did not exist that year are left out.
 */
function programsFor(year) {
  if (!year || year === currentCatalogYear || !overlays[year]) return programs;
  if (yearCache.has(year)) return yearCache.get(year);
  const out = [];
  for (const base of programs) {
    const exact = variants[year]?.[base.id];
    if (exact) { out.push(exact); continue; }
    const o = overlays[year][base.id];
    if (!o) { out.push(base); continue; }
    if (o.absent) continue;
    const p = JSON.parse(JSON.stringify(base));
    let restored = 0;
    for (const [path, codes] of Object.entries(o.add || {})) {
      const node = nodeAt(p.requirements, path);
      if (node?.from) { node.from.push(...codes.filter((c) => !node.from.includes(c))); restored += codes.length; }
    }
    const bits = [];
    if (restored) bits.push(`${restored} course option${restored === 1 ? '' : 's'} from the ${year} catalog restored`);
    if (o.loose?.length) bits.push(`listed in ${year} but not matched to a requirement: ${o.loose.slice(0, 8).join(', ')}${o.loose.length > 8 ? '…' : ''}`);
    if (o.structural) bits.push(`the ${year} catalog counted some sections differently, so check the numbers against that year's page`);
    p.catalogNote = `Audited with the current definition adjusted for ${year}: ${bits.join('; ')}.`;
    p.url = base.url.replace('https://ga.rice.edu/', `https://ga.rice.edu/archive/${year}/`);
    out.push(p);
  }
  yearCache.set(year, out);
  return out;
}

export default {
  id: 'rice',
  name: 'Rice University',
  shortName: 'Rice',
  catalogYear: '2026–2027',
  catalogUrl: 'https://ga.rice.edu/',
  catalogYears,
  currentCatalogYear,
  programsFor,
  defaultHours: 3,
  // A major or minor needs the letter grade, so the Registrar uncovers a P (on request, or at the final audit).
  // Such courses therefore count, with a notice.
  passFailGrades: ['P'],
  gradePoints: { 'A+': 4 }, // Rice awards 4.0 grade points for an A+ (ESTHER shows the +, but it does not raise the GPA)
  passFailNotice: (codes) => `${codes.join(', ')} ${codes.length === 1 ? 'was' : 'were'} taken Pass/Fail. ${codes.length === 1 ? 'It counts' : 'They count'} here because the Registrar uncovers the letter grade, on your request or automatically at the final degree audit. Until then DegreeWorks lists ${codes.length === 1 ? 'it' : 'them'} as still needed. An uncovered grade enters your GPA and cannot be covered again.`,
  maxTermHours: 18, // most a student can take in a term without an overload approval
  // Hints for the transcript parser (see js/parser/transcript.js for defaults).
  transcript: {
    inProgress: /\b(COURSES?\s+IN\s+PROGRESS|IN[- ]PROGRESS)\b/i,
    transfer: /\b(TRANSFER\s+CREDIT|ADVANCED\s+PLACEMENT|AP\s+CREDIT|TEST\s+CREDIT)\b/i,
    institution: /\b(INSTITUTION\s+CREDIT)\b/i,
    generic: /^TRAN \d/, // transfer credit with no Rice equivalent: counts toward total hours only
  },
  sample,
  // Per-department course details (descriptions, prerequisites, offerings), fetched lazily by js/ui/coursecard.js.
  courseDataPath: 'data/rice/courses/',
  scheduleTerms,
  // Section-level schedule data (meeting times) per term, fetched lazily by js/ui/schedule.js.
  sectionDataPath: 'data/rice/schedule/',
  sectionTerms,
  sectionDataDate,
  // University-wide graduation requirements (General Announcements, Graduation Requirements).
  degree: {
    // General Announcements, "Graduation Requirements" and "Transfer Credit" (2025-2026).
    hours: 120, upperLevelHours: 48, upperLevel: 300,
    residency: { hours: 60, upperLevelHours: 25 }, // earned at Rice: 60 hours, and more than half of the 48 upper-level hours
    minGpa: 1.67,
    programMinGpa: 2.0, // across the courses applied to a major or minor
    transferMinHours: 2.5, // a transferred equivalent counts toward distribution or FWIS only with at least 2.5 hours
    hourCaps: [
      { label: 'LPAP credit', from: [{ dept: 'LPAP' }], max: 4 },
      { label: 'student-taught COLL credit', from: [{ dept: 'COLL', min: 100, max: 199 }, 'COLL 200'], max: 3 },
    ],
    writing: { name: 'First-Year Writing Intensive Seminar', short: 'FWIS', from: [{ dept: 'FWIS', exclude: ['FWIS 100'] }], minHours: 3 }, // FWIS 100 cannot meet the requirement
    activity: { name: 'Lifetime Physical Activity Program', short: 'LPAP', from: [{ dept: 'LPAP', min: 100, max: 199 }, 'LPAP 238'], minHours: 1 },
    distribution: { groups: ['I', 'II', 'III'], courses: 3, minHours: 3, minDepartments: 2, excludeDepts: ['FWIS'] }, // FWIS never counts toward distribution
    diversity: { name: 'Analyzing Diversity', short: 'AD', minHours: 3 },
  },
  programs,
  crosslist,
  catalog,
};
