import { createChatCache } from "./chat-cache.js";

const config = window.__CRM_CONFIG__ || {};
const authKey = "rx-crm-session-v1";
const WHATSAPP_POLL_INTERVAL_MS = 5_000;
const WHATSAPP_SYNC_OVERLAP_MS = 2_000;
const WHATSAPP_FULL_SYNC_AFTER_MS = 6 * 60 * 60 * 1000;
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
document.addEventListener("visibilitychange", resumeWhatsappPolling);

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
  discardVoiceRecording();
  closeImageViewer();
  releaseMediaObjectUrls();
  document.body.classList.remove("whatsapp-route");
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

async function uploadAttachment(file, contactId, conversationId) {
  if (!state.session) throw new Error("Authentication required");
  if (Date.now() > Number(state.session.expiresAt || 0) - 60_000) await refreshSession();
  const query = new URLSearchParams({ contactId, conversationId });
  const response = await fetch(`${config.apiBaseUrl}/attachments?${query}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.accessToken}`,
      "content-type": file.type || "application/octet-stream",
      "x-filename": encodeURIComponent(file.name || "attachment.bin")
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) logout();
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Upload failed (${response.status})`);
  return payload.data;
}

async function fetchAttachmentBlob(attachmentId, { download = false } = {}) {
  if (!state.session) throw new Error("Authentication required");
  if (Date.now() > Number(state.session.expiresAt || 0) - 60_000) await refreshSession();
  const suffix = download ? "?download=true" : "";
  const response = await fetch(`${config.apiBaseUrl}/attachments/${encodeURIComponent(attachmentId)}/content${suffix}`, {
    headers: { authorization: `Bearer ${state.session.accessToken}` }
  });
  if (response.status === 401) logout();
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error?.message || payload.message || `File could not be opened (${response.status})`);
  }
  return response.blob();
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
  document.body.classList.toggle("whatsapp-route", base === "whatsapp");
  if (base !== "whatsapp") {
    discardVoiceRecording();
    closeImageViewer();
  }
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
  wa.cache ||= createChatCache(state.session?.email);
  await hydrateWhatsappCache(requestedConversationId);
  if (wa.conversations.length) renderWhatsappPage();

  const syncStartedAt = Date.now();
  const checkpointIsFresh = wa.syncedAt && syncStartedAt - Number(wa.syncedAt) < WHATSAPP_FULL_SYNC_AFTER_MS;
  const conversationQuery = checkpointIsFresh
    ? `/conversations?limit=100&from=${encodeURIComponent(new Date(Math.max(0, Number(wa.syncedAt) - WHATSAPP_SYNC_OVERLAP_MS)).toISOString())}&sortBy=updatedAt&sortOrder=asc`
    : "/conversations?limit=100&sortBy=lastMessageAt&sortOrder=desc";
  let networkResults;
  try {
    networkResults = await Promise.all([
      api(conversationQuery),
      wa.templates.length ? Promise.resolve({ data: wa.templates }) : api("/whatsapp/utility-templates"),
      wa.quickReplies.length ? Promise.resolve({ data: wa.quickReplies }) : optionalInboxApi("/whatsapp/quick-replies?limit=100", []),
      wa.users.length ? Promise.resolve({ data: wa.users }) : optionalInboxApi("/users?limit=100", []),
      wa.capabilities ? Promise.resolve({ data: wa.capabilities }) : optionalInboxApi("/whatsapp/capabilities", null)
    ]);
  } catch (error) {
    if (!wa.conversations.length) throw error;
    wa.syncState = "offline";
    console.warn("Showing locally cached WhatsApp inbox while sync is unavailable", error);
    updateWhatsappSyncBadge();
    startWhatsappPolling();
    return;
  }
  const [conversationResult, templateResult, quickReplyResult, usersResult, capabilitiesResult] = networkResults;
  const conversationUpdates = conversationResult.data.filter((item) => item.currentChannel === "WHATSAPP");
  wa.conversations = sortWhatsappConversations(
    checkpointIsFresh ? mergeById(wa.conversations, conversationUpdates, "conversationId") : conversationUpdates
  );
  wa.templates = templateResult.data;
  wa.quickReplies = quickReplyResult.data || [];
  wa.users = (usersResult.data || []).filter((item) => item.active !== false);
  wa.capabilities = capabilitiesResult.data || null;
  wa.syncState = "live";
  wa.selectedId = requestedConversationId || wa.selectedId || conversationId(wa.conversations[0]);
  if (wa.selectedId && !wa.conversations.some((item) => conversationId(item) === wa.selectedId)) {
    wa.selectedId = conversationId(wa.conversations[0]);
  }
  if (wa.selectedId) {
    const useIncrementalMessages = wa.messagesConversationId === wa.selectedId && wa.messages.length > 0;
    const incoming = await loadWhatsappConversation(wa.selectedId, { incremental: useIncrementalMessages });
    await refreshChangedMessageMarkers(conversationUpdates, new Set(incoming.map((item) => item.messageId || item.id)));
  }
  wa.syncedAt = serverSyncTime(conversationResult, syncStartedAt);
  await Promise.all([
    chatCacheCall(wa.cache, "putConversations", wa.conversations),
    chatCacheCall(wa.cache, "setMeta", "conversationSyncAt", wa.syncedAt)
  ]);
  renderWhatsappPage();
  startWhatsappPolling();
}

async function hydrateWhatsappCache(requestedConversationId) {
  const wa = state.whatsapp;
  if (!wa.cacheHydrated) {
    const [cachedConversations, cachedSyncAt] = await Promise.all([
      chatCacheCall(wa.cache, "getConversations"),
      chatCacheCall(wa.cache, "getMeta", "conversationSyncAt")
    ]);
    if (cachedConversations?.length) {
      wa.conversations = sortWhatsappConversations(mergeById(wa.conversations, cachedConversations, "conversationId"));
      wa.syncState = "cached";
    }
    if (cachedSyncAt) wa.syncedAt = Number(cachedSyncAt) || asDate(cachedSyncAt)?.getTime() || null;
    wa.cacheHydrated = true;
  }
  const selectedId = requestedConversationId || wa.selectedId || conversationId(wa.conversations[0]);
  if (!selectedId || !wa.conversations.some((item) => conversationId(item) === selectedId)) return;
  wa.selectedId = selectedId;
  if (wa.messagesConversationId !== selectedId) await loadCachedWhatsappConversation(selectedId);
}

async function loadCachedWhatsappConversation(id) {
  const wa = state.whatsapp;
  const selected = wa.conversations.find((item) => conversationId(item) === id);
  if (!selected) return;
  const [messages, cachedOverview] = await Promise.all([
    chatCacheCall(wa.cache, "getMessages", id),
    chatCacheCall(wa.cache, "getOverview", selected.contactId)
  ]);
  wa.messages = messages || [];
  wa.messagesConversationId = id;
  wa.overview = cachedOverview?.value || null;
  wa.overviewCachedAt = asDate(cachedOverview?.cachedAt)?.getTime() || 0;
  wa.selectedId = id;
  selectDefaultWhatsappOrder();
}

async function optionalInboxApi(path, fallback) {
  try {
    return await api(path);
  } catch (error) {
    console.warn(`Optional inbox feature unavailable: ${path}`, error);
    return { data: fallback, error: error.message };
  }
}

async function loadWhatsappConversation(id, { incremental = false } = {}) {
  const wa = state.whatsapp;
  const selected = wa.conversations.find((item) => conversationId(item) === id);
  if (!selected) return [];
  const sameConversation = wa.messagesConversationId === id;
  if (!sameConversation) {
    wa.messages = [];
    wa.overview = null;
    wa.overviewCachedAt = 0;
  }
  const hasBaseline = incremental && sameConversation && wa.messages.length > 0;
  const query = new URLSearchParams({ limit: "100", sortOrder: hasBaseline ? "asc" : "desc" });
  if (hasBaseline) {
    const latest = Math.max(...wa.messages.map((item) => asDate(item.createdAt)?.getTime() || 0));
    if (latest) query.set("from", new Date(Math.max(0, latest - WHATSAPP_SYNC_OVERLAP_MS)).toISOString());
  }
  const requests = [api(`/conversations/${encodeURIComponent(id)}/messages?${query}`)];
  const overviewIsStale = !wa.overviewCachedAt || Date.now() - wa.overviewCachedAt > 5 * 60 * 1000;
  if (!wa.overview || wa.overview.contact?.contactId !== selected.contactId || overviewIsStale) {
    requests.push(api(`/contacts/${encodeURIComponent(selected.contactId)}/overview`));
  }
  const [messageResult, overviewResult] = await Promise.all(requests);
  const incoming = hasBaseline ? messageResult.data : [...messageResult.data].reverse();
  wa.messages = (hasBaseline ? mergeById(wa.messages, incoming, "messageId") : incoming)
    .sort((left, right) => (asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0));
  wa.messagesConversationId = id;
  if (overviewResult) {
    wa.overview = overviewResult.data;
    wa.overviewCachedAt = Date.now();
  }
  wa.selectedId = id;
  selectDefaultWhatsappOrder();
  if (!whatsappWindow().open && wa.mode === "TEXT") wa.mode = "TEMPLATE";
  prefillUtilityValues(false);
  await Promise.all([
    chatCacheCall(wa.cache, "putMessages", incoming),
    overviewResult ? chatCacheCall(wa.cache, "putOverview", selected.contactId, wa.overview) : Promise.resolve()
  ]);
  return incoming;
}

function selectDefaultWhatsappOrder() {
  const wa = state.whatsapp;
  if (!wa.selectedOrderId || !wa.overview?.orders?.some((order) => order.orderId === wa.selectedOrderId)) {
    wa.selectedOrderId = wa.overview?.orders?.[0]?.orderId || null;
  }
}

function renderWhatsappPage(draftText = "") {
  const wa = state.whatsapp;
  const selected = selectedConversation();
  const syncIndicator = whatsappSyncIndicator();
  releaseMediaObjectUrls();
  page.innerHTML = `
    <div class="wa-page-head">
      <div><h1>WhatsApp Inbox</h1><p>Real-time client chat, media, team ownership and orders in one place.</p></div>
      <div class="wa-page-actions">
        <span id="wa-sync-state" class="wa-api-state ${syncIndicator.connected ? "connected" : "disconnected"}">${esc(syncIndicator.label)}</span>
        <button class="button button-secondary" id="wa-enable-alerts" type="button">Enable alerts</button>
        <a class="button button-primary" href="#clients">+ Start client chat</a>
      </div>
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
  const important = (contact.tags || []).includes("IMPORTANT");
  return `
    <section class="wa-chat-panel">
      <header class="wa-chat-head">
        <a class="wa-mobile-back" href="#whatsapp" aria-label="Back to conversations">‹</a><div class="wa-chat-person"><span class="wa-avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(contact.primaryPhone || "No phone")} · ${esc(contact.city || "")}</small></div></div>
        <div class="wa-chat-actions">
          <span class="wa-window ${windowStatus.open ? "open" : "closed"}">${windowStatus.open ? `Free reply · ${esc(windowStatus.remaining)}` : "Utility template required"}</span>
          ${contact.primaryPhone ? `<a class="wa-icon-button" href="tel:+${attr(contact.primaryPhone)}" title="Call customer">☎</a>` : ""}
          <button class="wa-icon-button wa-details-button" id="wa-toggle-client-panel" title="Client workspace">ⓘ</button>
          <button class="wa-icon-button ${important ? "important" : ""}" id="wa-toggle-important" title="${important ? "Remove Important" : "Mark Important"}">${important ? "★" : "☆"}</button>
          <button class="wa-icon-button" id="wa-toggle-status" title="${conversation.status === "CLOSED" ? "Reopen" : "Close"} conversation">${conversation.status === "CLOSED" ? "↻" : "✓"}</button>
        </div>
      </header>
      <div class="wa-message-list" id="wa-message-list">
        <div class="wa-day-chip">Conversation history</div>
        ${wa.messages.length ? wa.messages.map(waMessage).join("") : '<div class="wa-chat-empty">No messages yet. Use a Utility template to start this conversation.</div>'}
      </div>
      ${waComposer(windowStatus, draftText)}
    </section>
    <aside class="wa-order-panel ${wa.clientPanelOpen ? "open" : ""}">${waOrderPanel(contact)}</aside>`;
}

