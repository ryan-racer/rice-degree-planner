// Hover / tap card with course details: description, prerequisites, distribution, credit hours, and the
// terms the course has been offered. Details are loaded lazily per department from the school's data path.

import { esc, titleCase } from './render.js';
import { loadSections, latestSectionTerm } from './schedule.js';
import { courseDetails, clearCourseInfoCache, prereqStatus } from '../data/courseinfo.js';

let card, current, hideTimer, school, takenCodes = new Set();

export function initCourseCards(activeSchool) {
  school = activeSchool;
  card = document.createElement('div');
  card.id = 'course-card';
  card.setAttribute('role', 'tooltip');
  card.className = 'pointer-events-auto fixed z-40 hidden w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-zinc-200 bg-white p-3.5 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900';
  document.body.appendChild(card);

  document.addEventListener('mouseover', (e) => { const el = e.target.closest?.('[data-course]'); if (el) show(el); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest?.('[data-course]'); if (el && !card.contains(e.relatedTarget)) scheduleHide(); });
  card.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  card.addEventListener('click', (e) => { const b = e.target.closest('[data-find-sections]'); if (b) { hide(); window.dispatchEvent(new CustomEvent('dp:find-sections', { detail: { code: b.dataset.findSections } })); } });
  card.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('focusin', (e) => { const el = e.target.closest?.('[data-course]'); if (el) show(el); else if (!card.contains(e.target)) hide(); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-course]');
    if (el && !el.closest('button, a, input, select')) { e.preventDefault(); current === el && !card.classList.contains('hidden') ? hide() : show(el); }
    else if (!card.contains(e.target)) hide();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (current) position(current); }, { passive: true });
}

export function setCourseCardSchool(s) { school = s; clearCourseInfoCache(); hide(); }
/** Codes (with cross-list aliases) the student has taken, is taking, or plans; used to check prerequisites. */
export function setTakenCodes(codes) { takenCodes = new Set(codes); }

function scheduleHide() { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 120); }
function hide() { card.classList.add('hidden'); current = null; }

async function show(el) {
  clearTimeout(hideTimer);
  const code = el.dataset.course;
  if (!code) return;
  current = el;
  const info = school.catalog?.[code];
  card.innerHTML = body(code, info, null, true);
  card.classList.remove('hidden');
  position(el);
  const term = latestSectionTerm(school);
  const [details, sections] = await Promise.all([loadDetails(code), term && school.sectionDataPath ? loadSections(term) : Promise.resolve([])]);
  if (current !== el) return;
  const timed = sections.filter((x) => x.code === code && x.meetings.length).length;
  card.innerHTML = body(code, info, details, false, term ? { term, count: timed } : null);
  position(el);
}

function loadDetails(code) { return courseDetails(school, code); }

function position(el) {
  const r = el.getBoundingClientRect();
  const cw = card.offsetWidth, ch = card.offsetHeight;
  let left = Math.min(Math.max(8, r.left), window.innerWidth - cw - 8);
  let top = r.bottom + 6;
  if (top + ch > window.innerHeight - 8) top = Math.max(8, r.top - ch - 6);
  card.style.left = `${left}px`; card.style.top = `${top}px`;
}

// Rice-style term codes: YYYY10 = Fall of YYYY-1, YYYY20 = Spring YYYY, YYYY30 = Summer YYYY.
export function termName(code) {
  const y = Number(String(code).slice(0, 4)), s = String(code).slice(4);
  if (s === '10') return `Fall ${y - 1}`;
  if (s === '20') return `Spring ${y}`;
  if (s === '30') return `Summer ${y}`;
  return String(code);
}

function offeringSummary(offered, allTerms) {
  if (!offered?.length) return { line: 'No sections found in the recent schedule.', chips: [] };
  const recent = (allTerms || []).slice(-6); // last ~2 academic years of fall/spring/summer
  const set = new Set(offered.map(String));
  const seasons = { 10: 'Fall', 20: 'Spring', 30: 'Summer' };
  const bySeason = {};
  for (const t of recent) { const s = seasons[String(t).slice(4)]; bySeason[s] = bySeason[s] || { total: 0, hit: 0 }; bySeason[s].total++; if (set.has(String(t))) bySeason[s].hit++; }
  const always = Object.entries(bySeason).filter(([, v]) => v.total && v.hit === v.total).map(([k]) => k);
  const sometimes = Object.entries(bySeason).filter(([, v]) => v.hit && v.hit < v.total).map(([k]) => k);
  const last = [...set].sort().at(-1);
  let line;
  if (always.length) {
    line = `Offered every ${always.join(' and ')}${sometimes.length ? `, sometimes ${sometimes.join('/')}` : ''}.`;
    const only = always.filter((x) => x !== 'Summer');
    if (only.length === 1 && !sometimes.filter((x) => x !== 'Summer').length) {
      // Fall-only or spring-only: predict the next run from the last covered term.
      const lastCovered = String((allTerms || []).at(-1) || '');
      let y = Number(lastCovered.slice(0, 4)), sfx = lastCovered.slice(4);
      let next = '';
      for (let i = 0; i < 4 && !next; i++) { if (sfx === '10') { sfx = '20'; } else if (sfx === '20') { sfx = '30'; } else { sfx = '10'; y += 1; } if ((only[0] === 'Fall' && sfx === '10') || (only[0] === 'Spring' && sfx === '20')) next = termName(`${y}${sfx}`); }
      if (next) line = `${only[0]} only so far, so expect it next in ${next}.`;
    }
  }
  if (!always.length && sometimes.length) line = `Offered some ${sometimes.join('/')} terms; last in ${termName(last)}.`;
  if (!always.length && !sometimes.length) line = `Last offered ${termName(last)}.`;
  const chips = (allTerms || []).filter((t) => String(t).slice(4) !== '30').slice(-8).map((t) => ({ name: termName(t).replace('Spring', 'Sp').replace('Fall', 'Fa'), on: set.has(String(t)) }));
  return { line, chips };
}

