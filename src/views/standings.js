import { escapeHtml } from './html.js';

const seconds = value => {
  const hundredths = Math.round(value * 100);
  return `${Math.floor(hundredths / 6000)}:${((hundredths % 6000) / 100).toFixed(2).padStart(5, '0')}`;
};
export function standingsView(rows) {
  return `<table><caption>Race standings</caption><thead><tr><th scope="col">Place</th><th scope="col">Boat</th><th scope="col">Skill</th><th scope="col">Finish / remaining</th></tr></thead><tbody>${rows.map(row => `<tr data-racer-id="${escapeHtml(row.id)}"${row.role === 'human' ? ' class="human-standing"' : ''}><td>${row.place ?? `${row.order}*`}</td><th scope="row"><i class="boat-chip" style="background:${escapeHtml(row.color)}"></i>${escapeHtml(row.shortLabel)}</th><td>${escapeHtml(row.tier)}</td><td>${row.finished ? seconds(row.finishSeconds) : row.status === 'timed-out' ? 'Time limit' : `${Math.round(row.remainingMeters)} m`}</td></tr>`).join('')}</tbody></table><p>* Live order uses distance to the finish and is provisional. Finish times determine final places; ties share a place.</p>`;
}
