// "University requirements" strip on the Audit tab, with GPA and what-if grades.
import { $, school, runtime } from '../core.js';
import { esc } from './render.js';
import { auditDegree } from '../engine/degree.js';
import { projectedGpa, pointsFor, GRADES } from '../engine/grades.js';
import { courseDetails } from '../data/courseinfo.js';

let overviewToken = 0;
export function renderOverview(courses, declaredResults) {
  const el = $('#overview'); if (!el) return;
  const used = new Set(declaredResults.flatMap((r) => r.usedCourses.map((c) => c.key)));
  const unused = courses.filter((c) => !used.has(c.key));
  const ips = courses.filter((c) => c.status === 'in-progress' && (c.hours || 0) > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const num = (n) => (n % 1 ? n.toFixed(1) : n);
  const tile = (label, body, sub = '') => `<div class="min-w-0"><div class="text-[11px] text-zinc-500">${label}</div><div class="text-base font-semibold tabular-nums leading-tight">${body}</div>${sub ? `<div class="text-[11px] text-zinc-500">${sub}</div>` : ''}</div>`;
  const frame = (inner) => `<div class="mb-2 flex items-baseline justify-between gap-3"><h2 class="text-sm font-semibold" title="Counts completed, in-progress, and planned courses">University requirements</h2>${ips.length ? `<button type="button" id="gpa-toggle" class="shrink-0 text-xs font-medium text-rice-700 hover:underline dark:text-rice-300">What-if grades</button>` : ''}</div><div class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">${inner}</div><div id="gpa-panel" class="mt-3 hidden border-t border-zinc-100 pt-2 dark:border-zinc-800"></div><div id="unused-list" class="mt-3 hidden flex-wrap gap-1.5"></div><p id="degree-notes" class="mt-3 hidden border-t border-zinc-100 pt-2 text-xs leading-5 text-amber-700 dark:border-zinc-800 dark:text-amber-300"></p>`;
  const unusedTile = `<div class="min-w-0"><div class="text-[11px] text-zinc-500">Not used by your programs</div><div class="text-base font-semibold tabular-nums leading-tight">${unused.length}<span class="text-sm font-normal text-zinc-400"> course${unused.length === 1 ? '' : 's'}</span></div>${unused.length ? `<button type="button" id="unused-toggle" class="text-[11px] font-medium text-rice-700 hover:underline dark:text-rice-300">Show</button>` : ''}</div>`;
  const wire = (gpaNow) => {
    if (unused.length) {
      $('#unused-list').innerHTML = [...unused].sort((a, b) => a.code.localeCompare(b.code)).map((c) => `<span class="rounded border border-zinc-200 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-800"><span class="course-ref cursor-help" data-course="${esc(c.code)}" tabindex="0">${esc(c.code)}</span><span class="ml-1 font-sans text-zinc-500">${c.hours}</span></span>`).join('');
      $('#unused-toggle').addEventListener('click', (e) => { const l = $('#unused-list'); const closed = l.classList.toggle('hidden'); l.classList.toggle('flex', !closed); e.target.textContent = closed ? 'Show' : 'Hide'; });
    }
    const toggle = $('#gpa-toggle');
    if (!toggle) return;
    const panel = $('#gpa-panel');
    panel.innerHTML = `<p class="text-xs text-zinc-500">Assume grades for your in-progress courses to project your GPA. Nothing is saved.</p>
      <div class="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">${ips.map((c) => `<label class="flex items-center justify-between gap-3 text-xs"><span class="font-mono text-[12px]">${esc(c.code)} <span class="font-sans text-zinc-500">${c.hours}h</span></span><select data-gpa-for="${esc(c.key)}" class="field h-7 w-20 px-1.5 text-xs" aria-label="Assumed grade for ${esc(c.code)}"><option value="">—</option>${GRADES.map((g) => `<option>${g}</option>`).join('')}</select></label>`).join('')}</div>
      <p class="mt-2 text-sm">Projected GPA <strong id="gpa-proj" class="tabular-nums">—</strong>${gpaNow != null ? `<span class="ml-2 text-xs text-zinc-500">(now ${gpaNow.toFixed(2)})</span>` : ''}</p>`;
    const recompute = () => {
      const assumptions = {};
      panel.querySelectorAll('[data-gpa-for]').forEach((s) => { if (s.value) assumptions[s.dataset.gpaFor] = s.value; });
      const p = projectedGpa(courses, assumptions, pointsFor(school));
      $('#gpa-proj').textContent = p == null ? '—' : p.toFixed(2);
    };
    panel.addEventListener('change', recompute);
    toggle.addEventListener('click', () => { const closed = panel.classList.toggle('hidden'); toggle.textContent = closed ? 'What-if grades' : 'Hide what-if'; if (!closed) recompute(); });
  };
  el.innerHTML = frame(tile('Hours', '<span class="text-zinc-400">…</span>') + tile('GPA', '<span class="text-zinc-400">…</span>') + unusedTile); wire(null);
  const token = ++overviewToken;
  const programs = declaredResults.map((r) => r.program);
  auditDegree({ school, courses, programs, loadDetails: (code) => courseDetails(school, code) }).then((d) => {
    if (token !== overviewToken || !d) return;
    runtime.degree = d;
    const warn = 'text-amber-600 dark:text-amber-400', ok = 'text-emerald-600 dark:text-emerald-400';
    // Explanations sit behind a small alert icon next to the figure they concern.
    const hint = (about) => { const t = d.notes.filter((n) => n.about === about).map((n) => n.text).join(' '); return t ? ` <span class="inline-block cursor-help align-[-2px] text-amber-500" tabindex="0" role="img" aria-label="${esc(t)}" title="${esc(t)}"><svg class="size-3.5" aria-hidden="true"><use href="#i-alert"/></svg></span>` : ''; };
    const inRes = (r) => (r ? `${num(r.have)} at ${esc(school.shortName || school.name)}, ${r.need} required` : '');
    const base = school.degree.hours || 120, amount = (t) => `${num(t.have)}<span class="text-sm font-normal text-zinc-400"> / ${t.need}</span>`;
    const hoursTile = tile(`Hours${hint('hours')}`, amount(d.hours), inRes(d.residency?.hours) || (d.hours.need > base ? `your degree requires more than ${base}` : ''));
    const upperTile = tile(`<span title="${school.degree.upperLevel || 300} level and above">Upper-level hours</span>`, amount(d.upper), inRes(d.residency?.upper));
    const distTile = `<div class="min-w-0"><div class="text-[11px] text-zinc-500" title="${school.degree.distribution?.courses} courses per group, from ${school.degree.distribution?.minDepartments}+ departments">Distribution</div><div class="flex gap-2 text-base font-semibold tabular-nums leading-tight">${Object.entries(d.dist).map(([g, v], i) => `<span title="${esc((v.courses.map((c) => c.code).join(', ') || 'none yet') + (v.detail ? ' — ' + v.detail : ''))}"><span class="text-[11px] font-normal text-zinc-500">D${i + 1} </span><span class="${v.satisfied ? '' : warn}">${v.have}/${v.target}</span>${hint(`dist:${g}`)}</span>`).join('')}</div><div class="text-[11px] text-zinc-500">${Object.values(d.dist).some((v) => v.detail) ? Object.entries(d.dist).filter(([, v]) => v.detail).map(([g]) => `Group ${g} needs a second department`).join('; ') : ''}</div></div>`;
    const checks = `<div class="min-w-0"><div class="text-[11px] text-zinc-500">Also required</div><div class="flex flex-wrap gap-x-3 gap-y-0.5 text-sm font-medium leading-tight">${d.items.map((it) => `<span class="${it.satisfied ? ok : warn}" title="${esc(it.name)}${it.courses.length ? ': ' + esc(it.courses.map((c) => c.code).join(', ')) : ''}">${it.satisfied ? '✓' : '○'} ${esc(school.degree[it.id]?.short || it.name)}</span>`).join('')}</div></div>`;
    const gpaTile = tile('GPA', d.gpa != null ? d.gpa.toFixed(2) : '—', 'cumulative');
    el.innerHTML = frame(hoursTile + upperTile + distTile + checks + gpaTile + unusedTile); wire(d.gpa);
    const loud = d.notes.filter((n) => n.about === 'gpa');
    if (loud.length) { const n = $('#degree-notes'); n.classList.remove('hidden'); n.textContent = loud.map((x) => x.text).join(' '); }
  });
}
