// Semester schedule planner: pick sections for a term, see them on a weekly grid, and find courses that fit
// the open slots and fill something useful (a declared-program requirement or a distribution group).

import { esc, titleCase } from './render.js';
import { termName } from './coursecard.js';
import { suggestCourses } from '../engine/audit.js';
import { courseMatchesSpec, aliasesFor } from '../engine/match.js';
import { loadDept as loadDeptShared, prereqStatus, courseDetails } from '../data/courseinfo.js';
import { auditDegree } from '../engine/degree.js';

const sectionCache = new Map(); // term -> Promise<Section[]>
const DAY_ORDER = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
const DAY_NAME = { M: 'Mon', T: 'Tue', W: 'Wed', R: 'Thu', F: 'Fri', S: 'Sat', U: 'Sun' };
const PALETTE = [
  'bg-rice-100 text-rice-900 dark:bg-rice-900/60 dark:text-rice-100',
  'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100',
  'bg-amber-100 text-amber-900 dark:bg-amber-900/60 dark:text-amber-100',
  'bg-violet-100 text-violet-900 dark:bg-violet-900/60 dark:text-violet-100',
  'bg-rose-100 text-rose-900 dark:bg-rose-900/60 dark:text-rose-100',
  'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/60 dark:text-cyan-100',
  'bg-lime-100 text-lime-900 dark:bg-lime-900/60 dark:text-lime-100',
  'bg-orange-100 text-orange-900 dark:bg-orange-900/60 dark:text-orange-100',
];

let ctx; // { state, school, $, save, rerender, getCourses, getDeclaredResults }
let ui = { query: '', fits: true, needed: false, hideTaken: true, dist: '', earliest: 0, noFriday: false };

/** Jump to a course's sections for the current term (used by the hover card's "Find sections"). */
export function findSections(code) {
  ui = { ...ui, query: code.toLowerCase(), hideTaken: false, needed: false, dist: '' };
  const $ = ctx.$;
  $('#sched-search').value = code; $('#sched-hide-taken').checked = false; $('#sched-needed').checked = false;
  render();
}
export function latestSectionTerm(school) { const t = school.sectionTerms || []; return t[t.length - 1] || null; }

export function initSchedule(context) {
  ctx = context;
  const root = ctx.$('[data-panel="schedule"]');
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sched-term') { ctx.state.scheduleTerm = t.value; ctx.save(); render(); }
    if (t.id === 'sched-fits') { ui.fits = t.checked; renderCandidates(); }
    if (t.id === 'sched-needed') { ui.needed = t.checked; renderCandidates(); }
    if (t.id === 'sched-hide-taken') { ui.hideTaken = t.checked; renderCandidates(); }
    if (t.id === 'sched-earliest') { ui.earliest = Number(t.value); renderCandidates(); }
    if (t.id === 'sched-nofriday') { ui.noFriday = t.checked; renderCandidates(); }
    if (t.dataset.f === 'swap') { swapSection(Number(t.dataset.crn), Number(t.value)); }
  });
  root.addEventListener('input', (e) => { if (e.target.id === 'sched-search') { ui.query = e.target.value.trim().toLowerCase(); renderCandidates(); } });
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    if (b.dataset.f === 'add') addSection(Number(b.dataset.crn));
    if (b.dataset.f === 'remove') removeSection(Number(b.dataset.crn));
    if (b.dataset.f === 'dist') { ui.dist = ui.dist === b.dataset.g ? '' : b.dataset.g; renderCandidates(); }
    if (b.dataset.f === 'clear') { setSelected([]); }
    if (b.dataset.f === 'ics') exportIcs();
  });
}

// ---------- data ----------
export function loadSections(term) {
  if (!sectionCache.has(term)) {
    sectionCache.set(term, fetch(`${ctx.school.sectionDataPath}${term}.json`).then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((d) => d.sections.map((x) => ({ crn: x[0], code: x[1], sec: x[2], title: x[3], instr: x[4], credits: Number(x[5]) || 0, dist: x[6], part: x[7], meetings: x[8].map((m) => ({ days: m[0], start: m[1], end: m[2] })) })))
      .then((list) => { ctx?.sectionsCache?.set(term, list); return list; })
      .catch(() => []));
  }
  return sectionCache.get(term);
}
function loadDept(dept) { return loadDeptShared(ctx.school, dept); }

