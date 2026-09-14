export function openBusinessReports({ modal, action, esc, request }) {
  const { dialog } = modal('Business reports', `<p>Choose an optional date range. Booked orders, money received and refunds are separate. Reports scan all pages and can be resumed after closing.</p><form data-filters><div class="form-grid"><label class="field">From<input name="from" type="date" /></label><label class="field">Through<input name="to" type="date" /></label><label class="field">City (exact)<input name="city" /></label><label class="field">Recorded service (exact)<input name="service" /></label></div><button class="button button-primary" type="submit">Build report</button></form><div data-reports></div><div data-report></div><p class="form-error" role="alert"></p>`);
  let running = false, busy = false, timer, report, generation = 0;
  const lock = () => dialog.querySelectorAll('[data-filters] button[type="submit"], [data-report-id]').forEach(button => { button.disabled = busy; });
  const error = e => { dialog.querySelector('.form-error').textContent = e.message; };
  dialog.addEventListener('close', () => { running = false; generation++; clearTimeout(timer); });
  const draw = () => {
    lock(); if (!report || !dialog.isConnected) return;
    dialog.querySelector('[data-report]').innerHTML = `<h3>${report.status === 'COMPLETE' ? 'Completed scan' : 'Report in progress'}</h3><p>${report.scanned} source records scanned · ${esc(report.status)}${report.status !== 'COMPLETE' ? ' · totals are partial' : ''}</p>${report.status !== 'COMPLETE' ? action('run-report', running ? 'Pause scan' : 'Continue scan') : ''}<p>${esc(report.note)}</p><div class="crm-overview-links">${[['qualifyingOrders', 'Qualifying orders'], ['clientsWithOrders', 'Clients with orders'], ['clientsWithRepeatOrders', 'Clients with 2+ orders'], ['opportunities', 'Opportunities']].map(([k, label]) => `<div class="panel"><strong>${report.counts[k]}</strong><span>${label}</span></div>`).join('')}</div><p>Unknown business dates: ${report.counts.unknownDates} · Unpriced/invalid amounts: ${report.counts.invalidAmounts} · Missing client links: ${report.counts.missingContacts}</p>${Object.entries(report.byCurrency).map(([currency, values]) => `<article class="panel"><h3>${esc(currency)}</h3><p>Booked: ${esc(values.booked)} · Received: ${esc(values.collected)} · Refunds: ${esc(values.refunds)} · Net collected: ${esc(values.netCollected)}</p></article>`).join('')}<div class="form-grid">${[['byCity', 'Orders by city'], ['byService', 'Orders by recorded service'], ['byOwner', 'Orders by owner'], ['stages', 'Opportunity stages']].map(([key, title]) => `<details><summary>${title}</summary>${Object.values(report[key]).map(v => `<p>${esc(v.label)}: ${v.count}</p>`).join('') || '<p>No matching records</p>'}</details>`).join('')}</div>`;
    const button = dialog.querySelector('[data-action="run-report"]'); if (button) button.onclick = () => { running = !running; if (running) tick(); else { clearTimeout(timer); draw(); } };
  };
  async function tick() {
    if (busy || !running || !dialog.isConnected || report.status === 'COMPLETE') return;
    const mine = generation; busy = true; lock();
    try {
      const result = await request(`/reports/${report.reportId}/advance`, { expectedRevision: report.revision });
      if (!dialog.isConnected || mine !== generation) return;
      report = result; if (report.status === 'COMPLETE') running = false;
      draw();
    } catch (e) { if (dialog.isConnected && mine === generation) { running = false; error(e); } }
    finally { busy = false; draw(); if (running && mine === generation) timer = setTimeout(tick, 200); }
  }
  async function list() {
    try {
      const page = await request('/reports'); if (!dialog.isConnected) return;
      dialog.querySelector('[data-reports]').innerHTML = `<details><summary>Recent reports</summary>${page.items.map(r => `<p><button class="button button-secondary" data-report-id="${esc(r.reportId)}">${esc(r.status)} · ${r.scanned} records · ${esc(r.filters.from?.slice(0, 10) || 'All dates')}</button></p>`).join('') || '<p>No previous reports</p>'}</details>`;
      dialog.querySelectorAll('[data-report-id]').forEach(b => { b.onclick = async () => {
        if (busy) return; const mine = ++generation; busy = true; running = false; clearTimeout(timer); lock();
        try { const next = await request(`/reports/${b.dataset.reportId}`); if (dialog.isConnected && mine === generation) report = next; }
        catch (e) { if (dialog.isConnected) error(e); } finally { busy = false; draw(); }
      }; }); lock();
    } catch (e) { error(e); }
  }
  dialog.querySelector('[data-filters]').onsubmit = async e => {
    e.preventDefault(); if (busy) return; busy = true; lock(); const mine = ++generation; clearTimeout(timer); running = false;
    try {
      const values = Object.fromEntries(new FormData(e.target));
      const filters = Object.fromEntries(Object.entries(values).filter(([, v]) => v));
      if (filters.from) filters.from = new Date(`${filters.from}T00:00:00`).toISOString();
      if (filters.to) filters.to = new Date(`${filters.to}T23:59:59.999`).toISOString();
      const next = await request('/reports', filters);
      if (!dialog.isConnected || mine !== generation) return;
      report = next; running = true; list();
    } catch (failure) { if (dialog.isConnected) error(failure); } finally { busy = false; draw(); if (running && mine === generation) tick(); }
  };
  list();
}
