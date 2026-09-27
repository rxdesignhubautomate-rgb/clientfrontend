import { attachLookupFields } from './crm-pickers.mjs';
import { openContactImport } from './contact-import-ui.mjs';
import { openBusinessReports } from './crm-report-ui.mjs';
import { patchMarkup } from './dom-patch.mjs';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pretty = value => String(value || '').replaceAll('_', ' ').toLowerCase();
const field = (label, name, value = '', type = 'text') => `<label class="field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" required /></label>`;
const select = (label, name, options) => `<label class="field">${esc(label)}<select name="${name}">${options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join('')}</select></label>`;
const action = (name, label, disabled = false) => `<button type="button" class="button button-secondary" data-action="${name}" ${disabled ? 'disabled' : ''}>${label}</button>`;
const stamp = value => { if (!value) return 'Unknown'; const date = new Date(value._seconds ? value._seconds * 1000 : value); return Number.isNaN(+date) ? 'Unknown' : date.toLocaleString(); };
function marketingBannerDetail(capabilities) {
  if (!capabilities.dispatchConfigured) return 'Live sending is disabled by the production setting. You can still preview, approve and review batches.';
  if (!capabilities.settings.enabled) return 'Safety pause is active. Queued marketing messages remain held until an authorised rollout is activated.';
  if (!capabilities.settings.rolloutStage) return 'A reviewed rollout stage is required before any batch can be started.';
  return `Live dispatch is configured · ${pretty(capabilities.settings.rolloutStage)} rollout · every message is checked again before sending.`;
}

function templateExtras(components = []) {
  return components.map(component => {
    const type = String(component.type || '').toUpperCase();
    if (type === 'FOOTER' || (type === 'HEADER' && component.format === 'TEXT')) return `<p class="muted">${esc(component.text)}</p>`;
    if (type === 'BUTTONS') return `<div class="form-actions">${(component.buttons || []).map(b => `<span class="button button-secondary">${esc(b.text)}</span>`).join('')}</div>`;
    return '';
  }).join('');
}