// ---------- state helpers ----------
function currentTerm() {
  const terms = ctx.school.sectionTerms || [];
  if (!terms.length) return null;
  if (!ctx.state.scheduleTerm || !terms.includes(ctx.state.scheduleTerm)) ctx.state.scheduleTerm = terms[terms.length - 1];
  return ctx.state.scheduleTerm;
}
function selectedCrns() { const t = currentTerm(); return (ctx.state.schedule && ctx.state.schedule[t]) || []; }
async function setSelected(crns) {
  const t = currentTerm();
  if (!crns.length) for (const crn of selectedCrns()) { const code = await codeOf(crn); if (code) planEdit(t, code, false); }
  commit(crns);
}
function isTranscriptTerm(term) { const name = termName(term); return ctx.state.courses.some((c) => c.term === name); }
/** Add or remove one course in the planner term that matches this schedule term (future terms only). */
function planEdit(term, code, add) {
  const name = termName(term);
  if (ctx.state.courses.some((c) => c.term === name && c.code === code)) {
    // A course already on the transcript for this term: hide or unhide it here rather than touching the plan.
    ctx.state.scheduleHidden = ctx.state.scheduleHidden || {};
    const hidden = new Set(ctx.state.scheduleHidden[term] || []);
    if (add) hidden.delete(code); else hidden.add(code);
    ctx.state.scheduleHidden[term] = [...hidden];
    return;
  }
  let t = ctx.state.plan.find((x) => x.term === name);
  if (add) {
    if (!t) { t = { term: name, courses: [] }; ctx.state.plan.push(t); }
    if (!t.courses.some((c) => c.code === code)) t.courses.push({ code, hours: ctx.school.catalog?.[code]?.hours, fromSchedule: true });
  } else if (t) {
    t.courses = t.courses.filter((c) => c.code !== code);
    if (!t.courses.length) ctx.state.plan = ctx.state.plan.filter((x) => x !== t);
  }
}
async function codeOf(crn) { return (await loadSections(currentTerm())).find((s) => s.crn === crn)?.code; }
async function addSection(crn) {
  if (selectedCrns().includes(crn)) return;
  const code = await codeOf(crn); if (code) planEdit(currentTerm(), code, true);
  commit([...selectedCrns(), crn]);
}
async function removeSection(crn) {
  const code = await codeOf(crn); if (code) planEdit(currentTerm(), code, false);
  commit(selectedCrns().filter((c) => c !== crn));
}
async function swapSection(oldCrn, newCrn) { commit(selectedCrns().map((c) => (c === oldCrn ? newCrn : c))); }
function commit(crns) {
  const t = currentTerm();
  ctx.state.schedule = ctx.state.schedule || {};
  ctx.state.schedule[t] = crns;
  ctx.save(); ctx.rerender(); render();
}

/**
 * For a future term the planner is the source of truth: every planned course gets a section (the first timed one
 * that does not clash), and sections whose course left the plan are dropped. Returns planned codes with no sections.
 */
function reconcileWithPlan(term, sections) {
  const name = termName(term);
  const planTerm = ctx.state.plan.find((x) => x.term === name);
  const hidden = new Set(ctx.state.scheduleHidden?.[term] || []);
  const onTranscript = ctx.state.courses.filter((c) => c.term === name && c.status !== 'failed' && !hidden.has(c.code)).map((c) => c.code);
  const codes = [...new Set([...onTranscript, ...(planTerm ? planTerm.courses.filter((c) => c.code).map((c) => c.code) : [])])];
  const byCrn = new Map(sections.map((s) => [s.crn, s]));
  const before = selectedCrns();
  let sel = before.filter((crn) => codes.includes(byCrn.get(crn)?.code));
  const missing = [];
  for (const code of codes) {
    if (sel.some((crn) => byCrn.get(crn)?.code === code)) continue;
    const options = sections.filter((s) => s.code === code && s.meetings.length);
    if (!options.length) { missing.push(code); continue; }
    const chosen = sel.map((crn) => byCrn.get(crn));
    const pick = options.find((o) => !chosen.some((x) => conflicts(o, x))) || options[0];
    sel = [...sel, pick.crn];
  }
  if (sel.length !== before.length || sel.some((c, i) => c !== before[i])) {
    ctx.state.schedule = ctx.state.schedule || {}; ctx.state.schedule[term] = sel; ctx.save();
  }
  return missing;
}