function waComposer(windowStatus, draftText) {
  const wa = state.whatsapp;
  const template = selectedUtilityTemplate();
  const useText = wa.mode === "TEXT" && windowStatus.open;
  const quoted = wa.messages.find((item) => item.messageId === wa.replyToMessageId);
  const approvedTemplateAvailable = wa.templates.some((item) => item.approved !== false);
  return `<div class="wa-composer">
    <div class="wa-compose-tabs">
      <button class="${useText ? "active" : ""}" data-wa-mode="TEXT" ${windowStatus.open ? "" : "disabled"}>Reply</button>
      <button class="${!useText ? "active" : ""}" data-wa-mode="TEMPLATE">Utility update <span>low cost</span></button>
      <small>${windowStatus.open ? "Customer replied within 24 hours" : "Normal reply is locked outside 24 hours"}</small>
    </div>
    ${useText ? `<form id="wa-composer-form" class="wa-text-composer">
        <div class="wa-composer-toolbar">
          <select id="wa-quick-reply"><option value="">Quick reply…</option>${wa.quickReplies.map((item) => `<option value="${attr(item.quickReplyId)}">${esc(item.shortcut)} · ${esc(item.title)}</option>`).join("")}<option value="__CREATE__">+ Add custom quick reply</option></select>
          <label class="wa-tool-button" title="Attach image, video, audio or document">📎<input id="wa-attachment-input" type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf" hidden /></label>
          <button class="wa-tool-button ${wa.recording ? "recording" : ""}" id="wa-record-audio" type="button" title="Record voice note">${wa.recording ? "■ Stop" : "🎙 Voice"}</button>
          <button class="wa-tool-button" id="wa-share-location" type="button" title="Share current location">⌖</button>
          <button class="wa-tool-button" id="wa-share-contact" type="button" title="Share a contact card">👤</button>
          <button class="wa-tool-button" id="wa-interactive-buttons" type="button" title="Send quick-reply buttons">⚡</button>
          <button class="wa-tool-button" id="wa-add-internal-note" type="button" title="Add an internal note">📝</button>
        </div>
        ${quoted ? `<div class="wa-replying"><div><small>Replying to ${quoted.direction === "INBOUND" ? "customer" : "team"}</small><p>${esc(quoted.text || `[${pretty(quoted.type)}]`)}</p></div><button id="wa-cancel-reply" type="button">×</button></div>` : ""}
        <div class="wa-input-row"><textarea id="wa-message-input" rows="1" maxlength="4096" placeholder="Type a message or / shortcut…">${esc(draftText)}</textarea><button class="wa-send-button" type="submit">Send</button></div>
      </form>` : `
      <form id="wa-composer-form" class="wa-template-composer">
        <div class="wa-template-row"><label>Approved Utility template<select id="wa-template-select" ${approvedTemplateAvailable ? "" : "disabled"}>${wa.templates.map((item) => `<option value="${attr(item.id)}" ${item.id === template?.id ? "selected" : ""} ${item.approved === false ? "disabled" : ""}>${esc(item.label)} · ${esc(pretty(item.approvalStatus || "Approved"))}</option>`).join("")}</select></label>
          <label>Related order<select id="wa-template-order"><option value="">Select order</option>${(wa.overview?.orders || []).map((order) => `<option value="${attr(order.orderId)}" ${order.orderId === wa.selectedOrderId ? "selected" : ""}>${esc(orderReference(order))} · ${esc(pretty(order.status))}</option>`).join("")}</select></label></div>
        ${approvedTemplateAvailable
          ? `<div class="wa-template-fields">${(template?.variables || []).map((field) => `<label>${esc(field.label)}<input data-template-field="${attr(field.key)}" value="${attr(wa.templateValues[field.key] || "")}" required /></label>`).join("")}</div>
            <div class="wa-template-preview"><span>UTILITY PREVIEW</span><p>${esc(renderUtilityPreview(template, wa.templateValues))}</p></div>`
          : '<div class="wa-template-warning">No approved Utility template is synced. Sync Meta templates, then try again.</div>'}
        <div class="wa-template-actions"><button class="wa-sync-templates" id="wa-sync-templates" type="button">Sync Meta templates</button><button class="wa-send-template" type="submit" ${approvedTemplateAvailable ? "" : "disabled"}>Send Utility update</button></div>
      </form>`}
  </div>`;
}

