// Renders audit results as HTML strings. All user data is escaped.
import { specLabel } from '../engine/match.js';
import { programNotes } from '../engine/degree.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="size-4 shrink-0 ${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;

/**
 * One program row. `variant` is 'card' (declared programs, standalone bordered block) or 'row' (explorer list item).
 */
const NOTE = 'mb-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200';
const policyNotes = (result, school) => programNotes(result, school).map((t) => `<p class="${NOTE}">${esc(t)}</p>`).join('');

export function programCard(result, { expanded, declared, school, variant = 'row' }) {
  EDIT = declared ? result.program.id : null;
  const p = result.program;
  const pct = Math.round(result.pct * 100);
  const done = result.satisfied;
  const n = result.usedCourses.length;
  const planned = result.usedCourses.filter((c) => c.status === 'planned').length;
  const wrap = variant === 'card' ? 'panel' : '';
  return `
  <article class="${wrap}" data-id="${esc(p.id)}">
    <button type="button" class="prog-head grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-zinc-50 sm:grid-cols-[1fr_9rem_4.5rem_1rem] dark:hover:bg-zinc-800/50" aria-expanded="${expanded ? 'true' : 'false'}">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="font-medium">${esc(p.name)}</span>
          ${p.degree && p.degree.toLowerCase() !== p.kind ? `<span class="text-sm text-zinc-500">${esc(p.degree)}</span>` : ''}
          ${p.kind !== 'major' ? `<span class="badge badge-minor">${esc(p.kind)}</span>` : ''}
          ${done ? '<span class="badge badge-done">Complete</span>' : ''}
        </div>
        <div class="mt-0.5 truncate text-xs text-zinc-500" title="${esc(p.school)}">${p.hours ? `${p.hours} hrs · ` : ''}${n} course${n === 1 ? '' : 's'} apply</div>
      </div>
      <div class="hidden sm:block" title="${pct}% complete">
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div class="h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-rice-700 dark:bg-rice-400'}" style="width:${pct}%"></div></div>
      </div>
      <div class="text-right">
        <div class="text-lg font-semibold tabular-nums leading-none">${done ? icon('i-check', 'inline size-5 text-emerald-600') : result.remaining}</div>
        <div class="mt-1 text-[11px] text-zinc-500">${done ? 'complete' : 'to go'}${planned ? `<span class="block text-sky-600 dark:text-sky-400">${planned} planned</span>` : ''}</div>
      </div>
      ${icon('i-chevron', `hidden text-zinc-400 transition-transform sm:block ${expanded ? 'rotate-90' : ''}`)}
    </button>
    ${expanded ? `<div class="border-t border-zinc-200 px-4 pb-5 pt-3 dark:border-zinc-800">
      <div class="mb-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-xs">
        <a class="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100" href="${esc(p.url)}" target="_blank" rel="noopener">Catalog page ${icon('i-external', 'size-3')}</a>
        <a class="font-medium text-rice-700 hover:underline dark:text-rice-300" href="#" data-action="${declared ? 'undeclare' : 'declare'}" data-id="${esc(p.id)}">${declared ? 'Remove from my programs' : 'Add to my programs'}</a>
      </div>
      ${policyNotes(result, school)}
      ${p.catalogNote ? `<p class="${NOTE}">${esc(p.catalogNote)}</p>` : ''}
      ${result.tree.map((node) => nodeHtml(node, school, 0)).join('')}
      ${result.constraints?.length ? `<div class="mt-4"><div class="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">Rules across sections</div>${result.constraints.map((k) => `<div class="flex items-center gap-2 py-1 text-sm">${icon(k.satisfied ? 'i-check' : 'i-circle', k.satisfied ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-500')}<span class="min-w-0 flex-1 ${k.satisfied ? '' : 'text-zinc-700 dark:text-zinc-300'}">${esc(k.constraint.label || '')}</span><span class="font-mono text-[11px] tabular-nums ${k.satisfied ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">${k.have % 1 ? k.have.toFixed(1) : k.have} / ${k.constraint.type === 'atMost' ? 'max ' : ''}${k.need}${k.constraint.hours != null ? ' hrs' : ''}</span></div>`).join('')}</div>` : ''}
      ${p.notes?.length ? `<div class="mt-5 rounded-md bg-zinc-50 px-3 py-2.5 text-xs leading-5 text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400"><p class="font-medium text-zinc-700 dark:text-zinc-300">Rules not modeled automatically</p><ul class="mt-1 list-disc space-y-0.5 pl-4">${p.notes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    </div>` : ''}
  </article>`;
}

let EDIT = null; // program id whose open slots offer a manual substitution

function statusText(n) {
  if (n.kind === 'hours') return `${n.earned} / ${n.need} hrs`;
  return `${n.total - n.remaining} / ${n.total}`;
}

function heading(n, depth) {
  if (!n.node.name) return '';
  const cls = depth === 0 || n.kind === 'group' || n.kind === 'any'
    ? 'mt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 first:mt-1'
    : 'mt-2.5 text-sm font-medium';
  const stat = n.satisfied ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400';
  // A one-course requirement already shows a check or an open circle on its only row; "1 / 1" adds nothing.
  const count = n.kind !== 'hours' && n.total === 1 ? '' : `<span class="font-mono text-[11px] font-normal tabular-nums ${stat}">${statusText(n)}</span>`;
  return `<div class="${cls} flex items-baseline justify-between gap-3"><span>${esc(n.node.name)}</span>${count}</div>`;
}

function nodeHtml(n, school, depth) {
  const note = n.node.note ? `<p class="mt-0.5 text-xs text-zinc-500">${esc(n.node.note)}</p>` : '';
  const indent = depth > 0 ? 'ml-1 border-l border-zinc-200 pl-3 dark:border-zinc-800' : '';
  switch (n.kind) {
    case 'group':
      return `<section class="${indent}">${heading(n, depth)}${note}${n.children.map((c) => nodeHtml(c, school, depth + 1)).join('')}</section>`;
    case 'any': {
      const alts = (n.alternatives || []).map((a) => esc(a.node.name || 'alternative')).join(', ');
      return `<section class="${indent}">${heading(n, depth)}${note}
        ${n.chosen ? `<p class="mt-1 text-xs text-zinc-500">Closest option: <span class="font-medium text-zinc-700 dark:text-zinc-300">${esc(n.chosen.node.name || 'option')}</span>${alts ? ` · also: ${alts}` : ''}</p>${nodeHtml(n.chosen, school, depth + 1)}` : ''}</section>`;
    }
    case 'course':
    case 'all':
      return `<div class="${indent}">${heading(n, depth)}${note}${n.slots.map((s) => slotHtml(s.course, s.specs, school, null, null, { key: s.key, manual: s.manual })).join('')}</div>`;
    case 'choose': {
      const rows = n.filled.map((c) => slotHtml(c, null, school, null, null, { key: n.path, manual: n.manual?.has(c.key) })).join('');
      const missing = (n.missing || []).map((m) => slotHtml(null, m.specs, school, null, m.label, { key: n.path })).join('');
      return `<div class="${indent}">${heading(n, depth)}${note}${rows}${missing}</div>`;
    }
    case 'hours': {
      const rows = n.filled.map((c) => slotHtml(c, null, school, null, null, { key: n.path, manual: n.manual?.has(c.key) })).join('');
      const missing = n.remaining > 0 ? slotHtml(null, n.node.from, school, `${n.need - n.earned} more hrs`, null, { key: n.path }) : '';
      return `<div class="${indent}">${heading(n, depth)}${note}${rows}${missing}</div>`;
    }
    default: return '';
  }
}

const passFailText = (school, code) => (school.passFailNotice ? school.passFailNotice([code]) : `${code} was taken Pass/Fail; a major or minor may require the letter grade.`);

function slotHtml(course, specs, school, prefix, label, ov = {}) {
  const sub = EDIT && ov.key ? `<button type="button" class="shrink-0 text-[11px] font-medium text-rice-700 hover:underline dark:text-rice-300" data-ov-add="${esc(ov.key)}" data-prog="${esc(EDIT)}" title="Count one of your courses here (for advisor-approved substitutions)">Substitute</button>` : '';
  if (course) {
    const ip = course.status === 'in-progress';
    const planned = course.status === 'planned';
    const title = course.title || school.catalog?.[course.code]?.title || '';
    const right = [course.grade, ip ? 'in progress' : planned ? 'planned' : '', course.term].filter(Boolean).join(' · ');
    return `<div class="flex items-center gap-2 py-1 text-sm">
      ${icon(planned ? 'i-planned' : ip ? 'i-half' : 'i-check', planned ? 'text-sky-500' : ip ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400')}
      <span class="course-ref shrink-0 cursor-help whitespace-nowrap font-mono text-[13px] underline decoration-dotted decoration-zinc-300 underline-offset-4 hover:decoration-zinc-500 dark:decoration-zinc-600" data-course="${esc(course.code)}" tabindex="0">${esc(course.code)}</span>
      <span class="min-w-0 truncate text-zinc-500">${esc(titleCase(title))}</span>
      ${course.passFail ? `<span class="shrink-0 cursor-help text-amber-500" tabindex="0" role="img" aria-label="${esc(passFailText(school, course.code))}" title="${esc(passFailText(school, course.code))}">${icon('i-alert', '')}</span>` : ''}
      ${ov.manual ? `<span class="rounded bg-violet-50 px-1 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300" title="Manual substitution">manual</span>${EDIT ? `<button type="button" class="text-[11px] text-zinc-500 hover:underline" data-ov-remove="${esc(ov.key)}" data-code="${esc(course.code)}" data-prog="${esc(EDIT)}">undo</button>` : ''}` : ''}
      <span class="ml-auto hidden shrink-0 font-mono text-[11px] tabular-nums text-zinc-400 sm:inline">${esc(right)}</span></div>`;
  }
  const list = specs || [];
  if (label) return `<div class="flex items-center gap-2 py-1 text-sm">${icon('i-circle', 'text-zinc-300 dark:text-zinc-600')}<span class="min-w-0 flex-1 text-zinc-500">${esc(label)}</span>${sub}</div>`;
  const labels = list.map((s) => typeof s === 'string'
    ? `<span class="course-ref cursor-help whitespace-nowrap font-mono text-[13px] text-zinc-700 underline decoration-dotted decoration-zinc-300 underline-offset-4 hover:decoration-zinc-500 dark:text-zinc-300 dark:decoration-zinc-600" data-course="${esc(s)}" tabindex="0">${esc(s)}</span>`
    : `<span class="whitespace-nowrap font-mono text-[13px] text-zinc-700 dark:text-zinc-300">${esc(specLabel(s, null))}</span>`);
  const single = list.length === 1 && typeof list[0] === 'string' ? school.catalog?.[list[0]]?.title : '';
  const MAX = 6;
  const shown = labels.slice(0, MAX).join('<span class="text-zinc-400"> or </span>');
  const rest = labels.length > MAX ? `<button type="button" class="more-opts ml-1 text-xs font-medium text-rice-700 hover:underline dark:text-rice-300" data-more="${esc(list.slice(MAX).map((s) => specLabel(s, null)).join(', '))}">+${labels.length - MAX} more</button>` : '';
  return `<div class="flex items-center gap-2 py-1 text-sm">
    ${icon('i-circle', 'text-zinc-300 dark:text-zinc-600')}
    <span class="min-w-0 flex-1">${prefix ? `<span class="text-zinc-500">${esc(prefix)} from </span>` : ''}${shown}${rest}${single ? `<span class="ml-2 truncate text-zinc-500">${esc(titleCase(single))}</span>` : ''}</span>${sub}</div>`;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with']);
/** Catalog titles are shouty upper-case; soften them for display. */
export function titleCase(s) {
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/[a-z0-9&'().-]+/g, (w, i) => {
    if (/^(i{1,3}|iv|v|vi{1,3}|ix|x)$/.test(w)) return w.toUpperCase();
    if (/^(ai|ap|ml|us|uk|eu|dna|rna|cad|gis|hiv|nmr|pde|ode|vlsi|cmos|ee|cs)$/.test(w)) return w.toUpperCase();
    if (i > 0 && SMALL.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}
