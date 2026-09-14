import { openBulkClients } from './crm-bulk-ui.mjs';
import { patchMarkup } from "./dom-patch.mjs";
import { openPermissionReview } from './marketing-workspace.mjs';

const labels = { all: "All contacts", existing: "Existing", future: "Future", premium: "Premium / VIP", inactive: "Inactive", review: "Needs review" };
const relationshipLabels = { unclassified: "Unclassified", prospect: "Future Client", customer: "Existing Client" };
const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function mountClientDirectory({ page, api, capabilities, onAdd, notify, active = () => true, initialView = 'all' }) {
  let view = labels[initialView] ? initialView : 'all', search = "", generation = 0, timer, pages = [null], pageIndex = 0, nextCursor = null;
  const filters = {}, selected = new Set();
  const select = (label, name, choices) => `<label class="field">${label}<select data-filter="${name}"><option value="">All</option>${choices.map(v => `<option value="${v}">${v}</option>`).join('')}</select></label>`;
  page.innerHTML = `<div class="section-head"><div><h1>Client directory</h1><p>Classify and review your existing contact records.</p></div><button class="button button-primary" data-directory-add>Add client</button></div>
    <section class="panel crm-directory-panel"><nav class="crm-directory-tabs" aria-label="Client views">${Object.entries(labels).map(([key, label]) => `<button class="button button-secondary" data-directory-view="${key}" aria-pressed="${key === view}">${label} <span data-count="${key}">—</span></button>`).join("")}</nav>
    <p class="muted">Views overlap. Premium clients can also be inactive. Counts are contact records, not unique companies or sendable numbers.</p>
    ${capabilities.pendingPreparation ? `<p role="status">${capabilities.preparedRecords} of ${capabilities.totalRecords} records prepared. ${capabilities.pendingPreparation} await preparation and are not included below.</p>` : ""}
    <div class="toolbar"><label class="field">Search company / person name<input id="directory-search" class="search-input" maxlength="100" placeholder="Name starts with…" /></label><button class="button button-secondary" data-directory-refresh>Refresh</button><button class="button button-secondary" data-directory-bulk>Bulk changes / select all matching</button></div>
    <p class="muted">Inactive means no verified meaningful activity in ${capabilities.inactivityDays} days. Missing history stays unknown.</p>
    <details><summary>Filters and columns</summary><div class="form-grid"><label class="field">City (exact)<input data-filter="city" /></label><label class="field">Owner<input type="search" data-owner-search placeholder="Name starts with (match capitals)" /><select data-filter="owner"><option value="">All owners</option></select><small data-owner-status></small></label>${select('Relationship', 'relationship', ['unclassified', 'prospect', 'customer'])}${select('Tier', 'tier', ['standard', 'premium', 'vip'])}${select('Activity', 'activity', ['active', 'inactive', 'unknown'])}</div><div class="form-actions">${['Classification', 'Activity', 'Marketing permission'].map((label, i) => `<label><input type="checkbox" data-column="${i + 2}" checked /> ${label}</label>`).join('')}</div></details>
    <p data-directory-status role="status" aria-live="polite">Loading records…</p>
    <div class="table-wrap"><table><thead><tr><th>Client / contact</th><th>Classification</th><th>Activity</th><th>Marketing permission</th><th>Actions</th></tr></thead><tbody data-directory-rows></tbody></table></div>
    <div class="form-actions"><button class="button button-secondary" data-directory-prev disabled>Previous</button><span data-directory-page>Page 1</span><button class="button button-secondary" data-directory-next disabled>Next</button></div></section>`;
  const root = page.querySelector(".crm-directory-panel");
  const alive = () => active() && root.isConnected;
  const status = root.querySelector("[data-directory-status]");
  const rows = root.querySelector("[data-directory-rows]");
  const prev = root.querySelector("[data-directory-prev]"), next = root.querySelector("[data-directory-next]");
  page.querySelector("[data-directory-add]").onclick = onAdd;
  async function load(reset = false) {
    if (!alive()) return;
    const current = ++generation;
    if (reset) { pages = [null]; pageIndex = 0; selected.clear(); }
    prev.disabled = next.disabled = true;
    status.textContent = "Loading records…";
    const params = new URLSearchParams({ view, search, ...filters, limit: "50" });
    if (pages[pageIndex]) params.set("cursor", pages[pageIndex]);
    try {
      const [{ data }, { data: stats }] = await Promise.all([
        api(`/client-directory?${params}`), api(`/client-directory/counts?${new URLSearchParams({ search, ...filters })}`)
      ]);
      if (current !== generation || !alive()) return;
      patchMarkup(rows, data.items.length ? data.items.map(item => `<tr data-contact-row="${escape(item.contactId)}"><td><input type="checkbox" data-select-client="${escape(item.contactId)}" aria-label="Select ${escape(item.companyName || item.contactPerson)}" ${selected.has(item.contactId) ? 'checked' : ''} /> <a href="#client/${encodeURIComponent(item.contactId)}"><strong>${escape(item.companyName || item.contactPerson || "Unnamed contact")}</strong></a><br><small>${escape(item.contactPerson)} · ${escape(item.primaryPhone || "No phone")}</small></td><td>${escape(relationshipLabels[item.relationship])}<br><span class="badge">${escape(item.tier)}</span>${item.needsReview ? " <small>Needs review</small>" : ""}</td><td>${escape(item.activity)}<br><small>${escape(item.salesPersonName || "Owner not recorded")}</small></td><td>${item.permission.eligible ? "Permission recorded" : item.permission.state === "suppressed" ? "Opted out / suppressed" : item.permission.state === "needs_review" ? "Request held for review" : "Review destination permission"}<br><small>Open Details / Review to check evidence</small></td><td><button class="button button-secondary" data-review-contact="${escape(item.contactId)}">${capabilities.canClassify ? "Review" : "Details"}</button></td></tr>`).join("") : '<tr><td colspan="5"><div class="empty-state">No prepared records match this view.</div></td></tr>');
      for (const [key, count] of Object.entries(stats.counts)) {
        const target = root.querySelector(`[data-count="${key}"]`);
        if (target) target.textContent = Number(count).toLocaleString();
      }
      rows.querySelectorAll('[data-select-client]').forEach(box => { box.onchange = () => { if (box.checked) selected.add(box.dataset.selectClient); else selected.delete(box.dataset.selectClient); }; });
      applyColumns();
      nextCursor = data.pagination.nextCursor;
      prev.disabled = pageIndex === 0; next.disabled = !data.pagination.hasMore;
      root.querySelector("[data-directory-page]").textContent = `Page ${pageIndex + 1}`;
      status.textContent = `${data.items.length} shown · ${data.count.toLocaleString()} matching contact records`;
    } catch (error) {
      if (current !== generation || !alive()) return;
      rows.replaceChildren();
      status.textContent = `Could not load directory: ${error.message}. Use Refresh to retry.`;
    }
  }
  let columns = {};
  try { columns = JSON.parse(localStorage.getItem('crm-directory-columns') || '{}'); } catch { /* Use default visible columns. */ }
  function applyColumns() { for (const box of root.querySelectorAll('[data-column]')) { box.checked = columns[box.dataset.column] !== false; for (const cell of root.querySelectorAll(`table tr > :nth-child(${box.dataset.column})`)) cell.hidden = !box.checked; } }
  root.querySelectorAll('[data-column]').forEach(box => { box.onchange = () => { columns[box.dataset.column] = box.checked; try { localStorage.setItem('crm-directory-columns', JSON.stringify(columns)); } catch { /* Preference remains for this screen. */ } applyColumns(); }; });
  let ownerGeneration = 0, ownerTimer;
  async function loadOwners() {
    const mine = ++ownerGeneration, search = root.querySelector('[data-owner-search]').value.trim();
    const select = root.querySelector('[data-filter="owner"]'), info = root.querySelector('[data-owner-status]');
    try {
      const { data } = await api(`/client-directory/owners?${new URLSearchParams({ search })}`);
      if (!alive() || mine !== ownerGeneration) return;
      const current = select.value, label = select.selectedOptions[0]?.textContent;
      select.replaceChildren(new Option('All owners', ''));
      for (const item of data.items) select.append(new Option(item.label, item.value, false, current === item.value));
      if (current && !data.items.some(item => item.value === current)) select.append(new Option(label, current, true, true));
      info.textContent = data.hasMore ? 'Narrow the search to see more team members.' : '';
    } catch (error) { if (alive() && mine === ownerGeneration) info.textContent = error.message; }
  }
  root.querySelector('[data-owner-search]').oninput = () => { ownerGeneration++; clearTimeout(ownerTimer); ownerTimer = setTimeout(loadOwners, 300); };
  loadOwners();
  root.querySelectorAll('[data-filter]').forEach(input => { input.onchange = () => { if (input.value.trim()) filters[input.dataset.filter] = input.value.trim(); else delete filters[input.dataset.filter]; load(true); }; });
  root.querySelector("#directory-search").oninput = event => {
    search = event.target.value.trim(); generation += 1;
    clearTimeout(timer); timer = setTimeout(() => load(true), 350);
  };
  root.querySelector('[data-directory-bulk]').onclick = () => openBulkClients({ api, selectedIds: [...selected], filters: { view, search, ...filters }, esc: escape, afterSave: () => load(true) });
  root.querySelector("[data-directory-refresh]").onclick = () => load(true);
  prev.onclick = () => { if (pageIndex > 0) { pageIndex -= 1; load(); } };
  next.onclick = () => { if (nextCursor) { pages[++pageIndex] = nextCursor; load(); } };
  root.onclick = event => {
    const tab = event.target.closest("[data-directory-view]");
    const review = event.target.closest("[data-review-contact]");
    if (tab) {
      view = tab.dataset.directoryView;
      root.querySelectorAll("[data-directory-view]").forEach(button => button.setAttribute("aria-pressed", String(button === tab)));
      load(true);
    } else if (review) openClassificationReview({ api, contactId: review.dataset.reviewContact, capabilities, notify, afterSave: () => load() });
  };
  await load();
}

