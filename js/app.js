// Application shell: wires the header, transcript import, tabs, and the Audit tab, and boots the UI modules.
import { schools, getSchool } from './schools/index.js';
import { $, state, school, setSchool, runtime, hooks, save, load, cleanCourses, cleanPlan, setStatus, activeYear, activePrograms, inferCatalogYear, inferredExact } from './core.js';
import { detectDeclared } from './import/declared.js';
import { undoable } from './ui/undo.js';
import { renderOverview } from './ui/overview.js';
import { renderTimeline, initTimeline, renderSuggestions, prepared, scheduleSectionsCache } from './ui/timeline.js';
import { parseTranscript } from './parser/transcript.js';
import { pdfToText } from './parser/pdf.js';
import { auditProgram, auditAll } from './engine/audit.js';
import { buildSummary } from './engine/summary.js';
import { programCard, esc, titleCase } from './ui/render.js';
import { initCourseCards, setCourseCardSchool, setTakenCodes } from './ui/coursecard.js';
import { initCourseAutocomplete, setAutocompleteSchool } from './ui/autocomplete.js';
import { initSchedule, render as renderSchedule, findSections } from './ui/schedule.js';

const PAGE = 15;


// ---------- persistence ----------

// ---------- catalog year ----------

// ---------- undo ----------

// ---------- chrome ----------
function initChrome() {
  $('#theme-toggle').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('rf.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
  });
  const sel = $('#school-select');
  sel.innerHTML = schools.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = school.id;
  if (schools.length < 2) { sel.hidden = true; const sep = $('#school-sep'); if (sep) sep.hidden = true; }
  sel.addEventListener('change', () => {
    setSchool(getSchool(sel.value));
    setCourseCardSchool(school);
    setAutocompleteSchool(school);
    scheduleCtx.school = school;
    state.courses = []; state.declared = []; state.plan = []; state.expanded.clear();
    load(); renderAll(); save();
  });
  $('#year-select').addEventListener('change', (e) => { state.catalogYear = e.target.value; save(); renderAll(); });
}

// ---------- import ----------

async function handleFile(file) {
  if (!file) return;
  try {
    let text;
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      setStatus('Reading PDF…');
      text = await pdfToText(await file.arrayBuffer(), (p, n) => setStatus(`Reading PDF, page ${p} of ${n}…`));
    } else {
      text = await file.text();
      if (/\.json$/i.test(file.name) || text.trimStart().startsWith('{')) {
        let data = null;
        try { data = JSON.parse(text); } catch { /* not JSON after all */ }
        if (data && data.app === 'DegreePlanner') { restore(data, file.name); return; }
      }
    }
    ingest(text, file.name);
  } catch (e) {
    console.error(e);
    setStatus(`Could not read ${file.name}: ${e.message || e}`, 'error');
    $('#workspace').hidden = true; $('#intro').hidden = false;
  }
}

function ingest(text, label = 'text') {
  const { courses, declared, warnings } = parseTranscript(text, school);
  if (!courses.length) {
    setStatus(`No course codes (like "COMP 140") were found in ${label}. The text we read is shown below so you can check or edit it, then import again.`, 'error');
    $('#paste-text').value = text || '';
    $('#paste-box').hidden = false;
    $('#workspace').hidden = true; $('#intro').hidden = false;
    return;
  }
  const previous = state.courses;
  state.courses = courses.map((c) => ({ ...c }));
  const detected = detectDeclared(declared, activePrograms());
  if (detected.length || !state.declared.length) state.declared = detected;
  state.expanded = new Set(state.declared);
  state.page = 1;
  const notes = [...warnings];
  if (previous.length) {
    const before = new Map(previous.map((c) => [c.code, c]));
    const after = new Map(state.courses.map((c) => [c.code, c]));
    const added = [...after.keys()].filter((k) => !before.has(k));
    const removed = [...before.keys()].filter((k) => !after.has(k));
    const finished = [...after.values()].filter((c) => c.status === 'completed' && before.get(c.code)?.status === 'in-progress').map((c) => `${c.code}${c.grade ? ` (${c.grade})` : ''}`);
    if (added.length) notes.push(`New: ${added.join(', ')}.`);
    if (finished.length) notes.push(`Now completed: ${finished.join(', ')}.`);
    if (removed.length) notes.push(`No longer listed: ${removed.join(', ')}.`);
    // Planned courses that are now on the transcript have happened; drop them from the plan.
    let dropped = 0;
    for (const t of state.plan) { const keep = t.courses.filter((c) => !after.has(c.code)); dropped += t.courses.length - keep.length; t.courses = keep; }
    state.plan = state.plan.filter((t) => t.courses.length);
    if (dropped) notes.push(`${dropped} planned course${dropped === 1 ? ' that is' : 's that are'} now on your transcript ${dropped === 1 ? 'was' : 'were'} removed from the plan.`);
  }
  setStatus(`${previous.length ? 'Replaced with' : 'Imported'} ${courses.length} courses from ${label}.`, 'ok', notes);
  $('#paste-box').hidden = true;
  save(); renderAll();
  window.scrollTo({ top: 0 });
}