// ---------- time helpers ----------
const fmt = (m) => { const h = Math.floor(m / 60), mi = m % 60; const ap = h >= 12 ? 'p' : 'a'; return `${((h + 11) % 12) + 1}:${String(mi).padStart(2, '0')}${ap}`; };
const meetingText = (s) => s.meetings.length ? s.meetings.map((m) => `${m.days} ${fmt(m.start)}–${fmt(m.end)}`).join(', ') : 'No set meeting time';
function conflicts(a, b) {
  for (const x of a.meetings) for (const y of b.meetings) {
    if (x.start >= y.end || y.start >= x.end) continue;
    for (const d of x.days) if (y.days.includes(d)) return true;
  }
  return false;
}

// ---------- calendar export ----------
const ICS_DAY = { M: 'MO', T: 'TU', W: 'WE', R: 'TH', F: 'FR', S: 'SA', U: 'SU' };
const DAY_IDX = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };
/** Default semester window: Fall runs from the 4th Monday of August, Spring from the 2nd Monday of January, both ~15 weeks. */
function defaultTermDates(term) {
  const y = Number(String(term).slice(0, 4)), s = String(term).slice(4);
  const nthMonday = (year, month, n) => { const d = new Date(year, month, 1); const off = (8 - d.getDay()) % 7; d.setDate(1 + off + (n - 1) * 7); return d; };
  const start = s === '10' ? nthMonday(y - 1, 7, 4) : s === '20' ? nthMonday(y, 0, 2) : nthMonday(y, 4, 4);
  const end = new Date(start); end.setDate(end.getDate() + (s === '30' ? 7 * 10 : 7 * 15) - 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
async function exportIcs() {
  const $ = ctx.$;
  const term = currentTerm();
  const sections = await loadSections(term);
  const selected = selectedCrns().map((crn) => sections.find((s) => s.crn === crn)).filter(Boolean);
  if (!selected.length) return;
  const start = $('#ics-start').value, end = $('#ics-end').value;
  if (!start || !end) return;
  const [sy, sm, sd] = start.split('-').map(Number);
  const until = end.replace(/-/g, '') + 'T235959';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DegreePlanner//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:' + termName(term) + ' classes'];
  for (const sec of selected) sec.meetings.forEach((m, i) => {
    // First occurrence: the first listed meeting day on or after the term start date.
    const first = new Date(sy, sm - 1, sd);
    const days = [...m.days].map((d) => DAY_IDX[d]);
    while (!days.includes(first.getDay())) first.setDate(first.getDate() + 1);
    const dt = (mins) => `${first.getFullYear()}${pad(first.getMonth() + 1)}${pad(first.getDate())}T${pad(Math.floor(mins / 60))}${pad(mins % 60)}00`;
    lines.push('BEGIN:VEVENT', `UID:${sec.crn}-${i}-${term}@degreeplanner`, `DTSTAMP:${stamp}`, `DTSTART:${dt(m.start)}`, `DTEND:${dt(m.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${[...m.days].map((d) => ICS_DAY[d]).join(',')};UNTIL=${until}`,
      `SUMMARY:${sec.code} ${titleCase(sec.title).replace(/[,;]/g, ' ')}`, `DESCRIPTION:Section ${sec.sec}${sec.instr ? ' · ' + sec.instr.replace(/[,;]/g, ' ') : ''} · ${sec.credits} credit hours`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${termName(term).replace(' ', '-')}-classes.ics`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- rendering ----------
export async function render() {
  const $ = ctx.$;
  const term = currentTerm();
  const root = $('[data-panel="schedule"]');
  if (!term) { root.innerHTML = '<p class="text-sm text-zinc-500">No schedule data for this school yet.</p>'; return; }
  if (ctx.school.sectionDataDate) $('#sched-asof').textContent = ` as of ${new Date(ctx.school.sectionDataDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  $('#sched-term').innerHTML = (ctx.school.sectionTerms || []).map((t) => `<option value="${t}" ${t === term ? 'selected' : ''}>${termName(t)}</option>`).join('');
  const sections = await loadSections(term);
  if (ctx.state.scheduleTerm !== term) return;
  const byCrn = new Map(sections.map((s) => [s.crn, s]));

  const notOffered = reconcileWithPlan(term, sections);
  $('#sched-note').textContent = notOffered.length ? `On your plan for ${termName(term)} but with no timed sections: ${notOffered.join(', ')}.` : '';
  const selected = selectedCrns().map((crn) => byCrn.get(crn)).filter(Boolean);
  const dd = defaultTermDates(term);
  const icsStart = $('#ics-start'), icsEnd = $('#ics-end');
  if (icsStart.dataset.term !== term) { icsStart.value = dd.start; icsEnd.value = dd.end; icsStart.dataset.term = term; }
  $('#ics-box').hidden = !selected.length;
  renderGrid(selected);
  renderSelected(selected, sections);
  await renderCandidates();
}

function renderGrid(selected) {
  const $ = ctx.$;
  const days = ['M', 'T', 'W', 'R', 'F'];
  for (const s of selected) for (const m of s.meetings) for (const d of m.days) if (!days.includes(d)) days.push(d);
  days.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));
  let start = 8 * 60, end = 18 * 60;
  for (const s of selected) for (const m of s.meetings) { start = Math.min(start, Math.floor(m.start / 60) * 60); end = Math.max(end, Math.ceil(m.end / 60) * 60); }
  const scale = 0.85; // px per minute
  const height = (end - start) * scale;
  const colorOf = new Map(); [...new Set(selected.map((s) => s.code))].forEach((code, i) => colorOf.set(code, PALETTE[i % PALETTE.length]));
  const clash = new Set();
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) if (conflicts(selected[i], selected[j])) { clash.add(selected[i].crn); clash.add(selected[j].crn); }
  const hours = []; for (let h = start; h < end; h += 60) hours.push(h);
  const gridCols = `grid-template-columns: 2.6rem repeat(${days.length}, minmax(0, 1fr));`;
  const header = `<div class="grid text-[11px] font-medium text-zinc-500" style="${gridCols}"><div></div>${days.map((d) => `<div class="px-1 pb-1">${DAY_NAME[d]}</div>`).join('')}</div>`;
  const cols = days.map((d) => {
    const blocks = selected.flatMap((s) => s.meetings.filter((m) => m.days.includes(d)).map((m) => `<div class="absolute inset-x-0.5 overflow-hidden rounded px-1 py-0.5 text-[10px] leading-tight ${colorOf.get(s.code)} ${clash.has(s.crn) ? 'ring-2 ring-red-500' : ''}" style="top:${(m.start - start) * scale}px;height:${Math.max(14, (m.end - m.start) * scale - 2)}px" title="${esc(`${s.code} ${s.sec} · ${titleCase(s.title)} · ${fmt(m.start)}–${fmt(m.end)}`)}"><span class="course-ref font-mono font-medium" data-course="${esc(s.code)}">${esc(s.code)}</span><span class="block truncate opacity-80">${fmt(m.start)}–${fmt(m.end)}</span></div>`));
    return `<div class="relative border-l border-zinc-200 dark:border-zinc-800" style="height:${height}px">${hours.map((h) => `<div class="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800/70" style="top:${(h - start) * scale}px"></div>`).join('')}${blocks.join('')}</div>`;
  }).join('');
  const times = `<div class="relative" style="height:${height}px">${hours.map((h) => `<div class="absolute right-1 -translate-y-1/2 font-mono text-[10px] text-zinc-400" style="top:${(h - start) * scale}px">${fmt(h).replace(':00', '')}</div>`).join('')}</div>`;
  $('#sched-grid').innerHTML = header + `<div class="grid" style="${gridCols}">${times}${cols}</div>`;
  $('#sched-clash').textContent = clash.size ? `${clash.size} sections overlap` : '';
}

function renderSelected(selected, sections) {
  const $ = ctx.$;
  const credits = selected.reduce((a, s) => a + s.credits, 0);
  // An empty week is a screen of blank grid on a phone, pushing the course search out of view.
  $('#sched-grid').classList.toggle('max-lg:hidden', !selected.length);
  $('#sched-stats').textContent = selected.length ? `${selected.length} section${selected.length === 1 ? '' : 's'} · ${credits} credit hours${credits > (ctx.school.maxTermHours || 18) ? ` · over ${ctx.school.maxTermHours || 18}, needs overload approval` : ''}` : 'Nothing scheduled yet';
  const over = credits > (ctx.school.maxTermHours || 18); $('#sched-stats').classList.toggle('text-amber-700', over); $('#sched-stats').classList.toggle('dark:text-amber-400', over);
  $('#sched-selected').innerHTML = selected.map((s) => {
    const alts = sections.filter((x) => x.code === s.code && x.meetings.length);
    const swap = alts.length > 1 ? `<select data-f="swap" data-crn="${s.crn}" class="field h-6 px-1 text-[11px]" aria-label="Section">${alts.map((x) => `<option value="${x.crn}" ${x.crn === s.crn ? 'selected' : ''}>${esc(x.sec)} · ${esc(meetingText(x))}</option>`).join('')}</select>` : `<span class="font-mono text-[11px] text-zinc-500">${esc(s.sec)} · ${esc(meetingText(s))}</span>`;
    return `<div class="flex items-center gap-2 py-1 text-xs">
      <span class="course-ref shrink-0 cursor-help font-mono text-[12px] font-medium" data-course="${esc(s.code)}" tabindex="0">${esc(s.code)}</span>
      <span class="min-w-0 flex-1 truncate text-zinc-500">${esc(titleCase(s.title))}</span>
      ${swap}
      <span class="shrink-0 font-mono text-[11px] text-zinc-500">${s.credits} hr</span>
      <button type="button" class="btn-icon size-6 rounded" data-f="remove" data-crn="${s.crn}" aria-label="Remove ${esc(s.code)}"><svg class="size-3.5"><use href="#i-x"/></svg></button></div>`;
  }).join('') || '<p class="py-2 text-xs text-zinc-500">Add sections from the list, or search for a course.</p>';
}

/** Distribution progress from the university requirements audit: { have, need, cfg } keyed by group. */
let distMemo = null; // { courses, school, result }: renderCandidates runs on every keystroke, the audit need not
export function distributionSummary(courses, school = ctx?.school) {
  if (!school?.degree?.distribution) return Promise.resolve(null);
  if (distMemo?.courses !== courses || distMemo.school !== school) distMemo = { courses, school, result: computeDistribution(courses, school) };
  return distMemo.result;
}
async function computeDistribution(courses, school) {
  const d = await auditDegree({ school, courses, loadDetails: (code) => courseDetails(school, code) });
  const have = {}, need = {};
  for (const [g, v] of Object.entries(d.dist)) { have[g] = { count: v.have, codes: v.courses.map((c) => c.code), detail: v.detail }; need[g] = v.need; }
  return { have, need, cfg: { groups: school.degree.distribution.groups, coursesPerGroup: school.degree.distribution.courses } };
}

async function renderCandidates() {
  const $ = ctx.$;
  const term = currentTerm();
  const sections = await loadSections(term);
  const selected = selectedCrns().map((crn) => sections.find((s) => s.crn === crn)).filter(Boolean);
  const selectedCodes = new Set(selected.map((s) => s.code));
  const courses = ctx.getCourses();
  const takenCodes = new Set(courses.flatMap((c) => c.aliases || [c.code]));
  const results = ctx.getDeclaredResults();
  const { suggestions, patterns } = suggestCourses(results, courses, ctx.school, 500);
  const reqByCode = new Map(suggestions.map((s) => [s.code, s.programs]));
  const dist = await distributionSummary(courses);

  // Distribution summary chips
  $('#sched-dist').innerHTML = dist ? dist.cfg.groups.map((g) => {
    const h = dist.have[g], n = dist.need[g];
    return `<button type="button" data-f="dist" data-g="${g}" class="rounded-md border px-2 py-1 text-[11px] ${ui.dist === g ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900' : 'border-zinc-300 dark:border-zinc-700'}" title="${esc((h.codes.join(', ') || 'none yet') + (h.detail ? ' — ' + h.detail : ''))}">D${g === 'I' ? 1 : g === 'II' ? 2 : 3} <span class="${n ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} ${ui.dist === g ? '!text-inherit' : ''}">${!n ? '✓' : h.detail ? '+1 dept' : `${h.count}/${dist.cfg.coursesPerGroup}`}</span></button>`;
  }).join('') : '';

  const why = (s) => {
    const tags = [];
    const aliases = aliasesFor(s.code, ctx.school.crosslist);
    const progs = new Set();
    for (const a of aliases) for (const p of reqByCode.get(a) || []) progs.add(p);
    for (const pt of patterns) if (aliases.some((a) => courseMatchesSpec({ aliases: [a] }, pt.spec)) && !aliases.some((a) => takenCodes.has(a))) progs.add(pt.program);
    for (const p of progs) tags.push({ kind: 'req', text: p.replace(/\s*\(.*\)$/, '') });
    return tags;
  };

  let list = sections.filter((s) => s.meetings.length && !selectedCodes.has(s.code));
  if (ui.hideTaken) list = list.filter((s) => !aliasesFor(s.code, ctx.school.crosslist).some((a) => takenCodes.has(a)));
  if (ui.fits) list = list.filter((s) => !selected.some((x) => conflicts(s, x)));
  if (ui.dist) list = list.filter((s) => s.dist === ui.dist);
  if (ui.earliest) list = list.filter((s) => s.meetings.every((m) => m.start >= ui.earliest));
  if (ui.noFriday) list = list.filter((s) => !s.meetings.some((m) => m.days.includes('F')));
  if (ui.query) { const q = ui.query.split(/\s+/); list = list.filter((s) => { const t = `${s.code} ${s.title} ${s.instr}`.toLowerCase(); return q.every((w) => t.includes(w)); }); }
  const distNeed = (s) => (dist && s.dist && dist.need[s.dist] > 0 ? 1 : 0);
  const scored = list.map((s) => ({ s, tags: why(s), dn: distNeed(s) }));
  list = ui.needed ? scored.filter((x) => x.tags.length || x.dn) : scored;
  const codeQ = ui.query.replace(/^([a-z]+)\s?(\d)/, '$1 $2');
  const prefix = (x) => (ui.query && x.s.code.toLowerCase().startsWith(codeQ) ? 1 : 0);
  list.sort((a, b) => (prefix(b) - prefix(a)) || (b.tags.length - a.tags.length) || (b.dn - a.dn) || a.s.code.localeCompare(b.s.code) || a.s.sec.localeCompare(b.s.sec));
  let shown = list.slice(0, 60);
  const deptData = Object.assign({}, ...(await Promise.all([...new Set(shown.map((x) => x.s.code.split(' ')[0]))].map(loadDept))));
  // Within the shown page, sink sections whose prerequisites are clearly unmet.
  const unmet = (x) => prereqStatus(deptData[x.s.code]?.pre, takenCodes).met === false;
  shown = [...shown.filter((x) => !unmet(x)), ...shown.filter(unmet)];
  const prereqTag = (code) => {
    const st = prereqStatus(deptData[code]?.pre, takenCodes);
    if (st.met === false) return `<span class="rounded bg-red-50 px-1 text-red-700 dark:bg-red-950 dark:text-red-300" title="${esc(deptData[code].pre)}">prereqs not met</span>`;
    if (st.met === null && st.codes.length) return `<span class="rounded bg-zinc-100 px-1 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title="${esc(deptData[code].pre)}">check prereqs</span>`;
    return '';
  };
  $('#sched-count').textContent = `${list.length} section${list.length === 1 ? '' : 's'}${list.length > 60 ? ', showing 60' : ''}`;
  $('#sched-candidates').innerHTML = shown.map(({ s, tags }) => `<div class="flex items-start gap-2 border-b border-zinc-100 py-1.5 text-xs last:border-0 dark:border-zinc-800/70">
      <button type="button" class="btn-icon mt-0.5 size-6 shrink-0 rounded" data-f="add" data-crn="${s.crn}" aria-label="Add ${esc(s.code)} ${esc(s.sec)}"><svg class="size-3.5"><use href="#i-plus"/></svg></button>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-1.5"><span class="course-ref cursor-help font-mono text-[12px] font-medium" data-course="${esc(s.code)}" tabindex="0">${esc(s.code)}</span><span class="font-mono text-[10px] text-zinc-400">${esc(s.sec)}</span><span class="min-w-0 truncate text-zinc-600 dark:text-zinc-400">${esc(titleCase(s.title))}</span></div>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-zinc-500"><span class="font-mono">${esc(meetingText(s))}</span><span>${s.credits} hr</span>${s.dist ? `<span class="${dist && dist.need[s.dist] > 0 ? 'rounded bg-amber-50 px-1 font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300' : ''}" title="${dist && dist.need[s.dist] > 0 ? 'You still need courses in this distribution group' : 'Distribution group'}">D${s.dist === 'I' ? 1 : s.dist === 'II' ? 2 : 3}${dist && dist.need[s.dist] > 0 ? ' needed' : ''}</span>` : ''}${s.instr ? `<span class="truncate">${esc(s.instr.split(' ').slice(0, 2).join(' '))}</span>` : ''}
          ${tags.map((t) => `<span class="rounded px-1 ${t.kind === 'req' ? 'bg-rice-50 text-rice-700 dark:bg-rice-950 dark:text-rice-200' : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}">${esc(t.text)}</span>`).join('')}${prereqTag(s.code)}</div>
      </div></div>`).join('') || '<p class="py-3 text-xs text-zinc-500">No sections match. Loosen a filter or clear the search.</p>';
}
