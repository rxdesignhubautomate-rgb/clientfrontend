import { attachLookupFields } from './crm-pickers.mjs';

export function openBulkClients({ api, selectedIds, filters, esc, afterSave }) {
  const dialog = document.createElement('dialog'); dialog.className = 'modal crm-workspace-dialog';
  dialog.innerHTML = `<div class="modal-head"><h2>Bulk client review</h2><button type="button" class="modal-close" aria-label="Close bulk review">×</button></div><div class="crm-dialog-body"><form data-bulk-form><label class="field">Selection<select name="selection"><option value="selected" ${selectedIds.length ? 'selected' : ''}>${selectedIds.length} individually selected clients</option><option value="matching" ${!selectedIds.length ? 'selected' : ''}>All contacts matching the current directory filters</option></select></label><label class="field">Change<select name="action"><option value="tag_add">Add service tag</option><option value="tag_remove">Remove service tag</option><option value="tier">Change tier</option><option value="assign">Assign client owner</option></select></label><div data-bulk-value></div><label class="field">Reason<input name="reason" minlength="5" required /></label><button type="submit" class="button button-primary">Prepare preview</button></form><div data-bulk-progress></div><div data-bulk-members></div><details><summary>Recent bulk reviews</summary><div data-bulk-recent></div></details><p class="form-error" role="alert"></p></div>`;
  document.body.append(dialog); dialog.showModal();
  const actionLabels = { tag_add: 'Add service tag', tag_remove: 'Remove service tag', tier: 'Change tier', assign: 'Assign owner' };
  const statusLabels = { PREPARING: 'Preparing selection', REVIEW: 'Ready for review', APPLYING: 'Applying changes', COMPLETE: 'Complete', CANCELLED: 'Cancelled' };
  let job, running = false, busy = false, timer, generation = 0, memberCursor = null;
  const request = async (path = '', body) => (await api(`/client-directory/bulk${path}`, body ? { method: 'POST', body } : {})).data;
  const error = e => { dialog.querySelector('.form-error').textContent = e.message; };
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('.modal-close').onclick = close; dialog.oncancel = e => { e.preventDefault(); close(); };
  window.addEventListener('hashchange', close, { once: true });
  dialog.addEventListener('close', () => { running = false; generation++; clearTimeout(timer); window.removeEventListener('hashchange', close); afterSave(); });
  const choice = dialog.querySelector('[name="action"]');
  function valueControl() {
    dialog.querySelector('[data-bulk-value]').innerHTML = choice.value === 'tier' ? '<label class="field">Tier<select name="value"><option value="standard">Standard</option><option value="premium">Premium</option><option value="vip">VIP</option></select></label>' : choice.value === 'assign' ? '<label class="field">Owner<input name="assignedTo" required /></label>' : '<label class="field">Tag<input name="value" maxlength="60" required /></label>';
    if (choice.value === 'assign') attachLookupFields(dialog, api);
  }
  choice.onchange = valueControl; valueControl();
  async function members() {
    if (!job || !['REVIEW', 'COMPLETE', 'CANCELLED'].includes(job.status)) return;
    const mine = generation, bulkId = job.bulkId;
    const page = await request(`/${job.bulkId}/members${memberCursor ? `?cursor=${encodeURIComponent(memberCursor)}` : ''}`);
    if (!dialog.isConnected || mine !== generation || job.bulkId !== bulkId) return;
    dialog.querySelector('[data-bulk-members]').innerHTML = `<p>Frozen selection — ${page.items.length} visible on this page</p>${page.items.map(m => `<p><strong>${esc(m.companyName || m.contactId)}</strong>: ${esc((Array.isArray(m.before) ? m.before.join(', ') : m.before) || 'None')} → ${esc(m.after)} · ${esc(m.status)} ${esc(m.error || '')}</p>`).join('')}<button type="button" class="button button-secondary" data-member-next ${page.pagination.hasMore ? '' : 'disabled'}>Next selected clients</button>`;
    dialog.querySelector('[data-member-next]').onclick = () => { memberCursor = page.pagination.nextCursor; members().catch(error); };
  }
  function draw() {
    if (!dialog.isConnected || !job) return;
    const active = ['PREPARING', 'APPLYING'].includes(job.status);
    dialog.querySelector('[data-bulk-progress]').innerHTML = `<h3>${esc(statusLabels[job.status] || job.status)}</h3><p>${job.selected} frozen clients · ${job.changed} changed · ${job.conflicts} conflicts</p><p>${esc(actionLabels[job.action] || job.action)} → ${esc(job.value)} · ${esc(job.reason)}</p>${job.status === 'REVIEW' ? `<p>Apply this change to the entire reviewed selection of ${job.selected} clients? Concurrent edits will be skipped.</p><button type="button" class="button button-primary" data-approve-bulk>Apply to ${job.selected} reviewed clients</button>` : ''}${active ? `<button type="button" class="button button-secondary" data-run-bulk>${running ? 'Pause processing' : 'Continue processing'}</button>` : ''}${['COMPLETE', 'CANCELLED'].includes(job.status) ? '' : '<button type="button" class="button button-secondary" data-cancel-bulk>Cancel remaining changes</button>'}<p>Marketing permission and customer history remain unchanged. Cancelling stops future changes; already applied changes remain.</p>`;
    dialog.querySelector('[data-run-bulk]')?.addEventListener('click', () => { running = !running; clearTimeout(timer); draw(); if (running) tick(); });
    dialog.querySelector('[data-approve-bulk]')?.addEventListener('click', () => action('approve'));
    dialog.querySelector('[data-cancel-bulk]')?.addEventListener('click', () => action('cancel'));
    dialog.querySelectorAll('[data-approve-bulk], [data-cancel-bulk], [data-recent-bulk], [data-bulk-form] button[type="submit"]').forEach(button => { button.disabled = busy; });
  }
  async function action(name) {
    if (busy) return;
    running = false; busy = true; clearTimeout(timer); const mine = ++generation; draw();
    try {
      const next = await request(`/${job.bulkId}/action`, { action: name, expectedRevision: job.revision, expectedDigest: job.digest });
      if (!dialog.isConnected || mine !== generation) return;
      job = next; running = job.status === 'APPLYING'; if (!running) await members();
    } catch (e) {
      if (!dialog.isConnected || mine !== generation) return;
      error(e);
      try { const next = await request(`/${job.bulkId}`); if (mine === generation && dialog.isConnected) job = next; } catch (refreshError) { error(refreshError); }
    } finally { busy = false; draw(); if (running && mine === generation) tick(); }
  }
  async function tick() {
    if (busy || !running || !dialog.isConnected) return; const mine = generation; busy = true; draw();
    try {
      const next = await request(`/${job.bulkId}/action`, { action: 'advance', expectedRevision: job.revision });
      if (!dialog.isConnected || mine !== generation) return;
      job = next; running = running && ['PREPARING', 'APPLYING'].includes(job.status); draw();
      if (!running) await members();
    } catch (e) { if (mine === generation && dialog.isConnected) { running = false; error(e); } }
    finally { busy = false; draw(); if (running && mine === generation) timer = setTimeout(tick, 200); }
  }
  dialog.querySelector('[data-bulk-form]').onsubmit = async e => {
    e.preventDefault(); if (busy) return; e.submitter.disabled = true; busy = true; const mine = ++generation; running = false; clearTimeout(timer);
    try {
      const values = Object.fromEntries(new FormData(e.target)); if (values.selection === 'selected' && !selectedIds.length) throw new Error('Select clients in the directory first');
      const next = await request('', { ...(values.selection === 'selected' ? { contactIds: selectedIds } : { filters }), action: values.action, value: values.assignedTo || values.value, reason: values.reason });
      if (!dialog.isConnected || mine !== generation) return;
      job = next; memberCursor = null; dialog.querySelector('[data-bulk-members]').replaceChildren(); running = true;
    } catch (failure) { if (dialog.isConnected) error(failure); } finally { busy = false; e.submitter.disabled = false; draw(); if (running && mine === generation) tick(); }
  };
  request().then(page => {
    if (!dialog.isConnected) return;
    dialog.querySelector('[data-bulk-recent]').innerHTML = page.items.map(j => `<p><button class="button button-secondary" data-recent-bulk="${esc(j.bulkId)}">${esc(actionLabels[j.action] || j.action)} · ${j.selected} clients · ${esc(j.status)}</button></p>`).join('') || '<p>No recent reviews</p>';
    dialog.querySelectorAll('[data-recent-bulk]').forEach(button => { button.onclick = async () => {
      if (busy) return; const mine = ++generation; busy = true; running = false; clearTimeout(timer); draw();
      try { const next = await request(`/${button.dataset.recentBulk}`); if (!dialog.isConnected || mine !== generation) return; job = next; memberCursor = null; draw(); await members(); }
      catch (e) { if (dialog.isConnected) error(e); } finally { busy = false; draw(); }
    }; });
    draw();
  }).catch(error);
}