/** Restore a backup produced by the Export button. */
function restore(data, label) {
  if (data.school && data.school !== school.id) { setStatus(`This backup is for a different school (${data.school}).`, 'error'); return; }
  state.courses = cleanCourses(data.courses);
  state.declared = Array.isArray(data.declared) ? data.declared.filter((id) => activePrograms().some((p) => p.id === id)) : [];
  state.plan = cleanPlan(data.plan);
  state.schedule = data.schedule && typeof data.schedule === 'object' ? data.schedule : {};
  state.overrides = data.overrides && typeof data.overrides === 'object' ? data.overrides : {};
  state.includeInProgress = data.includeInProgress !== false;
  state.includePlanned = data.includePlanned !== false;
  state.expanded = new Set(state.declared);
  setStatus(`Restored ${state.courses.length} courses, ${state.declared.length} program${state.declared.length === 1 ? '' : 's'}, and ${state.plan.length} planned term${state.plan.length === 1 ? '' : 's'} from ${label}.`, 'ok');
  save(); renderAll();
  window.scrollTo({ top: 0 });
}


function initImport() {
  const fi = $('#file-input');
  const dz = $('#dropzone');
  const openPicker = () => fi.click();
  dz.addEventListener('click', openPicker);
  dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  $('#replace-btn').addEventListener('click', openPicker);
  fi.addEventListener('change', () => { handleFile(fi.files[0]); fi.value = ''; });

  const overlay = $('#drop-overlay');
  let depth = 0;
  document.addEventListener('dragenter', (e) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); depth++; overlay.classList.remove('hidden'); overlay.classList.add('flex'); dz.classList.add('over'); });
  document.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  const hide = () => { depth = 0; overlay.classList.add('hidden'); overlay.classList.remove('flex'); dz.classList.remove('over'); };
  document.addEventListener('dragleave', () => { if (--depth <= 0) hide(); });
  document.addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) { hide(); return; } e.preventDefault(); hide(); handleFile(e.dataTransfer.files[0]); });

  $('#paste-toggle').addEventListener('click', () => { $('#paste-box').hidden = false; $('#paste-text').focus(); });
  $('#paste-cancel').addEventListener('click', () => { $('#paste-box').hidden = true; });
  $('#parse-btn').addEventListener('click', () => ingest($('#paste-text').value, 'pasted text'));
  $('#sample-btn').addEventListener('click', () => ingest(school.sample || '', 'the sample transcript'));
  $('#demo-btn').addEventListener('click', () => ingest(school.sample || '', 'the demo transcript'));
  document.addEventListener('paste', (e) => {
    if (['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName)) return;
    const t = e.clipboardData?.getData('text');
    if (t && t.length > 40) { $('#paste-text').value = t; ingest(t, 'pasted text'); }
  });

  $('#print-btn').addEventListener('click', () => window.print());
  $('#export-btn').addEventListener('click', () => {
    const payload = { app: 'DegreePlanner', version: 1, school: school.id, exported: new Date().toISOString(), courses: state.courses, declared: state.declared, plan: state.plan, schedule: state.schedule, overrides: state.overrides, includeInProgress: state.includeInProgress, includePlanned: state.includePlanned };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `degreeplanner-${school.id}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#summary-btn').addEventListener('click', async () => {
    const courses = prepared();
    const ranked = auditAll(activePrograms().filter((p) => !state.declared.includes(p.id)), courses, state.overrides);
    const text = buildSummary({ school, courses, declaredResults: runtime.declaredResults, degree: runtime.degree, ranked, catalogYear: activeYear(), date: new Date().toISOString().slice(0, 10) });
    const done = () => setStatus('Summary copied to the clipboard. Paste it into an email to your advisor.', 'ok');
    try { await navigator.clipboard.writeText(text); done(); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); }
      catch { setStatus('Could not copy automatically. Your browser blocked clipboard access.', 'error'); }
      ta.remove();
    }
  });
  $('#reset-btn').addEventListener('click', () => undoable('Everything was cleared.', resetAll));
  $('#include-ip').addEventListener('change', (e) => { state.includeInProgress = e.target.checked; save(); renderAll(); });
  $('#include-planned').addEventListener('change', (e) => { state.includePlanned = e.target.checked; save(); renderAll(); });
  $('#edit-btn').addEventListener('click', () => { state.editing = !state.editing; renderTimeline(); });
}

// ---------- grades ----------

// ---------- timeline ----------












// ---------- results ----------
function renderDeclareSelect() {
  const sel = $('#declare-select');
  const grp = (kind, label) => `<optgroup label="${label}">${activePrograms().filter((p) => p.kind === kind && !state.declared.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name) || a.degree.localeCompare(b.degree))
    .map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${esc(p.degree)})</option>`).join('')}</optgroup>`;
  sel.innerHTML = `<option value="">Add a program…</option>${grp('major', 'Majors')}${grp('minor', 'Minors')}`;
}

function renderResults() {
  const has = state.courses.length > 0;
  $('#intro').hidden = has;
  $('#workspace').hidden = !has;
  if (!has) return;
  const courses = prepared();
  renderDeclareSelect();

  const declaredPrograms = state.declared.map((id) => activePrograms().find((p) => p.id === id)).filter(Boolean);
  const declaredResults = declaredPrograms.map((p) => auditProgram(p, courses, state.overrides[p.id]));
  runtime.prepared = courses; runtime.declaredResults = declaredResults;
  setTakenCodes(courses.flatMap((c) => c.aliases));
  renderOverview(courses, declaredResults);
  $('#declared-audits').innerHTML = declaredResults.length
    ? declaredResults.map((r) => programCard(r, { expanded: state.expanded.has(r.program.id), declared: true, school, variant: 'card' })).join('')
    : `<div class="panel px-4 py-6 text-center text-sm text-zinc-500">No declared programs yet. Choose your major from the menu, or add one from the list below.</div>`;
  renderSuggestions(declaredResults, courses);

  // Hide other degrees of a major you have already declared (BA vs BS of the same field cannot both be earned).
  const declaredMajorNames = new Set(declaredPrograms.filter((p) => p.kind === 'major').map((p) => p.name));
  let results = auditAll(activePrograms().filter((p) => !state.declared.includes(p.id) && !(p.kind === 'major' && declaredMajorNames.has(p.name))), courses, state.overrides);
  if (state.kind !== 'all') results = results.filter((r) => r.program.kind === state.kind);
  if (state.query) {
    const q = state.query.toLowerCase();
    results = results.filter((r) => `${r.program.name} ${r.program.degree} ${r.program.school}`.toLowerCase().includes(q));
  }
  if (state.sort === 'remaining') results.sort((a, b) => a.remaining - b.remaining || b.pct - a.pct || a.program.name.localeCompare(b.program.name));
  if (state.sort === 'name') results.sort((a, b) => a.program.name.localeCompare(b.program.name) || a.program.degree.localeCompare(b.program.degree));
  const shown = results.slice(0, PAGE * state.page);
  $('#explore-list').innerHTML = shown.length
    ? shown.map((r) => programCard(r, { expanded: state.expanded.has(r.program.id), declared: false, school })).join('')
    : `<p class="px-4 py-6 text-center text-sm text-zinc-500">No programs match.</p>`;
  const more = $('#show-more');
  more.hidden = results.length <= shown.length;
  more.textContent = `Show ${Math.min(PAGE, results.length - shown.length)} more of ${results.length - shown.length}`;
}


function initResults() {
  window.addEventListener('dp:find-sections', (e) => {
    state.tab = 'schedule';
    try { localStorage.setItem('rf.tab', state.tab); } catch { /* ignore */ }
    history.replaceState(null, '', '#schedule');
    renderTabs();
    findSections(e.detail.code);
    window.scrollTo({ top: 0 });
  });
  $('#declare-select').addEventListener('change', (e) => {
    const id = e.target.value; if (!id) return;
    if (!state.declared.includes(id)) state.declared.push(id);
    state.expanded.add(id);
    save(); renderResults();
  });
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
    state.kind = b.dataset.kind; state.page = 1; renderResults();
  }));
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; renderResults(); });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); state.page = 1; renderResults(); });
  $('#show-more').addEventListener('click', () => { state.page++; renderResults(); });

  $('#workspace').addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) {
      e.preventDefault();
      const id = act.dataset.id;
      if (act.dataset.action === 'declare' && !state.declared.includes(id)) state.declared.push(id);
      if (act.dataset.action === 'undeclare') { undoable('Program removed from your list.', () => { state.declared = state.declared.filter((x) => x !== id); save(); renderAll(); }); return; }
      save(); renderResults(); return;
    }
    const ovAdd = e.target.closest('[data-ov-add]');
    if (ovAdd) {
      // Swap the button for a picker of the student's own courses that this program is not already using.
      const prog = ovAdd.dataset.prog, key = ovAdd.dataset.ovAdd;
      const result = runtime.declaredResults.find((r) => r.program.id === prog);
      const usedKeys = new Set((result?.usedCourses || []).map((c) => c.key));
      const options = runtime.prepared.filter((c) => !usedKeys.has(c.key)).sort((a, b) => a.code.localeCompare(b.code));
      const sel = document.createElement('select');
      sel.className = 'field h-7 max-w-[15rem] px-1 text-xs';
      sel.setAttribute('aria-label', 'Course to count here');
      sel.innerHTML = `<option value="">Count which course?</option>${options.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} · ${esc(titleCase(c.title || school.catalog?.[c.code]?.title || ''))}${c.status === 'planned' ? ' (planned)' : c.status === 'in-progress' ? ' (in progress)' : ''}</option>`).join('')}`;
      sel.addEventListener('change', () => {
        if (!sel.value) return;
        state.overrides[prog] = [...(state.overrides[prog] || []), { key, code: sel.value }];
        save(); renderAll();
      });
      sel.addEventListener('blur', () => { if (!sel.value) renderResults(); });
      ovAdd.replaceWith(sel); sel.focus();
      return;
    }
    const ovRemove = e.target.closest('[data-ov-remove]');
    if (ovRemove) {
      const prog = ovRemove.dataset.prog;
      const list = state.overrides[prog] || [];
      const i = list.findIndex((o) => o.key === ovRemove.dataset.ovRemove && o.code === ovRemove.dataset.code);
      if (i >= 0) list.splice(i, 1);
      save(); renderAll(); return;
    }
    const more = e.target.closest('.more-opts');
    if (more) { more.replaceWith(document.createTextNode(', ' + more.dataset.more)); return; }
    const head = e.target.closest('.prog-head');
    if (head) {
      const id = head.closest('[data-id]').dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      renderResults();
    }
  });
}

function resetAll() {
  state.courses = []; state.declared = []; state.plan = []; state.schedule = {}; state.overrides = {}; state.expanded.clear(); state.editing = false;
  state.tab = 'audit'; state.page = 1; state.query = ''; $('#search').value = '';
  $('#paste-text').value = ''; $('#paste-box').hidden = true; setStatus('');
  try { localStorage.removeItem(`rf.${school.id}`); localStorage.removeItem('rf.tab'); } catch { /* ignore */ }
  history.replaceState(null, '', location.pathname);
  renderAll();
  window.scrollTo({ top: 0 });
}

function renderTabs() {
  document.querySelectorAll('[role="tab"]').forEach((b) => { const on = b.dataset.tab === state.tab; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== state.tab; });
  const planned = state.plan.reduce((a, t) => a + t.courses.length, 0);
  const badge = $('#tab-planner-count'); badge.hidden = !planned; badge.textContent = String(planned);
}
function initTabs() {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  document.querySelector('[role="tablist"]').addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement); if (i < 0) return;
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length] : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (next) { e.preventDefault(); next.focus(); next.click(); }
  });
  document.querySelectorAll('[role="tab"]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    try { localStorage.setItem('rf.tab', state.tab); } catch { /* ignore */ }
    history.replaceState(null, '', state.tab === 'audit' ? location.pathname : `#${state.tab}`);
    renderTabs();
    if (state.tab === 'schedule') renderSchedule();
  }));
}

