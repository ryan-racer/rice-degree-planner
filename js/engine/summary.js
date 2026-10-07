// Plain-text advising summary. Pure function of audit outputs: declared programs
// with what is still needed, university requirements, and the closest alternatives.
import { specLabel } from './match.js';
import { gpaOf, pointsFor } from './grades.js';

const fmt = (n) => (n % 1 ? n.toFixed(1) : String(n));

function specText(s) {
  if (typeof s === 'string') return s;
  if (s && Array.isArray(s.courses)) return s.courses.join('/');
  try { return specLabel(s, null) || 'a course'; } catch { return 'a course'; }
}

function missingLines(node, out) {
  if (!node || node.satisfied) return;
  if (node.kind === 'group') { for (const ch of node.children || []) missingLines(ch, out); return; }
  if (node.kind === 'any') { if (node.chosen) missingLines(node.chosen, out); return; }
  const name = node.node?.name || 'Requirement';
  if (node.kind === 'course' || node.kind === 'all') {
    for (const sl of node.slots || []) {
      if (sl.course) continue;
      const opts = (sl.specs || []).map(specText).filter(Boolean);
      out.push(opts.length > 3 ? `${name}: one of ${opts.slice(0, 3).join(', ')}, …` : `${name}: ${opts.join(' or ') || 'a course'}`);
    }
    return;
  }
  if (node.kind === 'choose') {
    const miss = node.missing || [];
    const bits = miss.filter((m) => m.label).map((m) => m.label);
    const specSet = [...new Set(miss.filter((m) => !m.label).flatMap((m) => (m.specs || []).map(specText).filter(Boolean)))];
    if (specSet.length && specSet.length <= 4) bits.push(`one of ${specSet.join(', ')}`);
    else if (specSet.length) bits.push(`${specSet.slice(0, 3).join(', ')}, …`);
    out.push(`${name}: ${node.remaining} more${bits.length ? ` (${bits.join('; ')})` : ''}`);
    return;
  }
  if (node.kind === 'hours') {
    out.push(`${name}: ${fmt(node.need - node.earned)} more hours`);
  }
}

/** Short "still needed" lines for an audit result tree, capped. */
export function stillNeeded(tree, limit = 8) {
  const out = [];
  for (const n of tree || []) missingLines(n, out);
  return out.slice(0, limit);
}

export function buildSummary({ school, courses = [], declaredResults = [], degree = null, ranked = [], catalogYear = '', date = '' }) {
  const L = [];
  L.push(`${school?.name || 'Degree Planner'} Degree Planner summary${date ? ` — ${date}` : ''}`);
  if (catalogYear) L.push(`Catalog: ${catalogYear}`);
  const g = gpaOf((courses || []).filter((c) => c.source !== 'transfer'), pointsFor(school));
  L.push(`Transcript: ${courses.length} courses${g != null ? `, GPA ${g.toFixed(2)}` : ''}`);
  L.push('');
  if (!declaredResults.length) L.push('No declared programs.');
  for (const r of declaredResults) {
    const p = r.program, pct = Math.round((r.pct || 0) * 100);
    L.push(`${p.name} (${p.degree}): ${r.satisfied ? 'COMPLETE' : `${pct}% complete, ${r.remaining} requirement${r.remaining === 1 ? '' : 's'} to go`}`);
    if (!r.satisfied) for (const n of stillNeeded(r.tree)) L.push(`  - ${n}`);
  }
  if (degree) {
    L.push('');
    L.push(`University requirements: ${fmt(degree.hours.have)}/${degree.hours.need} hours; ${fmt(degree.upper.have)}/${degree.upper.need} upper-level hours`);
    const dists = Object.entries(degree.dist || {}).map(([k, v]) => `D${k} ${v.have}/${v.target}${v.detail ? ` (${v.detail})` : ''}`);
    if (dists.length) L.push(`Distribution: ${dists.join('; ')}`);
    if (degree.items?.length) L.push(`Also required: ${degree.items.map((i) => `${i.satisfied ? 'done' : 'missing'}: ${school?.degree?.[i.id]?.short || i.name}`).join('; ')}`);
  }
  const close = (ranked || []).filter((r) => !r.satisfied).slice(0, 5);
  if (close.length) {
    L.push('');
    L.push('Closest other programs:');
    for (const r of close) L.push(`  - ${r.program.name} (${r.program.degree}, ${r.program.kind}): ${r.remaining} to go (${Math.round((r.pct || 0) * 100)}%)`);
  }
  L.push('');
  L.push('Estimates from the General Announcements, not an official audit.');
  return L.join('\n');
}