function waOrderPanel(contact) {
  const wa = state.whatsapp;
  const orders = wa.overview?.orders || [];
  const assignedTo = selectedConversation()?.assignedTo || contact.assignedTo || "";
  const canAssign = ["OWNER", "ADMIN"].includes(state.session?.role);
  const tags = contact.tags || [];
  const callReady = wa.capabilities?.externalSetup?.calling?.status || "META_ELIGIBILITY_REQUIRED";
  return `<div class="wa-client-card"><button class="wa-panel-close" id="wa-close-client-panel" type="button" aria-label="Close client workspace">×</button><p class="eyebrow">CLIENT WORKSPACE</p><h3>${esc(contact.companyName || contact.contactPerson || "Client")}</h3><p>${esc(contact.primaryPhone || "No phone")} · ${esc(contact.city || "City not set")}</p><a href="#client/${attr(contact.contactId || "")}">View complete profile →</a></div>
    <div class="wa-crm-controls">
      <label>Conversation owner<select id="wa-assignee" ${canAssign && wa.users.length ? "" : "disabled"}><option value="">Unassigned</option>${wa.users.map((user) => `<option value="${attr(user.userId)}" ${assignedTo === user.userId ? "selected" : ""}>${esc(user.name || user.email || user.userId)}</option>`).join("")}</select></label>
      <div class="wa-tag-head"><strong>Tags</strong><button id="wa-add-tag" type="button">+ Add</button></div>
      <div class="wa-tag-list">${tags.length ? tags.map((tag) => `<span>${esc(pretty(tag))}<button data-remove-tag="${attr(tag)}" type="button">×</button></span>`).join("") : "<small>No tags yet</small>"}</div>
      <label>Private customer notes<textarea id="wa-customer-notes" maxlength="5000" placeholder="Visible only inside CRM">${esc(contact.notes || "")}</textarea></label>
      <button class="wa-side-action" id="wa-save-notes" type="button">Save notes</button>
      <div class="wa-followup-box"><strong>Schedule follow-up</strong><input id="wa-followup-at" type="datetime-local" /><input id="wa-followup-note" maxlength="500" placeholder="Follow-up note" /><button class="wa-side-action" id="wa-create-followup" type="button">Add follow-up</button></div>
      <details class="wa-capabilities"><summary>Platform readiness</summary><p><b>Messaging:</b> ${wa.capabilities?.connected ? "Connected" : "Needs setup"}</p><p><b>Business App coexistence:</b> Meta onboarding required</p><p><b>WhatsApp calling:</b> ${esc(pretty(callReady))}</p><p><b>Flows:</b> API-ready; each Flow must be created and published in Meta.</p></details>
    </div>
    <div class="wa-order-head"><strong>Orders</strong><span>${orders.length}</span></div>
    <div class="wa-order-list">${orders.length ? orders.map(waOrderCard).join("") : '<div class="wa-no-orders">No linked orders found.</div>'}</div>
    <div class="wa-cost-note"><strong>Account safety</strong><p>Free-form replies run only in the active service window. Outside it, this CRM requires a correctly classified approved template.</p></div>`;
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
  const status = outbound ? messageStatusMarkup(message.status) : "";
  const quoted = message.replyTo || (message.replyToMessageId
    ? state.whatsapp.messages.find((item) => item.messageId === message.replyToMessageId)
    : null);
  const attachments = message.attachments || [];
  const recoverableMedia = ["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(message.type);
  const mediaBody = attachments.length
    ? attachments.map(waAttachment).join("")
    : recoverableMedia ? waMissingMedia(message) : "";
  const body = message.type === "REACTION"
    ? `<div class="wa-reaction-message">${esc(message.text || "♡")}</div>`
    : `${waStructuredMessage(message)}${mediaBody}${message.text ? `<p>${linkify(message.text)}</p>` : (!attachments.length && !recoverableMedia && !waHasStructuredBody(message) ? `<p>[${esc(pretty(message.type))}]</p>` : "")}`;
  return `<div class="wa-message-row ${outbound ? "outbound" : internal ? "internal" : "inbound"}" data-message-row="${attr(message.messageId)}">
    <div class="wa-bubble">
      ${quoted ? `<div class="wa-quoted"><small>${quoted.direction === "INBOUND" ? "Customer" : "RX team"}</small><p>${esc(quoted.text || `[${pretty(quoted.type)}]`)}</p></div>` : ""}
      ${body}
      <span class="wa-message-meta"><time>${esc(shortTime(message.createdAt))}</time>${status}</span>
      ${message.type === "TEMPLATE" ? `<em>${esc(pretty(message.metadata?.templateCategory || "TEMPLATE"))}</em>` : ""}
      ${message.status === "FAILED" ? `<div class="wa-message-error"><strong>Send failed</strong><span>${esc(message.errorMessage || message.errorCode || "WhatsApp rejected this message.")}</span><button data-retry-message="${attr(message.messageId)}" type="button">Retry</button></div>` : ""}
      ${!internal && message.type !== "REACTION" ? `<div class="wa-message-actions"><button data-reply-message="${attr(message.messageId)}" type="button" title="Reply">↩</button><button data-react-message="${attr(message.messageId)}" data-react-emoji="👍" type="button" title="React">👍</button></div>` : ""}
    </div>
  </div>`;
}

function waAttachment(attachment) {
  const url = attachment.signedUrl || "";
  const mime = attachment.mimeType || "";
  const name = attachment.originalFilename || "Attachment";
  const id = attachment.attachmentId || attachment.id || "";
  if (!url) return `<div class="wa-attachment-missing">Attachment unavailable</div>`;
  if (mime.startsWith("image/")) {
    const actions = `<div class="wa-file-actions"><button data-media-preview="${attr(id)}" data-media-name="${attr(name)}" type="button">View</button><button data-media-download="${attr(id)}" data-media-name="${attr(name)}" type="button">Download</button></div>`;
    return `<div class="wa-attachment-block"><button class="wa-media wa-image-preview" data-media-preview="${attr(id)}" data-media-name="${attr(name)}" type="button" aria-label="View ${attr(name)}"><img data-protected-media="${attr(id)}" src="${attr(url)}" alt="${attr(name)}" loading="lazy" /></button>${actions}</div>`;
  }
  const actions = `<div class="wa-file-actions"><button data-media-open="${attr(id)}" data-media-name="${attr(name)}" type="button">Open in new tab</button><button data-media-download="${attr(id)}" data-media-name="${attr(name)}" type="button">Download</button></div>`;
  if (mime.startsWith("video/")) {
    return `<div class="wa-attachment-block"><video class="wa-media" data-protected-media="${attr(id)}" src="${attr(url)}" controls preload="metadata"></video>${actions}</div>`;
  }
  if (mime.startsWith("audio/")) {
    return `<div class="wa-attachment-block"><audio class="wa-audio" data-protected-media="${attr(id)}" src="${attr(url)}" controls preload="metadata"></audio>${actions}</div>`;
  }
  return `<div class="wa-attachment-block"><div class="wa-document"><span>📄</span><div><strong>${esc(name)}</strong><small>${esc(pretty(mime || "document"))}${attachment.sizeBytes ? ` · ${esc(fileSize(attachment.sizeBytes))}` : ""}</small></div></div>${actions}</div>`;
}

function waMissingMedia(message) {
  const status = message.metadata?.mediaArchiveStatus || "FAILED";
  const label = status === "DOWNLOADING" || status === "PENDING"
    ? "Media is being prepared"
    : status === "RETRY" ? "Media download will retry" : `${pretty(message.type)} is not available yet`;
  return `<div class="wa-media-recovery"><span>📎</span><div><strong>${esc(label)}</strong><small>${esc(message.metadata?.mediaArchiveError || "Use Retry media to recover the original WhatsApp file.")}</small></div><button data-retry-media="${attr(message.messageId)}" type="button">Retry media</button></div>`;
}

function waStructuredMessage(message) {
  const location = message.metadata?.location;
  if (message.type === "LOCATION" && location?.latitude !== undefined && location?.longitude !== undefined) {
    const map = `https://www.google.com/maps?q=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`;
    return `<a class="wa-location" href="${attr(map)}" target="_blank" rel="noreferrer"><span>📍</span><div><strong>${esc(location.name || "Shared location")}</strong><small>${esc(location.address || `${location.latitude}, ${location.longitude}`)}</small></div></a>`;
  }
  const contacts = message.metadata?.contacts;
  if (message.type === "CONTACT" && Array.isArray(contacts) && contacts.length) {
    return contacts.map((contact) => `<div class="wa-contact-card"><span>👤</span><div><strong>${esc(contact.name?.formatted_name || "Contact")}</strong><small>${esc(contact.phones?.[0]?.phone || "")}</small></div></div>`).join("");
  }
  if (message.type === "INTERACTIVE") {
    const interactive = message.metadata?.interactive || message.metadata?.button;
    if (interactive) return `<div class="wa-interactive-reply">↪ ${esc(message.text || "Interactive response")}</div>`;
  }
  return "";
}

function waHasStructuredBody(message) {
  return Boolean(
    (message.type === "LOCATION" && message.metadata?.location)
    || (message.type === "CONTACT" && message.metadata?.contacts)
    || (message.type === "INTERACTIVE" && (message.metadata?.interactive || message.metadata?.button))
  );
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
  document.querySelector("#wa-sync-templates")?.addEventListener("click", syncUtilityTemplates);
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
  document.querySelector("#wa-toggle-client-panel")?.addEventListener("click", () => {
    state.whatsapp.clientPanelOpen = !state.whatsapp.clientPanelOpen;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  document.querySelector("#wa-close-client-panel")?.addEventListener("click", () => {
    state.whatsapp.clientPanelOpen = false;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  document.querySelector("#wa-toggle-important")?.addEventListener("click", toggleImportantContact);
  document.querySelector("#wa-enable-alerts")?.addEventListener("click", enableDesktopAlerts);
  document.querySelector("#wa-quick-reply")?.addEventListener("change", selectQuickReply);
  document.querySelector("#wa-attachment-input")?.addEventListener("change", sendSelectedAttachment);
  bindWhatsappMessageEvents();
  document.querySelector("#wa-record-audio")?.addEventListener("click", toggleVoiceRecording);
  document.querySelector("#wa-share-location")?.addEventListener("click", shareCurrentLocation);
  document.querySelector("#wa-share-contact")?.addEventListener("click", shareContactCard);
  document.querySelector("#wa-interactive-buttons")?.addEventListener("click", sendInteractiveButtons);
  document.querySelector("#wa-add-internal-note")?.addEventListener("click", addInternalNote);
  document.querySelector("#wa-cancel-reply")?.addEventListener("click", () => {
    state.whatsapp.replyToMessageId = null;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  document.querySelector("#wa-assignee")?.addEventListener("change", assignConversation);
  document.querySelector("#wa-add-tag")?.addEventListener("click", addContactTag);
  document.querySelectorAll("[data-remove-tag]").forEach((button) => button.addEventListener("click", () => removeContactTag(button.dataset.removeTag)));
  document.querySelector("#wa-save-notes")?.addEventListener("click", saveCustomerNotes);
  document.querySelector("#wa-create-followup")?.addEventListener("click", createWhatsappFollowup);
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

function bindWhatsappMessageEvents() {
  bindMediaEvents();
  document.querySelectorAll("[data-reply-message]").forEach((button) => button.addEventListener("click", () => {
    state.whatsapp.replyToMessageId = button.dataset.replyMessage;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    document.querySelector("#wa-message-input")?.focus();
  }));
  document.querySelectorAll("[data-react-message]").forEach((button) => button.addEventListener("click", () => {
    sendReaction(button.dataset.reactMessage, button.dataset.reactEmoji, button);
  }));
  document.querySelectorAll("[data-retry-message]").forEach((button) => button.addEventListener("click", () => {
    retryWhatsappMessage(button.dataset.retryMessage, button);
  }));
}

function bindMediaEvents() {
  document.querySelectorAll("[data-retry-media]").forEach((button) => button.addEventListener("click", () => {
    retryWhatsappMedia(button.dataset.retryMedia, button);
  }));
  document.querySelectorAll("[data-media-open]").forEach((button) => button.addEventListener("click", () => {
    openProtectedAttachment(button.dataset.mediaOpen, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-media-preview]").forEach((button) => button.addEventListener("click", () => {
    openImageViewer(button.dataset.mediaPreview, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-media-download]").forEach((button) => button.addEventListener("click", () => {
    downloadProtectedAttachment(button.dataset.mediaDownload, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-protected-media]").forEach((element) => {
    element.addEventListener("error", () => hydrateProtectedMedia(element), { once: true });
  });
}

async function retryWhatsappMedia(messageId, button) {
  button.disabled = true;
  button.textContent = "Recovering…";
  try {
    await api(`/messages/${encodeURIComponent(messageId)}/media/retry`, { method: "POST", body: {} });
    await refreshWhatsappMessage(messageId);
    renderWhatsappPage();
    notify("WhatsApp media recovered.");
  } catch (error) {
    notify(error.message, true);
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "Retry media";
    }
  }
}

async function hydrateProtectedMedia(element) {
  if (element.dataset.mediaFallback === "loading" || element.dataset.mediaFallback === "ready") return;
  element.dataset.mediaFallback = "loading";
  try {
    const blob = await fetchAttachmentBlob(element.dataset.protectedMedia);
    const objectUrl = URL.createObjectURL(blob);
    state.whatsapp.mediaObjectUrls.push(objectUrl);
    element.src = objectUrl;
    element.dataset.mediaFallback = "ready";
  } catch (error) {
    element.dataset.mediaFallback = "failed";
    notify(error.message, true);
  }
}

async function openImageViewer(attachmentId, filename, button) {
  closeImageViewer();
  const viewer = document.createElement("div");
  viewer.className = "wa-image-viewer";
  viewer.dataset.imageViewer = "true";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", filename || "Image preview");
  viewer.innerHTML = `
    <header><strong>${esc(filename || "Image")}</strong><button data-image-viewer-close type="button" aria-label="Close image">&times;</button></header>
    <div class="wa-image-viewer-stage"><span>Loading image&hellip;</span></div>
    <footer><button data-image-viewer-download type="button">Download</button></footer>`;
  document.body.appendChild(viewer);
  document.body.classList.add("wa-viewer-open");
  viewer.querySelector("[data-image-viewer-close]").addEventListener("click", closeImageViewer);
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) closeImageViewer();
  });
  viewer.querySelector("[data-image-viewer-download]").addEventListener("click", (event) => {
    downloadProtectedAttachment(attachmentId, filename, event.currentTarget);
  });
  document.addEventListener("keydown", handleImageViewerKey);
  if (button) button.disabled = true;
  try {
    const blob = await fetchAttachmentBlob(attachmentId);
    const objectUrl = URL.createObjectURL(blob);
    if (!viewer.isConnected) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    viewer.dataset.objectUrl = objectUrl;
    viewer.querySelector(".wa-image-viewer-stage").innerHTML = `<img src="${attr(objectUrl)}" alt="${attr(filename || "Image")}" />`;
    viewer.querySelector("[data-image-viewer-close]").focus();
  } catch (error) {
    closeImageViewer();
    notify(error.message, true);
  } finally {
    if (button && document.body.contains(button)) button.disabled = false;
  }
}

function closeImageViewer() {
  const viewer = document.querySelector("[data-image-viewer]");
  if (viewer?.dataset.objectUrl) URL.revokeObjectURL(viewer.dataset.objectUrl);
  viewer?.remove();
  document.body.classList.remove("wa-viewer-open");
  document.removeEventListener("keydown", handleImageViewerKey);
}

function handleImageViewerKey(event) {
  if (event.key === "Escape") closeImageViewer();
}

async function openProtectedAttachment(attachmentId, filename, button) {
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  button.disabled = true;
  try {
    const blob = await fetchAttachmentBlob(attachmentId);
    const objectUrl = URL.createObjectURL(blob);
    if (popup) popup.location.replace(objectUrl);
    else {
      const link = document.createElement("a");
      link.href = objectUrl;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.click();
    }
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    popup?.close();
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function downloadProtectedAttachment(attachmentId, filename, button) {
  button.disabled = true;
  try {
    const blob = await fetchAttachmentBlob(attachmentId, { download: true });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename || "attachment";
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

function releaseMediaObjectUrls() {
  for (const objectUrl of state.whatsapp?.mediaObjectUrls || []) URL.revokeObjectURL(objectUrl);
  if (state.whatsapp) state.whatsapp.mediaObjectUrls = [];
}

function bindConversationRows() {
  document.querySelectorAll("[data-conversation-id]").forEach((button) => button.addEventListener("click", () => {
    state.whatsapp.clientPanelOpen = false;
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
      body = { type: "TEXT", text, replyToMessageId: wa.replyToMessageId || null };
    } else {
      if (!selectedUtilityTemplate()) throw new Error("Sync and select an approved Utility template first.");
      if (!wa.selectedOrderId) throw new Error("Select the related CRM order before sending this Utility update.");
      document.querySelectorAll("[data-template-field]").forEach((input) => { wa.templateValues[input.dataset.templateField] = input.value.trim(); });
      body = { type: "TEMPLATE", utilityTemplateId: selectedUtilityTemplate()?.id, templateVariables: wa.templateValues };
    }
    const { data: sendResult } = await api(`/conversations/${encodeURIComponent(wa.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${wa.selectedId}-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: body.type === "TEMPLATE"
        ? { ...body, templateVariables: { ...body.templateVariables, order_id: wa.selectedOrderId || "" } }
        : body
    });
    if (sendResult?.queued !== true && sendResult?.sent !== true) {
      throw new Error(policyFailureMessage(sendResult?.reason));
    }
    wa.replyToMessageId = null;
    await loadWhatsappConversation(wa.selectedId, { incremental: true });
    renderWhatsappPage();
    notify(body.type === "TEMPLATE" ? "Utility update queued for WhatsApp." : "Message queued for WhatsApp.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function syncUtilityTemplates(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    await api("/whatsapp/templates/sync", { method: "POST", body: {} });
    const { data } = await api("/whatsapp/utility-templates");
    state.whatsapp.templates = data || [];
    state.whatsapp.templateId = null;
    state.whatsapp.templateValues = {};
    prefillUtilityValues(true);
    renderWhatsappPage();
    notify(state.whatsapp.templates.some((item) => item.approved) ? "Approved Meta templates synced." : "Sync completed, but no configured Utility template is Approved.", !state.whatsapp.templates.some((item) => item.approved));
  } catch (error) {
    notify(error.message, true);
    if (document.body.contains(button)) {
      button.disabled = false;
      button.textContent = "Sync Meta templates";
    }
  }
}

async function retryWhatsappMessage(messageId, button) {
  button.disabled = true;
  try {
    await api(`/messages/${encodeURIComponent(messageId)}/retry`, { method: "POST", body: {} });
    await refreshWhatsappMessage(messageId);
    renderWhatsappPage();
    notify("Message queued for retry.");
  } catch (error) {
    notify(error.message, true);
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function selectQuickReply(event) {
  const value = event.target.value;
  if (!value) return;
  if (value === "__CREATE__") {
    await createCustomQuickReply();
    return;
  }
  const reply = state.whatsapp.quickReplies.find((item) => item.quickReplyId === value || item.id === value);
  const input = document.querySelector("#wa-message-input");
  if (reply && input) {
    input.value = reply.text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
  event.target.value = "";
}

async function createCustomQuickReply() {
  const shortcut = prompt("Shortcut, for example /sample:");
  if (!shortcut) return;
  const title = prompt("Quick reply name:");
  if (!title) return;
  const text = prompt("Message text:");
  if (!text) return;
  try {
    const { data } = await api("/whatsapp/quick-replies", {
      method: "POST",
      body: { shortcut: shortcut.trim(), title: title.trim(), text: text.trim(), category: "GENERAL" }
    });
    state.whatsapp.quickReplies.push(data);
    renderWhatsappPage();
    notify("Quick reply saved.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function sendSelectedAttachment(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  await sendAttachmentFile(file, document.querySelector("#wa-message-input")?.value.trim() || "");
}

async function sendAttachmentFile(file, caption = "") {
  const wa = state.whatsapp;
  const conversation = selectedConversation();
  if (!conversation || !wa.overview?.contact?.contactId) return;
  if (!whatsappWindow().open) {
    notify("Media can be sent as a normal reply only while the 24-hour service window is open.", true);
    return;
  }
  const kind = messageTypeForFile(file);
  notify(`Uploading ${file.name || pretty(kind)}…`);
  try {
    const attachment = await uploadAttachment(file, wa.overview.contact.contactId, wa.selectedId);
    await api(`/conversations/${encodeURIComponent(wa.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${wa.selectedId}-media-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: {
        type: kind,
        text: kind === "AUDIO" ? "" : caption,
        attachmentIds: [attachment.attachmentId],
        replyToMessageId: wa.replyToMessageId || null
      }
    });
    wa.replyToMessageId = null;
    await loadWhatsappConversation(wa.selectedId, { incremental: true });
    renderWhatsappPage();
    notify(`${pretty(kind)} queued for WhatsApp.`);
  } catch (error) {
    notify(error.message, true);
  }
}

function messageTypeForFile(file) {
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "IMAGE";
  if (mime.startsWith("video/")) return "VIDEO";
  if (mime.startsWith("audio/")) return "AUDIO";
  return "DOCUMENT";
}

async function toggleVoiceRecording() {
  const wa = state.whatsapp;
  if (wa.recording && wa.mediaRecorder) {
    wa.mediaRecorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    notify("Voice recording is not supported by this browser. You can attach an audio file instead.", true);
    return;
  }
  if (!whatsappWindow().open) {
    notify("Voice notes can be sent only while the 24-hour service window is open.", true);
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());
      const mimeType = recorder.mimeType || "audio/webm";
      const file = new File(chunks, `voice-note-${Date.now()}.webm`, { type: mimeType });
      const discard = wa.discardRecording || !state.session || !location.hash.startsWith("#whatsapp");
      wa.recording = false;
      wa.discardRecording = false;
      wa.mediaRecorder = null;
      wa.mediaStream = null;
      if (discard) return;
      renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
      await sendAttachmentFile(file);
    });
    recorder.start();
    wa.recording = true;
    wa.mediaRecorder = recorder;
    wa.mediaStream = stream;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    notify("Recording voice note… click Stop when finished.");
  } catch (error) {
    notify(error.message || "Microphone permission was not granted.", true);
  }
}

function discardVoiceRecording() {
  const wa = state.whatsapp;
  if (!wa?.recording || !wa.mediaRecorder) return;
  wa.discardRecording = true;
  wa.mediaStream?.getTracks().forEach((track) => track.stop());
  if (wa.mediaRecorder.state !== "inactive") wa.mediaRecorder.stop();
}

async function shareCurrentLocation(buttonEvent) {
  if (!navigator.geolocation) {
    notify("Location is not supported by this browser.", true);
    return;
  }
  if (!whatsappWindow().open) {
    notify("Location can be sent only while the 24-hour service window is open.", true);
    return;
  }
  const button = buttonEvent.currentTarget;
  button.disabled = true;
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 60_000
    }));
    await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${state.whatsapp.selectedId}-location-${Date.now()}` },
      body: {
        type: "LOCATION",
        metadata: {
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            name: "Shared by RX Design Hub"
          }
        }
      }
    });
    await loadWhatsappConversation(state.whatsapp.selectedId, { incremental: true });
    renderWhatsappPage();
    notify("Location queued for WhatsApp.");
  } catch (error) {
    notify(error.message || "Location permission was not granted.", true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function shareContactCard(event) {
  if (!whatsappWindow().open) {
    notify("Contact cards can be sent only while the 24-hour service window is open.", true);
    return;
  }
  const formattedName = prompt("Contact name to share:");
  if (!formattedName?.trim()) return;
  const phone = prompt("Contact phone number with country code:");
  if (!phone?.trim()) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${state.whatsapp.selectedId}-contact-${Date.now()}` },
      body: {
        type: "CONTACT",
        metadata: {
          contacts: [{
            name: {
              formatted_name: formattedName.trim(),
              first_name: formattedName.trim().split(/\s+/)[0]
            },
            phones: [{ phone: phone.trim(), type: "CELL" }]
          }]
        }
      }
    });
    await loadWhatsappConversation(state.whatsapp.selectedId, { incremental: true });
    renderWhatsappPage();
    notify("Contact card queued for WhatsApp.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function sendInteractiveButtons(event) {
  if (!whatsappWindow().open) {
    notify("Interactive buttons can be sent only while the 24-hour service window is open.", true);
    return;
  }
  const bodyText = prompt("Question or action text:");
  if (!bodyText?.trim()) return;
  const labels = prompt("Button labels, separated by commas (maximum 3):", "Yes, No");
  const titles = String(labels || "").split(",").map((item) => item.trim().slice(0, 20)).filter(Boolean).slice(0, 3);
  if (!titles.length) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${state.whatsapp.selectedId}-buttons-${Date.now()}` },
      body: {
        type: "INTERACTIVE",
        text: bodyText.trim(),
        metadata: {
          interactive: {
            type: "button",
            body: { text: bodyText.trim() },
            action: {
              buttons: titles.map((title, index) => ({
                type: "reply",
                reply: { id: `rx_action_${Date.now()}_${index + 1}`, title }
              }))
            }
          }
        }
      }
    });
    await loadWhatsappConversation(state.whatsapp.selectedId, { incremental: true });
    renderWhatsappPage();
    notify("Interactive action queued for WhatsApp.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function addInternalNote() {
  const note = prompt("Internal note (customer will not see this):");
  if (!note?.trim()) return;
  try {
    await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/internal-note`, {
      method: "POST",
      body: { note: note.trim() }
    });
    await loadWhatsappConversation(state.whatsapp.selectedId, { incremental: true });
    renderWhatsappPage();
    notify("Internal note added.");
  } catch (error) {
    notify(error.message, true);
  }
}

async function sendReaction(messageId, emoji, button) {
  if (!whatsappWindow().open) {
    notify("Reactions can be sent only while the 24-hour service window is open.", true);
    return;
  }
  button.disabled = true;
  try {
    await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${state.whatsapp.selectedId}-reaction-${messageId}-${emoji}-${Date.now()}` },
      body: { type: "REACTION", text: emoji, replyToMessageId: messageId }
    });
    await loadWhatsappConversation(state.whatsapp.selectedId, { incremental: true });
    renderWhatsappPage();
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (document.body.contains(button)) button.disabled = false;
  }
}

async function enableDesktopAlerts() {
  if (!("Notification" in window)) {
    notify("Desktop notifications are not supported by this browser.", true);
    return;
  }
  const permission = await Notification.requestPermission();
  notify(permission === "granted" ? "Desktop WhatsApp alerts enabled." : "Notification permission was not granted.", permission !== "granted");
}

async function toggleImportantContact() {
  const contact = state.whatsapp.overview?.contact;
  if (!contact) return;
  const tags = new Set(contact.tags || []);
  if (tags.has("IMPORTANT")) tags.delete("IMPORTANT");
  else tags.add("IMPORTANT");
  await updateWhatsappContact({ tags: [...tags] }, tags.has("IMPORTANT") ? "Customer marked Important." : "Important marker removed.");
}

async function addContactTag() {
  const tag = prompt("Tag name:");
  if (!tag?.trim()) return;
  const contact = state.whatsapp.overview?.contact;
  const normalized = tag.trim().toUpperCase().replace(/\s+/g, "_").slice(0, 60);
  await updateWhatsappContact({ tags: [...new Set([...(contact.tags || []), normalized])] }, "Tag added.");
}

async function removeContactTag(tag) {
  const contact = state.whatsapp.overview?.contact;
  await updateWhatsappContact({ tags: (contact.tags || []).filter((item) => item !== tag) }, "Tag removed.");
}

async function saveCustomerNotes(event) {
  const button = event.currentTarget;
  button.disabled = true;
  await updateWhatsappContact({ notes: document.querySelector("#wa-customer-notes")?.value || "" }, "Customer notes saved.");
}

async function updateWhatsappContact(patch, successMessage) {
  const contact = state.whatsapp.overview?.contact;
  if (!contact) return;
  try {
    const { data } = await api(`/contacts/${encodeURIComponent(contact.contactId)}`, {
      method: "PATCH",
      body: patch
    });
    state.whatsapp.overview.contact = data;
    const conversation = selectedConversation();
    if (conversation) conversation.contact = { ...(conversation.contact || {}), ...data };
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    notify(successMessage);
  } catch (error) {
    notify(error.message, true);
  }
}

async function assignConversation(event) {
  const select = event.currentTarget;
  select.disabled = true;
  try {
    const { data } = await api(`/conversations/${encodeURIComponent(state.whatsapp.selectedId)}/assign`, {
      method: "POST",
      body: { assignedTo: select.value || null }
    });
    Object.assign(selectedConversation(), data);
    if (state.whatsapp.overview?.contact) state.whatsapp.overview.contact.assignedTo = data.assignedTo;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    notify("Conversation owner updated.");
  } catch (error) {
    notify(error.message, true);
    select.disabled = false;
  }
}

async function createWhatsappFollowup(event) {
  const button = event.currentTarget;
  const dueAt = document.querySelector("#wa-followup-at")?.value;
  const notes = document.querySelector("#wa-followup-note")?.value.trim() || "";
  if (!dueAt) {
    notify("Select a follow-up date and time.", true);
    return;
  }
  button.disabled = true;
  try {
    await api("/followups", {
      method: "POST",
      body: {
        contactId: state.whatsapp.overview.contact.contactId,
        conversationId: state.whatsapp.selectedId,
        assignedTo: selectedConversation()?.assignedTo || null,
        dueAt: new Date(dueAt).toISOString(),
        type: "MESSAGE",
        notes
      }
    });
    const { data } = await api(`/contacts/${encodeURIComponent(state.whatsapp.overview.contact.contactId)}/overview`);
    state.whatsapp.overview = data;
    renderWhatsappPage();
    notify("Follow-up scheduled.");
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
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
  if (document.hidden || state.whatsapp.syncing || !location.hash.startsWith("#whatsapp")) return;
  state.whatsapp.timer = setTimeout(pollWhatsapp, WHATSAPP_POLL_INTERVAL_MS);
}

function stopWhatsappPolling() {
  if (state.whatsapp?.timer) clearTimeout(state.whatsapp.timer);
  if (state.whatsapp) state.whatsapp.timer = null;
}

function resumeWhatsappPolling() {
  if (document.hidden || !state.session || !location.hash.startsWith("#whatsapp")) return;
  stopWhatsappPolling();
  pollWhatsapp();
}

async function pollWhatsapp() {
  const wa = state.whatsapp;
  if (!location.hash.startsWith("#whatsapp") || document.hidden || wa.syncing) return;
  wa.syncing = true;
  const previousUnread = new Map(wa.conversations.map((item) => [conversationId(item), Number(item.unreadCount || 0)]));
  try {
    const syncStartedAt = Date.now();
    const from = new Date(Math.max(0, Number(wa.syncedAt || syncStartedAt) - WHATSAPP_SYNC_OVERLAP_MS)).toISOString();
    const result = await api(`/conversations?limit=100&from=${encodeURIComponent(from)}&sortBy=updatedAt&sortOrder=asc`);
    const whatsappUpdates = result.data.filter((item) => item.currentChannel === "WHATSAPP");
    const selectedChanged = whatsappUpdates.some((item) => conversationId(item) === wa.selectedId);
    const newlyUnread = whatsappUpdates.filter((item) => Number(item.unreadCount || 0) > Number(previousUnread.get(conversationId(item)) || 0));
    wa.conversations = sortWhatsappConversations(mergeById(wa.conversations, whatsappUpdates, "conversationId"));
    let incoming = [];
    if (selectedChanged) incoming = await loadWhatsappConversation(wa.selectedId, { incremental: true }) || [];
    const markerUpdates = selectedChanged
      ? await refreshChangedMessageMarkers(whatsappUpdates, new Set(incoming.map((item) => item.messageId || item.id)))
      : [];
    wa.syncedAt = serverSyncTime(result, syncStartedAt);
    wa.syncState = "live";
    await Promise.all([
      chatCacheCall(wa.cache, "putConversations", whatsappUpdates),
      chatCacheCall(wa.cache, "setMeta", "conversationSyncAt", wa.syncedAt)
    ]);
    if (whatsappUpdates.length || selectedChanged) {
      refreshWhatsappLiveDom({ messagesChanged: incoming.length > 0 || markerUpdates.length > 0 });
    }
    if (incoming.some((item) => item.direction === "INBOUND")) markSelectedConversationRead();
    if (newlyUnread.length) showInboundNotification(newlyUnread[0]);
  } catch (error) {
    wa.syncState = "offline";
    updateWhatsappSyncBadge();
    console.warn("WhatsApp inbox refresh failed", error);
  } finally {
    wa.syncing = false;
    startWhatsappPolling();
  }
}

async function refreshChangedMessageMarkers(conversationUpdates, loadedMessageIds = new Set()) {
  const wa = state.whatsapp;
  const selectedUpdate = conversationUpdates.find((item) => conversationId(item) === wa.selectedId);
  if (!selectedUpdate) return [];
  const markerIds = [...new Set([
    selectedUpdate.deliveryStatusMessageId,
    selectedUpdate.mediaUpdatedMessageId
  ].filter((messageId) => messageId && !loadedMessageIds.has(messageId)))];
  if (!markerIds.length) return [];
  const results = await Promise.all(markerIds.map(async (messageId) => {
    try {
      return await refreshWhatsappMessage(messageId, { cacheOnly: true });
    } catch (error) {
      console.warn(`Changed message ${messageId} could not be refreshed`, error);
      return null;
    }
  }));
  const messages = results.filter((item) => item && item.conversationId === wa.selectedId);
  if (!messages.length) return [];
  wa.messages = mergeById(wa.messages, messages, "messageId")
    .sort((left, right) => (asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0));
  await chatCacheCall(wa.cache, "putMessages", messages);
  return messages;
}

async function refreshWhatsappMessage(messageId, { cacheOnly = false } = {}) {
  const message = (await api(`/messages/${encodeURIComponent(messageId)}`)).data;
  if (!message || message.conversationId !== state.whatsapp.selectedId) return null;
  if (cacheOnly) return message;
  state.whatsapp.messages = mergeById(state.whatsapp.messages, [message], "messageId")
    .sort((left, right) => (asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0));
  await chatCacheCall(state.whatsapp.cache, "putMessages", [message]);
  return message;
}

function refreshWhatsappLiveDom({ messagesChanged = false } = {}) {
  updateWhatsappSyncBadge();
  const list = document.querySelector("#wa-conversation-list");
  if (list) {
    list.innerHTML = waConversationList();
    bindConversationRows();
  }
  if (!messagesChanged) return;
  const body = document.querySelector("#wa-message-list");
  if (!body) return;
  const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
  const stayAtBottom = distanceFromBottom < 120;
  releaseMediaObjectUrls();
  body.innerHTML = state.whatsapp.messages.length
    ? state.whatsapp.messages.map(waMessage).join("")
    : '<div class="wa-chat-empty">No messages yet. Use a Utility template to start this conversation.</div>';
  bindWhatsappMessageEvents();
  requestAnimationFrame(() => {
    body.scrollTop = stayAtBottom ? body.scrollHeight : Math.max(0, body.scrollHeight - body.clientHeight - distanceFromBottom);
  });
}

function updateWhatsappSyncBadge() {
  const badge = document.querySelector("#wa-sync-state");
  if (!badge) return;
  const indicator = whatsappSyncIndicator();
  badge.textContent = indicator.label;
  badge.classList.toggle("connected", indicator.connected);
  badge.classList.toggle("disconnected", !indicator.connected);
}

function whatsappSyncIndicator() {
  const wa = state.whatsapp;
  if (wa.syncState === "offline") return { connected: false, label: "Cached · reconnecting" };
  if (wa.syncState === "cached") return { connected: true, label: "Cached · syncing" };
  return wa.capabilities?.connected
    ? { connected: true, label: "Cloud API connected" }
    : { connected: false, label: "API setup needed" };
}

function showInboundNotification(conversation) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const contact = conversation.contact || {};
  const name = contact.companyName || contact.contactPerson || contact.primaryPhone || "WhatsApp customer";
  const key = `${conversationId(conversation)}:${asDate(conversation.lastMessageAt)?.getTime() || 0}`;
  if (state.whatsapp.lastNotificationKey === key) return;
  state.whatsapp.lastNotificationKey = key;
  const notification = new Notification(`New WhatsApp message · ${name}`, {
    body: conversation.lastMessagePreview || "Open CRM to reply",
    tag: conversationId(conversation)
  });
  notification.addEventListener("click", () => {
    window.focus();
    location.hash = `#whatsapp/${conversationId(conversation)}`;
    notification.close();
  });
}