function renderYearSelect() {
  const sel = $('#year-select'); const years = school.catalogYears || [];
  sel.hidden = years.length < 2 || !state.courses.length;
  const inferred = inferCatalogYear(), active = activeYear();
  sel.innerHTML = years.map((y) => `<option value="${esc(y)}" ${y === active ? 'selected' : ''}>${esc(y.replace('-', '–'))} catalog${y === inferred ? (inferredExact ? ' (your first year)' : ' (closest to your first year)') : ''}</option>`).join('');
}

/** School labels. The footer names the catalog actually in use, which differs from the current one once a transcript sets the year. */
function renderSchoolLabels() {
  const label = (y) => `${school.name}${y ? ` · ${y.replace('-', '–')} catalog` : ''}`;
  $('#intro-school').textContent = label(school.catalogYear);
  $('#foot-school').textContent = label(state.courses.length ? activeYear() : school.catalogYear);
}

function renderAll() { renderYearSelect(); renderSchoolLabels(); renderTimeline(); renderResults(); renderTabs(); if (state.courses.length && state.tab === 'schedule') renderSchedule(); }

// ---------- offline ----------
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ }));
}

// ---------- boot ----------
hooks.renderAll = renderAll;
hooks.renderResults = renderResults;
initChrome();
initCourseCards(school);
initCourseAutocomplete(school);
initImport();
initTimeline();
initTabs();
const scheduleCtx = { state, school, $, save, rerender: () => { renderTimeline(); renderResults(); renderTabs(); }, getCourses: () => runtime.prepared, getDeclaredResults: () => runtime.declaredResults, sectionsCache: scheduleSectionsCache };
initSchedule(scheduleCtx);
initResults();
load();
renderAll();
