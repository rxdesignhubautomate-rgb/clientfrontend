const config = window.__CRM_CONFIG__ || {};
const authKey = "rx-crm-session-v1";
const state = {
  session: readSession(),
  importPayload: null,
  importPreview: null,
  whatsapp: freshWhatsappState(),
  marketing: freshMarketingState()
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
  stopWhatsappPolling();
  localStorage.removeItem(authKey);
  state.session = null;
  state.importPayload = null;
  state.importPreview = null;
  state.whatsapp = freshWhatsappState();
  state.marketing = freshMarketingState();
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
  stopWhatsappPolling();
  document.querySelector(".sidebar").classList.remove("open");
  const route = (location.hash.replace(/^#/, "") || "dashboard").split("/");
  const base = route[0];
  if (["import", "marketing"].includes(base) && !["OWNER", "ADMIN"].includes(state.session?.role)) {
    location.hash = "#dashboard";
    return;
  }
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === base || (base === "client" && link.dataset.route === "clients")));
  page.innerHTML = '<div class="loading-card">Loading…</div>';
  try {
    if (base === "whatsapp") await renderWhatsapp(route[1]);
    else if (base === "marketing") await renderMarketing();
    else if (base === "clients") await renderClients();
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

async function renderWhatsapp(requestedConversationId) {
  pageTitle.textContent = "WhatsApp Inbox";
  const wa = state.whatsapp;
  const syncStartedAt = Date.now();
  const [conversationResult, templateResult] = await Promise.all([
    api("/conversations?limit=100&sortBy=lastMessageAt&sortOrder=desc"),
    wa.templates.length ? Promise.resolve({ data: wa.templates }) : api("/whatsapp/utility-templates")
  ]);
  wa.conversations = conversationResult.data.filter((item) => item.currentChannel === "WHATSAPP");
  wa.templates = templateResult.data;
  wa.selectedId = requestedConversationId || wa.selectedId || conversationId(wa.conversations[0]);
  if (wa.selectedId && !wa.conversations.some((item) => conversationId(item) === wa.selectedId)) {
    wa.selectedId = conversationId(wa.conversations[0]);
  }
  if (wa.selectedId) await loadWhatsappConversation(wa.selectedId);
  wa.syncedAt = syncStartedAt;
  renderWhatsappPage();
  startWhatsappPolling();
}

async function loadWhatsappConversation(id, { incremental = false } = {}) {
  const wa = state.whatsapp;
  const selected = wa.conversations.find((item) => conversationId(item) === id);
  if (!selected) return;
  const query = new URLSearchParams({ limit: "100", sortOrder: incremental ? "asc" : "desc" });
  if (incremental && wa.messages.length) {
    const latest = Math.max(...wa.messages.map((item) => asDate(item.createdAt)?.getTime() || 0));
    if (latest) query.set("from", new Date(Math.max(0, latest - 1000)).toISOString());
  }
  const requests = [api(`/conversations/${encodeURIComponent(id)}/messages?${query}`)];
  if (!incremental || !wa.overview || wa.overview.contact?.contactId !== selected.contactId) {
    requests.push(api(`/contacts/${encodeURIComponent(selected.contactId)}/overview`));
  }
  const [messageResult, overviewResult] = await Promise.all(requests);
  const incoming = incremental ? messageResult.data : [...messageResult.data].reverse();
  wa.messages = incremental ? mergeById(wa.messages, incoming, "messageId") : incoming;
  if (overviewResult) wa.overview = overviewResult.data;
  wa.selectedId = id;
  if (!wa.selectedOrderId || !wa.overview?.orders?.some((order) => order.orderId === wa.selectedOrderId)) {
    wa.selectedOrderId = wa.overview?.orders?.[0]?.orderId || null;
  }
  if (!whatsappWindow().open && wa.mode === "TEXT") wa.mode = "TEMPLATE";
  prefillUtilityValues(false);
}

function renderWhatsappPage(draftText = "") {
  const wa = state.whatsapp;
  const selected = selectedConversation();
  page.innerHTML = `
    <div class="wa-page-head">
      <div><h1>WhatsApp Inbox</h1><p>Client chat, order history and transactional updates in one place.</p></div>
      <a class="button button-primary" href="#clients">+ Start client chat</a>
    </div>
    <div class="wa-shell">
      <aside class="wa-inbox-panel">
        <div class="wa-inbox-tools"><input id="wa-search" class="wa-search" placeholder="Search chats..." value="${attr(wa.search)}" />
          <div class="wa-filters">${waFilterButton("ALL", "All")}${waFilterButton("UNREAD", "Unread")}${waFilterButton("OPEN", "Open")}</div>
        </div>
        <div class="wa-conversation-list" id="wa-conversation-list">${waConversationList()}</div>
      </aside>
      ${selected ? whatsappChatMarkup(selected, draftText) : `<section class="wa-no-chat"><div class="wa-empty-icon">WA</div><h3>No WhatsApp conversation yet</h3><p>Open a client profile and choose <strong>Open WhatsApp</strong>. The first outbound message must be an approved Utility template.</p><a class="button button-primary" href="#clients">Choose a client</a></section>`}
    </div>`;
  bindWhatsappEvents();
  if (selected) {
    requestAnimationFrame(() => {
      const body = document.querySelector("#wa-message-list");
      if (body) body.scrollTop = body.scrollHeight;
    });
    markSelectedConversationRead();
  }
}

function whatsappChatMarkup(conversation, draftText) {
  const wa = state.whatsapp;
  const contact = wa.overview?.contact || conversation.contact || {};
  const name = contact.companyName || contact.contactPerson || "WhatsApp client";
  const windowStatus = whatsappWindow();
  return `
    <section class="wa-chat-panel">
      <header class="wa-chat-head">
        <a class="wa-mobile-back" href="#whatsapp" aria-label="Back to conversations">‹</a><div class="wa-chat-person"><span class="wa-avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(contact.primaryPhone || "No phone")} · ${esc(contact.city || "")}</small></div></div>
        <div class="wa-chat-actions">
          <span class="wa-window ${windowStatus.open ? "open" : "closed"}">${windowStatus.open ? `Free reply · ${esc(windowStatus.remaining)}` : "Utility template required"}</span>
          <button class="wa-icon-button" id="wa-toggle-status" title="${conversation.status === "CLOSED" ? "Reopen" : "Close"} conversation">${conversation.status === "CLOSED" ? "↻" : "✓"}</button>
        </div>
      </header>
      <div class="wa-message-list" id="wa-message-list">
        <div class="wa-day-chip">Conversation history</div>
        ${wa.messages.length ? wa.messages.map(waMessage).join("") : '<div class="wa-chat-empty">No messages yet. Use a Utility template to start this conversation.</div>'}
      </div>
      ${waComposer(windowStatus, draftText)}
    </section>
    <aside class="wa-order-panel">${waOrderPanel(contact)}</aside>`;
}

function waComposer(windowStatus, draftText) {
  const wa = state.whatsapp;
  const template = selectedUtilityTemplate();
  const useText = wa.mode === "TEXT" && windowStatus.open;
  return `<div class="wa-composer">
    <div class="wa-compose-tabs">
      <button class="${useText ? "active" : ""}" data-wa-mode="TEXT" ${windowStatus.open ? "" : "disabled"}>Reply</button>
      <button class="${!useText ? "active" : ""}" data-wa-mode="TEMPLATE">Utility update <span>low cost</span></button>
      <small>${windowStatus.open ? "Customer replied within 24 hours" : "Normal reply is locked outside 24 hours"}</small>
    </div>
    ${useText ? `<form id="wa-composer-form" class="wa-text-composer"><textarea id="wa-message-input" rows="1" maxlength="4096" placeholder="Type a message...">${esc(draftText)}</textarea><button class="wa-send-button" type="submit">Send</button></form>` : `
      <form id="wa-composer-form" class="wa-template-composer">
        <div class="wa-template-row"><label>Approved Utility template<select id="wa-template-select">${wa.templates.map((item) => `<option value="${attr(item.id)}" ${item.id === template?.id ? "selected" : ""}>${esc(item.label)}</option>`).join("")}</select></label>
          <label>Related order<select id="wa-template-order"><option value="">Select order</option>${(wa.overview?.orders || []).map((order) => `<option value="${attr(order.orderId)}" ${order.orderId === wa.selectedOrderId ? "selected" : ""}>${esc(orderReference(order))} · ${esc(pretty(order.status))}</option>`).join("")}</select></label></div>
        <div class="wa-template-fields">${(template?.variables || []).map((field) => `<label>${esc(field.label)}<input data-template-field="${attr(field.key)}" value="${attr(wa.templateValues[field.key] || "")}" required /></label>`).join("")}</div>
        <div class="wa-template-preview"><span>UTILITY PREVIEW</span><p>${esc(renderUtilityPreview(template, wa.templateValues))}</p></div>
        <button class="wa-send-template" type="submit">Send Utility update</button>
      </form>`}
  </div>`;
}

function waOrderPanel(contact) {
  const orders = state.whatsapp.overview?.orders || [];
  return `<div class="wa-client-card"><p class="eyebrow">CLIENT & ORDERS</p><h3>${esc(contact.companyName || contact.contactPerson || "Client")}</h3><p>${esc(contact.salesPersonName || "Unassigned sales person")}</p><a href="#client/${attr(contact.contactId || "")}">View complete profile →</a></div>
    <div class="wa-order-head"><strong>Orders</strong><span>${orders.length}</span></div>
    <div class="wa-order-list">${orders.length ? orders.map(waOrderCard).join("") : '<div class="wa-no-orders">No linked orders found.</div>'}</div>
    <div class="wa-cost-note"><strong>Cost control</strong><p>Free-form replies are used only in the active service window. Outside it, only approved Utility templates can be sent.</p></div>`;
}

function waOrderCard(order) {
  const suggested = suggestedTemplate(order.status);
  const statuses = orderStatusOptions(order.status);
  return `<article class="wa-order-card ${order.orderId === state.whatsapp.selectedOrderId ? "selected" : ""}" data-select-order="${attr(order.orderId)}">
    <div><strong>${esc(orderReference(order))}</strong><span>${esc(date(order.orderDate || order.createdAt))}</span></div>
    <p>${esc(order.items?.[0]?.description || order.notes?.split("\n")[0]?.replace(/^Rate details:\s*/, "") || "Client order")}</p>
    <div class="wa-order-money"><strong>${esc(money(order.totalAmount))}</strong><span class="badge ${order.paymentStatus === "PAID" ? "green" : "amber"}">${esc(pretty(order.paymentStatus || "PENDING"))}</span></div>
    <label>Status<select data-order-status="${attr(order.orderId)}">${statuses.map((status) => `<option value="${attr(status)}" ${status === order.status ? "selected" : ""}>${esc(pretty(status))}</option>`).join("")}</select></label>
    ${suggested ? `<button class="wa-prepare-update" data-prepare-template="${attr(suggested)}" data-order-id="${attr(order.orderId)}">Prepare customer update</button>` : ""}
  </article>`;
}

function waConversationList() {
  const wa = state.whatsapp;
  const needle = wa.search.trim().toLowerCase();
  const items = wa.conversations.filter((item) => {
    const contact = item.contact || {};
    const haystack = [contact.companyName, contact.contactPerson, contact.primaryPhone, item.lastMessagePreview].join(" ").toLowerCase();
    if (needle && !haystack.includes(needle)) return false;
    if (wa.filter === "UNREAD") return Number(item.unreadCount || 0) > 0;
    if (wa.filter === "OPEN") return item.status !== "CLOSED";
    return true;
  });
  if (!items.length) return '<div class="wa-no-results">No matching conversations.</div>';
  return items.map((item) => {
    const contact = item.contact || {};
    const name = contact.companyName || contact.contactPerson || contact.primaryPhone || "WhatsApp client";
    const active = conversationId(item) === wa.selectedId;
    return `<button class="wa-conversation ${active ? "active" : ""}" data-conversation-id="${attr(conversationId(item))}"><span class="wa-avatar">${esc(initials(name))}</span><span class="wa-conversation-copy"><span><strong>${esc(name)}</strong><time>${esc(shortTime(item.lastMessageAt))}</time></span><small>${esc(item.lastMessagePreview || "No messages yet")}</small></span>${Number(item.unreadCount || 0) ? `<b>${esc(item.unreadCount)}</b>` : ""}</button>`;
  }).join("");
}

function waMessage(message) {
  const internal = message.direction === "INTERNAL";
  const outbound = message.direction === "OUTBOUND";
  const status = outbound ? messageStatus(message.status) : "";
  return `<div class="wa-message-row ${outbound ? "outbound" : internal ? "internal" : "inbound"}"><div class="wa-bubble"><p>${esc(message.text || `[${pretty(message.type)}]`)}</p><span>${esc(shortTime(message.createdAt))}${status ? ` · ${status}` : ""}</span>${message.type === "TEMPLATE" ? '<em>UTILITY</em>' : ""}</div></div>`;
}

function bindWhatsappEvents() {
  document.querySelector("#wa-search")?.addEventListener("input", (event) => {
    state.whatsapp.search = event.target.value;
    document.querySelector("#wa-conversation-list").innerHTML = waConversationList();
    bindConversationRows();
  });
  document.querySelectorAll("[data-wa-filter]").forEach((button) => button.addEventListener("click", () => {
    state.whatsapp.filter = button.dataset.waFilter;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  }));
  bindConversationRows();
  document.querySelectorAll("[data-wa-mode]").forEach((button) => button.addEventListener("click", () => {
    state.whatsapp.mode = button.dataset.waMode;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  }));
  document.querySelector("#wa-template-select")?.addEventListener("change", (event) => {
    state.whatsapp.templateId = event.target.value;
    state.whatsapp.templateValues = {};
    prefillUtilityValues(true);
    renderWhatsappPage();
  });
  document.querySelector("#wa-template-order")?.addEventListener("change", (event) => {
    state.whatsapp.selectedOrderId = event.target.value || null;
    state.whatsapp.templateValues = {};
    prefillUtilityValues(true);
    renderWhatsappPage();
  });
  document.querySelectorAll("[data-template-field]").forEach((input) => input.addEventListener("input", () => {
    state.whatsapp.templateValues[input.dataset.templateField] = input.value;
    const preview = document.querySelector(".wa-template-preview p");
    if (preview) preview.textContent = renderUtilityPreview(selectedUtilityTemplate(), state.whatsapp.templateValues);
  }));
  document.querySelector("#wa-composer-form")?.addEventListener("submit", sendWhatsappMessage);
  document.querySelector("#wa-toggle-status")?.addEventListener("click", toggleConversationStatus);
  document.querySelectorAll("[data-order-status]").forEach((select) => select.addEventListener("change", updateOrderStatus));
  document.querySelectorAll("[data-select-order]").forEach((card) => card.addEventListener("click", (event) => {
    if (event.target.closest("select,button")) return;
    state.whatsapp.selectedOrderId = card.dataset.selectOrder;
    prefillUtilityValues(true);
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  }));
  document.querySelectorAll("[data-prepare-template]").forEach((button) => button.addEventListener("click", () => {
    state.whatsapp.mode = "TEMPLATE";
    state.whatsapp.templateId = button.dataset.prepareTemplate;
    state.whatsapp.selectedOrderId = button.dataset.orderId;
    state.whatsapp.templateValues = {};
    prefillUtilityValues(true);
    renderWhatsappPage();
  }));
}

function bindConversationRows() {
  document.querySelectorAll("[data-conversation-id]").forEach((button) => button.addEventListener("click", () => {
    location.hash = `#whatsapp/${button.dataset.conversationId}`;
  }));
}

async function sendWhatsappMessage(event) {
  event.preventDefault();
  const wa = state.whatsapp;
  const button = event.submitter;
  button.disabled = true;
  try {
    let body;
    if (wa.mode === "TEXT" && whatsappWindow().open) {
      const text = document.querySelector("#wa-message-input").value.trim();
      if (!text) return;
      body = { type: "TEXT", text };
    } else {
      document.querySelectorAll("[data-template-field]").forEach((input) => { wa.templateValues[input.dataset.templateField] = input.value.trim(); });
      body = { type: "TEMPLATE", utilityTemplateId: selectedUtilityTemplate()?.id, templateVariables: wa.templateValues };
    }
    await api(`/conversations/${encodeURIComponent(wa.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${wa.selectedId}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body
    });
    await loadWhatsappConversation(wa.selectedId);
    renderWhatsappPage();
    notify(body.type === "TEMPLATE" ? "Utility update queued for WhatsApp." : "Message queued for WhatsApp.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function updateOrderStatus(event) {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    await api(`/orders/${encodeURIComponent(select.dataset.orderStatus)}/change-status`, { method: "POST", body: { status: select.value } });
    const { data } = await api(`/contacts/${encodeURIComponent(selectedConversation().contactId)}/overview`);
    state.whatsapp.overview = data;
    notify("Order status updated. Customer message was not sent automatically.");
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  } catch (error) {
    notify(error.message, true);
    select.disabled = false;
  }
}

async function toggleConversationStatus() {
  const conversation = selectedConversation();
  const action = conversation.status === "CLOSED" ? "reopen" : "close";
  try {
    const { data } = await api(`/conversations/${encodeURIComponent(conversationId(conversation))}/${action}`, { method: "POST", body: {} });
    Object.assign(conversation, data);
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  } catch (error) { notify(error.message, true); }
}

async function markSelectedConversationRead() {
  const wa = state.whatsapp;
  const unread = [...wa.messages].reverse().find((item) => item.direction === "INBOUND" && item.status !== "READ");
  if (!unread) return;
  try {
    await api(`/messages/${encodeURIComponent(unread.messageId)}/mark-read`, { method: "POST", body: {} });
    wa.messages.filter((item) => item.direction === "INBOUND").forEach((item) => { item.status = "READ"; });
    const conversation = selectedConversation();
    if (conversation) conversation.unreadCount = 0;
    const list = document.querySelector("#wa-conversation-list");
    if (list) { list.innerHTML = waConversationList(); bindConversationRows(); }
  } catch { /* The message remains unread and can be retried on the next open. */ }
}

function startWhatsappPolling() {
  stopWhatsappPolling();
  state.whatsapp.timer = setTimeout(pollWhatsapp, 20_000);
}

function stopWhatsappPolling() {
  if (state.whatsapp?.timer) clearTimeout(state.whatsapp.timer);
  if (state.whatsapp) state.whatsapp.timer = null;
}

async function pollWhatsapp() {
  const wa = state.whatsapp;
  if (!location.hash.startsWith("#whatsapp")) return;
  if (document.hidden) return startWhatsappPolling();
  const draft = document.querySelector("#wa-message-input")?.value || "";
  try {
    const from = new Date(Math.max(0, Number(wa.syncedAt || Date.now()) - 1500)).toISOString();
    const { data } = await api(`/conversations?limit=100&from=${encodeURIComponent(from)}&sortBy=updatedAt&sortOrder=asc`);
    const whatsappUpdates = data.filter((item) => item.currentChannel === "WHATSAPP");
    const selectedChanged = whatsappUpdates.some((item) => conversationId(item) === wa.selectedId);
    wa.conversations = mergeById(wa.conversations, whatsappUpdates, "conversationId").sort((a, b) => (asDate(b.lastMessageAt)?.getTime() || 0) - (asDate(a.lastMessageAt)?.getTime() || 0));
    wa.syncedAt = Date.now();
    if (selectedChanged) await loadWhatsappConversation(wa.selectedId, { incremental: true });
    if (whatsappUpdates.length || selectedChanged) renderWhatsappPage(draft);
  } catch (error) {
    console.warn("WhatsApp inbox refresh failed", error);
  } finally {
    startWhatsappPolling();
  }
}

function prefillUtilityValues(force) {
  const wa = state.whatsapp;
  if (!wa.templateId) wa.templateId = wa.templates[0]?.id || null;
  const template = selectedUtilityTemplate();
  if (!template) return;
  const contact = wa.overview?.contact || selectedConversation()?.contact || {};
  const order = wa.overview?.orders?.find((item) => item.orderId === wa.selectedOrderId) || wa.overview?.orders?.[0];
  const defaults = {
    customer_name: contact.contactPerson || contact.companyName || "Customer",
    order_reference: order ? orderReference(order) : "",
    order_value: order ? money(order.totalAmount) : "",
    amount_due: order ? money(Math.max(0, Number(order.totalAmount || 0) - Number(order.paidAmount || 0))) : "",
    courier_name: "",
    tracking_reference: order?.deliveryNote || ""
  };
  for (const field of template.variables) {
    if (force || !wa.templateValues[field.key]) wa.templateValues[field.key] = defaults[field.key] || "";
  }
}

function whatsappWindow() {
  const wa = state.whatsapp;
  const inbound = [...wa.messages].reverse().find((item) => item.direction === "INBOUND");
  const fallback = selectedConversation()?.customerServiceWindow?.expiresAt;
  const inboundAt = asDate(inbound?.createdAt);
  const expiresAt = inboundAt ? new Date(inboundAt.getTime() + 24 * 60 * 60 * 1000) : asDate(fallback);
  const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
  return { open: remainingMs > 0, expiresAt, remaining: remainingMs > 0 ? compactDuration(remainingMs) : "Closed" };
}

function selectedConversation() { return state.whatsapp.conversations.find((item) => conversationId(item) === state.whatsapp.selectedId) || null; }
function selectedUtilityTemplate() { return state.whatsapp.templates.find((item) => item.id === state.whatsapp.templateId) || state.whatsapp.templates[0] || null; }
function conversationId(item) { return item?.conversationId || item?.id || null; }
function waFilterButton(value, label) { return `<button data-wa-filter="${value}" class="${state.whatsapp.filter === value ? "active" : ""}">${label}</button>`; }
function orderReference(order) { return order.orderNumber || `ORD-${String(order.orderId || "").slice(-8).toUpperCase()}`; }
function suggestedTemplate(status) { return ({ CONFIRMED: "order_confirmation", DESIGN_READY: "design_ready", DISPATCHED: "dispatch_update", DELIVERED: "order_delivered" })[status] || null; }
function orderStatusOptions(current) { return current && !ORDER_STATUSES.includes(current) ? [current, ...ORDER_STATUSES] : ORDER_STATUSES; }
function renderUtilityPreview(template, values) { return template ? template.variables.reduce((text, field, index) => text.replaceAll(`{{${index + 1}}}`, values[field.key] || `{{${index + 1}}}`), template.body) : ""; }
function messageStatus(status) { return ({ QUEUED: "○", SENT: "✓", DELIVERED: "✓✓", READ: "✓✓ Read", FAILED: "Failed" })[status] || pretty(status); }
function shortTime(value) { const parsed = asDate(value); return parsed ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(parsed) : ""; }
function asDate(value) { if (!value) return null; if (value._seconds) return new Date(value._seconds * 1000); const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function compactDuration(ms) { const hours = Math.floor(ms / 3_600_000); const minutes = Math.max(0, Math.floor((ms % 3_600_000) / 60_000)); return `${hours}h ${minutes}m left`; }
function mergeById(current, incoming, field) { const map = new Map(current.map((item) => [item[field] || item.id, item])); incoming.forEach((item) => map.set(item[field] || item.id, { ...(map.get(item[field] || item.id) || {}), ...item })); return [...map.values()]; }
function freshWhatsappState() { return { conversations: [], messages: [], templates: [], selectedId: null, overview: null, filter: "ALL", search: "", mode: "TEXT", templateId: null, templateValues: {}, selectedOrderId: null, syncedAt: null, timer: null }; }
function freshMarketingState() { return { contacts: [], audiences: [], campaigns: [], templates: [] }; }

const ORDER_STATUSES = ["CONFIRMED", "IN_DESIGN", "DESIGN_READY", "IN_PRODUCTION", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED"];

async function renderMarketing() {
  pageTitle.textContent = "Marketing";
  const [contactsResponse, audiencesResponse, campaignsResponse, templatesResponse] = await Promise.all([
    marketingApi("/contacts?limit=100", "Customers"),
    marketingApi("/marketing/audiences?limit=100", "Interested lists"),
    marketingApi("/marketing/campaigns?limit=100", "Campaigns"),
    marketingApi("/marketing/templates", "Marketing templates")
  ]);
  state.marketing = {
    contacts: contactsResponse.data || [],
    audiences: audiencesResponse.data || [],
    campaigns: campaignsResponse.data || [],
    templates: templatesResponse.data || []
  };
  const stats = aggregateCampaignStats(state.marketing.campaigns);
  const template = state.marketing.templates[0];
  page.innerHTML = `
    <div class="section-head marketing-head"><div><p class="eyebrow">CONSENT-FIRST WHATSAPP</p><h1>Interested customer campaigns</h1><p>Build a list, schedule follow-ups and move replies into your WhatsApp Inbox until an order is created.</p></div><a class="button button-secondary" href="#whatsapp">Open Inbox</a></div>
    <div class="marketing-metrics">
      ${miniStat("Campaigns", state.marketing.campaigns.length)}
      ${miniStat("Messages queued", stats.sent)}
      ${miniStat("Customer replies", stats.replied)}
      ${miniStat("Orders connected", stats.converted)}
    </div>
    <div class="compliance-banner"><span class="compliance-icon">✓</span><div><strong>Marketing safety is enforced by the backend</strong><p>Only customers with a recorded WhatsApp opt-in are enrolled. A reply pauses the drip, STOP opts the customer out, and a new order marks the campaign converted.</p></div></div>
    <div class="marketing-grid">
      <section class="panel marketing-audience-panel">
        <div class="panel-title-row"><div><p class="eyebrow">STEP 1</p><h3>Interested customer list</h3><p>Select customers for one reusable audience. Opt-in must be recorded separately and truthfully.</p></div><span class="count-pill">${state.marketing.contacts.length} clients</span></div>
        <form id="audience-form" class="audience-form">
          <div class="form-grid compact-grid"><label class="field">List name<input name="name" required placeholder="e.g. Catalogue interested – July" /></label><label class="field">Description<input name="description" placeholder="Where this interest came from" /></label></div>
          <div class="consent-toolbar"><input id="marketing-contact-search" class="search-input" placeholder="Search customer, phone or city…" /><label>Opt-in source<select id="marketing-consent-source"><option value="WHATSAPP_REPLY">WhatsApp reply</option><option value="WEBSITE_FORM">Website form</option><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option><option value="ORDER_FORM">Order form</option><option value="OTHER">Other</option></select></label></div>
          <div class="marketing-contact-list"><table><thead><tr><th><input id="select-all-marketing" type="checkbox" aria-label="Select all visible customers" /></th><th>Customer</th><th>WhatsApp consent</th><th>Action</th></tr></thead><tbody>
            ${state.marketing.contacts.length ? state.marketing.contacts.map(marketingCustomerRow).join("") : '<tr><td colspan="4"><div class="empty-state">No customers found.</div></td></tr>'}
          </tbody></table></div>
          <div class="form-actions audience-actions"><span id="audience-selection-count" class="muted">0 selected</span><button class="button button-primary" type="submit">Save interested list</button></div>
        </form>
        <div class="saved-audiences"><h4>Saved lists</h4>${state.marketing.audiences.length ? state.marketing.audiences.map((audience) => `<div class="saved-audience"><div><strong>${esc(audience.name)}</strong><small>${esc(audience.description || "Interested customer list")}</small></div><span>${esc(audience.contactCount || 0)} customers</span></div>`).join("") : '<p class="muted">No list created yet.</p>'}</div>
      </section>
      <section class="panel campaign-builder-panel">
        <div class="panel-title-row"><div><p class="eyebrow">STEP 2</p><h3>Create drip campaign</h3><p>Each delay is measured after the previous message.</p></div><span class="badge blue">Marketing template</span></div>
        ${template ? `<div class="template-preview"><small>Meta template to approve: <strong>${esc(template.name)}</strong></small><p>${esc(template.body)}</p></div>` : '<div class="form-error">Marketing template configuration is unavailable.</div>'}
        <form id="campaign-form" class="campaign-form">
          <label class="field">Campaign name<input name="name" required placeholder="e.g. July catalogue follow-up" /></label>
          <label class="field">Interested list<select name="audienceId" required ${state.marketing.audiences.length ? "" : "disabled"}><option value="">Select a list</option>${state.marketing.audiences.map((audience) => `<option value="${attr(audience.audienceId)}">${esc(audience.name)} (${esc(audience.contactCount || 0)})</option>`).join("")}</select></label>
          <label class="field">What they are interested in<input name="interestLabel" required placeholder="e.g. premium catalogue printing" /></label>
          <label class="field">Start date & time<input name="startAt" type="datetime-local" value="${attr(datetimeLocalValue(new Date(Date.now() + 5 * 60 * 1000)))}" /></label>
          <div class="drip-steps">
            ${dripStep(1, 0, "Share the latest options and pricing with our team.", true, true)}
            ${dripStep(2, 3, "Would you like us to prepare a quotation for you?", true)}
            ${dripStep(3, 7, "Reply here whenever you are ready and our team will help place the order.", true)}
          </div>
          <label class="campaign-confirm"><input name="confirmConsent" type="checkbox" required /> I confirm that the selected customers have permission to receive this type of WhatsApp marketing message.</label>
          <button class="button button-primary button-full" type="submit" ${state.marketing.audiences.length && template ? "" : "disabled"}>Create & schedule campaign</button>
          <p class="muted tiny-note">The worker checks due campaigns every 5 minutes to keep Firebase usage low. Actual delivery timing is controlled by Meta.</p>
        </form>
      </section>
    </div>
    <section class="panel campaign-list-panel"><div class="panel-title-row"><div><p class="eyebrow">CAMPAIGN CONTROL</p><h3>Campaigns</h3><p>Pause any active campaign instantly. Replies and orders remain connected to the original campaign.</p></div></div>
      <div class="campaign-list">${state.marketing.campaigns.length ? state.marketing.campaigns.map(campaignCard).join("") : '<div class="empty-state">No campaigns yet. Create your first campaign above.</div>'}</div>
    </section>`;
  bindMarketingEvents();
}

async function marketingApi(path, label) {
  try {
    return await api(path);
  } catch (error) {
    throw new Error(`${label} could not load: ${error.message}`);
  }
}

function marketingCustomerRow(contact) {
  const consent = contact.marketingConsent?.status || "NOT_RECORDED";
  const name = contact.companyName || contact.contactPerson || "Unnamed customer";
  const optedIn = consent === "OPTED_IN";
  return `<tr data-marketing-contact-row data-search="${attr(`${name} ${contact.contactPerson || ""} ${contact.primaryPhone || ""} ${contact.city || ""}`.toLowerCase())}"><td><input data-audience-contact type="checkbox" value="${attr(contact.contactId)}" /></td><td><div class="party-cell"><span class="party-avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(contact.primaryPhone || "No phone")} · ${esc(contact.city || "")}</small></div></div></td><td><span class="consent-badge ${optedIn ? "opted-in" : consent === "OPTED_OUT" ? "opted-out" : "unknown"}">${optedIn ? "Opted in" : consent === "OPTED_OUT" ? "Opted out" : "Not recorded"}</span></td><td><button class="text-button consent-action" type="button" data-consent-contact="${attr(contact.contactId)}" data-consent-status="${optedIn ? "OPTED_OUT" : "OPTED_IN"}">${optedIn ? "Opt out" : "Record opt-in"}</button></td></tr>`;
}

function dripStep(position, delayDays, messageLine, enabled, locked = false) {
  return `<div class="drip-step"><div class="step-number">${position}</div><div class="step-fields">${locked ? '<input type="hidden" name="step1Enabled" value="on" />' : `<label class="step-toggle"><input type="checkbox" name="step${position}Enabled" ${enabled ? "checked" : ""} /> Use step ${position}</label>`}<label>Wait days<input type="number" name="step${position}Delay" min="0" max="90" value="${delayDays}" ${locked ? "readonly" : ""} /></label><label class="step-message">Campaign line<input name="step${position}Message" maxlength="500" value="${attr(messageLine)}" required /></label></div></div>`;
}

function campaignCard(campaign) {
  const stats = { total: 0, eligible: 0, active: 0, sent: 0, replied: 0, converted: 0, suppressed: 0, ...(campaign.stats || {}) };
  const action = campaign.status === "ACTIVE" ? "pause" : campaign.status === "PAUSED" ? "resume" : campaign.status === "DRAFT" ? "launch" : null;
  return `<article class="campaign-card"><div class="campaign-main"><div><span class="status-dot status-${attr(String(campaign.status || "draft").toLowerCase())}"></span><strong>${esc(campaign.name)}</strong><small>${esc(campaign.audienceName || "Audience")} · ${esc(campaign.steps?.length || 0)} step${campaign.steps?.length === 1 ? "" : "s"} · ${esc(pretty(campaign.status))}</small></div>${action ? `<button class="button button-secondary campaign-action" data-campaign-action="${action}" data-campaign-id="${attr(campaign.campaignId)}">${action === "pause" ? "Pause" : action === "resume" ? "Resume" : "Launch now"}</button>` : ""}</div><div class="campaign-stats"><span><strong>${stats.eligible}</strong> enrolled</span><span><strong>${stats.sent}</strong> queued</span><span><strong>${stats.replied}</strong> replied</span><span><strong>${stats.converted}</strong> orders</span><span><strong>${stats.suppressed}</strong> skipped</span></div></article>`;
}

function bindMarketingEvents() {
  const updateSelectedCount = () => {
    const selected = document.querySelectorAll("[data-audience-contact]:checked").length;
    const label = document.querySelector("#audience-selection-count");
    if (label) label.textContent = `${selected} selected`;
  };
  document.querySelectorAll("[data-audience-contact]").forEach((checkbox) => checkbox.addEventListener("change", updateSelectedCount));
  document.querySelector("#select-all-marketing")?.addEventListener("change", (event) => {
    document.querySelectorAll("[data-marketing-contact-row]").forEach((row) => {
      if (row.hidden) return;
      row.querySelector("[data-audience-contact]").checked = event.target.checked;
    });
    updateSelectedCount();
  });
  document.querySelector("#marketing-contact-search")?.addEventListener("input", (event) => {
    const needle = event.target.value.trim().toLowerCase();
    document.querySelectorAll("[data-marketing-contact-row]").forEach((row) => { row.hidden = Boolean(needle && !row.dataset.search.includes(needle)); });
  });
  document.querySelectorAll(".consent-action").forEach((button) => button.addEventListener("click", () => recordMarketingConsent(button)));
  document.querySelector("#audience-form")?.addEventListener("submit", createMarketingAudience);
  document.querySelector("#campaign-form")?.addEventListener("submit", createMarketingCampaign);
  document.querySelectorAll(".campaign-action").forEach((button) => button.addEventListener("click", () => changeCampaignState(button)));
}

async function recordMarketingConsent(button) {
  const status = button.dataset.consentStatus;
  const source = document.querySelector("#marketing-consent-source")?.value || "OTHER";
  const message = status === "OPTED_IN"
    ? "Record opt-in only if this customer clearly agreed to receive WhatsApp marketing messages. Continue?"
    : "Opt this customer out and stop all of their active campaign messages?";
  if (!confirm(message)) return;
  const note = prompt("Short consent note / evidence (recommended):", status === "OPTED_IN" ? "Customer requested WhatsApp updates" : "Customer requested opt-out") || "";
  button.disabled = true;
  try {
    await api(`/marketing/contacts/${encodeURIComponent(button.dataset.consentContact)}/consent`, { method: "PATCH", body: { status, source, note } });
    notify(status === "OPTED_IN" ? "WhatsApp marketing opt-in recorded." : "Customer opted out and active drips stopped.");
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function createMarketingAudience(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const contactIds = [...form.querySelectorAll("[data-audience-contact]:checked")].map((item) => item.value);
  if (!contactIds.length) return notify("Select at least one interested customer.", true);
  const values = Object.fromEntries(new FormData(form));
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/marketing/audiences", { method: "POST", body: { name: values.name, description: values.description, contactIds } });
    notify("Interested customer list saved.");
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function createMarketingCampaign(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const steps = [1, 2, 3].filter((position) => values[`step${position}Enabled`] === "on").map((position) => ({
    delayDays: Number(values[`step${position}Delay`] || 0),
    messageLine: values[`step${position}Message`]
  }));
  if (!confirm(`Schedule this ${steps.length}-step Marketing campaign? Only recorded opt-ins will be enrolled.`)) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const { data: campaign } = await api("/marketing/campaigns", { method: "POST", body: {
      name: values.name,
      audienceId: values.audienceId,
      interestLabel: values.interestLabel,
      templateId: state.marketing.templates[0]?.id || "interest_followup",
      steps
    } });
    const startAt = values.startAt ? new Date(values.startAt).toISOString() : undefined;
    await api(`/marketing/campaigns/${encodeURIComponent(campaign.campaignId)}/launch`, { method: "POST", body: startAt ? { startAt } : {} });
    notify("Campaign scheduled. The first due message will be queued within 5 minutes.");
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function changeCampaignState(button) {
  const action = button.dataset.campaignAction;
  if (action === "launch" && !confirm("Launch this draft now? Only contacts with recorded opt-in will receive it.")) return;
  button.disabled = true;
  try {
    await api(`/marketing/campaigns/${encodeURIComponent(button.dataset.campaignId)}/${action}`, { method: "POST", body: {} });
    notify(`Campaign ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "launched"}.`);
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

function aggregateCampaignStats(campaigns) {
  return campaigns.reduce((total, campaign) => {
    for (const key of ["sent", "replied", "converted"]) total[key] += Number(campaign.stats?.[key] || 0);
    return total;
  }, { sent: 0, replied: 0, converted: 0 });
}

function datetimeLocalValue(value) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
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
    <section class="detail-hero"><div class="detail-person"><div class="detail-avatar">${esc(initials(client.companyName || client.contactPerson))}</div><div><h1>${esc(client.companyName || client.contactPerson || "Unnamed client")}</h1><p>${esc(client.primaryPhone || "No phone")} · ${esc(client.city || "City not set")}</p></div></div><div class="detail-actions"><span class="badge green">${esc(pretty(client.relationshipType || "CLIENT"))}</span><button class="button wa-open-client" id="open-client-whatsapp" ${client.primaryPhone ? "" : "disabled"}>Open WhatsApp</button></div></section>
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
  document.querySelector("#open-client-whatsapp")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Opening...";
    try {
      const { data: conversation } = await api("/conversations/start", { method: "POST", body: { contactId } });
      state.whatsapp = freshWhatsappState();
      location.hash = `#whatsapp/${conversationId(conversation)}`;
    } catch (error) {
      notify(error.message, true);
      button.disabled = false;
      button.textContent = "Open WhatsApp";
    }
  });
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
