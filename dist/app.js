const config = window.__CRM_CONFIG__ || {};
const authKey = "rx-crm-session-v1";
const state = {
  session: readSession(),
  importPayload: null,
  importPreview: null
};

const loginView = document.querySelector("#login-view");
const shell = document.querySelector("#app-shell");
const page = document.querySelector("#page");
const pageTitle = document.querySelector("#page-title");
const toast = document.querySelector("#toast");

document.querySelector("#login-form").addEventListener("submit", login);
document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#menu-button").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("open"));
window.addEventListener("hashchange", renderRoute);

if (state.session?.accessToken) boot();
else {
  localStorage.removeItem(authKey);
  state.session = null;
  showLogin();
}

async function login(event) {
  event.preventDefault();
  const button = event.submitter;
  const error = document.querySelector("#login-error");
  error.hidden = true;
  button.disabled = true;
  button.textContent = "Signing in…";
  try {
    const email = document.querySelector("#login-email").value.trim().toLowerCase();
    const password = document.querySelector("#login-password").value;
    const response = await fetch(`${config.apiBaseUrl}/auth/password/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(readApiError(payload));
    state.session = {
      email: payload.data.user.email,
      name: payload.data.user.name,
      role: payload.data.user.role,
      accessToken: payload.data.accessToken,
      refreshToken: payload.data.refreshToken,
      expiresAt: Date.now() + Number(payload.data.expiresInSeconds || 3600) * 1000
    };
    document.querySelector("#login-password").value = "";
    saveSession();
    await boot();
  } catch (loginError) {
    error.textContent = loginError.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = state.session ? "Signed in" : "Sign in <span>→</span>";
  }
}

function resetPasswordLogin() {
  document.querySelector("#login-password").value = "";
  document.querySelector("#login-error").hidden = true;
  document.querySelector("#login-submit").innerHTML = "Sign in <span>→</span>";
}

async function boot() {
  loginView.hidden = true;
  shell.hidden = false;
  const email = state.session?.email || "CRM User";
  document.querySelector("#user-email").textContent = email;
  document.querySelector("#user-avatar").textContent = email.slice(0, 1).toUpperCase();
  document.querySelectorAll("[data-owner-only]").forEach((element) => {
    element.hidden = !["OWNER", "ADMIN"].includes(state.session?.role);
  });
  if (!location.hash) location.hash = "#dashboard";
  await renderRoute();
}

function showLogin() {
  shell.hidden = true;
  loginView.hidden = false;
}

function logout() {
  localStorage.removeItem(authKey);
  state.session = null;
  state.importPayload = null;
  state.importPreview = null;
  resetPasswordLogin();
  location.hash = "";
  showLogin();
}

async function api(path, options = {}) {
  if (!state.session) throw new Error("Authentication required");
  if (Date.now() > Number(state.session.expiresAt || 0) - 60_000) await refreshSession();
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${state.session.accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) logout();
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Request failed (${response.status})`);
  return payload;
}

async function refreshSession() {
  if (!state.session?.refreshToken) {
    logout();
    throw new Error("Session expired. Please sign in again.");
  }
  const response = await fetch(`${config.apiBaseUrl}/auth/password/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: state.session.refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    logout();
    throw new Error(readApiError(payload));
  }
  state.session = {
    email: payload.data.user.email,
    name: payload.data.user.name,
    role: payload.data.user.role,
    accessToken: payload.data.accessToken,
    refreshToken: payload.data.refreshToken,
    expiresAt: Date.now() + Number(payload.data.expiresInSeconds || 3600) * 1000
  };
  saveSession();
}

async function renderRoute() {
  if (!state.session) return;
  document.querySelector(".sidebar").classList.remove("open");
  const route = (location.hash.replace(/^#/, "") || "dashboard").split("/");
  const base = route[0];
  if (base === "import" && !["OWNER", "ADMIN"].includes(state.session?.role)) {
    location.hash = "#dashboard";
    return;
  }
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === base || (base === "client" && link.dataset.route === "clients")));
  page.innerHTML = '<div class="loading-card">Loading…</div>';
  try {
    if (base === "clients") await renderClients();
    else if (base === "client" && route[1]) await renderClient(route[1]);
    else if (base === "import") await renderImport();
    else await renderDashboard();
  } catch (error) {
    if (/session expired|authentication/i.test(error.message)) return logout();
    page.innerHTML = `<div class="empty-state"><strong>Could not load this page</strong><p>${esc(error.message)}</p><button class="button button-secondary" id="retry-button">Try again</button></div>`;
    document.querySelector("#retry-button")?.addEventListener("click", renderRoute);
  }
}

async function renderDashboard() {
  pageTitle.textContent = "Overview";
  const { data } = await api("/dashboard/summary");
  page.innerHTML = `
    <div class="section-head"><div><h1>Good to see you.</h1><p>Your client operations at a glance.</p></div><a class="button button-primary" href="#clients">View clients</a></div>
    <div class="cards">
      ${metric("Total clients", data.contacts, "All client records", "blue")}
      ${metric("Active orders", data.activeOrders, "Currently in production", "mint")}
      ${metric("Due follow-ups", data.dueFollowUps, "Need attention", "amber")}
      ${metric("Open conversations", data.openConversations, `${data.unreadMessages} unread messages`, "blue")}
      ${metric("Active leads", data.activeLeads, "Separate from existing clients", "mint")}
      ${metric("Unread messages", data.unreadMessages, "Across WhatsApp and channels", "amber")}
    </div>
    <div class="quick-grid">
      <section class="panel"><h3>Client-first workflow</h3><p>Keep orders, payments and conversations attached to one permanent client profile.</p><div class="action-list">
        <a class="action-row" href="#clients"><div><strong>Search client records</strong><span>Find by company, person or phone</span></div><b>→</b></a>
        ${["OWNER", "ADMIN"].includes(state.session?.role) ? '<a class="action-row" href="#import"><div><strong>Import order register</strong><span>Preview and deduplicate before saving</span></div><b>→</b></a>' : ""}
      </div></section>
      <section class="panel accent-panel"><h3>WhatsApp is connected</h3><p>Future incoming messages can attach to existing clients through their normalized phone number.</p><a class="button" href="#clients">Open client directory</a></section>
    </div>`;
}

async function renderClients(search = "") {
  pageTitle.textContent = "Clients";
  const query = new URLSearchParams({ limit: "100" });
  if (search) query.set("search", search);
  const { data } = await api(`/contacts?${query}`);
  page.innerHTML = `
    <div class="section-head"><div><h1>Client directory</h1><p>Existing clients and their complete business history.</p></div></div>
    <div class="toolbar"><input class="search-input" id="client-search" placeholder="Search company, person, phone or city…" value="${attr(search)}" /><button class="button button-primary" id="add-client">+ Add client</button></div>
    <div class="table-card"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Phone</th><th>City</th><th>Sales person</th><th>Type</th><th>Last activity</th></tr></thead><tbody>
      ${data.length ? data.map(clientRow).join("") : '<tr><td colspan="6"><div class="empty-state">No clients found.</div></td></tr>'}
    </tbody></table></div></div>`;
  let timer;
  document.querySelector("#client-search").addEventListener("input", (event) => {
    clearTimeout(timer);
    timer = setTimeout(() => renderClients(event.target.value.trim()), 350);
  });
  document.querySelector("#add-client").addEventListener("click", showAddClient);
  document.querySelectorAll("[data-client-id]").forEach((row) => row.addEventListener("click", () => { location.hash = `#client/${row.dataset.clientId}`; }));
}

async function renderClient(contactId) {
  pageTitle.textContent = "Client profile";
  const { data } = await api(`/contacts/${encodeURIComponent(contactId)}/overview`);
  const client = data.contact;
  page.innerHTML = `
    <div class="section-head"><div><a href="#clients" class="muted">← Back to clients</a></div></div>
    <section class="detail-hero"><div class="detail-person"><div class="detail-avatar">${esc(initials(client.companyName || client.contactPerson))}</div><div><h1>${esc(client.companyName || client.contactPerson || "Unnamed client")}</h1><p>${esc(client.primaryPhone || "No phone")} · ${esc(client.city || "City not set")}</p></div></div><span class="badge green">${esc(pretty(client.relationshipType || "CLIENT"))}</span></section>
    <div class="detail-stats">
      ${miniStat("Orders", data.summary.totalOrders)}${miniStat("Order value", money(data.summary.totalValue))}${miniStat("Paid", money(data.summary.paidAmount))}${miniStat("Outstanding", money(data.summary.outstandingAmount))}
    </div>
    <div class="detail-grid">
      <section class="panel"><h3>Client information</h3><p>Permanent account details</p><div class="info-list">
        ${info("Contact person", client.contactPerson || "—")}${info("Primary phone", client.primaryPhone || "—")}${info("Email", (client.emails || []).join(", ") || "—")}${info("Location", [client.city, client.state, client.country].filter(Boolean).join(", ") || "—")}${info("Sales person", client.salesPersonName || "—")}${info("GST", client.gstNumber || "—")}${info("Notes", client.notes || "—")}
      </div></section>
      <section class="panel"><h3>Order history</h3><p>${data.orders.length} order${data.orders.length === 1 ? "" : "s"} linked to this client</p>
        <div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>Date</th><th>Order</th><th>Status</th><th>Designer</th><th>Total</th><th>Payment</th></tr></thead><tbody>
          ${data.orders.length ? data.orders.map(orderRow).join("") : '<tr><td colspan="6">No orders yet.</td></tr>'}
        </tbody></table></div>
      </section>
    </div>`;
}

async function renderImport() {
  pageTitle.textContent = "Import register";
  const summary = state.importPreview?.summary;
  page.innerHTML = `
    <div class="section-head"><div><h1>Import existing clients</h1><p>Upload or paste the order register. Nothing is saved until you approve the preview.</p></div></div>
    <div class="import-layout">
      <section class="panel"><h3>Order-register file</h3><p>Excel-exported TSV, CSV or pasted table is supported.</p>
        <label class="drop-zone"><input id="import-file" type="file" accept=".csv,.tsv,.txt" /><span><strong>Choose a CSV / TSV file</strong>or drop it here</span></label>
        <textarea id="import-text" class="import-textarea" placeholder="Or paste the table here, including its header row…"></textarea>
        <div class="form-actions"><button class="button button-secondary" id="clear-import">Clear</button><button class="button button-primary" id="preview-import">Preview import</button></div>
      </section>
      <section class="panel" id="preview-panel"><h3>Safe preview</h3><p>Blank template rows and duplicates are excluded automatically.</p>
        ${summary ? importSummary(summary, state.importPreview.rows) : '<div class="empty-state" style="margin-top:20px;padding:35px">Upload or paste your register to see the preview.</div>'}
      </section>
    </div>`;
  document.querySelector("#import-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    document.querySelector("#import-text").value = await file.text();
    document.querySelector("#import-text").dataset.sourceName = file.name;
  });
  document.querySelector("#clear-import").addEventListener("click", () => {
    state.importPayload = null; state.importPreview = null; renderImport();
  });
  document.querySelector("#preview-import").addEventListener("click", previewImport);
  document.querySelector("#commit-import")?.addEventListener("click", commitImport);
}

async function previewImport() {
  const textarea = document.querySelector("#import-text");
  const text = textarea.value;
  if (!text.trim()) return notify("Paste or choose the order register first.", true);
  const matrix = parseTable(text);
  if (matrix.length < 2) return notify("The register must include headers and at least one row.", true);
  state.importPayload = {
    sourceName: textarea.dataset.sourceName || "pasted-order-register.tsv",
    headers: matrix[0],
    rows: matrix.slice(1)
  };
  const button = document.querySelector("#preview-import");
  button.disabled = true; button.textContent = "Checking…";
  try {
    const { data } = await api("/imports/order-register/preview", { method: "POST", body: state.importPayload });
    state.importPreview = data;
    await renderImport();
  } catch (error) { notify(error.message, true); }
  finally { if (document.body.contains(button)) { button.disabled = false; button.textContent = "Preview import"; } }
}

async function commitImport() {
  if (!state.importPayload || !state.importPreview) return;
  const usable = state.importPreview.summary.usableRows;
  if (!confirm(`Import ${usable} client/order rows into the CRM?`)) return;
  const button = document.querySelector("#commit-import");
  button.disabled = true; button.textContent = "Importing…";
  try {
    const { data } = await api("/imports/order-register/commit", { method: "POST", body: state.importPayload });
    const result = data.result;
    notify(`Imported ${result.createdClients} clients and ${result.createdOrders} orders. ${result.skippedExisting} already existed.`);
    state.importPayload = null; state.importPreview = null;
    location.hash = "#clients";
  } catch (error) {
    notify(error.message, true);
    button.disabled = false; button.textContent = "Import approved rows";
  }
}

function showAddClient() {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<form class="modal" id="client-form"><div class="modal-head"><div><p class="eyebrow">NEW RECORD</p><h3>Add existing client</h3></div><button class="modal-close" type="button">×</button></div>
    <div class="form-grid">
      <label class="field full">Company / party name<input name="companyName" required /></label>
      <label class="field">Contact person<input name="contactPerson" /></label>
      <label class="field">Phone<input name="primaryPhone" inputmode="tel" /></label>
      <label class="field">City<input name="city" /></label>
      <label class="field">Sales person<input name="salesPersonName" /></label>
      <label class="field">GST number<input name="gstNumber" /></label>
      <label class="field">Status<select name="status"><option>ACTIVE</option><option>INACTIVE</option><option>BLOCKED</option></select></label>
      <label class="field full">Notes<textarea name="notes"></textarea></label>
    </div><p class="form-error" hidden></p><div class="form-actions"><button type="button" class="button button-secondary modal-cancel">Cancel</button><button class="button button-primary" type="submit">Create client</button></div></form>`;
  document.body.append(backdrop);
  const close = () => backdrop.remove();
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.querySelector(".modal-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  backdrop.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const error = form.querySelector(".form-error");
    const submit = event.submitter;
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      const { data } = await api("/contacts", { method: "POST", body: { ...values, relationshipType: "EXISTING_CLIENT", tags: ["EXISTING_CLIENT"], source: "MANUAL" } });
      close(); notify("Client created successfully."); location.hash = `#client/${data.contactId}`;
    } catch (submitError) {
      error.textContent = submitError.message; error.hidden = false; submit.disabled = false;
    }
  });
}