function prefillUtilityValues(force) {
  const wa = state.whatsapp;
  const available = wa.templates.filter((item) => item.approved !== false);
  if (!wa.templateId || !available.some((item) => item.id === wa.templateId)) wa.templateId = available[0]?.id || null;
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
function selectedUtilityTemplate() {
  const available = state.whatsapp.templates.filter((item) => item.approved !== false);
  return available.find((item) => item.id === state.whatsapp.templateId) || available[0] || null;
}
function conversationId(item) { return item?.conversationId || item?.id || null; }
function waFilterButton(value, label) { return `<button data-wa-filter="${value}" class="${state.whatsapp.filter === value ? "active" : ""}">${label}</button>`; }
function orderReference(order) { return order.orderNumber || `ORD-${String(order.orderId || "").slice(-8).toUpperCase()}`; }
function suggestedTemplate(status) { return ({ CONFIRMED: "order_confirmation", DESIGN_READY: "design_ready", DISPATCHED: "dispatch_update", DELIVERED: "order_delivered" })[status] || null; }
function orderStatusOptions(current) { return current && !ORDER_STATUSES.includes(current) ? [current, ...ORDER_STATUSES] : ORDER_STATUSES; }
function renderUtilityPreview(template, values) { return template ? template.variables.reduce((text, field, index) => text.replaceAll(`{{${index + 1}}}`, values[field.key] || `{{${index + 1}}}`), template.body) : ""; }
function messageStatusMarkup(status) {
  const normalized = String(status || "QUEUED").toUpperCase();
  const label = ({
    QUEUED: "Queued",
    SENDING: "Sending",
    SENT: "Sent",
    DELIVERED: "Delivered",
    READ: "Read",
    FAILED: "Failed",
    CANCELLED: "Cancelled"
  })[normalized] || pretty(normalized);
  if (["QUEUED", "SENDING"].includes(normalized)) {
    return `<span class="wa-delivery-status ${normalized.toLowerCase()}" role="img" aria-label="${attr(label)}" title="${attr(label)}"><span class="wa-status-clock"></span></span>`;
  }
  if (["FAILED", "CANCELLED"].includes(normalized)) {
    return `<span class="wa-delivery-status failed" role="img" aria-label="${attr(label)}" title="${attr(label)}">!</span>`;
  }
  const paths = normalized === "SENT"
    ? '<path d="M2 7.2 5.2 10.2 12.8 2.6"></path>'
    : '<path d="M1.5 7.2 4.6 10.2 9.5 5.2"></path><path d="M6.8 7.2 9.8 10.2 15.8 3.2"></path>';
  return `<span class="wa-delivery-status ${normalized.toLowerCase()}" role="img" aria-label="${attr(label)}" title="${attr(label)}"><svg viewBox="0 0 18 13" aria-hidden="true">${paths}</svg></span>`;
}
function shortTime(value) { const parsed = asDate(value); return parsed ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(parsed) : ""; }
function asDate(value) { if (!value) return null; if (value._seconds) return new Date(value._seconds * 1000); const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function compactDuration(ms) { const hours = Math.floor(ms / 3_600_000); const minutes = Math.max(0, Math.floor((ms % 3_600_000) / 60_000)); return `${hours}h ${minutes}m left`; }
function fileSize(bytes) { const value = Number(bytes || 0); if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
function mergeById(current, incoming, field) { const map = new Map(current.map((item) => [item[field] || item.id, item])); incoming.forEach((item) => map.set(item[field] || item.id, { ...(map.get(item[field] || item.id) || {}), ...item })); return [...map.values()]; }
function sortWhatsappConversations(items) {
  return [...items].sort((left, right) => (asDate(right.lastMessageAt)?.getTime() || 0) - (asDate(left.lastMessageAt)?.getTime() || 0));
}
function serverSyncTime(response, fallback = Date.now()) {
  return asDate(response?.meta?.serverTime)?.getTime() || fallback;
}
async function chatCacheCall(cache, method, ...args) {
  try {
    return await cache?.[method]?.(...args);
  } catch (error) {
    console.warn(`Local chat cache ${method} failed`, error);
    return null;
  }
}
function freshWhatsappState() {
  return {
    conversations: [],
    messages: [],
    templates: [],
    quickReplies: [],
    users: [],
    capabilities: null,
    syncState: "idle",
    cache: null,
    cacheHydrated: false,
    clientPanelOpen: false,
    selectedId: null,
    messagesConversationId: null,
    overview: null,
    overviewCachedAt: 0,
    filter: "ALL",
    search: "",
    mode: "TEXT",
    templateId: null,
    templateValues: {},
    selectedOrderId: null,
    replyToMessageId: null,
    recording: false,
    discardRecording: false,
    mediaRecorder: null,
    mediaStream: null,
    mediaObjectUrls: [],
    lastNotificationKey: null,
    syncedAt: null,
    timer: null,
    syncing: false
  };
}
function freshMarketingState() {
  return {
    contacts: [], audiences: [], campaigns: [], templates: [], replied: [], users: [],
    metaTemplates: [], configuredTemplates: [], templateLoadError: null, replyLoadError: null, userLoadError: null,
    strictCampaignLifecycle: false, replyFilter: "ALL", decision: null
  };
}

const ORDER_STATUSES = ["CONFIRMED", "IN_DESIGN", "DESIGN_READY", "IN_PRODUCTION", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED"];

async function renderMarketing() {
  pageTitle.textContent = "Marketing";
  const [contactsResponse, audiencesResponse, campaignsResponse, templatesResponse, repliedResponse, usersResponse, metaTemplatesResponse, configuredTemplatesResponse] = await Promise.all([
    marketingApi("/contacts?limit=100", "Customers"),
    marketingApi("/marketing/audiences?limit=100", "Interested lists"),
    firstAvailableMarketingApi(["/campaigns?limit=100", "/marketing/campaigns?limit=100"], "Campaigns"),
    marketingApi("/marketing/templates", "Marketing templates"),
    optionalMarketingApi("/marketing/replied?limit=100"),
    optionalMarketingApi("/users?limit=100"),
    optionalMarketingApi("/whatsapp/templates?limit=100"),
    optionalMarketingApi("/whatsapp/templates/configured")
  ]);
  state.marketing = {
    contacts: contactsResponse.data || [],
    audiences: audiencesResponse.data || [],
    campaigns: campaignsResponse.data || [],
    templates: templatesResponse.data || [],
    replied: repliedResponse.data || [],
    users: usersResponse.data || [],
    metaTemplates: metaTemplatesResponse.data || [],
    configuredTemplates: configuredTemplatesResponse.data || [],
    templateLoadError: metaTemplatesResponse.error || configuredTemplatesResponse.error || null,
    replyLoadError: repliedResponse.error || null,
    userLoadError: usersResponse.error || null,
    strictCampaignLifecycle: campaignsResponse.route?.startsWith("/campaigns") === true,
    decision: state.marketing.decision || null,
    replyFilter: state.marketing.replyFilter || "ALL"
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
    ${renderWhatsAppPolicyTools()}
    ${renderRepliedProspectsSection()}
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
          <div class="drip-steps">
            ${dripStep(1, 0, "Share the latest options and pricing with our team.", true, true)}
            ${dripStep(2, 3, "Would you like us to prepare a quotation for you?", true)}
            ${dripStep(3, 7, "Reply here whenever you are ready and our team will help place the order.", true)}
          </div>
          <label class="campaign-confirm"><input name="confirmConsent" type="checkbox" required /> I confirm that the selected customers have permission to receive this type of WhatsApp marketing message.</label>
          <button class="button button-primary button-full" type="submit" ${state.marketing.audiences.length && template ? "" : "disabled"}>Save campaign draft</button>
          <p class="muted tiny-note">After saving, submit the draft for approval. An approved campaign can then be started now or scheduled.</p>
        </form>
      </section>
    </div>
    <section class="panel campaign-list-panel"><div class="panel-title-row"><div><p class="eyebrow">CAMPAIGN CONTROL</p><h3>Campaigns</h3><p>Draft, submit, approve and schedule campaigns with a visible audit-friendly lifecycle.</p></div></div>
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

async function optionalMarketingApi(path) {
  try {
    return await api(path);
  } catch (error) {
    return { data: [], error: error.message };
  }
}

async function firstAvailableMarketingApi(paths, label) {
  let lastError = null;
  for (const path of paths) {
    try {
      return { ...(await api(path)), route: path };
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label} could not load: ${lastError?.message || "Route not found"}`);
}

function renderWhatsAppPolicyTools() {
  if (!state.marketing.strictCampaignLifecycle) {
    return `<section class="panel policy-center-panel compatibility-panel"><div class="panel-title-row"><div><p class="eyebrow">BACKEND UPDATE REQUIRED</p><h3>Marketing is running in compatibility mode</h3><p>The deployed Render backend does not have the new smart-policy routes yet. Existing audiences and campaigns remain usable; Meta sync, send-mode preview and approval workflow will appear automatically after backend v7 is deployed.</p></div><span class="count-pill">Legacy backend</span></div></section>`;
  }
  const configured = state.marketing.configuredTemplates || [];
  const remote = state.marketing.metaTemplates || [];
  const templateRows = configured.map((template) => ({
    ...template,
    remote: remote.find((item) => item.name === template.name && String(item.language || "en").toLowerCase() === String(template.language || "en").toLowerCase()) || null
  }));
  const approved = templateRows.filter((item) => item.remote?.status === "APPROVED").length;
  const blocked = templateRows.filter((item) => item.remote && item.remote.status !== "APPROVED").length;
  const missing = templateRows.filter((item) => !item.remote).length;
  const decision = state.marketing.decision;
  const customerOptions = marketingCustomerOptions();
  return `<section class="panel policy-center-panel">
    <div class="panel-title-row"><div><p class="eyebrow">WHATSAPP POLICY CENTER</p><h3>Meta template readiness</h3><p>Sync before sending. Only templates marked Approved by Meta can be used outside the customer-service window.</p></div><button type="button" class="button button-secondary" id="sync-meta-templates">Sync from Meta</button></div>
    ${state.marketing.templateLoadError ? `<div class="form-error policy-error">Template status unavailable: ${esc(state.marketing.templateLoadError)}</div>` : ""}
    <div class="template-summary"><span class="template-count approved"><strong>${approved}</strong> Approved</span><span class="template-count review"><strong>${blocked}</strong> In review / blocked</span><span class="template-count missing"><strong>${missing}</strong> Not synced</span><span class="template-count remote"><strong>${remote.length}</strong> Meta templates</span></div>
    <details class="template-registry"><summary>View configured template status (${templateRows.length})</summary><div class="template-status-grid">${templateRows.length ? templateRows.map(templateStatusCard).join("") : '<div class="empty-state">Backend template registry is unavailable.</div>'}</div></details>
  </section>
  <div class="policy-tools-grid">
    <section class="panel policy-tool-panel">
      <div><p class="eyebrow">SEND SAFETY CHECK</p><h3>Preview the allowed send mode</h3><p>Check whether a message will use the 24-hour service window, a utility template, a marketing template, or be blocked.</p></div>
      <form id="message-decision-form" class="policy-form">
        <label class="field">Customer<select name="contactId" required>${customerOptions}</select></label>
        <div class="form-grid policy-form-grid"><label class="field">Event<select name="eventType">${messageEventOptions()}</select></label><label class="field">Template<select name="templateKey"><option value="">Auto select</option>${configured.map((item) => `<option value="${attr(item.key)}">${esc(item.key)} · ${esc(item.category)}</option>`).join("")}</select></label></div>
        <div class="form-grid policy-form-grid"><label class="field">Order ID<input name="orderId" placeholder="Real Firestore order ID" /></label><label class="field">Quotation ID<input name="quotationId" placeholder="Real quotation ID" /></label></div>
        <label class="field">Message intent<input name="messageIntent" maxlength="500" placeholder="Why this message should be sent" /></label>
        <label class="campaign-confirm"><input type="checkbox" name="isPromotional" /> This message contains a promotion</label>
        <button type="submit" class="button button-secondary button-full">Check send mode</button>
      </form>
      ${decision ? renderDecisionResult(decision) : '<p class="muted policy-helper">No message is sent by this check.</p>'}
    </section>
    <section class="panel policy-tool-panel">
      <div><p class="eyebrow">TRANSACTIONAL UPDATE</p><h3>Send an order utility message</h3><p>Use a real quotation or order reference. The backend verifies it before queueing the WhatsApp message.</p></div>
      <form id="utility-event-form" class="policy-form">
        <label class="field">Customer<select name="contactId" required>${customerOptions}</select></label>
        <label class="field">Update type<select name="eventType" id="utility-event-type"><option value="QUOTATION_READY">Quotation ready</option><option value="DESIGN_PROOF_READY">Design proof ready</option><option value="DESIGN_APPROVAL_PENDING">Design approval pending</option><option value="PAYMENT_RECEIVED">Payment received</option><option value="ORDER_DISPATCHED">Order dispatched</option></select></label>
        <div id="utility-event-fields">${utilityEventFields("QUOTATION_READY")}</div>
        <button type="submit" class="button button-primary button-full">Verify & queue message</button>
      </form>
    </section>
  </div>`;
}

function templateStatusCard(template) {
  const status = template.remote?.status || "NOT_SYNCED";
  return `<article class="template-status-card"><div><strong>${esc(template.name)}</strong><small>${esc(template.key)} · ${esc(template.language)} · ${esc(template.category)}</small></div><span class="template-status status-${attr(status.toLowerCase())}">${esc(pretty(status))}</span>${template.remote?.rejectedReason ? `<p>${esc(template.remote.rejectedReason)}</p>` : ""}</article>`;
}

function marketingCustomerOptions() {
  const contacts = state.marketing.contacts || [];
  return `<option value="">Select customer</option>${contacts.map((contact) => `<option value="${attr(contact.contactId)}">${esc(contact.companyName || contact.contactPerson || contact.primaryPhone || contact.contactId)}</option>`).join("")}`;
}

function messageEventOptions() {
  return ["QUOTATION_READY", "DESIGN_PROOF_READY", "DESIGN_APPROVAL_PENDING", "PAYMENT_RECEIVED", "PAYMENT_DUE", "ORDER_READY", "ORDER_DISPATCHED", "TRACKING_UPDATED", "DELIVERY_UPDATED", "LEAD_REENGAGEMENT", "CAMPAIGN_MESSAGE", "CUSTOMER_REQUEST"]
    .map((eventType) => `<option value="${eventType}">${esc(pretty(eventType))}</option>`).join("");
}

function renderDecisionResult(decision) {
  const mode = decision.mode || "DO_NOT_SEND";
  return `<div class="decision-result ${decision.allowed ? "allowed" : "blocked"}"><div><span>${esc(pretty(mode))}</span><strong>${decision.allowed ? "Allowed" : "Blocked"}</strong></div><p>${esc(decision.reason || "Policy decision completed")}</p><small>Service window: ${decision.serviceWindowOpen ? "Open" : "Closed"} · Transaction: ${decision.transactionVerified ? "Verified" : "Not verified"}</small></div>`;
}

function utilityEventFields(eventType) {
  const commonName = '<label class="field">Customer name<input name="customerName" placeholder="Name used in the template" /></label>';
  if (eventType === "QUOTATION_READY") return `${commonName}<label class="field">Quotation ID<input name="quotationId" required placeholder="Real quotation ID" /></label><div class="form-grid policy-form-grid"><label class="field">Product<input name="product" required /></label><label class="field">Amount<input name="amount" type="number" min="0" step="0.01" required /></label></div><label class="field">Quotation URL<input name="quotationUrl" type="url" required placeholder="https://..." /></label>`;
  if (["DESIGN_PROOF_READY", "DESIGN_APPROVAL_PENDING"].includes(eventType)) return `${commonName}<label class="field">Order ID<input name="orderId" required placeholder="Real order ID" /></label><label class="field">Proof URL<input name="proofUrl" type="url" required placeholder="https://..." /></label>`;
  if (eventType === "PAYMENT_RECEIVED") return `${commonName}<div class="form-grid policy-form-grid"><label class="field">Order ID<input name="orderId" required placeholder="Real order ID" /></label><label class="field">Amount received<input name="amount" type="number" min="0" step="0.01" required /></label></div>`;
  return `${commonName}<label class="field">Order ID<input name="orderId" required placeholder="Real order ID" /></label><div class="form-grid policy-form-grid"><label class="field">Courier name<input name="courierName" required /></label><label class="field">Tracking number<input name="trackingNumber" required /></label></div><label class="field">Tracking URL (optional)<input name="trackingUrl" type="url" placeholder="https://..." /></label>`;
}

function renderRepliedProspectsSection() {
  const replied = state.marketing.replied || [];
  const filter = state.marketing.replyFilter || "ALL";
  const counts = {
    ALL: replied.length,
    IMPORTANT: replied.filter((item) => item.important).length,
    HOT: replied.filter((item) => item.aiTemperature === "HOT").length,
    WARM: replied.filter((item) => item.aiTemperature === "WARM").length,
    COLD: replied.filter((item) => item.aiTemperature === "COLD").length,
    REPEAT: replied.filter((item) => item.repeatMarketing && !item.suppressed).length
  };
  const visible = replied.filter((item) => {
    if (filter === "IMPORTANT") return item.important;
    if (filter === "REPEAT") return item.repeatMarketing && !item.suppressed;
    if (["HOT", "WARM", "COLD"].includes(filter)) return item.aiTemperature === filter;
    return true;
  });
  return `<section class="panel marketing-replies-panel" id="marketing-replies-panel">
    <div class="panel-title-row"><div><p class="eyebrow">REPLIED INTERESTED CUSTOMERS</p><h3>AI priority inbox</h3><p>Campaign replies are separated here. AI assigns Hot, Warm or Cold; your team controls importance, ownership and repeat-marketing eligibility.</p></div><button class="button button-secondary" id="select-repeat-marketing" type="button" ${counts.REPEAT ? "" : "disabled"}>Select repeat list (${counts.REPEAT})</button></div>
    ${state.marketing.replyLoadError ? `<div class="compatibility-note">Replied-customer classification will appear after the backend update. The rest of Marketing remains available.</div>` : ""}
    ${state.marketing.userLoadError ? `<div class="compatibility-note">Sales-user assignment is temporarily unavailable. Campaign and customer data can still be used.</div>` : ""}
    <div class="reply-filter-bar">${["ALL", "IMPORTANT", "HOT", "WARM", "COLD", "REPEAT"].map((item) => `<button type="button" class="reply-filter ${filter === item ? "active" : ""}" data-reply-filter="${item}">${pretty(item)} <span>${counts[item]}</span></button>`).join("")}</div>
    <div class="reply-prospect-list">${visible.length ? visible.map(repliedProspectCard).join("") : '<div class="empty-state">No replied customers in this section yet.</div>'}</div>
    <p class="muted tiny-note reply-safety-note">Repeat marketing only makes the customer selectable for a future campaign. It never sends automatically, and an opt-out always overrides this setting.</p>
  </section>`;
}

function repliedProspectCard(prospect) {
  const name = prospect.companyName || prospect.contactPerson || "Unnamed customer";
  const temperature = prospect.aiTemperature || "WARM";
  const confidence = Math.round(Number(prospect.aiConfidence || 0) * 100);
  const source = prospect.classificationSource === "AI" ? `AI ${confidence}%` : "Needs AI review";
  const assignedUsers = (state.marketing.users || []).filter((user) => user.active !== false && ["OWNER", "ADMIN", "SALES_MANAGER", "SALES"].includes(user.role));
  return `<article class="reply-prospect-card ${prospect.important ? "important" : ""}">
    <div class="reply-prospect-main"><div class="reply-prospect-identity"><span class="party-avatar">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(prospect.primaryPhone || "No phone")} · ${esc(prospect.city || "City not set")} · ${esc(date(prospect.lastReplyAt))}</small></div></div><div class="reply-badges">${prospect.important ? '<span class="reply-badge important">Important</span>' : ""}<span class="reply-badge temp-${attr(temperature.toLowerCase())}">${esc(temperature)}</span><span class="reply-badge ai-source">${esc(source)}</span>${prospect.repeatMarketing ? '<span class="reply-badge repeat">Repeat</span>' : ""}${prospect.suppressed ? '<span class="reply-badge suppressed">Opted out</span>' : ""}</div></div>
    <blockquote>${esc(prospect.lastReplyText || "Customer replied to the campaign")}</blockquote>
    <p class="reply-ai-reason">${esc(prospect.aiReason || "Waiting for AI classification")}</p>
    <div class="reply-prospect-actions">
      <label>Assigned to<select class="reply-assignee" data-replied-contact="${attr(prospect.contactId)}"><option value="">Unassigned</option>${assignedUsers.map((user) => `<option value="${attr(user.userId)}" ${prospect.assignedTo === user.userId ? "selected" : ""}>${esc(user.name || user.email || user.userId)}</option>`).join("")}</select></label>
      <button type="button" class="button button-secondary reply-setting" data-replied-contact="${attr(prospect.contactId)}" data-reply-setting="important" data-reply-value="${prospect.important ? "false" : "true"}">${prospect.important ? "Remove Important" : "Mark Important"}</button>
      <button type="button" class="button button-secondary reply-setting" data-replied-contact="${attr(prospect.contactId)}" data-reply-setting="repeatMarketing" data-reply-value="${prospect.repeatMarketing ? "false" : "true"}" ${prospect.suppressed ? "disabled" : ""}>${prospect.repeatMarketing ? "Remove Repeat" : "Add to Repeat"}</button>
      ${prospect.conversationId ? `<a class="button button-primary" href="#whatsapp/${attr(prospect.conversationId)}">Open chat</a>` : ""}
    </div>
  </article>`;
}

function refreshRepliedProspectsSection() {
  const current = document.querySelector("#marketing-replies-panel");
  if (!current) return;
  current.outerHTML = renderRepliedProspectsSection();
  bindRepliedProspectEvents();
}

function bindRepliedProspectEvents() {
  document.querySelectorAll("[data-reply-filter]").forEach((button) => button.addEventListener("click", () => {
    state.marketing.replyFilter = button.dataset.replyFilter;
    refreshRepliedProspectsSection();
  }));
  document.querySelectorAll(".reply-setting").forEach((button) => button.addEventListener("click", () => {
    updateRepliedProspect(button.dataset.repliedContact, { [button.dataset.replySetting]: button.dataset.replyValue === "true" }, button);
  }));
  document.querySelectorAll(".reply-assignee").forEach((select) => select.addEventListener("change", () => {
    updateRepliedProspect(select.dataset.repliedContact, { assignedTo: select.value || null }, select);
  }));
  document.querySelector("#select-repeat-marketing")?.addEventListener("click", selectRepeatMarketingCustomers);
}

async function updateRepliedProspect(contactId, patch, control) {
  control.disabled = true;
  try {
    const { data } = await api(`/marketing/replied/${encodeURIComponent(contactId)}`, { method: "PATCH", body: patch });
    state.marketing.replied = state.marketing.replied.map((item) => item.contactId === contactId ? { ...item, ...data } : item);
    notify("Replied customer settings updated.");
    refreshRepliedProspectsSection();
  } catch (error) {
    notify(error.message, true);
    control.disabled = false;
  }
}

function selectRepeatMarketingCustomers() {
  const selectedIds = new Set(state.marketing.replied.filter((item) => item.repeatMarketing && !item.suppressed).map((item) => item.contactId));
  let selected = 0;
  document.querySelectorAll("[data-audience-contact]").forEach((checkbox) => {
    checkbox.checked = selectedIds.has(checkbox.value);
    if (checkbox.checked) selected += 1;
  });
  const label = document.querySelector("#audience-selection-count");
  if (label) label.textContent = `${selected} selected`;
  document.querySelector("#audience-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  notify(selected ? `${selected} repeat-marketing customer(s) selected.` : "Repeat customers are not in the currently loaded customer page.", !selected);
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
  const stats = { total: 0, eligible: 0, active: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0, converted: 0, suppressed: 0, ...(campaign.stats || {}) };
  return `<article class="campaign-card"><div class="campaign-main"><div><span class="status-dot status-${attr(String(campaign.status || "draft").toLowerCase())}"></span><strong>${esc(campaign.name)}</strong><small>${esc(campaign.audienceName || "Audience")} · ${esc(campaign.steps?.length || 0)} step${campaign.steps?.length === 1 ? "" : "s"} · ${esc(pretty(campaign.status))}${campaign.startAt ? ` · ${esc(dateTime(campaign.startAt))}` : ""}</small></div><div class="campaign-actions">${campaignActionButtons(campaign)}</div></div><div class="campaign-stats"><span><strong>${stats.eligible}</strong> enrolled</span><span><strong>${stats.sent}</strong> sent</span><span><strong>${stats.delivered}</strong> delivered</span><span><strong>${stats.read}</strong> read</span><span><strong>${stats.replied}</strong> replied</span><span><strong>${stats.converted}</strong> orders</span><span><strong>${stats.failed}</strong> failed</span><span><strong>${Math.max(stats.skipped, stats.suppressed)}</strong> skipped</span></div></article>`;
}

function campaignActionButtons(campaign) {
  const id = attr(campaign.campaignId);
  const button = (action, label, primary = false) => `<button class="button ${primary ? "button-primary" : "button-secondary"} campaign-action" data-campaign-action="${action}" data-campaign-id="${id}">${label}</button>`;
  if (!state.marketing.strictCampaignLifecycle) {
    const legacyActions = [button("details", "Details")];
    if (campaign.status === "DRAFT") legacyActions.push(button("launch", "Launch now", true));
    if (campaign.status === "ACTIVE") legacyActions.push(button("pause", "Pause"));
    if (campaign.status === "PAUSED") legacyActions.push(button("resume", "Resume", true));
    return legacyActions.join("");
  }
  const actions = [button("details", "Details")];
  if (campaign.status === "DRAFT") actions.push(button("submit", "Submit", true));
  if (campaign.status === "PENDING_APPROVAL") actions.push(button("approve", "Approve", true));
  if (campaign.status === "APPROVED") actions.push(button("schedule", "Schedule"), button("start", "Start now", true));
  if (campaign.status === "SCHEDULED") actions.push(button("start", "Start now", true));
  if (campaign.status === "ACTIVE") actions.push(button("pause", "Pause"));
  if (campaign.status === "PAUSED") actions.push(button("resume", "Resume", true));
  if (!["COMPLETED", "CANCELLED", "FAILED"].includes(campaign.status)) actions.push(button("cancel", "Cancel"));
  return actions.join("");
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
  document.querySelector("#sync-meta-templates")?.addEventListener("click", syncMetaTemplates);
  document.querySelector("#message-decision-form")?.addEventListener("submit", checkMessageDecision);
  document.querySelector("#utility-event-type")?.addEventListener("change", (event) => {
    document.querySelector("#utility-event-fields").innerHTML = utilityEventFields(event.target.value);
  });
  document.querySelector("#utility-event-form")?.addEventListener("submit", sendUtilityEvent);
  bindRepliedProspectEvents();
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
  if (!confirm(`Save this ${steps.length}-step marketing campaign as a draft? Only recorded opt-ins can be enrolled later.`)) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const campaignBase = state.marketing.strictCampaignLifecycle ? "/campaigns" : "/marketing/campaigns";
    await api(campaignBase, { method: "POST", body: {
      name: values.name,
      audienceId: values.audienceId,
      interestLabel: values.interestLabel,
      templateId: state.marketing.templates[0]?.id || "interest_followup",
      steps
    } });
    notify("Campaign draft saved. Submit it when it is ready for approval.");
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function changeCampaignState(button) {
  const action = button.dataset.campaignAction;
  if (action === "details") return showCampaignDetails(button.dataset.campaignId, button);
  if (action === "launch" && !confirm("Launch this draft now? Only contacts with recorded opt-in will receive it.")) return;
  if (action === "cancel" && !confirm("Cancel this campaign? Pending messages will stop.")) return;
  if (action === "start" && !confirm("Start this approved campaign now? Only eligible opted-in customers will be enrolled.")) return;
  let body = {};
  if (action === "schedule") {
    const answer = prompt("Campaign start date/time (example: 2026-07-25 10:30)", datetimeLocalValue(new Date(Date.now() + 60 * 60 * 1000)).replace("T", " "));
    if (!answer) return;
    const parsed = new Date(answer.replace(" ", "T"));
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) return notify("Choose a valid future date and time.", true);
    body = { startAt: parsed.toISOString() };
  }
  button.disabled = true;
  try {
    const campaignBase = state.marketing.strictCampaignLifecycle ? "/campaigns" : "/marketing/campaigns";
    await api(`${campaignBase}/${encodeURIComponent(button.dataset.campaignId)}/${action}`, { method: "POST", body });
    const messages = { launch: "launched", submit: "submitted for approval", approve: "approved", schedule: "scheduled", start: "started", pause: "paused", resume: "resumed", cancel: "cancelled" };
    notify(`Campaign ${messages[action] || "updated"}.`);
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
  }
}

async function syncMetaTemplates(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Syncing…";
  try {
    const { data } = await api("/whatsapp/templates/sync", { method: "POST", body: {} });
    notify(`${data.synced || 0} Meta template(s) synced.`);
    await renderMarketing();
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
    button.textContent = "Sync from Meta";
  }
}

async function checkMessageDecision(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const payload = {
    contactId: values.contactId,
    eventType: values.eventType,
    messageIntent: values.messageIntent || "CRM policy preview",
    isPromotional: values.isPromotional === "on",
    requestedByCustomer: values.eventType === "CUSTOMER_REQUEST",
    templateData: {}
  };
  for (const key of ["templateKey", "orderId", "quotationId"]) if (values[key]) payload[key] = values[key];
  const button = event.submitter;
  button.disabled = true;
  try {
    const { data } = await api("/message/decide", { method: "POST", body: payload });
    state.marketing.decision = data;
    const existing = form.parentElement.querySelector(".decision-result, .policy-helper");
    if (existing) existing.outerHTML = renderDecisionResult(data);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function sendUtilityEvent(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const type = values.eventType;
  const endpoint = ({
    QUOTATION_READY: "quotation-ready",
    DESIGN_PROOF_READY: "design-proof-ready",
    DESIGN_APPROVAL_PENDING: "design-approval-pending",
    PAYMENT_RECEIVED: "payment-received",
    ORDER_DISPATCHED: "order-dispatched"
  })[type];
  if (!endpoint) return notify("Select a supported update type.", true);
  delete values.eventType;
  Object.keys(values).forEach((key) => { if (values[key] === "") delete values[key]; });
  if (!confirm(`Verify the transaction and queue this ${pretty(type)} WhatsApp update?`)) return;
  const button = event.submitter;
  button.disabled = true;
  try {
    const { data } = await api(`/events/${endpoint}`, { method: "POST", body: values });
    notify(data.mode ? `Message ${data.queued ? "queued" : "checked"} using ${pretty(data.mode)}${data.reason ? `: ${pretty(data.reason)}` : ""}.` : "Utility message verified and queued.");
    event.currentTarget.reset();
    document.querySelector("#utility-event-fields").innerHTML = utilityEventFields("QUOTATION_READY");
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function showCampaignDetails(campaignId, button) {
  button.disabled = true;
  try {
    const campaignBase = state.marketing.strictCampaignLifecycle ? "/campaigns" : "/marketing/campaigns";
    const { data: campaign } = await api(`${campaignBase}/${encodeURIComponent(campaignId)}`);
    const enrollments = campaign.enrollments || [];
    const skipped = enrollments.filter((item) => item.suppressionReason || item.failureReason || ["SUPPRESSED", "FAILED", "SKIPPED"].includes(item.status));
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal campaign-detail-modal"><div class="modal-head"><div><p class="eyebrow">CAMPAIGN DETAIL</p><h3>${esc(campaign.name)}</h3></div><button class="modal-close" type="button" aria-label="Close">×</button></div><div class="campaign-detail-meta"><span>Status <strong>${esc(pretty(campaign.status))}</strong></span><span>Audience <strong>${esc(campaign.audienceName || "—")}</strong></span><span>Start <strong>${esc(dateTime(campaign.startAt))}</strong></span></div><h4>Skipped / failed recipients</h4>${skipped.length ? `<div class="campaign-recipient-list">${skipped.map((item) => `<div><strong>${esc(item.contactId)}</strong><span>${esc(pretty(item.suppressionReason || item.failureReason || item.status))}</span></div>`).join("")}</div>` : '<div class="empty-state">No skipped or failed recipient recorded.</div>'}<p class="muted tiny-note">${enrollments.length} total enrollment record(s).</p></div>`;
    document.body.append(backdrop);
    const close = () => backdrop.remove();
    backdrop.querySelector(".modal-close").addEventListener("click", close);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) close(); });
  } catch (error) {
    notify(error.message, true);
  } finally {
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
function dateTime(value) {
  if (!value) return "—";
  const parsed = value?._seconds ? new Date(value._seconds * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(parsed);
}
function pretty(value) { return String(value || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()); }
function initials(value) { return String(value || "RX").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
function linkify(value) {
  const text = String(value ?? "");
  const pattern = /https?:\/\/[^\s<>"']+/gi;
  let result = "";
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    result += esc(text.slice(lastIndex, match.index));
    result += `<a href="${attr(match[0])}" target="_blank" rel="noopener noreferrer">${esc(match[0])}</a>`;
    lastIndex = match.index + match[0].length;
  }
  return result + esc(text.slice(lastIndex));
}
function policyFailureMessage(reason) {
  const value = String(reason || "MESSAGE_NOT_QUEUED");
  if (value === "TRANSACTION_RECORD_NOT_VERIFIED") return "Selected order could not be verified. Select the linked order and try again.";
  if (value.startsWith("MISSING_TRANSACTION_DATA")) return "This Utility template needs a linked order and all required details.";
  if (value.startsWith("TEMPLATE_NOT_APPROVED")) return value.replace(/^TEMPLATE_NOT_APPROVED:/, "").trim();
  if (value === "DUPLICATE_SEND_BLOCKED") return "This update was already queued. Refresh the chat before sending again.";
  if (value === "SERVICE_WINDOW_CLOSED") return "The service window is closed. Use an approved Utility template.";
  return pretty(value);
}
function attr(value) { return esc(value); }
function notify(message, error = false) { toast.textContent = message; toast.className = `toast${error ? " error" : ""}`; toast.hidden = false; clearTimeout(notify.timer); notify.timer = setTimeout(() => { toast.hidden = true; }, 5000); }
function readApiError(payload) { return payload.error?.message || payload.message || "Login failed. Please try again."; }
function readSession() { try { return JSON.parse(localStorage.getItem(authKey)); } catch { return null; } }
function saveSession() { localStorage.setItem(authKey, JSON.stringify(state.session)); }