export async function openClassificationReview({ api, contactId, capabilities, notify, afterSave = () => {} }) {
  let item;
  try { item = (await api(`/client-directory/${encodeURIComponent(contactId)}`)).data; }
  catch (error) { notify(error.message, true); return; }
  const dialog = document.createElement("dialog");
  dialog.className = "modal crm-review-dialog";
  dialog.innerHTML = `<form><div class="modal-head"><div><p class="eyebrow">CLASSIFICATION REVIEW</p><h3>${escape(item.companyName || item.contactPerson || "Contact")}</h3></div><button class="modal-close" type="button" aria-label="Close review">×</button></div>
    <div class="form-grid"><label class="field">Relationship<select name="relationship" ${capabilities.canClassify ? '' : 'disabled'}>${Object.entries(relationshipLabels).map(([value, label]) => `<option value="${value}" ${value === item.relationship ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">Tier<select name="tier" ${capabilities.canChangeTier ? "" : "disabled"}>${["standard", "premium", "vip"].map(tier => `<option value="${tier}" ${tier === item.tier ? "selected" : ""}>${tier === "vip" ? "VIP" : tier}</option>`).join("")}</select></label>
    <label class="field">Phone country (ISO, e.g. IN)<input name="phoneCountryCode" maxlength="2" value="${escape(item.destination.country || '')}" /></label>
    <label class="field full">Review reason<textarea name="reason" minlength="5" maxlength="500" required ${capabilities.canClassify ? "" : "disabled"}></textarea></label></div>
    <p>Activity: <strong>${escape(item.activity)}</strong>. Existing customer history cannot be downgraded.</p>
    <h4>WhatsApp permission</h4><p>${item.permission.state === "suppressed" ? "Opted out or suppressed." : "Unknown — destination permission evidence needs review."} Legacy status: ${escape(item.permission.legacyStatus)}${item.permission.source ? ` · ${escape(item.permission.source)}` : ""}.</p>
    <p>Stored phone: ${escape(item.destination.original || "Missing")}. ${item.destination.e164 ? `Validated format: ${escape(item.destination.e164)}.` : `Review needed: ${escape(item.destination.reason)}.`}</p>
    <p class="muted">Reviewing a client or changing tier does not grant marketing permission.</p><button type="button" class="button button-secondary" data-permission hidden>Review permission evidence</button>
    <p class="form-error" role="alert" hidden></p><div class="form-actions"><button class="button button-secondary" type="button" data-close>Close</button>${capabilities.canClassify ? '<button class="button button-primary" type="submit">Save review</button>' : ""}</div></form>`;
  document.body.append(dialog);
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector(".modal-close").onclick = close;
  dialog.querySelector("[data-close]").onclick = close;
  dialog.oncancel = event => { event.preventDefault(); close(); };
  dialog.showModal();
  api('/marketing-workspace/capabilities').then(({ data }) => { if (data.enabled && dialog.isConnected) { const button = dialog.querySelector('[data-permission]'); button.hidden = false; button.onclick = () => openPermissionReview({ api, contactId, notify }); } }).catch(() => {});
  dialog.querySelector("form").onsubmit = async event => {
    event.preventDefault();
    if (!capabilities.canClassify) return;
    const button = event.submitter, error = dialog.querySelector(".form-error");
    button.disabled = true; error.hidden = true;
    try {
      await api(`/client-directory/${encodeURIComponent(contactId)}/classification`, { method: "PATCH", body: {
        relationship: dialog.querySelector('[name="relationship"]').value, tier: dialog.querySelector('[name="tier"]').value,
        ...(dialog.querySelector('[name="phoneCountryCode"]').value ? { phoneCountryCode: dialog.querySelector('[name="phoneCountryCode"]').value.toUpperCase() } : {}),
        reason: dialog.querySelector('[name="reason"]').value, expectedRevision: item.revision
      } });
      close(); notify("Client review saved. Marketing permission is unchanged."); await afterSave();
    } catch (failure) { error.textContent = failure.message; error.hidden = false; button.disabled = false; }
  };
}