function importSummary(summary, rows) {
  const warnings = rows.filter((row) => row.valid && row.warnings?.length).slice(0, 12);
  return `<div class="import-summary">
    ${summaryBox("Usable rows", summary.usableRows)}${summaryBox("Skipped blanks", summary.skippedBlankRows)}${summaryBox("Needs review", summary.warningRows)}${summaryBox("Order value", money(summary.totalOrderValue))}
  </div>${warnings.length ? `<ul class="warning-list">${warnings.map((row) => `<li><strong>Row ${row.rowNumber} · ${esc(row.partyName)}</strong><br>${row.warnings.map(esc).join(" · ")}</li>`).join("")}</ul>` : '<p class="muted" style="margin-top:18px">No warnings found.</p>'}
  <button class="button button-primary button-full" id="commit-import" style="margin-top:20px">Import approved rows</button>`;
}

function parseTable(text) {
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (clean.includes("\t")) return clean.split("\n").filter((line) => line.trim()).map((line) => line.split("\t").map((cell) => cell.trim()));
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '"' && quoted && clean[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if (char === "\n" && !quoted) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function metric(label, value, note, color) { return `<article class="metric-card ${color}"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${esc(value)}</strong><span class="metric-note">${esc(note)}</span></article>`; }
function miniStat(label, value) { return `<div class="mini-stat"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
function summaryBox(label, value) { return `<div class="summary-box"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }
function info(label, value) { return `<div class="info-row"><small>${esc(label)}</small><strong>${esc(value)}</strong></div>`; }
function clientRow(client) {
  const name = client.companyName || client.contactPerson || "Unnamed client";
  return `<tr data-client-id="${attr(client.contactId)}"><td><div class="party-cell"><span class="party-avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(client.contactPerson || "Existing client")}</small></div></div></td><td>${esc(client.primaryPhone || "—")}</td><td>${esc(client.city || "—")}</td><td>${esc(client.salesPersonName || "—")}</td><td><span class="badge ${client.relationshipType === "EXISTING_CLIENT" ? "green" : "blue"}">${esc(pretty(client.relationshipType || "PROSPECT"))}</span></td><td>${esc(date(client.lastInteractionAt || client.updatedAt))}</td></tr>`;
}
function orderRow(order) {
  const status = order.status || "CONFIRMED";
  return `<tr><td>${esc(date(order.orderDate || order.createdAt))}</td><td>${esc(order.notes?.split("\n")[0]?.replace(/^Rate details:\s*/, "") || "Order")}</td><td><span class="badge ${status === "DISPATCHED" ? "green" : status.includes("DESIGN") ? "blue" : "amber"}">${esc(pretty(status))}</span></td><td>${esc(order.designerName || "—")}</td><td>${esc(money(order.totalAmount))}</td><td><span class="badge ${order.paymentStatus === "PAID" ? "green" : order.paymentStatus === "PARTIAL" ? "amber" : "red"}">${esc(pretty(order.paymentStatus || "PENDING"))}</span></td></tr>`;
}
function money(value) { return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(Number(value || 0)); }
function date(value) {
  if (!value) return "—";
  const parsed = value?._seconds ? new Date(value._seconds * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(parsed);
}
function pretty(value) { return String(value || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()); }
function initials(value) { return String(value || "RX").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function attr(value) { return esc(value); }
function notify(message, error = false) { toast.textContent = message; toast.className = `toast${error ? " error" : ""}`; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 5000); }
function readApiError(payload) { return payload.error?.message || payload.message || "Login failed. Please try again."; }
function readSession() { try { return JSON.parse(localStorage.getItem(authKey)); } catch { return null; } }
function saveSession() { localStorage.setItem(authKey, JSON.stringify(state.session)); }