function modal(title, html) {
  const dialog = document.createElement('dialog'); dialog.className = 'modal crm-workspace-dialog';
  dialog.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="modal-close" aria-label="Close">×</button></div><div class="crm-dialog-body">${html}</div>`;
  document.body.append(dialog); dialog.showModal();
  const close = () => { dialog.close(); dialog.remove(); };
  window.addEventListener('hashchange', close, { once: true });
  dialog.addEventListener('close', () => window.removeEventListener('hashchange', close), { once: true });
  dialog.querySelector('.modal-close').onclick = close;
  dialog.oncancel = event => { event.preventDefault(); close(); };
  return { dialog, close };
}
function formDialog(title, html, submit, label = 'Save') {
  const { dialog, close } = modal(title, `<form>${html}<p class="form-error" role="alert" hidden></p><button class="button button-primary" type="submit">${label}</button></form>`);
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const button = event.submitter, error = dialog.querySelector('.form-error');
    button.disabled = true; error.hidden = true;
    try { const values = Object.fromEntries(new FormData(event.currentTarget)); await submit(values, dialog); close(); }
    catch (failure) { error.hidden = false; error.textContent = failure.message; button.disabled = false; }
  };
  return dialog;
}

const baseFormDialog = formDialog;

export function audienceRule(fieldName, value) {
  if (['lastInteraction', 'lastMarketing'].includes(fieldName)) return { field: fieldName, op: value === 'unknown' ? 'unknown' : 'olderDays', ...(value === 'unknown' ? {} : { value: Number(value) }) };
  return { field: fieldName, op: fieldName === 'service' ? 'contains' : 'eq', value: fieldName === 'needsReview' ? value === 'true' : value };
}

export async function mountMarketingWorkspace({ page, api, capabilities, notify, uploadAsset, attachmentUrl, onLegacyPreview, active = () => true }) {
  const request = async (path, body, method = 'POST') => (await api(`/marketing-workspace${path}`, body ? { method, body } : {})).data;
  const formDialog = (...args) => { const dialog = baseFormDialog(...args); attachLookupFields(dialog, api); return dialog; };
  let tab = 'campaigns', cursor = null, cursors = [], next = null, generation = 0;
  page.innerHTML = `<div class="section-head"><div><h1>Marketing</h1><p>Choose clients → preview → approve → send a batch.</p></div><a class="button button-secondary" href="#whatsapp">View replies</a></div>
    <div class="crm-marketing-banner" role="status"><strong>${capabilities.settings.enabled ? 'Marketing enabled' : 'Marketing paused'}</strong><span>${marketingBannerDetail(capabilities)}</span>${action('kill', 'Pause all marketing', !capabilities.settings.enabled)}${action('rollout', 'Rollout settings')}${action('business-reports', 'Business reports')}</div>
    <div data-overview class="crm-overview-links"><a class="panel" href="#clients">Client directory<span>Existing · Future · Premium · Needs review</span></a><a class="panel" href="#whatsapp">Conversations<span>Read and review client replies</span></a></div>
    <section class="panel"><nav class="crm-directory-tabs" aria-label="Marketing workspace">${[['campaigns', 'Your batches'], ['audiences', 'Client groups'], ['content', 'Message & media'], ['tasks', 'Follow-ups'], ['pipeline', 'Opportunities'], ['replies', 'Review replies'], ['rules', 'Task rules'], ['legacy', 'Earlier batches']].map(([key, text]) => `<button class="button button-secondary" data-tab="${key}" aria-pressed="${key === tab}">${text}</button>`).join('')}</nav>
    <div class="toolbar" data-tools></div><p data-status role="status" aria-live="polite"></p><div data-workspace-list></div><div class="form-actions">${action('prev', 'Previous', true)}${action('next', 'Next', true)}</div></section>`;
  const root = page.querySelector('[data-workspace-list]'), status = page.querySelector('[data-status]'), tools = page.querySelector('[data-tools]');
  const alive = () => active() && root.isConnected;
  function buttons() {
    tools.innerHTML = action('refresh', 'Refresh') + (tab === 'campaigns' ? action('create-campaign', 'New batch') : tab === 'audiences' ? action('create-audience', 'New client group') + action('import', 'Import CSV / Excel') : tab === 'content' ? action('create-content', 'New message') : tab === 'tasks' ? action('create-task', 'Add follow-up') : tab === 'pipeline' ? action('open-opportunity', 'Open client opportunity') : '');
  }
  async function load() {
    const mine = ++generation; status.textContent = 'Loading…'; buttons();
    try {
      const response = tab === 'legacy' ? await api(`/campaigns?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`) : null;
      const data = response ? { items: (response.data || []).filter(item => !item.crmUpgrade), pagination: response.pagination } : await request(`/${tab}${tab === 'rules' ? '' : `?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`}`);
      if (!alive() || mine !== generation) return;
      next = data.pagination?.nextCursor || null;
      page.querySelector('[data-action="prev"]').disabled = !cursors.length;
      page.querySelector('[data-action="next"]').disabled = !next;
      if (tab === 'pipeline') {
        patchMarkup(root, data.items.map(item => `<article class="crm-workspace-row"><div><strong>${esc(item.companyName)}</strong><p>${esc(pretty(item.leadStatus))} · ${esc(item.serviceInterest || 'Service not recorded')}</p><p>${esc(item.nextAction || 'Next action not recorded')}${item.nextActionAt ? ` · ${esc(stamp(item.nextActionAt))}` : ''}</p><p>${item.expectedValue ? `${esc(item.currency || 'Currency not recorded')} ${esc(item.expectedValue)} expected` : 'Expected value not recorded'}</p></div><a class="button button-secondary" href="#client/${encodeURIComponent(item.contactId)}">Open opportunity</a></article>`).join('') || '<p>No opportunities on this page in your client scope.</p>');
        status.textContent = `${data.items.length} visible opportunities on this page${next ? ' · more on next page' : ''}`; return;
      }
      if (tab === 'replies') {
        patchMarkup(root, data.items.map(item => `<article class="crm-workspace-row"><div><strong>${esc(item.companyName)}</strong><p>${esc(item.text || 'Open conversation to review the reply')}</p><p>${esc(pretty(item.attribution))} · ${esc(stamp(item.createdAt))}</p>${item.conversationId ? `<a href="#whatsapp/${encodeURIComponent(item.conversationId)}">Open chat</a>` : `<a href="#client/${encodeURIComponent(item.contactId)}">Open client</a>`}</div><button class="button button-secondary" data-review-reply="${esc(item.messageId)}">Record outcome</button></article>`).join('') || '<p>No replies awaiting review in your scope.</p>');
        root.querySelectorAll('[data-review-reply]').forEach(button => { button.onclick = () => formDialog('Review client reply', select('Outcome', 'outcome', ['SAMPLE_REQUESTED', 'QUOTATION_REQUESTED', 'MEETING_REQUESTED', 'FOLLOWUP_SCHEDULED', 'SERVICE_REPLY', 'NOT_INTERESTED', 'WRONG_CONTACT', 'OPT_OUT'].map(value => [value, pretty(value)])) + field('What the client requested', 'reason') + '<p>An ordinary reply never grants marketing permission. An ambiguous stop remains held until permission evidence is reviewed.</p>', async values => { await request(`/replies/${button.dataset.reviewReply}/review`, values); await load(); }); });
        status.textContent = `${data.items.length} replies awaiting review on this page`; return;
      }
      if (tab === 'rules') {
        patchMarkup(root, `<p>Rules create tasks only. Enabling a rule never sends a message.</p>${data.rules.map(r => `<article class="crm-workspace-row"><div><strong>${esc(pretty(r.key))}</strong><p>${r.enabled ? 'Enabled' : 'Disabled'} · ${r.delayHours} hours · owner ${esc(r.assignedTo)}</p></div><button class="button button-secondary" data-rule="${esc(r.key)}">Edit</button></article>`).join('')}`);
        root.querySelectorAll('[data-rule]').forEach(button => { button.onclick = () => {
          const rule = data.rules.find(r => r.key === button.dataset.rule);
          formDialog('Task rule', `<p>${esc(pretty(rule.key))} · task only</p>${select('State', 'enabled', [[String(rule.enabled), rule.enabled ? 'Enabled' : 'Disabled'], [String(!rule.enabled), rule.enabled ? 'Disabled' : 'Enabled']])}${field('Delay in hours', 'delayHours', rule.delayHours, 'number')}${field('Owner user ID', 'assignedTo', rule.assignedTo)}`, async values => { await request('/rules', { expectedVersion: data.version, rules: data.rules.map(r => r.key === rule.key ? { key: r.key, enabled: values.enabled === 'true', delayHours: Number(values.delayHours), assignedTo: values.assignedTo, mode: 'task_only' } : r) }, 'PUT'); await load(); });
        }; });
        status.textContent = 'Optional follow-up rules'; return;
      }
      patchMarkup(root, data.items.length ? data.items.map(item => {
        const id = item.campaignId || item.audienceId || item.contentVersionId || item.followUpId || item.id;
        const name = item.name || item.companyName || item.reason;
        return `<article class="crm-workspace-row" data-record="${esc(id)}"><div><strong>${esc(name)}</strong><p>${tab === 'tasks' ? `${item.overdue ? 'Overdue · ' : ''}${esc(stamp(item.dueAt))} · ${esc(item.reason)}` : `${esc(pretty(item.status || item.kind))}${item.version ? ` · version ${item.version}` : ''}${tab === 'campaigns' ? ` · ${item.recipients || 0} recipients · ${item.exclusions || 0} exclusions` : ''}`}</p>${tab === 'campaigns' ? `<p class="muted">${item.status === 'COMPLETED' ? 'Queue preparation finished. Open to check actual delivery.' : 'Open to see exactly what will be sent and to whom.'}</p>` : ''}</div><button class="button button-primary" data-open="${esc(id)}">${tab === 'campaigns' ? 'Preview & progress' : 'Open'}</button></article>`;
      }).join('') : '<div class="empty-state">Nothing here yet. Use the button above to add one.</div>');
      root.querySelectorAll('[data-open]').forEach(button => { button.onclick = () => guard(async () => {
        const item = data.items.find(i => [i.campaignId, i.audienceId, i.contentVersionId, i.followUpId, i.id].includes(button.dataset.open));
        if (tab === 'legacy') { if (onLegacyPreview) await onLegacyPreview(item.campaignId, button); }
        else if (tab === 'campaigns') await openCampaign(item);
        else if (tab === 'audiences') await openAudience(item);
        else if (tab === 'content') await openContent(item);
        else openTask(item);
      }); });
      status.textContent = `${data.items.length} shown${next ? ' · more on next page' : ''}`;
    } catch (error) { if (alive() && mine === generation) status.textContent = `Could not load: ${error.message}. Use Refresh to retry.`; }
  }
  async function guard(fn) { try { await fn(); } catch (error) { notify(error.message, true); } }
  page.onclick = event => {
    if (event.target.closest('[data-action="open-opportunity"]')) { formDialog('Open opportunity', field('Client', 'contactId'), async v => { const lead = await request('/opportunities', v); location.hash = `#client/${lead.contactId}`; }); return; }
    if (event.target.closest('[data-action="business-reports"]')) { openBusinessReports({ modal, action, esc, request }); return; }
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) { tab = tabButton.dataset.tab; cursor = null; cursors = []; page.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === tabButton))); load(); return; }
    const name = event.target.closest('[data-action]')?.dataset.action;
    if (!name) return;
    guard(async () => {
      if (name === 'refresh') { await load(); await refreshCounts(); }
      if (name === 'next' && next) { cursors.push(cursor); cursor = next; await load(); }
      if (name === 'prev' && cursors.length) { cursor = cursors.pop(); await load(); }
      if (name === 'create-audience') createAudience();
      if (name === 'create-content') createContent();
      if (name === 'create-campaign') await createCampaign();
      if (name === 'create-task') createTask();
      if (name === 'import') importCsv();
      if (name === 'rollout') {
        const settings = (await request('/capabilities')).settings;
        formDialog('Reviewed rollout', `<p>Save a stage and evidence first. Each change pauses marketing. Internal tests need 1–10 staff contact IDs; pilots need 1–25 approved contact IDs. Test recipients still require permission and approved content.</p>${select('Stage', 'stage', [['INTERNAL_TEST', 'Internal test'], ['PILOT', 'Small approved pilot'], ['FULL', 'Full rollout after pilot review']])}<label class="field">Allowed existing contact IDs (comma separated)<textarea name="contactIds"></textarea></label>${field('Provider/account verification reference', 'providerReviewReference')}<label class="field">Previous test / pilot review reference<input name="previousStageReviewReference" /></label>${field('Reason', 'reason')}<label><input name="activate" type="checkbox" ${capabilities.dispatchConfigured ? '' : 'disabled'} /> Activate this reviewed stage (all deployment and data checks must pass).</label>`, async v => {
          const value = await request('/rollout', { stage: v.stage, expectedVersion: settings.version || 0, contactIds: v.contactIds.split(',').map(s => s.trim()).filter(Boolean), providerReviewReference: v.providerReviewReference, ...(v.previousStageReviewReference ? { previousStageReviewReference: v.previousStageReviewReference } : {}), reason: v.reason }, 'PUT');
          capabilities.settings = value;
          if (v.activate === 'on') capabilities.settings = await request('/settings', { enabled: true, reason: v.reason }, 'PATCH');
          page.querySelector('.crm-marketing-banner strong').textContent = capabilities.settings.enabled ? `Marketing enabled · ${pretty(value.rolloutStage)}` : `Marketing paused · ${pretty(value.rolloutStage)}`;
          page.querySelector('[data-action="kill"]').disabled = !capabilities.settings.enabled; notify('Rollout review saved');
        });
      }
      if (name === 'kill') formDialog('Pause all marketing', `${field('Reason', 'reason')}<p>Stops future dispatches. Messages already submitted cannot be recalled.</p>`, async v => { await request('/settings', { enabled: false, reason: v.reason }, 'PATCH'); capabilities.settings.enabled = false; page.querySelector('.crm-marketing-banner strong').textContent = 'Marketing paused'; page.querySelector('[data-action="kill"]').disabled = true; }, 'Pause marketing');
    });
  };
  function createAudience(previous = null) {
    if (previous?.kind === 'static') { formDialog('New version of selected group', field('Group name', 'name', previous.name), async v => { await request(`/audiences/${previous.audienceId}/versions`, { name: v.name, kind: 'static', contactIds: previous.contactIds }); await load(); }); return; }
    const presets = { future: [['relationship', 'prospect']], existing: [['relationship', 'customer']], inactive: [['lastInteraction', '90']], premium: [['tier', 'premium']], vip: [['tier', 'vip']], review: [['needsReview', 'true']], untouched: [['lastMarketing', 'unknown']] };

    const dialog = formDialog('New client group', `${field('Group name', 'name', previous?.name || '')}${select('Start with', 'preset', [['custom', 'Custom conditions'], ['future', 'Future clients'], ['existing', 'Existing clients'], ['inactive', 'Inactive 90 days'], ['premium', 'Premium clients'], ['vip', 'VIP clients'], ['review', 'Needs review'], ['untouched', 'No recorded marketing']])}${select('Include contacts matching', 'operator', [['and', 'All conditions'], ['or', 'Any condition']])}<div data-conditions></div>${action('add-condition', 'Add condition')}<p class="muted">This saved group updates as contact data changes. Batch recipients freeze separately during review.</p>`, async values => {
      const rules = [...dialog.querySelectorAll('[data-condition]')].map(row => audienceRule(row.querySelector('[name="field"]').value, row.querySelector('[name="value"]').value));
      await request(previous ? `/audiences/${previous.audienceId}/versions` : '/audiences', { name: values.name, kind: 'dynamic', filter: { version: 1, rule: { op: values.operator, rules } } }); await load();
    });
    const add = (initial = null) => {
      if (dialog.querySelectorAll('[data-condition]').length >= 6) return;
      const row = document.createElement('div'); row.className = 'form-grid'; row.dataset.condition = '';
      row.innerHTML = select('Field', 'field', [['relationship', 'Relationship'], ['tier', 'Tier'], ['city', 'City'], ['owner', 'Owner user ID'], ['service', 'Service tag'], ['lastInteraction', 'Last interaction'], ['lastMarketing', 'Last marketing'], ['needsReview', 'Needs review']]) + '<div data-value></div><button type="button" class="button button-secondary" aria-label="Remove condition">Remove</button>';
      const update = () => { const f = row.querySelector('[name="field"]').value; const options = { relationship: [['prospect', 'Future client'], ['customer', 'Existing client'], ['unclassified', 'Unclassified']], tier: [['standard', 'Standard'], ['premium', 'Premium'], ['vip', 'VIP']], needsReview: [['true', 'Yes'], ['false', 'No']], lastInteraction: [['90', 'Older than 90 days'], ['30', 'Older than 30 days'], ['180', 'Older than 180 days'], ['unknown', 'Unknown history']], lastMarketing: [['30', 'Older than 30 days'], ['7', 'Older than 7 days'], ['unknown', 'No recorded send']] };
        row.querySelector('[data-value]').innerHTML = options[f] ? select('Value', 'value', options[f]) : field('Value (exact match)', 'value'); };
      row.querySelector('[name="field"]').onchange = update; row.querySelector('button').onclick = () => row.remove(); if (initial) row.querySelector('[name="field"]').value = initial[0]; update(); if (initial) { const input = row.querySelector('[name="value"]'); if (input.tagName === 'SELECT' && ![...input.options].some(o => o.value === String(initial[1]))) input.append(new Option(String(initial[1]), String(initial[1]))); input.value = initial[1]; } dialog.querySelector('[data-conditions]').append(row);
    };
    dialog.querySelector('[data-action="add-condition"]').onclick = () => add();
    dialog.querySelector('[name="preset"]').onchange = event => { const preset = presets[event.target.value]; if (!preset) return; dialog.querySelector('[data-conditions]').replaceChildren(); preset.forEach(rule => add(rule)); };
    const oldRule = previous?.filter?.rule, oldRules = oldRule?.rules || (oldRule ? [oldRule] : []);
    if (oldRules.length && oldRules.every(r => r.field && ['eq', 'contains', 'olderDays', 'unknown'].includes(r.op))) { dialog.querySelector('[name="operator"]').value = oldRule.op === 'or' ? 'or' : 'and'; oldRules.forEach(r => add([r.field, r.op === 'unknown' ? 'unknown' : r.value])); }
    else if (oldRules.length) { dialog.close(); dialog.remove(); notify('This group contains advanced nested conditions. Create a new group using the supported editor; the original remains unchanged.', true); }
    else add();
  }
  async function openAudience(item) {
    let pageCursor = null, selected = new Set();
    const { dialog } = modal(item.name, `<p data-audience-count></p><div data-audience-rows></div><div class="form-actions">${action('more', 'Next page')}${action('export', 'Export this page')}${action('selection', 'Save selected as a group')}${action('edit-group', 'Create edited version')}${action('share-group', 'Share with team')}${action('archive-group', 'Archive group', item.status === 'ARCHIVED')}</div><p class="form-error" role="alert"></p>`);
    async function show() {
      const data = await request(`/audiences/${item.audienceId}/preview?limit=50${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ''}`);
      dialog.querySelector('[data-audience-count]').textContent = `${data.count} matching contact records · ${data.eligibleOnThisPage} permission-eligible on this page. Shared destinations are deduplicated when preparing a batch.`;
      dialog.querySelector('[data-audience-rows]').innerHTML = data.items.map(c => `<label class="crm-workspace-row"><input type="checkbox" data-contact="${esc(c.contactId)}" ${selected.has(c.contactId) ? 'checked' : ''}/><span><a href="#client/${encodeURIComponent(c.contactId)}">${esc(c.companyName || c.contactPerson)}</a><br>${esc(c.primaryPhone)} · ${esc(c.permission.eligible ? 'Permission recorded' : pretty(c.permission.reason))}</span></label>`).join('') || '<p>No matching contacts.</p>';
      dialog.querySelectorAll('[data-contact]').forEach(box => { box.onchange = () => box.checked ? selected.add(box.dataset.contact) : selected.delete(box.dataset.contact); });
      dialog.querySelector('[data-action="more"]').disabled = !data.pagination.hasMore;
      dialog.querySelector('[data-action="more"]').onclick = () => guard(async () => { pageCursor = data.pagination.nextCursor; await show(); });
    }
    dialog.querySelector('[data-action="export"]').onclick = () => guard(async () => { const result = await request(`/audiences/${item.audienceId}/export?limit=50${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ''}`); download(result.csv, 'contact-page.csv'); });
    dialog.querySelector('[data-action="selection"]').onclick = () => { if (!selected.size) { notify('Select contacts first', true); return; } formDialog('Save selection', field('Group name', 'name'), async v => { await request('/audiences', { name: v.name, kind: 'static', contactIds: [...selected] }); await load(); }); };
    dialog.querySelector('[data-action="share-group"]').onclick = () => {
      const selectedMembers = new Set(item.sharedWith || []);
      const sharing = formDialog('Share client group', '<p>Shared users can use this group within their own client permissions. Sharing does not grant access to additional clients.</p>' + field('Add team member', 'assignedTo', capabilities.actorId) + action('add-shared', 'Add selected member') + '<div data-shared-members></div>', async () => { item = await request(`/audiences/${item.audienceId}/sharing`, { sharedWith: [...selectedMembers], expectedRevision: item.sharingRevision || 0 }, 'PUT'); notify('Group sharing saved'); });
      function drawMembers() { sharing.querySelector('[data-shared-members]').innerHTML = [...selectedMembers].map(userId => `<p>${esc(userId)} <button type="button" class="button button-secondary" data-remove-member="${esc(userId)}">Remove</button></p>`).join('') || '<p>Only the owner and managers</p>'; sharing.querySelectorAll('[data-remove-member]').forEach(b => { b.onclick = () => { selectedMembers.delete(b.dataset.removeMember); drawMembers(); }; }); }
      sharing.querySelector('[data-action="add-shared"]').onclick = () => { const input = sharing.querySelector('[name="assignedTo"]'); if (input.value) selectedMembers.add(input.value); drawMembers(); }; drawMembers();
    };
    dialog.querySelector('[data-action="edit-group"]').onclick = () => createAudience(item);
    dialog.querySelector('[data-action="archive-group"]').onclick = () => formDialog('Archive group', field('Reason', 'reason'), async v => { await request(`/audiences/${item.audienceId}/archive`, { ...v, expectedVersion: item.version }); dialog.close(); dialog.remove(); await load(); });
    await show();
  }
  function createContent(previous = null) {
    const templates = capabilities.templates || [];
    if (!templates.length) { notify('No marketing template is configured. Configure and sync the existing Meta integration first.', true); return; }
    const dialog = formDialog('Message & media', `${field('Internal name', 'name', previous?.name || '')}${field('Service / purpose', 'service', previous?.service || '')}${select('Approved template', 'templateKey', templates.map(t => [t.key, `${t.name} · ${t.language}`]))}<div data-variables></div><label class="field">Optional message content for a template variable<textarea name="body" maxlength="4000">${esc(previous?.body || '')}</textarea></label><label class="field">Image / video / PDF<input name="asset" type="file" accept="image/jpeg,image/png,video/mp4,application/pdf" /></label>${field('Content expiry', 'expiresAt', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 16), 'datetime-local')}<label><input type="checkbox" name="rights" required /> I have permission to share this non-confidential material.</label><p>Only the approved template text and its mapped variables are sent. Review the rendered message below.</p><pre class="crm-message-preview" data-message-preview></pre>`, async (v, form) => {
      const template = templates.find(t => t.key === v.templateKey), variables = {};
      for (const variable of template.variables) variables[variable.key] = form.querySelector(`[data-variable="${variable.key}"]`).value;
      let attachmentIds = previous?.attachmentIds || []; const file = form.querySelector('[name="asset"]').files[0];
      if (file) { if (file.size > 20 * 1024 * 1024) throw new Error('Use media under 20 MB'); const asset = await uploadAsset(file); attachmentIds = [asset.attachmentId || asset.id]; }
      await request(previous ? `/content/${previous.contentVersionId}/versions` : '/content', { name: v.name, service: v.service, templateKey: v.templateKey, body: v.body || template.body, variables, language: template.language, attachmentIds, rightsConfirmed: v.rights === 'on', confidential: false, expiresAt: new Date(v.expiresAt).toISOString() }); await load();
    });
    function preview() { const t = templates.find(t => t.key === dialog.querySelector('[name="templateKey"]').value); let text = t.body; t.variables.forEach((v, i) => { text = text.replaceAll(`{{${i + 1}}}`, dialog.querySelector(`[data-variable="${v.key}"]`)?.value || `[${v.label}]`); }); dialog.querySelector('[data-message-preview]').textContent = text; }
    function variables() { const t = templates.find(t => t.key === dialog.querySelector('[name="templateKey"]').value); dialog.querySelector('[data-variables]').innerHTML = t.variables.map(v => `<label class="field">${esc(v.label)}<input data-variable="${esc(v.key)}" value="${v.key === 'customer_name' ? '{{company}}' : ''}" required /></label>`).join('') + '<p class="muted">Use {{company}}, {{person}}, {{city}} or {{content}} for personalisation. Missing values block review.</p>'; preview(); }
    dialog.querySelector('[name="templateKey"]').onchange = variables; dialog.oninput = preview; if (previous) dialog.querySelector('[name="templateKey"]').value = previous.templateKey; variables(); if (previous) { for (const input of dialog.querySelectorAll('[data-variable]')) input.value = previous.variables?.[input.dataset.variable] || ''; preview(); }
  }
  async function mediaHtml(ids) {
    if (!ids?.length) return '';
    const a = (await api(`/attachments/${encodeURIComponent(ids[0])}`)).data;
    const url = await attachmentUrl(ids[0]);
    if (a.mimeType?.startsWith('video/')) return `<video class="crm-preview-media" controls preload="metadata" src="${esc(url)}"></video>`;
    if (a.mimeType?.startsWith('image/')) return `<img class="crm-preview-media" alt="Message attachment" src="${esc(url)}" />`;
    return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(a.filename || 'Open attached document')}</a>`;
  }
  async function openContent(item) {
    const { dialog } = modal(item.name, `<p>${esc(pretty(item.status))} · version ${item.version} · expires ${esc(stamp(item.expiresAt))}</p><p>Template: ${esc(item.templateKey)}</p><pre class="crm-message-preview">${esc(item.body)}</pre><div data-media></div><p>Personalised final text appears in each batch recipient preview.</p>${action('approve-content', 'Approve this content', ['APPROVED', 'ARCHIVED'].includes(item.status))}${action('edit-content', 'Create edited version')}${action('archive-content', 'Archive content', item.status === 'ARCHIVED')}`);
    dialog.querySelector('[data-media]').innerHTML = await mediaHtml(item.attachmentIds);
    dialog.querySelector('[data-action="edit-content"]').onclick = () => createContent(item);
    dialog.querySelector('[data-action="archive-content"]').onclick = () => formDialog('Archive content', field('Reason', 'reason') + '<p>Existing queued batches using this content will be held at dispatch.</p>', async v => { await request(`/content/${item.contentVersionId}/archive`, { ...v, expectedVersion: item.version }); dialog.close(); dialog.remove(); await load(); });
    dialog.querySelector('[data-action="approve-content"]').onclick = () => guard(async () => { await request(`/content/${item.contentVersionId}/approve`, {}); dialog.close(); dialog.remove(); await load(); });
  }
  async function createCampaign() {
    const [audiences, contents] = await Promise.all([request('/audiences?limit=100'), request('/content?limit=100')]);
    audiences.items = audiences.items.filter(a => a.status !== 'ARCHIVED');
    const approved = contents.items.filter(c => c.status === 'APPROVED');
    if (!audiences.items.length || !approved.length) { notify('Create a client group and approve a message first.', true); return; }
    formDialog('New manual batch', `${field('Batch name', 'name')}${select('Batch type', 'mode', [['standard', 'Client batch'], ['internal_test', 'Internal test — approved staff numbers only']])}${select('Client group', 'audienceId', audiences.items.map(a => [a.audienceId, a.name]))}${select('Message', 'contentVersionId', approved.map(c => [c.contentVersionId, `${c.name} · v${c.version}`]))}${select('Purpose', 'objective', [['design_update', 'Design update'], ['reactivation', 'Reactivation'], ['premium_preview', 'Premium preview']])}${field('Maximum recipients (1–500)', 'maxRecipients', 500, 'number')}${field('Business timezone', 'timezone', 'Asia/Kolkata')}<div class="form-grid">${field('Start hour (0–23)', 'businessHourStart', 9, 'number')}${field('End hour (1–24)', 'businessHourEnd', 18, 'number')}</div><details><summary>Reviewed exceptions (selected groups only)</summary><label><input name="resend" type="checkbox" /> Resend this content to the separately selected recipients</label><label><input name="multiple" type="checkbox" /> Include separately selected people at the same company</label><label class="field">Exception reason<input name="exceptionReason" maxlength="500" /></label><label class="field">Client request / resend evidence reference<input name="evidenceReference" maxlength="500" /></label><p>Requires exception permission. Consent, opt-outs, cooldowns and frequency limits still apply. A group of individually selected clients is required.</p></details><p>No automatic daily sending. Prepare and review this batch, then start it manually.</p>`, async v => { const { resend, multiple, exceptionReason, evidenceReference, ...values } = v; const campaign = await request('/campaigns', { ...values, ...(resend === 'on' ? { resendReview: { reason: exceptionReason, evidenceReference } } : {}), ...(multiple === 'on' ? { multipleCompanyRecipientsReview: { reason: exceptionReason } } : {}), maxRecipients: Number(v.maxRecipients), businessHourStart: Number(v.businessHourStart), businessHourEnd: Number(v.businessHourEnd) }); await load(); await openCampaign(campaign); }, 'Create draft');
  }
  async function openCampaign(initial) {
    let campaign = initial, recipientCursor = null, refreshing = false, timer;
    const { dialog } = modal(initial.name, '<div data-campaign-summary></div><div data-campaign-tools class="form-actions"></div><div data-recipient-list></div><div class="form-actions">' + action('recipient-next', 'Next recipients', true) + '</div><p class="form-error" role="alert"></p>');
    async function refresh() {
      if (refreshing || !dialog.isConnected) return;
      refreshing = true;
      try {
      const [current, recipients, report] = await Promise.all([request(`/campaigns/${initial.campaignId}`), request(`/campaigns/${initial.campaignId}/recipients?limit=50${recipientCursor ? `&cursor=${encodeURIComponent(recipientCursor)}` : ''}`), request(`/campaigns/${initial.campaignId}/report`)]);
      if (!dialog.isConnected) return; campaign = current;
      const progressed = ['SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED'].reduce((sum, key) => sum + report.currentStates[key], 0), maximum = Math.max(campaign.recipients, 1);
      patchMarkup(dialog.querySelector('[data-campaign-summary]'), `<p><strong>${esc(pretty(campaign.status))}</strong> · ${campaign.recipients} recipients · ${campaign.exclusions} excluded · ${campaign.scanned} reviewed</p><div class="crm-batch-progress"><strong>${report.accepted} accepted / ${campaign.recipients}</strong><progress max="${maximum}" value="${Math.min(progressed, maximum)}"></progress><p>${report.confirmedDelivered} delivered · ${report.confirmedRead} read · ${report.currentStates.FAILED} failed · ${report.currentStates.DELIVERY_UNKNOWN} unknown</p></div><p class="muted">Accepted does not mean delivered. Missing read status is unknown. Pause/cancel stops future dispatches; submitted messages cannot be recalled.</p>${campaign.resendReview ? `<p>Reviewed resend: ${esc(campaign.resendReview.reason)} · ${esc(campaign.resendReview.evidenceReference)}</p>` : ''}${campaign.multipleCompanyRecipientsReview ? `<p>Multiple contacts per company reviewed: ${esc(campaign.multipleCompanyRecipientsReview.reason)}</p>` : ''}<p>${esc(campaign.timezone)} · ${campaign.businessHourStart}:00–${campaign.businessHourEnd}:00</p>`);
      const ctl = dialog.querySelector('[data-campaign-tools]');
      patchMarkup(ctl, action('progress-refresh', 'Refresh progress') + (campaign.status === 'PREPARING' ? action('prepare', 'Review next 50 contacts') : campaign.status === 'REVIEW' ? action('approve', 'Approve frozen recipients') : ['APPROVED', 'PAUSED'].includes(campaign.status) ? action('start', capabilities.dispatchConfigured ? 'Start this batch' : 'Sending disabled in development', !capabilities.dispatchConfigured || !capabilities.settings.enabled) : '') + (['UPGRADE_RUNNING', 'COMPLETED'].includes(campaign.status) ? action('pause', 'Pause') : '') + (campaign.status !== 'CANCELLED' ? action('cancel', 'Cancel batch') : '') + action('link-order', 'Link an order') + action('finance', 'Linked order report'));
      patchMarkup(dialog.querySelector('[data-recipient-list]'), recipients.items.map(r => `<article class="crm-workspace-row" data-recipient-row="${esc(r.campaignEnrollmentId)}"><div><a href="#client/${encodeURIComponent(r.contactId)}">${esc(r.destination || r.contactId)}</a><p>${esc(pretty(r.deliveryState || r.status))}${r.errorCode ? ` · ${esc(pretty(r.errorCode))}` : ''}${r.suppressionReason ? ` · ${esc(pretty(r.suppressionReason))}` : ''}</p></div><button class="button button-secondary" data-preview-recipient="${esc(r.campaignEnrollmentId)}">Message preview</button>${r.deliveryState === 'DELIVERY_UNKNOWN' ? `<button class="button button-secondary" data-reconcile="${esc(r.messageId)}">Review unknown result</button>` : ''}</article>`).join('') || '<p>Prepare recipients to see their individual messages here.</p>');
      dialog.querySelectorAll('[data-preview-recipient]').forEach(b => { b.onclick = () => guard(async () => { const r = recipients.items.find(row => row.campaignEnrollmentId === b.dataset.previewRecipient); const { dialog: preview } = modal(`Message to ${r.destination || r.contactId}`, `<pre class="crm-message-preview">${esc(r.preparedMessage?.text || 'Not eligible / personalisation missing')}</pre><div data-media></div>${templateExtras(r.preparedMessage?.metadata?.providerComponents)}<p>Template: ${esc(r.preparedMessage?.metadata?.template?.name || 'Unavailable')} · content version ${esc(campaign.contentSnapshot.version)}</p>`); preview.querySelector('[data-media]').innerHTML = await mediaHtml(r.preparedMessage?.attachmentIds); }); });
      dialog.querySelectorAll('[data-reconcile]').forEach(button => { button.onclick = () => formDialog('Reconcile unknown submission', `<p>Check the provider record first. A timeout does not mean failure. Neither decision automatically resends the message.</p>${select('Verified result', 'outcome', [['ACCEPTED', 'Provider accepted it'], ['NOT_ACCEPTED', 'Provider definitively did not accept it']])}<label class="field">Provider message ID (required for accepted)<input name="providerMessageId" /></label>${field('Provider evidence reference', 'evidenceReference')}${field('Review reason', 'reason')}`, async values => { if (!values.providerMessageId) delete values.providerMessageId; await request(`/messages/${button.dataset.reconcile}/reconcile`, values); await refresh(); }); });
      const nextButton = dialog.querySelector('[data-action="recipient-next"]'); nextButton.disabled = !recipients.pagination.hasMore; nextButton.onclick = () => guard(async () => { recipientCursor = recipients.pagination.nextCursor; await refresh(); });
      ctl.onclick = event => guard(async () => {
        const button = event.target.closest('[data-action]'), key = button?.dataset.action; if (!key) return;
        button.disabled = true;
        try {
          if (key === 'prepare') await request(`/campaigns/${campaign.campaignId}/prepare`, {});
          else if (key === 'finance') { await openFinance(campaign); return; }
          else if (key === 'link-order') { formDialog('Link confirmed order', field('Order ID', 'orderId'), async v => { await request(`/campaigns/${campaign.campaignId}/orders`, v); notify('Primary campaign attribution saved'); }); return; }
          else if (key !== 'progress-refresh') await request(`/campaigns/${campaign.campaignId}/action`, { action: key, expectedDigest: campaign.snapshotDigest });
          await refresh(); await load();
        } catch (error) { dialog.querySelector('.form-error').textContent = error.message; button.disabled = false; }
      });
      } finally { refreshing = false; }
    }
    async function poll() {
      if (!dialog.isConnected) return;
      if (!document.hidden) { try { await refresh(); } catch (error) { dialog.querySelector('.form-error').textContent = `Progress update failed: ${error.message}`; } }
      if (dialog.isConnected) timer = setTimeout(poll, 8000);
    }
    dialog.addEventListener('close', () => clearTimeout(timer), { once: true });
    await refresh(); timer = setTimeout(poll, 8000);
  }
  async function openFinance(campaign) {
    let reportCursor = null;
    const { dialog } = modal('Linked order report', '<div data-finance></div><div class="form-actions">' + action('finance-next', 'Next order page', true) + '</div>');
    async function show() {
      const report = await request(`/campaigns/${campaign.campaignId}/finance?limit=50${reportCursor ? `&cursor=${encodeURIComponent(reportCursor)}` : ''}`);
      dialog.querySelector('[data-finance]').innerHTML = `<p>${esc(report.note)}</p>${!report.complete ? '<p>Partial report: check subsequent pages, missing currency/amounts and payment history before using a total.</p>' : ''}${Object.entries(report.byCurrency).map(([currency, totals]) => `<article class="panel"><h3>${esc(currency)}</h3><p>Booked: ${esc(totals.booked)}</p><p>Collected: ${esc(totals.collected)} · Refunds: ${esc(totals.refunds)}</p><p>Net collected: ${esc(totals.netCollected)}</p></article>`).join('') || '<p>No financial records on this page.</p>'}${report.orders.map(o => `<p>${esc(o.orderId)} · ${esc(pretty(o.status))} · ${esc(o.currency || 'Currency missing')} ${esc(o.totalAmount)}</p>`).join('')}`;
      const button = dialog.querySelector('[data-action="finance-next"]'); button.disabled = !report.pagination.hasMore;
      button.onclick = () => guard(async () => { reportCursor = report.pagination.nextCursor; await show(); });
    }
    await show();
  }
  function createTask() {
    formDialog('Add follow-up', `${field('Contact ID', 'contactId')}${field('Next action', 'reason')}${field('Due date', 'dueAt', '', 'datetime-local')}${field('Owner user ID', 'assignedTo', capabilities.actorId)}${select('Priority', 'priority', [['NORMAL', 'Normal'], ['HIGH', 'High'], ['LOW', 'Low']])}`, async v => { await request('/tasks', { ...v, dueAt: new Date(v.dueAt).toISOString(), dedupeKey: crypto.randomUUID() }); await load(); });
  }
  function openTask(item) {
    formDialog('Update follow-up', `<p><a href="#client/${encodeURIComponent(item.contactId)}">${esc(item.companyName || item.contactId)}</a> · ${esc(item.reason)}</p>${select('Action', 'action', [['complete', 'Complete'], ['reschedule', 'Reschedule'], ['reassign', 'Reassign']])}${field('Outcome / reason', 'outcome')}${field('Owner user ID', 'assignedTo', item.assignedTo)}<label class="field">New date (for reschedule)<input name="dueAt" type="datetime-local" /></label>`, async v => { await request(`/tasks/${item.followUpId || item.id}`, { action: v.action, outcome: v.outcome, assignedTo: v.assignedTo, ...(v.dueAt ? { dueAt: new Date(v.dueAt).toISOString() } : {}) }, 'PATCH'); await load(); });
  }
  function importCsv() { openContactImport({ modal, fieldSelect: select, action, esc, parseCsv, request }); }
  async function refreshCounts() {
  try {
    const totals = await request('/overview');
    if (alive()) page.querySelector('[data-overview]').innerHTML = `<a class="panel" href="#clients"><strong>${totals.totalContacts}</strong><span>Total contact records</span></a><a class="panel" href="#clients/existing"><strong>${totals.preparedCounts.existing}</strong><span>Existing clients · prepared</span></a><a class="panel" href="#clients/future"><strong>${totals.preparedCounts.future}</strong><span>Future clients · prepared</span></a><a class="panel" href="#clients/premium"><strong>${totals.preparedCounts.premium}</strong><span>Premium / VIP · overlaps other views</span></a><a class="panel" href="#whatsapp"><strong>${totals.repliedContacts}</strong><span>Clients with replies recorded by this upgrade</span></a><div class="panel"><strong>${totals.optedOutNumbers ?? 'Restricted'}</strong><span>Opted-out numbers · prepared records</span></div>`;
  } catch (error) { if (alive()) page.querySelector('[data-overview]').insertAdjacentHTML('beforeend', `<p>Counts unavailable: ${esc(error.message)}</p>`); }
  }
  await load(); await refreshCounts();
}

export async function openPermissionReview({ api, contactId, notify }) {
  const path = `/marketing-workspace/contacts/${encodeURIComponent(contactId)}/permission`;
  try {
    const { data } = await api(path);
    formDialog('Marketing permission', `<p>${esc(data.e164 || 'Phone needs review')} · ${esc(pretty(data.state))}</p><p>Record permission only when the client has genuinely given it. This applies to the same destination across all linked contact records.</p>${select('Permission', 'state', [['revoked', 'Opt out / revoke'], ['granted', 'Record permission']])}${select('Evidence source', 'source', [['CUSTOMER_REQUEST', 'Customer request'], ['SIGNED_FORM', 'Signed form'], ['CUSTOMER_MESSAGE', 'Customer message'], ['RECORDED_CALL', 'Recorded call'], ['IN_PERSON', 'In person']])}${field('Evidence reference', 'evidenceReference')}${field('Permission obtained at', 'obtainedAt', '', 'datetime-local')}${field('Reason', 'reason')}<label><input type="checkbox" name="restoresOptOut" /> Fresh permission explicitly restores a previous marketing opt-out.</label>`, async v => { await api(path, { method: 'POST', body: { ...v, restoresOptOut: v.restoresOptOut === 'on', obtainedAt: new Date(v.obtainedAt).toISOString(), expectedVersion: data.version } }); notify('Permission record saved'); });
  } catch (error) { notify(error.message, true); }
}

export async function mountContactWorkspace({ page, api, contact, notify, openQuotation }) {
  let capabilities;
  try { capabilities = (await api('/marketing-workspace/capabilities')).data; } catch { return; }
  if (!capabilities?.enabled || location.hash !== `#client/${contact.contactId}`) return;
  const formDialog = (...args) => { const dialog = baseFormDialog(...args); attachLookupFields(dialog, api, contact.contactId); return dialog; };
  const section = document.createElement('section'); section.className = 'panel crm-contact-history';
  section.innerHTML = `<h3>Client workspace</h3><div class="form-actions">${action('permission', 'Permission evidence')}${action('company', 'Link company')}${action('followup', 'Add follow-up')}${action('account-review', 'Account preferences')}${action('complaint', 'Record complaint')}${action('opportunity', 'Open opportunity')}</div><nav class="crm-directory-tabs" aria-label="Client history">${[['contacts', 'Contacts / companies'], ['activity', 'Activity timeline'], ['opportunities', 'Opportunities'], ['quotations', 'Quotations'], ['orders', 'Orders'], ['payments', 'Payments'], ['conversations', 'Conversations'], ['marketing', 'Marketing history'], ['tasks', 'Notes & tasks']].map(([key, text]) => `<button class="button button-secondary" data-history="${key}">${text}</button>`).join('')}</nav><p data-history-status></p><div data-history-rows></div>${action('history-next', 'Next page', true)}`;
  page.append(section); let kind = 'opportunities', cursor = null, next = null, generation = 0;
  const request = async (path, body, method = 'POST') => (await api(`/marketing-workspace${path}`, body ? { method, body } : {})).data;
  async function show() {
    const mine = ++generation, status = section.querySelector('[data-history-status]'); status.textContent = 'Loading…';
    try {
      const data = await request(`/contacts/${contact.contactId}/${kind === 'activity' ? 'timeline' : `history/${kind}`}?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (!section.isConnected || mine !== generation) return;
      next = data.pagination.nextCursor; section.querySelector('[data-action="history-next"]').disabled = !next;
      section.querySelectorAll('[data-history]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.history === kind)));
      section.querySelector('[data-history-rows]').innerHTML = data.items.map(item => `<article class="crm-workspace-row"><div><strong>${esc(item.quotationNumber || item.orderNumber || item.reason || item.title || item.name || item.leadId || item.campaignId || item.paymentId || item.conversationId || item.id)}</strong><p>${esc(pretty(item.leadStatus || item.status))} · ${esc(stamp(item.dueAt || item.createdAt))}</p>${kind === 'marketing' ? `<p>${esc(item.preparedMessage?.text || '')}</p>` : ''}${kind === 'payments' || kind === 'orders' || kind === 'quotations' ? `<p>${esc(item.currency || 'Currency not recorded')} ${esc(item.totalAmount ?? item.amount ?? '')}</p>` : ''}</div>${kind === 'tasks' && item.status === 'SCHEDULED' ? `<button class="button button-secondary" data-complete-task="${esc(item.followUpId || item.id)}">${item.source === 'COMPLAINT' ? 'Resolve complaint' : 'Complete task'}</button>` : kind === 'contacts' ? `<a class="button button-secondary" href="#client/${encodeURIComponent(item.contactId)}">Open linked client</a>` : kind === 'opportunities' ? `<button class="button button-secondary" data-stage="${esc(item.leadId)}">Update stage</button>` : kind === 'conversations' ? `<a class="button button-secondary" href="#whatsapp/${encodeURIComponent(item.conversationId)}">Open chat</a>` : kind === 'quotations' ? `<button class="button button-secondary" data-quote="${esc(item.quotationId)}">Open quotation</button>` : ''}</article>`).join('') || '<p>No linked records here yet.</p>';
      section.querySelectorAll('[data-complete-task]').forEach(button => { button.onclick = () => formDialog('Complete follow-up', field('Outcome / resolution', 'outcome'), async v => { await request(`/tasks/${button.dataset.completeTask}`, { ...v, action: 'complete' }, 'PATCH'); await show(); }); });
      section.querySelectorAll('[data-quote]').forEach(b => { b.onclick = () => openQuotation(b.dataset.quote).catch(e => notify(e.message, true)); });
      section.querySelectorAll('[data-stage]').forEach(b => { b.onclick = () => {
        const lead = data.items.find(i => i.leadId === b.dataset.stage);
        const stages = ['NEW_LEAD', 'QUALIFYING', 'SAMPLE_SENT', 'QUOTATION_SENT', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST', 'ON_HOLD'];
        const optional = (label, name, value = '') => `<label class="field">${esc(label)}<input name="${name}" value="${esc(value)}" /></label>`;
        const dialog = formDialog('Opportunity', select('Stage', 'stage', stages.map(s => [s, pretty(s)])) + field('Reason for this update', 'reason') + field('Owner', 'assignedTo', lead.assignedTo || contact.assignedTo || capabilities.actorId) + optional('Expected value', 'expectedValue', lead.expectedValue || '') + optional('Currency', 'currency', lead.currency || '') + optional('Service interest', 'serviceInterest', lead.serviceInterest || '') + optional('Next action', 'nextAction', lead.nextAction || '') + '<label class="field">Next action date<input name="nextActionAt" type="datetime-local" /></label>' + optional('Confirmed order (required for Won)', 'orderId', lead.orderId || '') + optional('Quotation', 'quotationId', lead.quotationId || ''), async v => {
          const fields = Object.fromEntries(Object.entries(v).filter(([, value]) => value !== ''));
          if (fields.nextActionAt) fields.nextActionAt = new Date(fields.nextActionAt).toISOString();
          if (fields.currency) fields.currency = fields.currency.toUpperCase();
          await request(`/opportunities/${lead.leadId}/stage`, { ...fields, expectedStage: lead.leadStatus, expectedRevision: lead.crmRevision || 0 }, 'PATCH'); await show();
        });
        dialog.querySelector('[name="stage"]').value = lead.leadStatus;
      }; });
      status.textContent = `${data.items.length} linked records on this page. Financial amounts shown are source records, not a consolidated balance.`;
    } catch (error) { if (section.isConnected && mine === generation) status.textContent = `Unavailable: ${error.message}`; }
  }
  section.onclick = event => {
    const tab = event.target.closest('[data-history]'); if (tab) { kind = tab.dataset.history; cursor = null; show(); return; }
    const key = event.target.closest('[data-action]')?.dataset.action;
    if (key === 'history-next' && next) { cursor = next; show(); }
    if (key === 'permission') openPermissionReview({ api, contactId: contact.contactId, notify });
    if (key === 'company') formDialog('Link an existing company record', `${field('Company record ID', 'companyId')}${field('Reason', 'reason')}<label><input type="checkbox" name="preferred" /> This is the preferred recipient for that company.</label><p>This links existing records and keeps their individual histories.</p>`, async v => { await request(`/contacts/${contact.contactId}/company`, { ...v, preferred: v.preferred === 'on' }); notify('Company association saved'); });
    if (key === 'complaint') formDialog('Record complaint', `${field('Complaint / issue', 'reason')}${field('Owner', 'assignedTo', capabilities.actorId)}${field('Resolution due', 'dueAt', '', 'datetime-local')}<p>Marketing for this client stays held until all complaint tasks are resolved.</p>`, async v => { await request(`/contacts/${contact.contactId}/complaints`, { ...v, dueAt: new Date(v.dueAt).toISOString(), requestId: crypto.randomUUID() }); kind = 'tasks'; cursor = null; await show(); });
    if (key === 'opportunity') { request('/opportunities', { contactId: contact.contactId }).then(() => { kind = 'opportunities'; cursor = null; return show(); }).catch(e => notify(e.message, true)); }
    if (key === 'account-review') formDialog('Account preferences', `<label class="field">Preferred services<textarea name="preferredServices">${esc(contact.crmPreferredServices || '')}</textarea></label><label class="field">Style notes<textarea name="styleNotes">${esc(contact.crmStyleNotes || '')}</textarea></label><label class="field">Open concerns<textarea name="concerns">${esc(contact.crmOpenConcerns || '')}</textarea></label><label class="field">Next account review<input name="reviewAt" type="datetime-local" /></label>${field('Review reason', 'reason')}`, async v => { await request(`/contacts/${contact.contactId}/account-review`, { ...v, reviewAt: v.reviewAt ? new Date(v.reviewAt).toISOString() : null, expectedRevision: contact.crmAccountRevision || 0 }, 'PATCH'); contact.crmAccountRevision = (contact.crmAccountRevision || 0) + 1; contact.crmPreferredServices = v.preferredServices; contact.crmStyleNotes = v.styleNotes; contact.crmOpenConcerns = v.concerns; notify('Account preferences saved'); });
    if (key === 'followup') formDialog('Next action', `${field('Action', 'reason')}${field('Due date', 'dueAt', '', 'datetime-local')}${field('Owner user ID', 'assignedTo', capabilities.actorId)}`, async v => { await request('/tasks', { ...v, contactId: contact.contactId, dueAt: new Date(v.dueAt).toISOString(), dedupeKey: crypto.randomUUID() }); kind = 'tasks'; cursor = null; await show(); });
  };
  await show();
}

export function parseCsv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && input[i + 1] === '\n') i++; row.push(cell); if (row.some(v => v !== '')) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function download(text, filename) { const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