function body(code, info, d, loading, sec) {
  const title = titleCase(info?.title || d?.t || '');
  const meta = [info?.hours != null ? `${info.hours} hrs` : '', d?.dist ? d.dist.replace(/^Distribution Group/i, 'Dist.') : '', (d?.level || '').replace('Undergraduate', 'UG').replace('Graduate', 'Grad')].filter(Boolean).join(' · ');
  const desc = d?.d ? (d.d.length > 420 ? d.d.slice(0, 400).replace(/\s+\S*$/, '') + '…' : d.d) : '';
  const off = d ? offeringSummary(d.o, d.terms || school.scheduleTerms) : null;
  return `
    <div class="flex items-baseline justify-between gap-3">
      <div class="shrink-0 whitespace-nowrap font-mono text-[13px] font-medium">${esc(code)}</div>
      <div class="min-w-0 truncate text-[11px] text-zinc-500">${esc(meta)}</div>
    </div>
    ${title ? `<div class="mt-0.5 font-medium leading-snug">${esc(title)}</div>` : ''}
    ${loading ? '<div class="mt-2 text-xs text-zinc-400">Loading details…</div>' : ''}
    ${desc ? `<p class="mt-2 text-xs leading-5 text-zinc-600 dark:text-zinc-400">${esc(desc)}</p>` : (!loading && !d ? '<p class="mt-2 text-xs text-zinc-400">No catalog entry for this course.</p>' : '')}
    ${d?.pre ? prereqHtml(d.pre) : ''}
    ${off ? `<div class="mt-2.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
      <div class="text-[11px] text-zinc-600 dark:text-zinc-400">${esc(off.line)}</div>
      ${off.chips.length ? `<div class="mt-1.5 flex flex-wrap gap-1">${off.chips.map((c) => `<span class="rounded px-1.5 py-px font-mono text-[10px] ${c.on ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-zinc-100 text-zinc-400 line-through dark:bg-zinc-800 dark:text-zinc-500'}">${esc(c.name)}</span>`).join('')}</div>` : ''}
    </div>` : ''}
    ${d?.x ? `<div class="mt-1.5 text-[11px] text-zinc-500">Cross-listed: ${esc(d.x)}</div>` : ''}
    ${sec ? `<div class="mt-2 flex items-center justify-between gap-2 border-t border-zinc-200 pt-2 text-[11px] dark:border-zinc-800"><span class="text-zinc-600 dark:text-zinc-400">${esc(termName(sec.term))}: ${sec.count ? `${sec.count} section${sec.count === 1 ? '' : 's'} with set times` : 'no scheduled sections'}</span>${sec.count ? `<button type="button" class="font-medium text-rice-700 hover:underline dark:text-rice-300" data-find-sections="${esc(code)}">Find sections →</button>` : ''}</div>` : ''}`;
}

function prereqHtml(text) {
  const st = prereqStatus(text, takenCodes);
  const verdict = st.met === true ? '<span class="text-emerald-600 dark:text-emerald-400">met</span>' : st.met === false ? '<span class="text-red-600 dark:text-red-400">not met yet</span>' : st.codes.length ? '<span class="text-amber-600 dark:text-amber-400">check</span>' : '';
  const marked = esc(text).replace(/\b([A-Z]{2,5}) (\d{3}[A-Z]?)\b/g, (m, d, n) => { const ok = takenCodes.has(`${d} ${n}`); return `<span class="font-mono ${ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}">${m}${ok ? ' ✓' : ''}</span>`; });
  return `<p class="mt-2 text-[11px] leading-4 text-zinc-500"><span class="font-medium text-zinc-600 dark:text-zinc-400">Prerequisites</span> ${verdict ? `(${verdict})` : ''} ${marked}</p>`;
}
