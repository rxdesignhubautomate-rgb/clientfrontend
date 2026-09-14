import { patchMarkup, patchNode, bindLiveEvent } from "./dom-patch.mjs";
import { createChatCache } from "./chat-cache.js";
import { uiIcon, avatarStyle, inboxMatches, inboxCounts, inboxOwners } from "./inbox-style.js";
import { mountClientDirectory, openClassificationReview } from "./client-directory.mjs";
import { mountMarketingWorkspace, mountContactWorkspace } from './marketing-workspace.mjs';

const config = window.__CRM_CONFIG__ || {};
const authKey = "rx-crm-session-v1";
const WHATSAPP_POLL_INTERVAL_MS = 5_000;
const WHATSAPP_SYNC_OVERLAP_MS = 2_000;

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
document.addEventListener("visibilitychange", resumeMarketingProgress);

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
      userId: payload.data.user.userId,
      clientScope: payload.data.user.clientScope,
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
  document.querySelector('[data-route="marketing"]')?.removeAttribute("hidden");
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
  const requestSession = state.session;
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...options,
    signal: options.signal || AbortSignal.timeout(options.method && options.method !== "GET" ? 60_000 : 30_000),
    headers: {
      authorization: `Bearer ${state.session.accessToken}`,
      "content-type": "application/json",
      ...(options.headers || {})
    },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!state.session || state.session.userId !== requestSession.userId || state.session.email !== requestSession.email) throw new Error("Session changed. Please try again.");
  if (response.status === 401) logout();
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  const syncLabel = document.querySelector('.live-pill span');
  if (syncLabel) syncLabel.textContent = `Synced ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  return payload;
}

async function uploadAttachment(file, contactId, conversationId) {
  if (!state.session) throw new Error("Authentication required");
  if (Date.now() > Number(state.session.expiresAt || 0) - 60_000) await refreshSession();
  const query = new URLSearchParams({ contactId });
  if (conversationId) query.set("conversationId", conversationId);
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

async function uploadMarketingAsset(file) {
  if (!state.session) throw new Error("Authentication required");
  if (Date.now() > Number(state.session.expiresAt || 0) - 60_000) await refreshSession();
  const response = await fetch(`${config.apiBaseUrl}/attachments?purpose=MARKETING_ASSET`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${state.session.accessToken}`,
      "content-type": file.type || "application/octet-stream",
      "x-filename": encodeURIComponent(file.name || "campaign-asset.bin")
    },
    body: file
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) logout();
  if (!response.ok) throw new Error(payload.error?.message || payload.message || `Campaign media upload failed (${response.status})`);
  return payload.data;
}



async function fetchAttachmentBlob(attachmentId, { download = false } = {}) {
  const wa=state.whatsapp;
  if(download)return fetchAttachmentBlobUncached(attachmentId,{download:true});
  const hit=wa.mediaCache.get(attachmentId);
  if(hit && (hit.pending || hit.expiresAt>Date.now()))return hit.promise;
  if(hit?.blob)wa.mediaCacheBytes-=hit.blob.size;
  wa.mediaCache.delete(attachmentId);
  const entry={pending:true,expiresAt:0};
  entry.promise=fetchAttachmentBlobUncached(attachmentId).then(blob=>{
    entry.pending=false;
    if(state.whatsapp!==wa || wa.mediaCache.get(attachmentId)!==entry || blob.size>32*1024*1024){if(wa.mediaCache.get(attachmentId)===entry)wa.mediaCache.delete(attachmentId);return blob;}
    entry.blob=blob;entry.expiresAt=Date.now()+60_000;wa.mediaCacheBytes+=blob.size;
    for(const [key,item] of wa.mediaCache){
      if(wa.mediaCacheBytes<=32*1024*1024 && wa.mediaCache.size<=40)break;
      wa.mediaCache.delete(key);if(item.blob)wa.mediaCacheBytes-=item.blob.size;
    }
    return blob;
  }).catch(error=>{wa.mediaCache.delete(attachmentId);throw error;});
  wa.mediaCache.set(attachmentId,entry);
  return entry.promise;
}

async function fetchAttachmentBlobUncached(attachmentId, { download = false } = {}) {
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
  const session = state.session;
  if (refreshSession.pending?.session === session) return refreshSession.pending.promise;
  const promise = performSessionRefresh(session);
  const pending = { session, promise };
  refreshSession.pending = pending;
  try { return await promise; }
  finally { if (refreshSession.pending === pending) refreshSession.pending = null; }
}

async function performSessionRefresh(session) {
  if (!state.session?.refreshToken) {
    logout();
    throw new Error("Session expired. Please sign in again.");
  }
  const response = await fetch(`${config.apiBaseUrl}/auth/password/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ refreshToken: session.refreshToken })
  });
  const payload = await response.json().catch(() => ({}));
  if (state.session !== session) throw new Error("Session changed. Please try again.");
  if (!response.ok) {
    logout();
    throw new Error(readApiError(payload));
  }
  state.session = {
    email: payload.data.user.email,
    name: payload.data.user.name,
    role: payload.data.user.role,
    userId: payload.data.user.userId,
    clientScope: payload.data.user.clientScope,
    accessToken: payload.data.accessToken,
    refreshToken: payload.data.refreshToken,
    expiresAt: Date.now() + Number(payload.data.expiresInSeconds || 3600) * 1000
  };
  saveSession();
}

async function renderRoute() {
  stopMarketingProgress();
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
  if (base === "import" && !["OWNER", "ADMIN"].includes(state.session?.role)) {
    location.hash = "#dashboard";
    return;
  }
  document.querySelectorAll("[data-route]").forEach((link) => link.classList.toggle("active", link.dataset.route === base || (base === "client" && link.dataset.route === "clients")));
  if (base !== "whatsapp" || !state.whatsapp.cacheHydrated) page.innerHTML = '<div class="loading-card">Loading…</div>';
  try {
    if (base === "whatsapp") await renderWhatsapp(route[1]);
    else if (base === "marketing") await renderMarketing();
    else if (base === "quotations") await renderQuotations();
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
  const segment = currentClientSegment();
  const primaryLabel = segment === "PROSPECT" ? "Prospects" : segment === "EXISTING_CLIENT" ? "Existing clients" : "Existing clients";
  const primaryValue = segment === "PROSPECT" ? data.contacts : (data.existingClients ?? data.contacts);
  const scopeDescription = segment === "PROSPECT" ? "Reshu's new-client pipeline" : segment === "EXISTING_CLIENT" ? "Ankit's client operations" : `${formatCount(data.contacts)} total contact records`;
  page.innerHTML = `
    <div class="section-head"><div><h1>Good to see you.</h1><p>${esc(segmentLabel(segment))} operations at a glance.</p></div><a class="button button-primary" href="#clients">View ${segment === "PROSPECT" ? "prospects" : "clients"}</a></div>
    <div class="cards">
      ${metric(primaryLabel, primaryValue, scopeDescription, "blue")}
      ${metric("Active orders", data.activeOrders, "Currently in production", "mint")}
      ${metric("Due follow-ups", data.dueFollowUps, "Need attention", "amber")}
      ${metric("Open conversations", data.openConversations, `${data.unreadMessages} unread messages`, "blue")}
      ${metric("Active leads", data.activeLeads, segment === "PROSPECT" ? "Potential new clients" : "Separate from existing clients", "mint")}
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
  const navigation = ++wa.navigationVersion;
  rememberWhatsappConversation();
  wa.mobileChatOpen = Boolean(requestedConversationId);
  wa.cache ||= createChatCache([config.apiBaseUrl, state.session?.email, state.session?.role, state.session?.clientScope, state.session?.userId].join(":"));
  const current = () => state.whatsapp === wa && navigation === wa.navigationVersion && location.hash.startsWith('#whatsapp');
  // Paint the selected conversation from memory/disk before starting network work.
  if (requestedConversationId && wa.selectedId !== requestedConversationId) {
    discardVoiceRecording();
    wa.selectedId = requestedConversationId;
    wa.messages = []; wa.messagesConversationId=null; wa.overview = null; wa.overviewCachedAt = 0;
  }
  await hydrateWhatsappCache(requestedConversationId);
  if (!current()) return;
  renderWhatsappPage();
  ensureWhatsappMetadata();
  let refreshedId=null,progressRequest;
  const refreshSelected = async () => {
    const id = wa.selectedId;
    if (!id || !selectedConversation()) return;
    refreshedId=id;
    try {
      await loadWhatsappConversation(id, {incremental:wa.messagesConversationId === id && wa.messages.length > 0});
      if (current() && wa.selectedId === id) renderWhatsappBackground();
    } catch (error) {
      if (current()) { wa.syncState='offline'; updateWhatsappSyncBadge(); notify(error.message, true); }
    }
  };
  // Chat navigation never waits for the full inbox or template catalog.
  if (wa.fullSyncedAt || wa.inboxRequest) {
    await refreshSelected();
    if (current()) startWhatsappPolling();
    return;
  }
  const selectedRequest = refreshSelected();
  wa.syncing = true;
  wa.inboxRequest = (async () => {
    try {
      const result = await inboxAllPages('/conversations?limit=100&sortBy=updatedAt&sortOrder=asc', partial=>{
        if(state.whatsapp !== wa) return;
        wa.conversations=sortWhatsappConversations(mergeById(wa.conversations,partial.data.filter(item=>item.currentChannel==='WHATSAPP'),'conversationId'));
        if(current() && !refreshedId){
          if(!selectedConversation() && !requestedConversationId)wa.selectedId=conversationId(wa.conversations[0]);
          if(selectedConversation()){renderWhatsappPage();progressRequest=refreshSelected();}
        }
        if(location.hash.startsWith('#whatsapp'))refreshWhatsappLiveDom();
      });
      if(state.whatsapp !== wa) return;
      wa.conversations=sortWhatsappConversations(result.data.filter(item=>item.currentChannel==='WHATSAPP'));
      for(const item of wa.conversations) if(!wa.draftDirty.has(conversationId(item)))wa.drafts[conversationId(item)]=item.preferences?.draft || '';
      wa.syncedAt=asDate(result.meta?.syncStartedAt)?.getTime() || Date.now();
      wa.fullSyncedAt=Date.now();wa.syncState='live';
      const snapshot=wa.conversations.slice();
      const checkpoint=snapshot.length<=10000?{syncedAt:wa.syncedAt,fullSyncedAt:wa.fullSyncedAt}:null;
      queueWhatsappCache(wa, async()=>{
        await wa.cache?.replaceConversations?.(snapshot);
        // Persist the cutoff only when the cache retains a complete inbox.
        await wa.cache?.setMeta?.('completeInbox',checkpoint);
      });

    } catch(error) {
      if(state.whatsapp === wa){wa.syncState='offline';if(location.hash.startsWith('#whatsapp')){updateWhatsappSyncBadge();notify(error.message,true);}}
    } finally {
      wa.inboxRequest=null;wa.syncing=false;
      if(state.whatsapp===wa)startWhatsappPolling();
    }
  })();
  await Promise.all([wa.inboxRequest,selectedRequest]);
  if(progressRequest)await progressRequest;
  if(!current())return;
  if(!selectedConversation()) {
    wa.selectedId=conversationId(wa.conversations[0]);wa.messages=[];wa.overview=null;wa.messagesConversationId=null;
  }
  if(wa.selectedId !== refreshedId)await refreshSelected();
  if(current())renderWhatsappBackground();
}

function ensureWhatsappMetadata() {
  const wa=state.whatsapp;
  if(wa.metadataRequest || Date.now()-(wa.metadataAt||0)<5*60_000)return wa.metadataRequest;
  wa.metadataRequest=Promise.all([
    optionalInboxApi('/whatsapp/utility-templates',wa.templates),
    optionalInboxApi('/whatsapp/quick-replies?limit=100',wa.quickReplies),
    optionalInboxApi('/users?limit=100',wa.users),
    optionalInboxApi('/whatsapp/capabilities',wa.capabilities)
  ]).then(([templates,quickReplies,users,capabilities])=>{
    if(state.whatsapp!==wa)return;
    wa.templates=templates.data;wa.quickReplies=quickReplies.data;wa.users=users.data.filter(item=>item.active!==false);wa.capabilities=capabilities.data;
    wa.metadataAt=Date.now();
    const metadata={templates:wa.templates,quickReplies:wa.quickReplies,users:wa.users,capabilities:wa.capabilities};
    queueWhatsappCache(wa,()=>chatCacheCall(wa.cache,'setMeta','inboxMetadata',metadata));
    if(location.hash.startsWith('#whatsapp'))renderWhatsappBackground();
  }).catch(error=>console.warn('Inbox metadata unavailable',error)).finally(()=>{wa.metadataRequest=null;});
  return wa.metadataRequest;
}

function rememberWhatsappConversation() {
  const wa=state.whatsapp,id=wa.messagesConversationId;
  if(!id || wa.selectedId!==id)return;
  const messages=wa.messages.slice(-500);
  const olderCursor=wa.messages.length>500?btoa(JSON.stringify({id:messages[0].messageId || messages[0].id})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_'):wa.olderCursor;
  wa.recentChats.delete(id);
  wa.recentChats.set(id,{messages,overview:wa.overview,overviewCachedAt:wa.overviewCachedAt,olderCursor});
  while(wa.recentChats.size>30)wa.recentChats.delete(wa.recentChats.keys().next().value);
}

function queueWhatsappCache(wa,write) {
  wa.cacheWrites=(wa.cacheWrites || Promise.resolve()).then(()=>state.whatsapp===wa?write():undefined).catch(error=>console.warn('Chat cache write failed',error));
}

async function hydrateWhatsappCache(requestedConversationId) {
  const wa = state.whatsapp;
  const navigation = wa.navigationVersion;
  if (!wa.cacheHydrated) {
    const [cachedConversations, cachedSyncAt, metadata] = await Promise.all([
      chatCacheCall(wa.cache, "getConversations"),
      chatCacheCall(wa.cache, "getMeta", "completeInbox"),
      chatCacheCall(wa.cache, "getMeta", "inboxMetadata")
    ]);
    if (state.whatsapp !== wa || wa.navigationVersion !== navigation) return;
    if(metadata){wa.templates=metadata.templates||[];wa.quickReplies=metadata.quickReplies||[];wa.users=metadata.users||[];wa.capabilities=metadata.capabilities||null;}
    if (cachedConversations?.length) {
      wa.conversations = sortWhatsappConversations(mergeById(wa.conversations, cachedConversations, "conversationId"));
      wa.syncState = "cached";
    }
    if(cachedConversations?.length && cachedSyncAt?.fullSyncedAt && Date.now()-cachedSyncAt.fullSyncedAt<15*60_000) {
      wa.syncedAt=cachedSyncAt.syncedAt;wa.fullSyncedAt=cachedSyncAt.fullSyncedAt;
    }
    wa.cacheHydrated = true;
  }
  const selectedId = requestedConversationId || wa.selectedId || conversationId(wa.conversations[0]);
  if (!selectedId || !wa.conversations.some((item) => conversationId(item) === selectedId)) return;
  wa.selectedId = selectedId;
  if (wa.messagesConversationId !== selectedId) await loadCachedWhatsappConversation(selectedId);
}

async function loadCachedWhatsappConversation(id) {
  const wa = state.whatsapp;
  const navigation = wa.navigationVersion;
  const selected = wa.conversations.find((item) => conversationId(item) === id);
  if (!selected) return;
  const memory=wa.recentChats.get(id);
  if(memory){
    wa.messages=memory.messages;wa.overview=memory.overview;wa.overviewCachedAt=memory.overviewCachedAt;
    wa.olderCursor=memory.olderCursor;wa.messagesConversationId=id;selectDefaultWhatsappOrder();return;
  }
  const [messages, cachedOverview, localDraft] = await Promise.all([
    chatCacheCall(wa.cache, "getMessages", id),
    chatCacheCall(wa.cache, "getOverview", selected.contactId),
    chatCacheCall(wa.cache, "getMeta", `draft:${id}`)
  ]);
  if (state.whatsapp !== wa || wa.navigationVersion !== navigation || wa.selectedId !== id) return;
  wa.messages = messages || [];
  wa.olderCursor = wa.messages.length ? btoa(JSON.stringify({id:wa.messages[0].messageId || wa.messages[0].id})).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_') : null;
  if ((typeof localDraft === "string" || localDraft?.pending) && !Object.hasOwn(wa.drafts,id)) { wa.drafts[id] = typeof localDraft === "string" ? localDraft : localDraft.text; wa.draftDirty.add(id); }
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

async function loadWhatsappConversation(id, options = {}) {
  const wa = state.whatsapp;
  const key = `${wa.navigationVersion}:${id}`;
  if (wa.messageRequest?.key === key) return wa.messageRequest.promise;
  const promise = fetchWhatsappConversation(id, options);
  const pending = { key, promise };
  wa.messageRequest = pending;
  try { return await promise; }
  finally { if (wa.messageRequest === pending) wa.messageRequest = null; }
}

async function fetchWhatsappConversation(id, { incremental = false } = {}) {
  const wa = state.whatsapp;
  const navigation=wa.navigationVersion;
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
    const latest = Math.max(0, ...wa.messages.filter(item => !item.clientAcknowledged).map((item) => asDate(item.createdAt)?.getTime() || 0));
    if (latest) query.set("from", new Date(Math.max(0, latest - WHATSAPP_SYNC_OVERLAP_MS)).toISOString());
  }
  const overviewIsStale = !wa.overviewCachedAt || Date.now() - wa.overviewCachedAt > 5 * 60 * 1000;
  if ((!wa.overview || wa.overview.contact?.contactId !== selected.contactId || overviewIsStale)
      && wa.overviewRequest?.key !== `${navigation}:${id}`) {
    const pending = { key: `${navigation}:${id}` };
    wa.overviewRequest = pending;
    pending.promise = api(`/contacts/${encodeURIComponent(selected.contactId)}/overview`).then(result => {
      if (state.whatsapp !== wa || wa.navigationVersion !== navigation || wa.selectedId !== id) return;
      wa.overview = result.data; wa.overviewCachedAt = Date.now();
      selectDefaultWhatsappOrder(); prefillUtilityValues(false);
      queueWhatsappCache(wa, () => chatCacheCall(wa.cache, "putOverview", selected.contactId, result.data));
      rememberWhatsappConversation(); renderWhatsappBackground();
    }).catch(error => console.warn('Client overview unavailable; messages remain usable', error))
      .finally(() => { if (wa.overviewRequest === pending) wa.overviewRequest = null; });
  }
  const messageResult = await (hasBaseline ? inboxAllPages(`/conversations/${encodeURIComponent(id)}/messages?${query}`) : api(`/conversations/${encodeURIComponent(id)}/messages?${query}`));
  if (state.whatsapp !== wa || wa.navigationVersion !== navigation || wa.selectedId !== id) return [];
  if (!hasBaseline) wa.olderCursor = messageResult.pagination?.hasMore ? messageResult.pagination.nextCursor : null;
  const previous = new Map(wa.messages.map(message => [message.messageId || message.id, JSON.stringify(message)]));
  const incoming = hasBaseline ? messageResult.data : [...messageResult.data].reverse();
  const changed = incoming.filter(message => previous.get(message.messageId || message.id) !== JSON.stringify(message));
  wa.messages = (hasBaseline ? mergeById(wa.messages, incoming, "messageId") : incoming)
    .sort((left, right) => (asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0));
  wa.messagesConversationId = id;
  wa.selectedId = id;
  selectDefaultWhatsappOrder();
  syncWhatsappComposerMode({ conversationChanged: !sameConversation });
  prefillUtilityValues(false);
  if (changed.length) queueWhatsappCache(wa, () => chatCacheCall(wa.cache, "putMessages", changed));
  rememberWhatsappConversation();
  return changed;
}

function selectDefaultWhatsappOrder() {
  const wa = state.whatsapp;
  if (!wa.selectedOrderId || !wa.overview?.orders?.some((order) => order.orderId === wa.selectedOrderId)) {
    wa.selectedOrderId = wa.overview?.orders?.[0]?.orderId || null;
  }
}

function syncWhatsappComposerMode({ conversationChanged = false } = {}) {
  const wa = state.whatsapp;
  if (!whatsappWindow().open) {
    wa.mode = "TEMPLATE";
    wa.composerModeTouched = false;
    return;
  }
  if (conversationChanged || !wa.composerModeTouched) wa.mode = "TEXT";
}

function renderWhatsappPage(draftText) {
  const wa = state.whatsapp;
  const counts = inboxCounts(wa.conversations,wa);
  const selected = selectedConversation();
  draftText ??= wa.drafts[wa.selectedId] ?? selected?.preferences?.draft ?? "";
  const syncIndicator = whatsappSyncIndicator();
  const viewport = captureWhatsappViewport();
  releaseMediaObjectUrls();
  page.innerHTML = `
    <div class="wa-shell ${selected && wa.mobileChatOpen ? "mobile-chat-open" : ""} ${selected && wa.clientPanelOpen ? "client-panel-open" : ""}">
      <aside class="wa-inbox-panel" aria-label="Conversations">
        <div class="wa-inbox-tools">
          <header class="wa-inbox-heading">
            <div><h1>WhatsApp</h1><span id="wa-sync-state" class="wa-api-state ${syncIndicator.connected ? "connected" : "disconnected"}">${esc(syncIndicator.label)}</span></div>
            <div class="wa-header-actions">
              <button id="wa-toggle-filters" class="wa-icon-button" type="button" aria-label="Toggle inbox filters" aria-expanded="${!referencePreferences().filtersCollapsed}">⌃</button>
              <button id="wa-reference-refresh" class="wa-icon-button" type="button" aria-label="Sync chats">${uiIcon("refresh")}</button>
              <button id="wa-reference-settings" class="wa-icon-button" type="button" aria-label="Chat settings">⚙</button>
              <button class="wa-icon-button wa-mobile-menu" id="wa-menu-button" type="button" title="Open navigation" aria-label="Open navigation">${uiIcon("menu")}</button>
              <button class="wa-icon-button" id="wa-enable-alerts" type="button" title="Enable desktop alerts" aria-label="Enable desktop alerts">${uiIcon("bell")}</button>
              <button class="wa-icon-button" id="wa-reference-new-chat" type="button" title="Start client chat" aria-label="Start client chat">${uiIcon("plus")}</button>
            </div>
          </header>
          <div id="wa-reference-filters" ${referencePreferences().filtersCollapsed ? "hidden" : ""}><label class="wa-search-wrap">${uiIcon("search")}<span class="sr-only">Search conversations</span><input id="wa-search" class="wa-search" type="search" placeholder="Search or start a new chat" value="${attr(wa.search)}" /></label>
          <div class="wa-filters" aria-label="Filter conversations">${waFilterButton("ALL", "All", counts)}${waFilterButton("UNREAD", "Unread", counts)}${waFilterButton("READ", "Read", counts)}${waFilterButton("WINDOW", "Open", counts)}${waFilterButton("MARKETING", "Marketing replies", counts)}${waFilterButton("HOT", "Hot leads", counts)}${waFilterButton("IMPORTANT", "Favourites", counts)}</div>
          ${waQuickFilters()}
          <details class="ref-more-filters"><summary>More filters</summary><div class="wa-smart-circles" aria-label="Priority filters">${[['DUE','Due'],['CLOSING','Closing'],['HOT','Hot'],['QUOTATION','Quote'],['FOLLOWUP','Follow-up'],['ARCHIVED','Archived']].map(([key,label]) => waFilterButton(key,label, counts)).join('')}</div>
          <div class="wa-smart-sort"><label>Sort <select id="wa-smart-sort"><option value="RECENT" ${wa.sort === 'RECENT' ? 'selected' : ''}>Recent</option><option value="PRIORITY" ${wa.sort === 'PRIORITY' ? 'selected' : ''}>Connect next</option></select></label><button id="wa-smart-refresh" type="button">Refresh</button></div>
          </details><div class="wa-inbox-counts" id="wa-inbox-counts" aria-live="polite">${waInboxSummary(counts)}</div></div>
        </div>
        <div class="wa-conversation-list" id="wa-conversation-list">${waConversationList()}</div>
      </aside>
      <div id="wa-reference-resizer" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize conversation list"></div>
      ${selected ? whatsappChatMarkup(selected, draftText) : `<section class="wa-no-chat"><div class="wa-empty-icon">${uiIcon("chat")}</div><h3>No WhatsApp conversation yet</h3><p>Open a client profile and choose <strong>Open WhatsApp</strong>. Choose a relevant approved template when the reply window is closed.</p><a class="button button-primary" href="#clients">Choose a client</a></section>`}
    </div>`;
  bindWhatsappEvents();
  bindReferenceWhatsapp();
  if (selected) {
    requestAnimationFrame(() => {
      restoreWhatsappViewport(viewport, conversationId(selected));
      installWhatsappMediaScrollStability(document.querySelector("#wa-message-list"));
    });
    markSelectedConversationRead();
  }
}

function whatsappChatMarkup(conversation, draftText) {
  const wa = state.whatsapp;
  const contact = wa.overview?.contact || conversation.contact || {};
  const name = contact.companyName || contact.contactPerson || contact.primaryPhone || "WhatsApp client";
  const windowStatus = whatsappWindow();
  const important = (contact.tags || []).includes("IMPORTANT");
  return `
    <section class="wa-chat-panel" data-chat-conversation-id="${attr(conversationId(conversation))}">
      <header class="wa-chat-head">
        <a class="wa-mobile-back" href="#whatsapp" aria-label="Back to conversations">${uiIcon("back")}</a><div class="wa-chat-person"><span class="wa-avatar" style="${avatarStyle(name)}">${esc(initials(name))}</span><div><strong>${esc(name)}</strong><small>${esc(contact.primaryPhone || "No phone")} · ${esc(contact.city || "")}</small></div></div>
        <div class="wa-chat-actions">
          <span class="wa-window ${windowStatus.open ? "open" : "closed"}">${windowStatus.open ? `Free reply · ${esc(windowStatus.remaining)}` : "Approved template required"}</span>
          ${contact.primaryPhone ? `<a class="wa-icon-button" href="tel:+${attr(contact.primaryPhone)}" title="Call customer" aria-label="Call customer">${uiIcon("phone")}</a>` : ""}
          <button id="wa-create-quotation" class="button button-secondary" type="button">Quotation</button>
          <button id="wa-reference-search" class="wa-icon-button" type="button" aria-label="Search this conversation">${uiIcon("search")}</button>
          <button class="wa-icon-button wa-details-button" id="wa-toggle-client-panel" type="button" title="Client workspace" aria-label="Client workspace" aria-expanded="${wa.clientPanelOpen}" aria-controls="wa-client-workspace">${uiIcon("info")}</button>
          <button class="wa-icon-button ${important ? "important" : ""}" id="wa-toggle-important" title="${important ? "Remove Important" : "Mark Important"}">${uiIcon("star")}</button>
          <button class="wa-icon-button" id="wa-toggle-status" title="${conversation.status === "CLOSED" ? "Reopen" : "Close"} conversation">${uiIcon(conversation.status === "CLOSED" ? "refresh" : "check")}</button>
        </div>
      </header>
      <details class="ref-chat-tools" ${wa.messageSearch || wa.starredOnly ? "open" : ""}><summary>Chat tools</summary>${smartChatToolbar()}</details>
      <div class="wa-message-list" id="wa-message-list">
        ${whatsappMessagesMarkup()}
      </div>
      ${waComposer(windowStatus, draftText)}
    </section>
    <aside id="wa-client-workspace" aria-label="Client workspace" class="wa-order-panel ${wa.clientPanelOpen ? "open" : ""}">${waOrderPanel(contact)}</aside>`;
}

function waComposer(windowStatus, draftText) {
  const wa = state.whatsapp;
  const template = selectedUtilityTemplate();
  const templateHeader = template?.header || null;
  const visibleTemplates = utilityTemplatesForSelectedContact();
  const useText = wa.mode === "TEXT" && windowStatus.open;
  const quoted = wa.messages.find((item) => item.messageId === wa.replyToMessageId);
  const approvedTemplateAvailable = visibleTemplates.length > 0;
  return `<div class="wa-composer reference-composer">
    ${useText ? `<form id="wa-composer-form" class="wa-text-composer">
      ${quoted ? `<div class="wa-replying"><div><small>Replying to ${quoted.direction === "INBOUND" ? "customer" : "team"}</small><p>${esc(quoted.text || pretty(quoted.type))}</p></div><button id="wa-cancel-reply" type="button">×</button></div>` : ""}
      <div class="wa-input-row">
        <details class="ref-attachment-menu"><summary aria-label="Attach a file">${uiIcon("plus")}</summary><div class="ref-attachment-options">
          <label class="wa-tool-button">${uiIcon("clip")} Attach files<input id="wa-attachment-input" class="sr-only" type="file" multiple accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf" /></label>
          <button class="wa-tool-button" id="wa-share-location" type="button">${uiIcon("pin")} Share location</button>
          <button class="wa-tool-button" id="wa-share-contact" type="button">${uiIcon("people")} Share contact</button>
          <button class="wa-tool-button" id="wa-interactive-buttons" type="button">${uiIcon("bolt")} Reply buttons</button>
          <button class="wa-tool-button" id="wa-add-internal-note" type="button">${uiIcon("note")} Internal note</button>
        </div></details>
        <button class="wa-tool-button" id="wa-reference-emoji" type="button" aria-label="Choose emoji">☺</button>
        <button class="wa-tool-button" id="wa-reference-photos" type="button" aria-label="Attach photos and videos">${uiIcon("image")}</button>
        <textarea id="wa-message-input" rows="1" maxlength="4096" placeholder="Type a message or / shortcut…">${esc(draftText)}</textarea>
        <button class="wa-tool-button ${wa.recording ? "recording" : ""}" id="wa-record-audio" type="button" aria-label="${wa.recording ? "Stop recording" : "Record voice note"}">${wa.recording ? "■" : uiIcon("mic")}</button>
        <button class="wa-send-button" type="submit" title="Send message" aria-label="Send message">${uiIcon("send")}</button>
      </div>
      <div class="ref-composer-footer"><select id="wa-quick-reply" aria-label="Quick replies"><option value="">Quick replies</option>${wa.quickReplies.map(item => `<option value="${attr(item.quickReplyId)}">${esc(item.shortcut)} · ${esc(item.title)}</option>`).join("")}<option value="__CREATE__">+ Add custom quick reply</option></select><button id="wa-save-quick-reply" type="button">Save quick reply</button><button data-wa-mode="TEMPLATE" type="button">Templates</button><button id="wa-reference-suggest" type="button">Suggest reply</button></div>
    </form>` : `<div class="wa-compose-tabs"><button data-wa-mode="TEXT" ${windowStatus.open ? "" : "disabled"}>Reply</button><button data-wa-mode="TEMPLATE" class="active">Approved template</button><small>${windowStatus.open ? "Customer replied within 24 hours" : "Normal reply is locked outside 24 hours"}</small></div>
      <form id="wa-composer-form" class="wa-template-composer">
        <div class="wa-template-row"><label>Approved Utility template<select id="wa-template-select" ${approvedTemplateAvailable ? "" : "disabled"}>${visibleTemplates.map((item) => `<option value="${attr(item.id)}" ${item.id === template?.id ? "selected" : ""}>${esc(item.label)} · ${esc(pretty(item.approvalStatus || "Approved"))}</option>`).join("")}</select></label>
          <label>Related order<select id="wa-template-order"><option value="">Select order</option>${(wa.overview?.orders || []).map((order) => `<option value="${attr(order.orderId)}" ${order.orderId === wa.selectedOrderId ? "selected" : ""}>${esc(orderReference(order))} · ${esc(pretty(order.status))}</option>`).join("")}</select></label></div>
        ${approvedTemplateAvailable
          ? `<div class="wa-template-fields">${(template?.variables || []).map((field) => `<label>${esc(field.label)}<input data-template-field="${attr(field.key)}" value="${attr(wa.templateValues[field.key] || "")}" required /></label>`).join("")}</div>
            ${templateHeader?.type ? `<label class="wa-template-media">${esc(pretty(templateHeader.type))} header ${templateHeader.required ? "(required)" : "(optional)"}<input id="wa-template-header-file" type="file" accept="${attr(templateHeaderAccept(templateHeader.type))}" ${templateHeader.required ? "required" : ""} /><small id="wa-template-header-name">${wa.utilityHeaderFile ? esc(wa.utilityHeaderFile.name) : `Upload the order-specific ${String(templateHeader.type).toLowerCase()} approved for this template.`}</small></label>` : ""}
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
      ${smartClientControls()}
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
  const items = smartSort(wa.conversations.filter((item) => inboxMatches(item, wa)));
  if (!items.length) return '<div class="wa-no-results">No matching conversations.</div>';
  return items.slice(0,wa.listLimit).map((item) => {
    const contact = item.contact || {};
    const name = contact.companyName || contact.contactPerson || contact.primaryPhone || "WhatsApp client";
    const active = conversationId(item) === wa.selectedId;
    return `<button class="wa-conversation ${active ? "active" : ""} ${Number(item.unreadCount || 0) > 0 ? "unread" : ""}" data-conversation-id="${attr(conversationId(item))}" aria-label="Open chat with ${attr(name)}" ${active ? 'aria-current="true"' : ""}><span class="wa-avatar" style="${avatarStyle(name)}">${esc(initials(name))}</span><span class="wa-conversation-copy"><span><strong>${esc(name)}</strong><time>${esc(shortTime(item.lastMessageAt))}</time>${referenceReplyTimer(item)}</span><small>${item.preferences?.pinned ? "📌 " : ""}${item.preferences?.muted ? "🔕 " : ""}${esc(item.lastMessagePreview || "No messages yet")}</small>${referenceChatHint(item)}</span>${Number(item.unreadCount || 0) ? `<b>${esc(item.unreadCount)}</b>` : ""}</button>`;
  }).join("") + (items.length>wa.listLimit ? `<button id="wa-load-more-chats" class="wa-load-older" type="button">Show more chats (${formatCount(items.length-wa.listLimit)} remaining)</button>` : "");
}

function waMessage(message, visibleIds = null) {
  const internal = message.direction === "INTERNAL";
  const outbound = message.direction === "OUTBOUND";
  const status = outbound ? messageStatusMarkup(message.status, message.errorCode, message.errorMessage) : "";
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
  return `<div class="wa-message-row ${outbound ? "outbound" : internal ? "internal" : "inbound"}" data-message-row="${attr(message.messageId)}" ${(visibleIds ? visibleIds.has(message.messageId) : smartVisibleMessages().some(item => item.messageId === message.messageId)) ? "" : "hidden"}>
    <div class="wa-bubble">
      ${quoted ? `<div class="wa-quoted"><small>${quoted.direction === "INBOUND" ? "Customer" : "RX team"}</small><p>${esc(quoted.text || `[${pretty(quoted.type)}]`)}</p></div>` : ""}
      ${body}
      <span class="wa-message-meta"><time>${esc(shortTime(message.createdAt))}</time>${status}</span>
      ${message.type === "TEMPLATE" ? `<em>${esc(pretty(message.metadata?.templateCategory || "TEMPLATE"))}</em>` : ""}
      ${message.status === "DELIVERY_UNKNOWN" ? '<div class="wa-message-error">Delivery uncertain · check provider before resending</div>' : ""}
      ${message.status === "FAILED" ? `<div class="wa-message-error"><strong>Send failed</strong><span>${esc(message.errorMessage || message.errorCode || "WhatsApp rejected this message.")}</span><button data-retry-message="${attr(message.messageId)}" type="button">Retry</button></div>` : ""}
      <div class="wa-message-tools"><button data-star-message="${attr(message.messageId)}" type="button" aria-label="Star message">${selectedConversation()?.preferences?.starredMessageIds?.includes(message.messageId) ? '★' : '☆'}</button>${message.text ? `<button data-copy-message="${attr(message.messageId)}" type="button">Copy</button><button data-use-message="${attr(message.messageId)}" type="button">Use as draft</button>` : ''}</div>
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
  bindLiveEvent(document.querySelector("#wa-create-quotation"), "binding-54764", "click",openCurrentQuotation);
  bindSmartInbox();
  bindLiveEvent(document.querySelector("#wa-search"), "binding-54884", "input", (event) => {
    state.whatsapp.search = event.target.value;
    state.whatsapp.listLimit=100;
    refreshWhatsappLiveDom();
  });
  bindLiveEvent(document.querySelector(".wa-inbox-tools"), "binding-55086", "click", (event) => {
    const filterButton = event.target.closest("[data-wa-filter]");
    const ownerButton = event.target.closest("[data-wa-owner]");
    if (filterButton) state.whatsapp.filter = filterButton.dataset.waFilter;
    else if (ownerButton) state.whatsapp.ownerFilter = state.whatsapp.ownerFilter === ownerButton.dataset.waOwner ? "" : ownerButton.dataset.waOwner;
    else return;
    refreshWhatsappLiveDom();
  });
  bindLiveEvent(document.querySelector("#wa-label-filter"), "binding-55590", "change", (event) => {
    state.whatsapp.tagFilter = event.target.value;
    refreshWhatsappLiveDom();
  });
  bindLiveEvent(document.querySelector("#wa-menu-button"), "binding-55767", "click", () => document.querySelector(".sidebar").classList.toggle("open"));
  bindConversationRows();
  document.querySelectorAll("[data-wa-mode]").forEach((button) => bindLiveEvent(button, "binding-55998", "click", () => {
    state.whatsapp.mode = button.dataset.waMode;
    state.whatsapp.composerModeTouched = true;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  }));
  bindLiveEvent(document.querySelector("#wa-template-select"), "binding-56231", "change", (event) => {
    state.whatsapp.templateId = event.target.value;
    state.whatsapp.templateValues = {};
    state.whatsapp.utilityHeaderFile = null;
    prefillUtilityValues(true);
    renderWhatsappPage();
  });
  bindLiveEvent(document.querySelector("#wa-sync-templates"), "binding-56528", "click", syncUtilityTemplates);
  bindLiveEvent(document.querySelector("#wa-template-order"), "binding-56626", "change", (event) => {
    state.whatsapp.selectedOrderId = event.target.value || null;
    state.whatsapp.templateValues = {};
    state.whatsapp.utilityHeaderFile = null;
    prefillUtilityValues(true);
    renderWhatsappPage();
  });
  document.querySelectorAll("[data-template-field]").forEach((input) => bindLiveEvent(input, "binding-57005", "input", () => {
    state.whatsapp.templateValues[input.dataset.templateField] = input.value;
    const preview = document.querySelector(".wa-template-preview p");
    if (preview) preview.textContent = renderUtilityPreview(selectedUtilityTemplate(), state.whatsapp.templateValues);
  }));
  bindLiveEvent(document.querySelector("#wa-template-header-file"), "binding-57326", "change", (event) => {
    const file = event.target.files?.[0] || null;
    state.whatsapp.utilityHeaderFile = file;
    const label = document.querySelector("#wa-template-header-name");
    if (label) label.textContent = file?.name || "No file selected";
  });
  bindLiveEvent(document.querySelector("#wa-composer-form"), "binding-57666", "submit", sendWhatsappMessage);
  bindLiveEvent(document.querySelector("#wa-toggle-status"), "binding-57763", "click", toggleConversationStatus);
  bindLiveEvent(document.querySelector("#wa-toggle-client-panel"), "binding-57864", "click", () => {
    state.whatsapp.clientPanelOpen = !state.whatsapp.clientPanelOpen;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  bindLiveEvent(document.querySelector("#wa-close-client-panel"), "binding-58113", "click", () => {
    state.whatsapp.clientPanelOpen = false;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  bindLiveEvent(document.querySelector("#wa-toggle-important"), "binding-58335", "click", toggleImportantContact);
  bindLiveEvent(document.querySelector("#wa-enable-alerts"), "binding-58437", "click", enableDesktopAlerts);
  bindLiveEvent(document.querySelector("#wa-quick-reply"), "binding-58533", "change", selectQuickReply);
  bindLiveEvent(document.querySelector("#wa-attachment-input"), "binding-58625", "change", sendSelectedAttachment);
  bindWhatsappMessageEvents();
  bindLiveEvent(document.querySelector("#wa-record-audio"), "binding-58760", "click", toggleVoiceRecording);
  bindLiveEvent(document.querySelector("#wa-share-location"), "binding-58856", "click", shareCurrentLocation);
  bindLiveEvent(document.querySelector("#wa-share-contact"), "binding-58954", "click", shareContactCard);
  bindLiveEvent(document.querySelector("#wa-interactive-buttons"), "binding-59047", "click", sendInteractiveButtons);
  bindLiveEvent(document.querySelector("#wa-add-internal-note"), "binding-59152", "click", addInternalNote);
  bindLiveEvent(document.querySelector("#wa-cancel-reply"), "binding-59248", "click", () => {
    state.whatsapp.replyToMessageId = null;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  });
  bindLiveEvent(document.querySelector("#wa-assignee"), "binding-59464", "change", assignConversation);
  bindLiveEvent(document.querySelector("#wa-add-tag"), "binding-59555", "click", addContactTag);
  document.querySelectorAll("[data-remove-tag]").forEach((button) => bindLiveEvent(button, "binding-59706", "click", () => removeContactTag(button.dataset.removeTag)));
  bindLiveEvent(document.querySelector("#wa-save-notes"), "binding-59794", "click", saveCustomerNotes);
  bindLiveEvent(document.querySelector("#wa-create-followup"), "binding-59885", "click", createWhatsappFollowup);
  document.querySelectorAll("[data-order-status]").forEach((select) => bindLiveEvent(select, "binding-60055", "change", updateOrderStatus));
  document.querySelectorAll("[data-select-order]").forEach((card) => bindLiveEvent(card, "binding-60180", "click", (event) => {
    if (event.target.closest("select,button")) return;
    state.whatsapp.selectedOrderId = card.dataset.selectOrder;
    prefillUtilityValues(true);
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
  }));
  document.querySelectorAll("[data-prepare-template]").forEach((button) => bindLiveEvent(button, "binding-60544", "click", () => {
    state.whatsapp.mode = "TEMPLATE";
    state.whatsapp.composerModeTouched = true;
    state.whatsapp.templateId = button.dataset.prepareTemplate;
    state.whatsapp.selectedOrderId = button.dataset.orderId;
    state.whatsapp.templateValues = {};
    state.whatsapp.utilityHeaderFile = null;
    prefillUtilityValues(true);
    renderWhatsappPage();
  }));
}

function bindWhatsappMessageEvents() {
  bindWhatsappOlderMessages();
  bindSmartMessageTools();
  bindMediaEvents();
  document.querySelectorAll("[data-reply-message]").forEach((button) => bindLiveEvent(button, "binding-61154", "click", () => {
    state.whatsapp.replyToMessageId = button.dataset.replyMessage;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    document.querySelector("#wa-message-input")?.focus();
  }));
  document.querySelectorAll("[data-react-message]").forEach((button) => bindLiveEvent(button, "binding-61486", "click", () => {
    sendReaction(button.dataset.reactMessage, button.dataset.reactEmoji, button);
  }));
  document.querySelectorAll("[data-retry-message]").forEach((button) => bindLiveEvent(button, "binding-61691", "click", () => {
    retryWhatsappMessage(button.dataset.retryMessage, button);
  }));
}

function bindMediaEvents() {
  document.querySelectorAll("[data-retry-media]").forEach((button) => bindLiveEvent(button, "binding-61910", "click", () => {
    retryWhatsappMedia(button.dataset.retryMedia, button);
  }));
  document.querySelectorAll("[data-media-open]").forEach((button) => bindLiveEvent(button, "binding-62089", "click", () => {
    openProtectedAttachment(button.dataset.mediaOpen, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-media-preview]").forEach((button) => bindLiveEvent(button, "binding-62301", "click", () => {
    openImageViewer(button.dataset.mediaPreview, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-media-download]").forEach((button) => bindLiveEvent(button, "binding-62509", "click", () => {
    downloadProtectedAttachment(button.dataset.mediaDownload, button.dataset.mediaName, button);
  }));
  document.querySelectorAll("[data-protected-media]").forEach((element) => {
    bindLiveEvent(element, "binding-62739", "error", () => hydrateProtectedMedia(element), { once: true });
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
  bindLiveEvent(document.querySelector('#wa-load-more-chats'), "binding-67915", 'click',()=>{state.whatsapp.listLimit+=100;refreshWhatsappLiveDom();});
  document.querySelectorAll("[data-conversation-id]").forEach((button) => bindLiveEvent(button, "binding-68126", "click", () => {
    saveSmartDraft();
    state.whatsapp.messageSearch = ""; state.whatsapp.starredOnly = false;
    state.whatsapp.clientPanelOpen = false;
    state.whatsapp.composerModeTouched = false;
    location.hash = `#whatsapp/${button.dataset.conversationId}`;
  }));
}

async function sendWhatsappMessage(event) {
  event.preventDefault();
  const wa = state.whatsapp;
  const sendingId = wa.selectedId;
  const sendingOrderId = wa.selectedOrderId;
  const button = event.submitter;
  wa.sendingConversations ||= new Set();
  if (wa.sendingConversations.has(sendingId)) return;
  wa.sendingConversations.add(sendingId);
  const typedAtSubmit = document.querySelector('#wa-message-input')?.value || '';
  button.disabled = true;
  try {
    let body;
    if (wa.mode === 'TEXT' && !whatsappWindow().open) throw new Error('The reply window has closed. Select a relevant approved template before sending.');
    if (wa.mode === "TEXT" && whatsappWindow().open) {
      const text = document.querySelector("#wa-message-input").value.trim();
      if (!text) return;
      body = { type: "TEXT", text, replyToMessageId: wa.replyToMessageId || null };
    } else {
      const template = selectedUtilityTemplate();
      if (!template) throw new Error("Sync and select an approved Utility template first.");
      if (!wa.selectedOrderId) throw new Error("Select the related CRM order before sending this Utility update.");
      document.querySelectorAll("[data-template-field]").forEach((input) => { wa.templateValues[input.dataset.templateField] = input.value.trim(); });
      const headerFile = wa.utilityHeaderFile;
      if (template.header?.required && !headerFile) throw new Error(`Upload the required ${String(template.header.type || "media").toLowerCase()} for this approved template.`);
      if (!template.header && headerFile) throw new Error("The selected Utility template does not accept header media.");
      if (headerFile && !fileMatchesTemplateHeader(headerFile, template.header?.type)) {
        throw new Error(`Select a valid ${String(template.header?.type || "media").toLowerCase()} file.`);
      }
      let attachmentIds = [];
      if (headerFile) {
        button.textContent = "Uploading video...";
        const attachment = await uploadAttachment(headerFile, wa.overview.contact.contactId, sendingId);
        attachmentIds = [attachment.attachmentId || attachment.id];
        button.textContent = "Queueing update...";
      }
      body = { type: "TEMPLATE", utilityTemplateId: template.id, templateVariables: wa.templateValues, attachmentIds };
    }
    const { data: sendResult } = await api(`/conversations/${encodeURIComponent(sendingId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": smartSendKey(sendingId,body) },
      body: body.type === "TEMPLATE"
        ? { ...body, templateVariables: { ...body.templateVariables, order_id: sendingOrderId || "" } }
        : body
    });
    if (sendResult?.queued !== true && sendResult?.sent !== true) {
      throw new Error(policyFailureMessage(sendResult?.reason));
    }
    if (state.whatsapp !== wa) return;
    delete wa.pendingSends[sendingId];
    const input = sendingId === wa.selectedId ? document.querySelector('#wa-message-input') : null;
    const unchanged = input ? input.value === typedAtSubmit : (wa.drafts[sendingId] || '') === typedAtSubmit;
    if (unchanged) {
      clearTimeout(wa.draftTimers[sendingId]); wa.drafts[sendingId] = '';
      if (input) input.value = '';
      // Save through the ordered preference queue; do not block the next reply.
      saveSmartPreference({ draft: '' }, sendingId).catch(() => {});
    }
    if (sendingId !== wa.selectedId) { notify("Message queued in the original conversation."); return; }
    wa.replyToMessageId = null; wa.utilityHeaderFile = null;
    document.querySelector('.wa-replying')?.remove();
    if (sendResult.messageId && body.type === 'TEXT') {
      const queued = { messageId: sendResult.messageId, conversationId: sendingId, direction: 'OUTBOUND', type: 'TEXT', text: body.text, status: sendResult.sent ? 'SENT' : 'QUEUED', createdAt: new Date().toISOString(), clientAcknowledged: true, replyToMessageId: body.replyToMessageId };
      if (!wa.messages.some(message => message.messageId === queued.messageId)) wa.messages = mergeById(wa.messages, [queued], 'messageId');
      // This is a server-acknowledged queue item, not a delivery confirmation.
      renderWhatsappBackground();
    }
    if (sendResult.messageId) refreshWhatsappMessage(sendResult.messageId).then(message => {
      if (state.whatsapp === wa && wa.selectedId === sendingId && message) renderWhatsappBackground();
    }).catch(error => console.warn('Queued message will refresh on next sync', error));
    notify(body.type === "TEMPLATE" ? "Utility update queued for WhatsApp." : "Message queued for WhatsApp.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    wa.sendingConversations.delete(sendingId);
    if (document.body.contains(button)) {
      button.disabled = false;
      if (button.classList.contains("wa-send-template")) button.textContent = "Send Utility update";
    }
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
    saveSmartDraft();
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
  const files = Array.from(event.target.files || []).slice(0, 10);
  event.target.value = "";
  event.target.accept = "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.rtf";
  previewReferenceAttachments(files, document.querySelector("#wa-message-input")?.value.trim() || "");
}

async function sendAttachmentFile(file, caption = "") {
  const wa = state.whatsapp;
  const sendingId = wa.selectedId;
  const replyToMessageId = wa.replyToMessageId || null;
  const conversation = selectedConversation();
  if (!conversation || !wa.overview?.contact?.contactId) return false;
  if (!whatsappWindow().open) {
    notify("Media can be sent as a normal reply only while the 24-hour service window is open.", true);
    return false;
  }
  const kind = messageTypeForFile(file);
  notify(`Uploading ${file.name || pretty(kind)}…`);
  try {
    const attachment = await uploadAttachment(file, wa.overview.contact.contactId, sendingId);
    if (state.whatsapp !== wa || !state.session) return false;
    const { data: queued } = await api(`/conversations/${encodeURIComponent(sendingId)}/messages`, {
      method: "POST",
      headers: { "idempotency-key": `${sendingId}-media-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      body: {
        type: kind,
        text: kind === "AUDIO" ? "" : caption,
        attachmentIds: [attachment.attachmentId],
        replyToMessageId
      }
    });
    if (!queued?.queued && !queued?.sent) throw new Error(policyFailureMessage(queued?.reason));
    if (sendingId !== wa.selectedId) { notify("Attachment queued in the original conversation."); return true; }
    wa.replyToMessageId = null;
    await loadWhatsappConversation(sendingId, { incremental: true });
    renderWhatsappPage();
    notify(`${pretty(kind)} queued for WhatsApp.`);
    return true;
  } catch (error) {
    notify(error.message, true);
    return false;
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
  const recordingConversationId = wa.selectedId;
  if (wa.voiceBusy) { notify('Please wait for the voice preview.'); return; }
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
  let stream;
  wa.voiceBusy = true;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
    if (state.whatsapp !== wa || wa.selectedId !== recordingConversationId || !state.session || !location.hash.startsWith('#whatsapp')) { stream.getTracks().forEach(track => track.stop()); return; }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data?.size) chunks.push(event.data);
    });
    recorder.addEventListener("stop", async () => {
      clearTimeout(wa.recordingTimeout);
      stream.getTracks().forEach((track) => track.stop());
      const mimeType = recorder.mimeType || "audio/webm";
      const file = new File(chunks, `voice-note-${Date.now()}.webm`, { type: mimeType });
      const discard = wa.discardRecording || wa.selectedId !== recordingConversationId || !state.session || !location.hash.startsWith("#whatsapp");
      wa.recording = false;
      wa.discardRecording = false;
      wa.mediaRecorder = null;
      wa.mediaStream = null;
      if (discard) return;
      renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
      wa.voiceBusy = true;
      try {
        notify('Preparing voice preview…');
        const encoded = await encodeReferenceVoice(file);
        if (state.whatsapp === wa && wa.selectedId === recordingConversationId && state.session && location.hash.startsWith('#whatsapp')) previewReferenceAttachments([encoded]);
      } catch (error) { notify(`Voice encoding failed: ${error.message}. You can attach an audio file instead.`, true); }
      finally { wa.voiceBusy = false; }
    });
    recorder.start();
    wa.recordingTimeout = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 120000);
    wa.recording = true;
    wa.mediaRecorder = recorder;
    wa.mediaStream = stream;
    renderWhatsappPage(document.querySelector("#wa-message-input")?.value || "");
    notify("Recording voice note… click Stop when finished.");
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    notify(error.message || "Microphone permission was not granted.", true);
  } finally { wa.voiceBusy = false; }
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
  if (!dueAt || new Date(dueAt).getTime() <= Date.now()) {
    notify("Select a future follow-up date and time.", true);
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
    state.whatsapp.fullSyncedAt = null;
    selectedConversation().nextFollowUpAt = data.followUps.filter(f=>f.status === "SCHEDULED").sort((a,b)=>asDate(a.dueAt)-asDate(b.dueAt))[0]?.dueAt || null;
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
  const wa = state.whatsapp, id = wa.selectedId;
  if (window.matchMedia("(max-width: 680px)").matches && !wa.mobileChatOpen) return;
  if (!id || selectedConversation()?.preferences?.manualUnread) return;
  wa.readRequests ||= new Map(); wa.readRetryAt ||= new Map();
  if (wa.readRequests.has(id) || Date.now() < (wa.readRetryAt.get(id) || 0)) return;
  const unread = [...wa.messages].reverse().find(item => item.direction === "INBOUND" && item.status !== "READ");
  if (!unread) return;
  const readIds = new Set(wa.messages.filter(item => item.direction === 'INBOUND').map(item => item.messageId));
  wa.readRequests.set(id, unread.messageId);
  try {
    const result = await api(`/messages/${encodeURIComponent(unread.messageId)}/mark-read`, { method: "POST", body: {} });
    if (state.whatsapp !== wa || wa.selectedId !== id) return;
    wa.messages.filter(item => readIds.has(item.messageId)).forEach(item => { item.status = "READ"; });
    const conversation = selectedConversation();
    const arrivedAfterRequest = wa.messages.filter(item => item.direction === 'INBOUND' && !readIds.has(item.messageId) && item.status !== 'READ').length;
    if (conversation) conversation.unreadCount = Math.max(Number(result.data?.conversationUnreadCount || 0), arrivedAfterRequest);
    wa.readRetryAt.delete(id);
    refreshWhatsappLiveDom();
  } catch { wa.readRetryAt.set(id, Date.now() + 30_000); }
  finally { wa.readRequests.delete(id); }
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
    const selectedId = wa.selectedId;
    const selectedRefresh = selectedId ? loadWhatsappConversation(selectedId, { incremental: true })
      .then(incoming => {
        if (state.whatsapp === wa && wa.selectedId === selectedId && location.hash.startsWith('#whatsapp') && incoming.length) {
          renderWhatsappBackground();
          if (incoming.some(item => item.direction === 'INBOUND')) markSelectedConversationRead();
        }
        return incoming;
      }).catch(error => { console.warn('Selected chat refresh failed', error); return []; }) : Promise.resolve([]);
    const from = new Date(Math.max(0, Number(wa.syncedAt || syncStartedAt) - WHATSAPP_SYNC_OVERLAP_MS)).toISOString();
    const full = !wa.fullSyncedAt || syncStartedAt - wa.fullSyncedAt > 15 * 60_000;
    const result = await inboxAllPages(full ? "/conversations?limit=100&sortBy=updatedAt&sortOrder=asc" : `/conversations?limit=100&from=${encodeURIComponent(from)}&sortBy=updatedAt&sortOrder=asc`);
    if (state.whatsapp !== wa) return;
    const whatsappUpdates = result.data.filter((item) => item.currentChannel === "WHATSAPP");
    for (const item of whatsappUpdates) if (!wa.draftDirty.has(conversationId(item))) wa.drafts[conversationId(item)] = item.preferences?.draft || "";
    const previousConversations = new Map(wa.conversations.map(item => [conversationId(item), JSON.stringify(item)]));
    const changedConversations = whatsappUpdates.filter(item => previousConversations.get(conversationId(item)) !== JSON.stringify(item));
    const selectedChanged = changedConversations.some((item) => conversationId(item) === wa.selectedId);
    const newlyUnread = whatsappUpdates.filter((item) => Number(item.unreadCount || 0) > Number(previousUnread.get(conversationId(item)) || 0));
    wa.conversations = sortWhatsappConversations(full ? whatsappUpdates : mergeById(wa.conversations, whatsappUpdates, "conversationId"));
    if (full) {
      wa.fullSyncedAt = syncStartedAt;
      const ids=new Set(wa.conversations.map(conversationId));
      for(const id of wa.recentChats.keys())if(!ids.has(id))wa.recentChats.delete(id);
    }
    if (wa.selectedId && !selectedConversation()) { wa.selectedId = null; wa.messages = []; wa.overview = null; renderWhatsappPage(); }
    const incoming = await selectedRefresh;
    if (state.whatsapp !== wa) return;
    const markerUpdates = selectedChanged
      ? await refreshChangedMessageMarkers(changedConversations, new Set(incoming.map((item) => item.messageId || item.id)))
      : [];
    wa.syncedAt = asDate(result.meta?.syncStartedAt)?.getTime() || syncStartedAt;
    wa.syncState = "live";
    const snapshot=wa.conversations.slice();
    const checkpoint=snapshot.length<=10000?{syncedAt:wa.syncedAt,fullSyncedAt:wa.fullSyncedAt}:null;
    queueWhatsappCache(wa,async()=>{
      await wa.cache?.[full?'replaceConversations':'putConversations']?.(full?snapshot:changedConversations);
      await wa.cache?.setMeta?.('completeInbox',checkpoint);
    });
    refreshWhatsappLiveDom();
    if (selectedChanged || markerUpdates.length) renderWhatsappBackground();
    if (incoming.some((item) => item.direction === "INBOUND")) markSelectedConversationRead();
    if (newlyUnread.length) showInboundNotification(newlyUnread[0]);
    updateSmartReminders();
  } catch (error) {
    wa.syncState = "offline";
    updateWhatsappSyncBadge();
    console.warn("WhatsApp inbox refresh failed", error);
  } finally {
    wa.syncing = false;
    if(state.whatsapp===wa)startWhatsappPolling();
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
  const wa = state.whatsapp, navigation = wa.navigationVersion;
  const message = (await api(`/messages/${encodeURIComponent(messageId)}`)).data;
  if (state.whatsapp !== wa || navigation !== wa.navigationVersion || !message || message.conversationId !== wa.selectedId) return null;
  if (cacheOnly) return message;
  state.whatsapp.messages = mergeById(state.whatsapp.messages, [message], "messageId")
    .sort((left, right) => (asDate(left.createdAt)?.getTime() || 0) - (asDate(right.createdAt)?.getTime() || 0));
  await chatCacheCall(state.whatsapp.cache, "putMessages", [message]);
  return message;
}

function refreshWhatsappLiveDom({ messagesChanged = false } = {}) {
  updateWhatsappSyncBadge();
  updateWhatsappFilterCounts();
  const list = document.querySelector("#wa-conversation-list");
  if (list) {
    const listViewport = captureScrollAnchor(list, ".wa-conversation", "conversationId");
    patchMarkup(list, waConversationList());
    bindConversationRows();
    restoreScrollAnchor(list, listViewport, ".wa-conversation", "conversationId");
  }
  if (messagesChanged) renderWhatsappBackground();
}

// Background responses must not replace an editor while the user is typing.
// Keeping the original node also preserves selection, undo and IME composition.
function renderWhatsappBackground() {
  if (!location.hash.startsWith('#whatsapp')) return;
  const wa = state.whatsapp;
  const panel = document.querySelector('[data-chat-conversation-id]');
  if (!panel || panel.dataset.chatConversationId !== wa.selectedId) { renderWhatsappPage(); return; }
  const selected = selectedConversation();
  if (!selected) return;
  const viewport = captureWhatsappViewport();
  const draft = document.querySelector('#wa-message-input')?.value ?? wa.drafts[wa.selectedId] ?? '';
  const desired = document.createElement('template');
  desired.innerHTML = whatsappChatMarkup(selected, draft);
  patchNode(panel, desired.content.querySelector('[data-chat-conversation-id]'), {skip: node => wa.recording && node.nodeType === 1 && node.classList.contains('wa-composer')});
  const workspace = document.querySelector('#wa-client-workspace');
  if (workspace) patchNode(workspace, desired.content.querySelector('#wa-client-workspace'));
  bindWhatsappEvents();
  bindReferenceWhatsapp();
  pruneWhatsappMediaObjectUrls();
  restoreWhatsappViewport(viewport, wa.selectedId);
  installWhatsappMediaScrollStability(document.querySelector('#wa-message-list'));
}

function pruneWhatsappMediaObjectUrls() {
  const used = new Set([...document.querySelectorAll('[data-protected-media]')].map(node => node.src));
  state.whatsapp.mediaObjectUrls = state.whatsapp.mediaObjectUrls.filter(url => {
    if (used.has(url)) return true;
    URL.revokeObjectURL(url); return false;
  });
}

function whatsappMessagesMarkup() {
  const wa = state.whatsapp;
  const visibleIds = new Set(smartVisibleMessages().map(message => message.messageId));
  return `<div class="wa-day-chip">Conversation history</div>${wa.olderCursor ? '<button class="wa-load-older" id="wa-load-older" type="button">Load earlier messages</button>' : ""}
    ${wa.messages.length ? wa.messages.map(message => waMessage(message, visibleIds)).join("") : '<div class="wa-chat-empty">No messages yet. Use a Utility template to start this conversation.</div>'}`;
}

// eslint-disable-next-line no-unused-vars -- Exercised by the isolated inbox DOM regression harness.
function refreshWhatsappMessagesDom() {
  const body = document.querySelector('#wa-message-list');
  if (!body) return;
  const viewport = captureWhatsappViewport();
  patchMarkup(body, whatsappMessagesMarkup());
  pruneWhatsappMediaObjectUrls();
  bindWhatsappMessageEvents();
  const count = document.querySelector('#wa-search-match-count');
  if (count && count.textContent !== `${smartVisibleMessages().length} messages`) count.textContent = `${smartVisibleMessages().length} messages`;
  restoreWhatsappViewport(viewport, state.whatsapp.selectedId);
  installWhatsappMediaScrollStability(body);
}

function bindWhatsappOlderMessages() {
  bindLiveEvent(document.querySelector('#wa-load-older'), "binding-103182", 'click', async event => {
    const wa = state.whatsapp;
    try {
    const id = wa.selectedId; event.currentTarget.disabled = true;
    const { data, pagination } = await api(`/conversations/${encodeURIComponent(id)}/messages?limit=100&sortOrder=desc&cursor=${encodeURIComponent(wa.olderCursor)}`);
    if (id !== wa.selectedId) return;
    wa.messages = mergeById(wa.messages,data,'messageId').sort((a,b) => asDate(a.createdAt) - asDate(b.createdAt));
    wa.olderCursor = pagination?.hasMore ? pagination.nextCursor : null;
    await chatCacheCall(wa.cache,'putMessages',data); renderWhatsappBackground();
    } catch (error) { notify(error.message, true); event.currentTarget?.removeAttribute('disabled'); }
  });
}

function captureWhatsappViewport() {
  const list = document.querySelector("#wa-conversation-list");
  const body = document.querySelector("#wa-message-list");
  const panel = document.querySelector("[data-chat-conversation-id]");
  return {
    conversationId: panel?.dataset.chatConversationId || null,
    list: captureScrollAnchor(list, ".wa-conversation", "conversationId"),
    messages: captureMessageViewport(body)
  };
}

function restoreWhatsappViewport(viewport, selectedId) {
  const list = document.querySelector("#wa-conversation-list");
  const body = document.querySelector("#wa-message-list");
  restoreScrollAnchor(list, viewport?.list, ".wa-conversation", "conversationId");
  if (!body) return;
  if (!viewport?.messages || viewport.conversationId !== selectedId) {
    body.scrollTop = body.scrollHeight;
    return;
  }
  restoreMessageViewport(body, viewport.messages);
}

function captureMessageViewport(body) {
  if (!body) return null;
  const distanceFromBottom = Math.max(0, body.scrollHeight - body.scrollTop - body.clientHeight);
  const anchor = captureScrollAnchor(body, "[data-message-row]", "messageRow");
  return {
    ...anchor,
    atBottom: distanceFromBottom <= 80,
    distanceFromBottom,
    scrollTop: body.scrollTop
  };
}

function restoreMessageViewport(body, viewport) {
  if (!body || !viewport) return;
  if (viewport.atBottom) {
    body.scrollTop = body.scrollHeight;
    return;
  }
  if (restoreScrollAnchor(body, viewport, "[data-message-row]", "messageRow")) return;
  body.scrollTop = Math.max(0, body.scrollHeight - body.clientHeight - viewport.distanceFromBottom);
}

function captureScrollAnchor(scroller, selector, datasetKey) {
  if (!scroller) return null;
  const scrollerTop = scroller.getBoundingClientRect().top;
  const elements = [...scroller.querySelectorAll(selector)];
  const anchor = elements.find((element) => element.getBoundingClientRect().bottom > scrollerTop + 1);
  return {
    id: anchor?.dataset?.[datasetKey] || null,
    offset: anchor ? anchor.getBoundingClientRect().top - scrollerTop : 0,
    scrollTop: scroller.scrollTop
  };
}

function restoreScrollAnchor(scroller, viewport, selector, datasetKey) {
  if (!scroller || !viewport) return false;
  const anchor = viewport.id
    ? [...scroller.querySelectorAll(selector)].find((element) => element.dataset?.[datasetKey] === viewport.id)
    : null;
  if (!anchor) {
    scroller.scrollTop = viewport.scrollTop || 0;
    return false;
  }
  const scrollerTop = scroller.getBoundingClientRect().top;
  scroller.scrollTop += anchor.getBoundingClientRect().top - scrollerTop - viewport.offset;
  return true;
}

function installWhatsappMediaScrollStability(body) {
  if (!body) return;
  body.__waScrollCleanup?.();
  let viewport = captureMessageViewport(body);
  let frame = null;
  const rememberViewport = () => {
    viewport = captureMessageViewport(body);
  };
  const settleMedia = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      restoreMessageViewport(body, viewport);
      rememberViewport();
      frame = null;
    });
  };
  body.addEventListener("scroll", rememberViewport, { passive: true });
  const media = [...body.querySelectorAll("img, video, audio")];
  media.forEach((element) => {
    element.addEventListener("load", settleMedia, { once: true });
    element.addEventListener("loadedmetadata", settleMedia, { once: true });
  });
  body.__waScrollCleanup = () => {
    if (frame) cancelAnimationFrame(frame);
    body.removeEventListener("scroll", rememberViewport);
    media.forEach((element) => {
      element.removeEventListener("load", settleMedia);
      element.removeEventListener("loadedmetadata", settleMedia);
    });
  };
}

function updateWhatsappSyncBadge() {
  const badge = document.querySelector("#wa-sync-state");
  if (!badge) return;
  const indicator = whatsappSyncIndicator();
  if (badge.textContent !== indicator.label) badge.textContent = indicator.label;
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
  if (conversation.preferences?.muted) return;
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
  const available = utilityTemplatesForSelectedContact();
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
  const conversation = selectedConversation();
  const inboundAt = asDate(conversation?.lastInboundAt);
  const expiresAt = inboundAt ? new Date(inboundAt.getTime() + 86400000) : asDate(conversation?.customerServiceWindow?.expiresAt);
  const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : 0;
  return { open: remainingMs > 0, expiresAt, remaining: remainingMs > 0 ? compactDuration(remainingMs) : "Closed" };
}

function selectedConversation() { return state.whatsapp.conversations.find((item) => conversationId(item) === state.whatsapp.selectedId) || null; }
function selectedUtilityTemplate() {
  const available = utilityTemplatesForSelectedContact();
  return available.find((item) => item.id === state.whatsapp.templateId) || available[0] || null;
}
function utilityTemplatesForSelectedContact() {
  const wa = state.whatsapp;
  const contact = wa.overview?.contact || selectedConversation()?.contact || {};
  return wa.templates.filter((item) => (
    item.approved !== false
    && (item.id !== "order_confirmation" || contact.relationshipType === "EXISTING_CLIENT")
  ));
}
function conversationId(item) { return item?.conversationId || item?.id || null; }
function waFilterButton(value, label, counts) {
  const wa = state.whatsapp;
  const count = (counts || inboxCounts(wa.conversations, wa))[value];
  return `<button type="button" data-wa-filter="${value}" class="${wa.filter === value ? "active" : ""}" aria-pressed="${wa.filter === value}">${label}<span class="wa-filter-count">${formatCount(count)}</span></button>`;
}

function waQuickFilters() {
  const wa = state.whatsapp;
  const tags = [...new Set(wa.conversations.flatMap(item => item.contact?.tags || []))].sort();
  if (wa.tagFilter && !tags.includes(wa.tagFilter)) tags.push(wa.tagFilter);
  const owners = inboxOwners(wa.users);
  return `<div class="wa-compact-filters"><select id="wa-label-filter" class="wa-label-filter" aria-label="Filter by client tag"><option value="">All labels</option>${tags.map(tag => `<option value="${attr(tag)}" ${wa.tagFilter === tag ? "selected" : ""}>${esc(pretty(tag))}</option>`).join("")}</select>
    ${owners.length ? `<div class="wa-owner-filters" role="group" aria-label="Quick owner filters">${owners.map(owner => `<button class="wa-mini-filter" type="button" data-wa-owner="${attr(owner.id)}" title="${attr(owner.name)}" aria-label="Filter by ${attr(owner.name)}" aria-pressed="${wa.ownerFilter === owner.id}">${esc(owner.initial)}</button>`).join("")}</div>` : ""}</div>`;
}

function waInboxSummary(counts) {
  const wa = state.whatsapp;
  counts ||= inboxCounts(wa.conversations, wa);
  const shown = wa.conversations.filter(item => inboxMatches(item, wa)).length;
  return `<span>${formatCount(shown)} of ${formatCount(wa.conversations.length)} loaded chats</span><span><strong>${formatCount(counts.messages)}</strong> unread messages</span>`;
}

function updateWhatsappFilterCounts() {
  const wa = state.whatsapp;
  const counts = inboxCounts(wa.conversations, wa);
  document.querySelectorAll("[data-wa-filter]").forEach(button => {
    const active = button.dataset.waFilter === wa.filter;
    button.classList.toggle("active", active);
    if (button.getAttribute("aria-pressed") !== String(active)) button.setAttribute("aria-pressed", String(active));
    const count = button.querySelector(".wa-filter-count");
    if (count && count.textContent !== formatCount(counts[button.dataset.waFilter])) count.textContent = formatCount(counts[button.dataset.waFilter]);
  });
  document.querySelectorAll("[data-wa-owner]").forEach(button => { const value = String(button.dataset.waOwner === wa.ownerFilter); if (button.getAttribute("aria-pressed") !== value) button.setAttribute("aria-pressed", value); });
  const summary = document.querySelector("#wa-inbox-counts");
  if (summary) patchMarkup(summary, waInboxSummary(counts));
}
function orderReference(order) { return order.orderNumber || `ORD-${String(order.orderId || "").slice(-8).toUpperCase()}`; }
function suggestedTemplate(status) { return ({ CONFIRMED: "order_confirmation", DESIGN_READY: "design_ready", DISPATCHED: "dispatch_update", DELIVERED: "order_delivered" })[status] || null; }
function orderStatusOptions(current) { return current && !ORDER_STATUSES.includes(current) ? [current, ...ORDER_STATUSES] : ORDER_STATUSES; }
function renderUtilityPreview(template, values) { return template ? template.variables.reduce((text, field, index) => text.replaceAll(`{{${index + 1}}}`, values[field.key] || `{{${index + 1}}}`), template.body) : ""; }
function templateHeaderAccept(type) {
  return ({ IMAGE: "image/*", VIDEO: "video/*", DOCUMENT: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv" })[String(type || "").toUpperCase()] || "";
}
function fileMatchesTemplateHeader(file, type) {
  const expected = String(type || "").toUpperCase();
  if (expected === "IMAGE") return String(file?.type || "").startsWith("image/");
  if (expected === "VIDEO") return String(file?.type || "").startsWith("video/");
  if (expected === "DOCUMENT") return Boolean(file);
  return false;
}
function messageStatusMarkup(status, errorCode = null, errorMessage = null) {
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
    const reason = deliveryHoldReason(errorCode, errorMessage);
    const title = reason ? `${label} · ${reason}` : label;
    return `<span class="wa-delivery-status ${normalized.toLowerCase()}" role="img" aria-label="${attr(title)}" title="${attr(title)}"><span class="wa-status-clock"></span><span class="wa-status-label">${esc(label)}</span></span>`;
  }
  if (["FAILED", "CANCELLED", "DELIVERY_UNKNOWN"].includes(normalized)) {
    return `<span class="wa-delivery-status failed" role="img" aria-label="${attr(label)}" title="${attr(label)}">!</span>`;
  }
  const paths = normalized === "SENT"
    ? '<path d="M2 7.2 5.2 10.2 12.8 2.6"></path>'
    : '<path d="M1.5 7.2 4.6 10.2 9.5 5.2"></path><path d="M6.8 7.2 9.8 10.2 15.8 3.2"></path>';
  return `<span class="wa-delivery-status ${normalized.toLowerCase()}" role="img" aria-label="${attr(label)}" title="${attr(label)}"><svg viewBox="0 0 18 13" aria-hidden="true">${paths}</svg></span>`;
}
function deliveryHoldReason(code, message) {
  const labels = {
    MARKETING_PAUSED: "Marketing is paused",
    CAMPAIGN_PAUSED: "Campaign is paused",
    QUIET_HOURS: "Waiting for business hours",
    ENROLLMENT_NOT_READY: "Preparing recipient",
    ROLLOUT_REVIEW_REQUIRED: "Rollout review required",
    RECIPIENT_OUTSIDE_ROLLOUT_ALLOWLIST: "Recipient is outside the approved rollout",
    SENDER_PERMISSION_REVOKED: "Sender permission needs review",
    SUPPRESSED: "Recipient is suppressed",
    PERMISSION_UNKNOWN: "Marketing permission needs review",
    CONTENT_EXPIRED_OR_REVOKED: "Approved content needs review",
    TEMPLATE_CHANGED_REVIEW_REQUIRED: "Template changed; review required",
    SNAPSHOT_MISMATCH: "Batch snapshot changed; review required"
  };
  const known = labels[String(code || "").toUpperCase()];
  if (known) return known;
  const text = String(message || "").trim();
  return text.length > 0 && text.length <= 140 ? text : "Waiting for the sender or worker";
}
function shortTime(value) { const parsed = asDate(value); return parsed ? new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(parsed) : ""; }
function asDate(value) { if (!value) return null; if (value._seconds) return new Date(value._seconds * 1000); const parsed = new Date(value); return Number.isNaN(parsed.getTime()) ? null : parsed; }
function compactDuration(ms) { const hours = Math.floor(ms / 3_600_000); const minutes = Math.max(0, Math.floor((ms % 3_600_000) / 60_000)); return `${hours}h ${minutes}m left`; }
function fileSize(bytes) { const value = Number(bytes || 0); if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 ** 2).toFixed(1)} MB`; }
function mergeById(current, incoming, field) { const map = new Map(current.map((item) => [item[field] || item.id, item])); incoming.forEach((item) => map.set(item[field] || item.id, { ...(map.get(item[field] || item.id) || {}), ...item })); return [...map.values()]; }
function sortWhatsappConversations(items) {
  return [...items].sort((left, right) => (asDate(right.lastMessageAt)?.getTime() || 0) - (asDate(left.lastMessageAt)?.getTime() || 0));
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
    navigationVersion:0,recentChats:new Map(),cacheWrites:Promise.resolve(),inboxRequest:null,listLimit:100,mediaCache:new Map(),mediaCacheBytes:0,
    drafts: {}, draftDirty: new Set(), draftTimers: {}, preferenceWrites: {}, pendingSends: {}, messageSearch: "", starredOnly: false, sort: "RECENT", olderCursor: null, fullSyncedAt: null, reminderKeys: new Set(),
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
    mobileChatOpen: false,
    ownerFilter: "",
    tagFilter: "",
    selectedId: null,
    messagesConversationId: null,
    overview: null,
    overviewCachedAt: 0,
    filter: "ALL",
    search: "",
    mode: "TEXT",
    composerModeTouched: false,
    templateId: null,
    templateValues: {},
    utilityHeaderFile: null,
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
    contacts: [], orders: [], utilityBatchContacts: [], audiences: [], campaigns: [], templates: [], replied: [], users: [],
    metaTemplates: [], configuredTemplates: [], templateLoadError: null, replyLoadError: null, userLoadError: null, utilityClientLoadError: null,
    strictCampaignLifecycle: false, replyFilter: "ALL", decision: null, utilityBatchResult: null, utilityBatchIndex: 0
  };
}

function currentClientSegment() {
  const scope = state.session?.clientScope;
  if (scope === "EXISTING_CLIENT" || scope === "PROSPECT") return scope;
  const email = String(state.session?.email || "").toLowerCase();
  if (email === "ankit@rxdesignhub.com") return "EXISTING_CLIENT";
  if (email === "reshu@rxdesignhub.com") return "PROSPECT";
  return "ALL";
}

function segmentLabel(segment = currentClientSegment()) {
  if (segment === "EXISTING_CLIENT") return "Existing clients";
  if (segment === "PROSPECT") return "Prospects";
  return "All customers";
}



const ORDER_STATUSES = ["CONFIRMED", "IN_DESIGN", "DESIGN_READY", "IN_PRODUCTION", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED"];

async function renderMarketing() {
  stopMarketingProgress();
  pageTitle.textContent = "Marketing";
  page.innerHTML = '<div class="empty-state">Loading your batches…</div>';
  try {
    const { data: capabilities } = await api('/marketing-workspace/capabilities');
    if (location.hash !== '#marketing') return;
    if (capabilities.enabled) return mountMarketingWorkspace({ page, api, capabilities, notify, uploadAsset: uploadMarketingAsset, onLegacyPreview: showSimpleCampaignPreview,
      attachmentUrl: async id => (await api(`/attachments/${encodeURIComponent(id)}`)).data.signedUrl,
      active: () => location.hash === '#marketing' && Boolean(state.session) });
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const [summary, audiences, campaigns] = await Promise.all([
    optionalMarketingApi("/marketing/summary"),
    loadAllBatchPages("/marketing/audiences?limit=100"),
    loadAllBatchPages("/campaigns?limit=100")
  ]);
  if (location.hash && location.hash !== "#marketing") return;
  state.marketing = { ...freshMarketingState(), audiences: audiences.data, campaigns: campaigns.data, strictCampaignLifecycle: true };
  const counts = summary.error ? null : summary.data;
  const sorted = [...campaigns.data].sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const history = sorted.filter(item => ["COMPLETED", "CANCELLED", "FAILED"].includes(item.status));
  const active = sorted.filter(item => !history.includes(item));
  page.innerHTML = `<div class="simple-marketing">
    <div class="section-head"><div><h1>Marketing</h1><p>Your contacts. Your batches. Preview before sending.</p></div><div class="simple-header-actions"><a class="button button-secondary" href="#whatsapp">View replies</a><button class="button button-secondary" id="refresh-marketing">Refresh</button></div></div>
    <div class="simple-marketing-metrics">
      ${miniStat("Total contacts", counts ? formatCount(counts.totalContacts) : "—")}
      ${miniStat("Replied", counts ? formatCount(counts.replied) : "—")}
      ${miniStat("Opted out", counts ? formatCount(counts.optedOut) : "—")}
    </div>
    <p class="muted simple-count-note">Replied counts unique contacts with a recorded marketing reply. Opted-out contacts are excluded from sending.${counts?.calculatedAt ? ` Counts updated ${esc(shortTime(counts.calculatedAt))}; refresh within 30 seconds may reuse these counts.` : ''}</p>
    ${summary.error ? '<div class="form-error">Contact counts could not load. Deploy the updated backend, then refresh.</div>' : ""}
    <section class="panel"><div class="panel-title-row"><div><h3>Your batches</h3><p>Open a batch to check the message and video.</p></div><span class="count-pill">${active.length} batches</span></div>
      ${campaigns.error || audiences.error ? `<div class="form-error">Some batches could not load completely. ${esc(campaigns.error || audiences.error)}</div>` : ""}
      <p id="marketing-progress-sync" class="muted tiny-note">Batch progress updates automatically.</p>
      <div class="campaign-list">${active.map(simpleCampaignCard).join("") || '<div class="empty-state">No pending batches.</div>'}</div>
    </section>
    ${history.length ? `<details class="panel simple-history"><summary>Past & cancelled batches · ${history.length}</summary><div class="campaign-list">${history.map(simpleCampaignCard).join("")}</div></details>` : ""}
  </div>`;
  document.querySelector("#refresh-marketing").addEventListener("click", renderMarketing);
  document.querySelectorAll("[data-preview-batch]").forEach(button => button.addEventListener("click", () => showSimpleCampaignPreview(button.dataset.previewBatch, button)));
  startMarketingProgress();
}

function batchProgress(campaign, audienceCount) {
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const stats = campaign.stats || {};
  const total = number(stats.total) || number(audienceCount);
  const queued = number(stats.sent);
  // Provider failures can overlap queued/completed. Never add failed to sent.
  const processed = number(stats.total) > 0
    ? Math.min(total, Math.max(0, number(stats.total) - number(stats.active) - number(stats.waiting))) : 0;
  const percent = total ? Math.min(processed < total ? 99 : 100, Math.round(processed / total * 100)) : 0;
  const status = String(campaign.status || 'DRAFT').toUpperCase();
  const labels = { DRAFT:'Not started', PENDING_APPROVAL:'Awaiting approval', APPROVED:'Ready to send', SCHEDULED:'Scheduled', PAUSED:'Paused', CANCELLED:'Cancelled', FAILED:'Stopped with errors', COMPLETED:'Batch processed' };
  const label = labels[status] || (number(stats.waiting) && !number(stats.active) ? 'Waiting for replies…' : processed === total && total ? 'Messages queued' : 'Sending messages…');
  return { total, processed, percent, queued, failed:number(stats.failed), label, stopped:['CANCELLED','FAILED'].includes(status) };
}

function batchProgressMarkup(campaign, count) {
  const p = batchProgress(campaign, count);
  return `<div class="batch-progress-box ${p.stopped ? 'is-stopped' : ''}"><div class="batch-progress-heading"><strong>${esc(p.label)}</strong><b>${formatCount(p.processed)} / ${p.total ? formatCount(p.total) : '—'}</b></div><div class="batch-progress-track" role="progressbar" aria-label="Batch processing progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p.percent}" aria-valuetext="${p.processed} of ${p.total} contacts processed"><span style="width:${p.percent}%"></span></div><small>${p.percent}% processed · ${formatCount(p.queued)} queued · ${formatCount(p.failed)} failed</small></div>`;
}

function simpleBatchStats(campaign) {
  return `<span><strong>${formatCount(campaign.stats?.delivered || 0)}</strong> delivered</span><span><strong>${formatCount(campaign.stats?.read || 0)}</strong> read</span><span><strong>${formatCount(campaign.stats?.replied || 0)}</strong> replied</span>`;
}

function simpleCampaignCard(campaign) {
  const audience = state.marketing.audiences.find(item => item.audienceId === campaign.audienceId);
  const count = audience?.contactCount ?? campaign.stats?.total;
  return `<article class="campaign-card simple-batch-card" data-batch-card="${attr(campaign.campaignId)}"><div class="campaign-main"><div><strong>${esc(campaign.name)}</strong><small>${count == null ? "Contact count unavailable" : `${formatCount(count)} contacts`} <span>·</span> <span data-batch-status>${esc(pretty(campaign.status))}</span></small></div><button class="button button-primary" data-preview-batch="${attr(campaign.campaignId)}">Preview</button></div><div data-batch-progress>${batchProgressMarkup(campaign, count)}</div><div class="simple-batch-stats">${simpleBatchStats(campaign)}</div></article>`;
}

function stopMarketingProgress() {
  if (state.marketing?.progressTimer) clearTimeout(state.marketing.progressTimer);
  if (state.marketing) {
    state.marketing.progressTimer = null;
    state.marketing.progressGeneration = (state.marketing.progressGeneration || 0) + 1;
  }
}

function resumeMarketingProgress() {
  stopMarketingProgress();
  if (!document.hidden && location.hash === '#marketing') startMarketingProgress();
}

function startMarketingProgress(delay = 5000) {
  const marketing = state.marketing;
  if (!marketing || marketing.progressLoading || marketing.progressTimer || document.hidden || !state.session || location.hash !== '#marketing') return;
  const generation = marketing.progressGeneration;
  marketing.progressTimer = setTimeout(async () => {
    marketing.progressTimer = null; marketing.progressLoading = true;
    let nextDelay = 5000;
    try {
      const result = await loadAllBatchPages('/campaigns?limit=100');
      if (state.marketing !== marketing || marketing.progressGeneration !== generation || document.hidden || location.hash !== '#marketing' || !state.session) return;
      if (result.error) throw new Error(result.error);
      marketing.campaigns = result.data;
      const campaigns = new Map(result.data.map(item => [item.campaignId, item]));
      document.querySelectorAll('[data-batch-card]').forEach(card => {
        const campaign = campaigns.get(card.dataset.batchCard);
        if (!campaign) return;
        const count = marketing.audiences.find(item => item.audienceId === campaign.audienceId)?.contactCount;
        card.querySelector('[data-batch-progress]').innerHTML = batchProgressMarkup(campaign, count);
        card.querySelector('[data-batch-status]').textContent = pretty(campaign.status);
        card.querySelector('.simple-batch-stats').innerHTML = simpleBatchStats(campaign);
      });
      const note = document.querySelector('#marketing-progress-sync');
      if (note) note.textContent = `Progress updated ${shortTime(new Date())} · queued messages may still be awaiting delivery.`;
    } catch {
      nextDelay = 15000;
      const note = document.querySelector('#marketing-progress-sync');
      if (note && state.marketing === marketing) note.textContent = 'Progress refresh failed. Retrying shortly…';
    } finally {
      marketing.progressLoading = false;
      if (state.marketing === marketing) startMarketingProgress(nextDelay);
    }
  }, delay);
}

async function showSimpleCampaignPreview(campaignId, button) {
  button.disabled = true;
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal simple-preview-modal" role="dialog" aria-modal="true" aria-labelledby="batch-preview-title"><div class="modal-head"><h3 id="batch-preview-title">Batch preview</h3><button class="modal-close" type="button" aria-label="Close preview">×</button></div><div class="simple-preview-content">Loading preview…</div></div>`;
  document.body.append(backdrop);
  const urls = [];
  const close = () => {
    backdrop.querySelectorAll("video,audio").forEach(media => { media.pause(); media.removeAttribute("src"); media.load(); });
    backdrop.remove(); urls.forEach(url => URL.revokeObjectURL(url));
    document.removeEventListener("keydown", escape); window.removeEventListener("hashchange", close);
    button.disabled = false; if (button.isConnected) button.focus();
  };
  const escape = event => {
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const focusable = [...backdrop.querySelectorAll('button:not(:disabled),select,a[href],video[controls],audio[controls]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  };
  document.addEventListener("keydown", escape);
  window.addEventListener("hashchange", close);
  backdrop.querySelector(".modal-close").addEventListener("click", close);
  backdrop.addEventListener("click", event => { if (event.target === backdrop) close(); });
  backdrop.querySelector(".modal-close").focus();
  const content = backdrop.querySelector(".simple-preview-content");
  try {
    const { data } = await api(`/marketing/campaigns/${encodeURIComponent(campaignId)}/preview`);
    if (!backdrop.isConnected) return;
    const campaign = data.campaign;
    backdrop.querySelector("#batch-preview-title").textContent = campaign.name;
    const variants = data.steps.flatMap((step, index) => step.variants.map(variant => ({ ...variant, step: index + 1, delay: step.delayMinutes })));
    if (!variants.length) throw new Error("This batch has no message to preview.");
    const multiple = variants.length > 1;
    content.innerHTML = `<p class="muted">${formatCount(data.contactCount)} contacts · ${esc(pretty(campaign.status))}</p>
      ${multiple ? `<label class="field" for="batch-preview-variant">Message preview<select id="batch-preview-variant">${variants.map((variant, index) => `<option value="${index}">${data.steps.length > 1 ? `Step ${variant.step} · ` : ""}${esc(variant.label)}</option>`).join("")}</select></label>` : ""}
      <p class="muted tiny-note simple-sample-hint"></p>
      ${multiple ? '<p class="muted tiny-note">Clients who replied in the last 24 hours can receive the recent-reply message. Other clients receive the template.</p>' : ""}
      <div class="simple-message-stage"></div>
      <p class="muted tiny-note">Preview shows the current saved content. Previously sent messages are in the <a href="#whatsapp">WhatsApp Inbox</a>.</p>
      <div class="simple-preview-actions">${campaignActionButtons(campaign)}</div>`;
    content.querySelector('[data-campaign-action="details"]')?.remove();
    content.querySelector('[data-campaign-action="schedule"]')?.remove();
    const actionLabels = { submit: "Submit for approval", approve: "Approve batch", start: "Send this batch", cancel: "Cancel batch" };
    content.querySelectorAll(".campaign-action").forEach(actionButton => {
      actionButton.textContent = actionLabels[actionButton.dataset.campaignAction] || actionButton.textContent;
      actionButton.addEventListener("click", async () => { if (await changeCampaignState(actionButton)) close(); });
    });
    let renderId = 0;
    const mediaCache = new Map();
    const renderVariant = async index => {
      const ticket = ++renderId;
      const variant = variants[index];
      content.querySelector(".simple-sample-hint").textContent = variant.templateName
        ? '“Customer” is an example; each recipient gets their saved name.' : 'This is the saved message for this batch.';
      const stage = content.querySelector(".simple-message-stage");
      stage.querySelectorAll("video,audio").forEach(media => media.pause());
      stage.innerHTML = `<div class="simple-message-bubble"><div class="simple-preview-media"></div><p>${esc(variant.text || "")}</p><small>${esc(variant.templateName || "Message")}${variant.delay ? ` · After ${variant.delay} minutes` : ""}</small></div>`;
      const target = stage.querySelector(".simple-preview-media");
      if (!variant.mediaRequired && !variant.attachmentIds.length) target.innerHTML = '<small class="muted">No media attached</small>';
      if (variant.mediaRequired && !variant.attachmentIds.length) target.innerHTML = '<p class="form-error">Required template media is missing.</p>';
      for (const id of variant.attachmentIds) {
        const holder = document.createElement("div"); holder.textContent = "Loading attached media…"; target.append(holder);
        try {
          if (!mediaCache.has(id)) mediaCache.set(id, fetchAttachmentBlob(id).then(blob => {
            if (!backdrop.isConnected) return null;
            const url = URL.createObjectURL(blob); urls.push(url); return { url, type: blob.type };
          }));
          const media = await mediaCache.get(id);
          if (!media || ticket !== renderId || !backdrop.isConnected) return;
          holder.innerHTML = "";
          if (media.type.startsWith("video/") || media.type.startsWith("audio/")) {
            const player = document.createElement(media.type.startsWith("video/") ? "video" : "audio");
            player.src = media.url; player.controls = true; player.preload = "metadata"; holder.append(player);
            player.addEventListener("error", () => { holder.textContent = "This media could not be played in your browser."; });
          } else if (media.type.startsWith("image/")) {
            const image = document.createElement("img"); image.src = media.url; image.alt = "Attached campaign image"; holder.append(image);
          } else {
            const link = document.createElement("a"); link.href = media.url; link.target = "_blank"; link.rel = "noopener"; link.textContent = "Open attached document"; holder.append(link);
          }
        } catch (error) { holder.className = "form-error"; holder.textContent = `Media preview unavailable: ${error.message}`; }
      }
    };
    content.querySelector("#batch-preview-variant")?.addEventListener("change", event => renderVariant(Number(event.target.value)));
    await renderVariant(0);
  } catch (error) {
    if (backdrop.isConnected) content.innerHTML = `<div class="form-error">Preview could not load: ${esc(error.message)}. Check that the updated backend is deployed, then try again.</div>`;
  } finally { button.disabled = false; }
}




async function optionalMarketingApi(path) {
  try {
    return await api(path);
  } catch (error) {
    return { data: [], error: error.message };
  }
}





async function loadAllBatchPages(path, maxPages = 25) {
  const items = [];
  let cursor = null;
  try {
    for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
      const response = await api(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      items.push(...(response.data || []));
      cursor = response.pagination?.nextCursor || null;
      if (!cursor) return { data: items, error: null, truncated: false };
    }
    return { data: items, error: "Only the first 25,000 records were loaded", truncated: true };
  } catch (error) {
    return { data: items, error: error.message, truncated: false };
  }
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
  if (campaign.status === "PENDING_APPROVAL" && ["OWNER", "ADMIN"].includes(state.session?.role)) actions.push(button("approve", "Approve", true));
  if (campaign.status === "APPROVED") actions.push(button("schedule", "Schedule"), button("start", "Start now", true));
  if (campaign.status === "SCHEDULED") actions.push(button("start", "Start now", true));
  if (campaign.status === "ACTIVE") actions.push(button("pause", "Pause"));
  if (campaign.status === "PAUSED") actions.push(button("resume", "Resume", true));
  if (!["COMPLETED", "CANCELLED", "FAILED"].includes(campaign.status)) actions.push(button("cancel", "Cancel"));
  return actions.join("");
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
    return true;
  } catch (error) {
    notify(error.message, true);
    button.disabled = false;
    return false;
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



function datetimeLocalValue(value) {
  const date = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

async function renderClients(search = "") {
  pageTitle.textContent = "Clients";
  const capability = await clientDirectoryCapability();
  if (location.hash.split('/')[0] !== '#clients') return;
  if (capability?.enabled) {
    return mountClientDirectory({ page, api, capabilities: capability, onAdd: showAddClient, notify, initialView: location.hash.split('/')[1], active: () => location.hash.split('/')[0] === '#clients' });
  }
  const segment = currentClientSegment();
  const directoryTitle = segment === "PROSPECT" ? "Prospect directory" : segment === "EXISTING_CLIENT" ? "Existing client directory" : "Client directory";
  const directoryDescription = segment === "PROSPECT"
    ? "Prospective customers assigned to Reshu."
    : segment === "EXISTING_CLIENT"
      ? "Existing customers and their complete business history, assigned to Ankit."
      : "Existing clients and prospects, separated by customer type.";
  const query = new URLSearchParams({ limit: "100" });
  if (search) query.set("search", search);
  const [{ data }, { data: counts }] = await Promise.all([
    api(`/contacts?${query}`),
    api("/contacts/count")
  ]);
  page.innerHTML = `
    <div class="section-head"><div><h1>${esc(directoryTitle)}</h1><p>${esc(directoryDescription)}</p></div><span class="count-pill">${formatCount(counts.totalContacts)} visible ${segment === "PROSPECT" ? "prospects" : segment === "EXISTING_CLIENT" ? "clients" : "records"}</span></div>
    <div class="toolbar"><input class="search-input" id="client-search" placeholder="Search company, person, phone or city…" value="${attr(search)}" /><button class="button button-primary" id="add-client">+ Add ${segment === "PROSPECT" ? "prospect" : "client"}</button></div>
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
    <section class="detail-hero"><div class="detail-person"><div class="detail-avatar">${esc(initials(client.companyName || client.contactPerson))}</div><div><h1>${esc(client.companyName || client.contactPerson || "Unnamed client")}</h1><p>${esc(client.primaryPhone || "No phone")} · ${esc(client.city || "City not set")}</p></div></div><div class="detail-actions"><span class="badge green">${esc(pretty(client.relationshipType || "CLIENT"))}</span><button class="button button-secondary" id="client-new-quotation">Quotation</button><button class="button wa-open-client" id="open-client-whatsapp" ${client.primaryPhone ? "" : "disabled"}>Open WhatsApp</button></div></section>
    <div class="detail-stats">
      ${data.summary.metricNote ? `<p class="muted">${esc(data.summary.metricNote)}</p>` : ""}${miniStat("Orders", data.summary.totalOrders)}${miniStat("Order value", money(data.summary.totalValue))}${miniStat("Paid", money(data.summary.paidAmount))}${miniStat("Outstanding", money(data.summary.outstandingAmount))}
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
  document.querySelector("#client-new-quotation").onclick = () => openQuotationForClient(client);
  mountContactWorkspace({ page, api, contact: client, notify, openQuotation: showSavedQuotation }).catch(error => notify(error.message, true));
  const profileSession = state.session;
  clientDirectoryCapability().then(directoryCapability => {
    if (!directoryCapability?.enabled || state.session !== profileSession || location.hash !== `#client/${contactId}`) return;
    const reviewButton = document.createElement('button');
    reviewButton.className = 'button button-secondary';
    reviewButton.textContent = 'Classification & permission';
    reviewButton.onclick = () => openClassificationReview({ api, contactId, capabilities: directoryCapability, notify });
    page.querySelector('.detail-actions')?.append(reviewButton);
  }).catch(() => { /* Optional review availability must not block the existing profile actions. */ });
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

async function clientDirectoryCapability() {
  try { return (await api('/client-directory/capabilities')).data; }
  catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
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
  const segment = currentClientSegment();
  const fixedType = segment === "ALL" ? null : segment;
  const defaultType = fixedType || "EXISTING_CLIENT";
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<form class="modal" id="client-form"><div class="modal-head"><div><p class="eyebrow">NEW RECORD</p><h3>Add ${fixedType === "PROSPECT" ? "prospect" : fixedType === "EXISTING_CLIENT" ? "existing client" : "customer"}</h3></div><button class="modal-close" type="button">×</button></div>
    <div class="form-grid">
      <label class="field full">Company / party name<input name="companyName" required /></label>
      ${fixedType ? `<input type="hidden" name="relationshipType" value="${fixedType}" />` : '<label class="field full">Customer type<select name="relationshipType"><option value="EXISTING_CLIENT">Existing client · Ankit</option><option value="PROSPECT">Prospect · Reshu</option></select></label>'}
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
      const relationshipType = values.relationshipType || defaultType;
      const { data } = await api("/contacts", { method: "POST", body: { ...values, relationshipType, tags: [relationshipType], source: "MANUAL" } });
      close(); notify(`${relationshipType === "PROSPECT" ? "Prospect" : "Client"} created successfully.`); location.hash = `#client/${data.contactId}`;
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

function metric(label, value, note, color) { return `<article class="metric-card ${color}"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${esc(formatCount(value))}</strong><span class="metric-note">${esc(note)}</span></article>`; }
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
function formatCount(value) { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Number(value || 0)); }
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

// Smart inbox helpers share the existing authenticated API and durable outbox.
async function inboxAllPages(path, onPage) {
  const items = []; const seen = new Set(); let cursor = null; let response; let syncStartedAt;
  do {
    response = await api(`${path}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    if (!syncStartedAt && response.meta?.syncStartedAt) {
      syncStartedAt = response.meta.syncStartedAt;
      path += `&to=${encodeURIComponent(syncStartedAt)}`;
    }
    items.push(...(response.data || []));
    if(onPage)onPage(response);
    const next = response.pagination?.hasMore ? response.pagination.nextCursor : null;
    if (response.pagination?.hasMore && (!next || seen.has(next))) throw new Error('Inbox sync returned an invalid cursor. Refresh to retry.');
    if (next) seen.add(next);
    cursor = next;
  } while (cursor);
  return { ...response, meta: {...response.meta, syncStartedAt}, data: items };
}

function smartChatToolbar() {
  const wa = state.whatsapp; const p = selectedConversation()?.preferences || {};
  return `<div class="wa-smart-chat-tools"><div class="wa-smart-actions">${[['pinned','Pin','Pinned'],['archived','Archive','Unarchive'],['muted','Mute','Unmute'],['manualUnread','Mark unread','Mark read']].map(([key,off,on]) => `<button type="button" data-smart-pref="${key}" aria-pressed="${Boolean(p[key])}">${p[key] ? on : off}</button>`).join('')}<button id="wa-ai-suggest" type="button">✦ AI suggestion</button><button id="wa-prepare-sequence" type="button">Prepare sequence</button></div><div class="wa-chat-search"><input id="wa-message-search" type="search" placeholder="Search loaded messages" aria-label="Search loaded messages" value="${attr(wa.messageSearch)}"><label><input id="wa-starred-only" type="checkbox" ${wa.starredOnly ? 'checked' : ''}> Starred</label><small id="wa-search-match-count">${smartVisibleMessages().length} messages</small></div></div>`;
}

function smartVisibleMessages() {
  const wa = state.whatsapp; const ids = selectedConversation()?.preferences?.starredMessageIds || [];
  const needle = wa.messageSearch.trim().toLowerCase();
  return wa.messages.filter(m => (!wa.starredOnly || ids.includes(m.messageId)) && (!needle || [m.text, ...(m.attachments || []).map(a => a.fileName)].join(' ').toLowerCase().includes(needle)));
}



function smartSort(items) {
  const score = item => {
    const remaining = (asDate(item.lastInboundAt)?.getTime() || 0) + 86400000 - Date.now();
    const due = asDate(item.nextFollowUpAt || item.lead?.nextFollowupDate)?.getTime() || Infinity;
    return (due <= Date.now() ? 500 : 0) + (remaining > 0 && remaining < 3600000 ? 400 : 0) + (Number(item.unreadCount) > 0 || item.preferences?.manualUnread ? 200 : 0) + (['HIGH','VERY_HIGH'].includes(item.lead?.interestLevel) ? 100 : 0);
  };
  return [...items].sort((a,b) => Number(Boolean(b.preferences?.pinned)) - Number(Boolean(a.preferences?.pinned)) || (state.whatsapp.sort === 'PRIORITY' ? score(b) - score(a) : 0) || (asDate(b.lastMessageAt)?.getTime() || 0) - (asDate(a.lastMessageAt)?.getTime() || 0));
}

async function saveSmartPreference(patch, id = state.whatsapp.selectedId) {
  const wa = state.whatsapp; if (!id) return;
  if (Object.hasOwn(patch,"draft")) { wa.draftDirty.add(id); await chatCacheCall(wa.cache,"setMeta",`draft:${id}`,{text:patch.draft,pending:true}); }
  const previous = wa.preferenceWrites[id] || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const { data } = await api(`/conversations/${encodeURIComponent(id)}/preferences`, { method: 'PATCH', body: patch });
    if (Object.hasOwn(patch,"draft") && wa.drafts[id] === patch.draft) { wa.draftDirty.delete(id); await chatCacheCall(wa.cache,"setMeta",`draft:${id}`,{text:patch.draft,pending:false}); }
    const item = wa.conversations.find(c => conversationId(c) === id);
    if (item) { item.preferences = data; await chatCacheCall(wa.cache, 'putConversations', [item]); }
    return data;
  });
  wa.preferenceWrites[id] = task;
  return task;
}

function saveSmartDraft() {
  const wa = state.whatsapp; const input = document.querySelector('#wa-message-input'); const id = wa.selectedId;
  if (!input || !id) return;
  const value = input.value; wa.drafts[id] = value; wa.draftDirty.add(id);
  chatCacheCall(wa.cache,"setMeta",`draft:${id}`,{text:value,pending:true});
  clearTimeout(wa.draftTimers[id]);
  wa.draftTimers[id] = setTimeout(() => saveSmartPreference({ draft: value }, id).catch(error => notify(`Draft kept on this screen; sync failed: ${error.message}`, true)), 500);
}

function bindSmartInbox() {
  const wa = state.whatsapp;
  const on = (id, event, fn) => bindLiveEvent(document.querySelector(id), "binding-220487", event, fn);
  const run = fn => async event => { try { await fn(event); } catch (error) { notify(error.message, true); } };
  on('#wa-message-input','input',saveSmartDraft);
  on('#wa-message-input','keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); document.querySelector('#wa-composer-form')?.requestSubmit(document.querySelector('#wa-composer-form button[type="submit"]')); }
    if (event.key === 'Escape') { wa.replyToMessageId = null; renderWhatsappPage(); }
  });
  on('#wa-smart-sort','change',event => { wa.sort = event.target.value; refreshWhatsappLiveDom(); });
  on('#wa-smart-refresh','click',run(async () => { wa.fullSyncedAt = null; await pollWhatsapp(); }));
  document.querySelectorAll('[data-smart-pref]').forEach(button => bindLiveEvent(button, "binding-221352", 'click',run(async () => {
    const key = button.dataset.smartPref; button.disabled = true;
    try { await saveSmartPreference({ [key]: !selectedConversation()?.preferences?.[key] }); renderWhatsappPage(); } finally { button.disabled = false; }
  })));
  const search = () => {
    const visible = new Set(smartVisibleMessages().map(m => m.messageId));
    document.querySelectorAll('[data-message-row]').forEach(row => { row.hidden = !visible.has(row.dataset.messageRow); });
    const count = document.querySelector('#wa-search-match-count'); if (count) count.textContent = `${visible.size} messages`;
  };
  on('#wa-message-search','input',event => { wa.messageSearch = event.target.value; search(); });
  on('#wa-starred-only','change',event => { wa.starredOnly = event.target.checked; search(); });
  on('#wa-ai-suggest','click',run(async event => {
    const button = event.currentTarget; const id = wa.selectedId; button.disabled = true; button.textContent = 'Thinking…';
    try {
      const { data } = await api(`/conversations/${encodeURIComponent(id)}/suggest`, { method:'POST',body:{} });
      if (id !== wa.selectedId) return;
      const dialog = smartDialog('Review AI suggestion',`<p>${esc(data.reason || 'Review the reply before using it.')}</p><textarea id="wa-ai-draft" rows="7" maxlength="4096">${esc(data.reply || '')}</textarea><p>Nothing has been sent.${data.needsHuman ? ' This reply needs careful human review.' : ''}</p><button id="wa-use-ai" type="button">Use as draft</button>`);
      dialog.querySelector('#wa-use-ai').onclick = () => { wa.drafts[id] = dialog.querySelector('#wa-ai-draft').value; saveSmartPreference({draft:wa.drafts[id]},id).catch(error=>notify(error.message,true)); dialog.close(); dialog.remove(); renderWhatsappPage(); };
    } finally { button.disabled = false; button.textContent = '✦ AI suggestion'; }
  }));
  on('#wa-human-takeover','click',run(async () => {
    const enabled = !selectedConversation()?.humanTakeover;
    await api(`/conversations/${encodeURIComponent(wa.selectedId)}/human-takeover`,{method:'POST',body:{enabled}});
    selectedConversation().humanTakeover = enabled; renderWhatsappPage();
  }));
  on('#wa-save-lead','click',run(async () => {
    const lead = selectedConversation()?.lead; if (!lead) return;
    const {data} = await api(`/leads/${encodeURIComponent(lead.leadId)}`,{method:'PATCH',body:{ leadStatus: document.querySelector('#wa-lead-stage').value, interestLevel: document.querySelector('#wa-lead-interest').value, productRequired: document.querySelector('#wa-product-required').value.split(',').map(v=>v.trim()).filter(Boolean) }});
    selectedConversation().lead = data; renderWhatsappPage(); notify('Client follow-up stage saved.');
  }));
  document.querySelectorAll('[data-followup-days]').forEach(button=>bindLiveEvent(button, "binding-224213", 'click',()=>{
    const time = new Date(); const days = Number(button.dataset.followupDays);
    if (days === 0) time.setHours(time.getHours()+1); else {time.setDate(time.getDate()+days);time.setHours(10,0,0,0);}
    time.setMinutes(time.getMinutes()-time.getTimezoneOffset());
    document.querySelector('#wa-followup-at').value=time.toISOString().slice(0,16);
  }));
  document.querySelectorAll('[data-complete-followup]').forEach(button=>bindLiveEvent(button, "binding-224684", 'click',run(async()=>{
    await api(`/followups/${encodeURIComponent(button.dataset.completeFollowup)}/complete`,{method:'POST',body:{outcome:'Completed from smart inbox'}});
    wa.overviewCachedAt=0; await loadWhatsappConversation(wa.selectedId,{incremental:true}); wa.fullSyncedAt=null; renderWhatsappPage();
  })));
  on('#wa-prepare-sequence','click',openSmartSequence);
  on('#wa-save-quick-reply','click',run(async()=>{
    const text=document.querySelector('#wa-message-input')?.value.trim(); if(!text) throw new Error('Type a reply first.');
    const title=prompt('Quick reply name'); if(!title?.trim())return;
    const shortcut = prompt('Shortcut, for example /delivery'); if (!shortcut?.trim()) return;
    await api('/whatsapp/quick-replies',{method:'POST',body:{title:title.trim(),text,shortcut:shortcut.trim()}});
    wa.quickReplies=(await api('/whatsapp/quick-replies?limit=100')).data; renderWhatsappPage();notify('Quick reply saved.');
  }));
  document.querySelectorAll('[data-insert-emoji]').forEach(button=>bindLiveEvent(button, "binding-225751", 'click',()=>{
    const input=document.querySelector('#wa-message-input'); if(!input)return;
    input.setRangeText(button.dataset.insertEmoji,input.selectionStart,input.selectionEnd,'end');input.focus();saveSmartDraft();
  }));
}

function bindSmartMessageTools() {
  const bind = (selector,fn) => document.querySelectorAll(selector).forEach(button=>bindLiveEvent(button, "binding-226133", 'click',async()=>{try{await fn(button);}catch(error){notify(error.message,true);}}));
  bind('[data-star-message]',async button=>{
    const ids = new Set(selectedConversation()?.preferences?.starredMessageIds || []); const id=button.dataset.starMessage;
    if(ids.has(id))ids.delete(id);else ids.add(id);
    await saveSmartPreference({starredMessageIds:[...ids]});renderWhatsappPage();
  });
  bind('[data-copy-message]',async button=>{await navigator.clipboard.writeText(state.whatsapp.messages.find(m=>m.messageId===button.dataset.copyMessage)?.text || '');notify('Copied.');});
  bind('[data-use-message]',async button=>{
    const wa=state.whatsapp;wa.drafts[wa.selectedId]=wa.messages.find(m=>m.messageId===button.dataset.useMessage)?.text || '';
    await saveSmartPreference({draft:wa.drafts[wa.selectedId]});renderWhatsappPage();
  });
}

function smartClientControls() {
  const wa=state.whatsapp;const lead=selectedConversation()?.lead;
  const stages=['NEW_LEAD','FIRST_CONTACT','INTERESTED','QUALIFYING','QUOTATION_SENT','FOLLOW_UP_1','FOLLOW_UP_2','FOLLOW_UP_3','ORDER_CONFIRMED','DESIGNING','APPROVAL','PRINTING','BINDING','DISPATCHED','CLOSED_WON','CLOSED_LOST','ON_HOLD'];
  return `<div class="wa-smart-client"><button id="wa-human-takeover" type="button">${selectedConversation()?.humanTakeover ? 'Release human takeover' : 'Take over · pause automation'}</button><p>AI suggests replies. You review and send.</p>${lead ? `<label>Follow-up stage<select id="wa-lead-stage">${stages.map(value=>`<option ${lead.leadStatus===value?'selected':''}>${value}</option>`).join('')}</select></label><label>Interest<select id="wa-lead-interest">${['UNKNOWN','LOW','MEDIUM','HIGH','VERY_HIGH'].map(value=>`<option ${lead.interestLevel===value?'selected':''}>${value}</option>`).join('')}</select></label><label>Products required<input id="wa-product-required" value="${attr((lead.productRequired || []).join(', '))}" placeholder="Separate products with commas"></label><button id="wa-save-lead" type="button">Save stage</button>`:''}<div class="wa-followup-shortcuts">${[[0,'In 1 hour'],[1,'Tomorrow'],[3,'In 3 days']].map(([days,label])=>`<button type="button" data-followup-days="${days}">${label}</button>`).join('')}</div>${(wa.overview?.followUps || []).filter(f=>f.status==='SCHEDULED').map(f=>`<div class="wa-due-item"><span>${esc(date(f.dueAt))} · ${esc(f.notes || 'Follow-up')}</span><button type="button" data-complete-followup="${attr(f.followUpId)}">Done</button></div>`).join('')}</div>`;
}

function smartDialog(title,body) {
  const existing = document.querySelector('#wa-smart-dialog');
  if (existing) { existing.close(); existing.remove(); }
  const dialog=document.createElement('dialog');dialog.id='wa-smart-dialog';dialog.className='wa-smart-dialog';
  dialog.innerHTML=`<header><h2>${esc(title)}</h2><button type="button" aria-label="Close dialog">×</button></header>${body}`;
  dialog.querySelector('header button').onclick=()=>{dialog.close();dialog.remove();};
  document.body.append(dialog);dialog.showModal();return dialog;
}

function openSmartSequence() {
  const wa=state.whatsapp;const contact=wa.overview?.contact;if(!contact)return;
  const dialog=smartDialog('Prepare a client sequence',`<p>Prepare up to 3 text or video steps for ${esc(contact.companyName || contact.contactPerson)}. The sequence is saved as a draft. Start it manually from Marketing after review.</p><label>Sequence name<input id="sequence-name" value="Client follow-up"></label>${[0,1,2].map(index=>`<fieldset><legend>Step ${index+1}${index?' · optional':''}</legend><label>Delay after previous step (minutes)<input type="number" min="0" max="1440" id="sequence-delay-${index}" value="${index?60:0}"></label><textarea id="sequence-text-${index}" maxlength="1024" rows="2" placeholder="Message for this step"></textarea><label>Optional video/image/document<input id="sequence-file-${index}" type="file" accept="video/*,image/*,.pdf"></label></fieldset>`).join('')}<p>Steps send only while the reply window is open. Client replies, STOP and human takeover pause/stop queued automation.</p><p id="sequence-error" role="alert"></p><button id="sequence-save" type="button">Save draft sequence</button>`);
  dialog.querySelector('#sequence-save').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{
      const name=dialog.querySelector('#sequence-name').value.trim();if(name.length<2)throw new Error('Enter a sequence name.');
      const steps=[];
      for(const index of [0,1,2]){
        const messageLine=dialog.querySelector(`#sequence-text-${index}`).value.trim();const file=dialog.querySelector(`#sequence-file-${index}`).files[0];
        if(!messageLine&&!file)continue;
        if(messageLine.length<2)throw new Error(`Add a caption/message for step ${index+1}.`);
        const delayMinutes=Number(dialog.querySelector(`#sequence-delay-${index}`).value);if(!Number.isInteger(delayMinutes)||delayMinutes<0||delayMinutes>1440)throw new Error('Delay must be 0–1440 minutes.');
        const attachment=file?await uploadMarketingAsset(file):null;
        steps.push({delayDays:0,delayMinutes,messageLine,messageType:file?messageTypeForFile(file):'TEXT',attachmentIds:attachment?[attachment.attachmentId]:[]});
      }
      if(!steps.length)throw new Error('Add at least one message.');
      const {data:audience}=await api('/marketing/audiences',{method:'POST',body:{name,contactIds:[contact.contactId],relationshipType:contact.relationshipType==='EXISTING_CLIENT'?'EXISTING_CLIENT':'PROSPECT'}});
      await api('/campaigns',{method:'POST',body:{name,audienceId:audience.audienceId,interestLabel:name,templateId:'interest_followup',deliveryMode:'OPEN_WINDOW_ONLY',trigger:'MANUAL',steps}});
      dialog.close();dialog.remove();notify('Sequence draft saved. Review and start it in Marketing.');location.hash='#marketing';
    }catch(error){dialog.querySelector('#sequence-error').textContent=error.message;button.disabled=false;}
  };
}

function updateSmartReminders() {
  const wa=state.whatsapp;
  const item=wa.conversations.find(c=>!c.preferences?.muted && inboxMatches(c,{filter:'CLOSING'}) && Number(c.unreadCount)>0);
  if(!item)return;
  const key=`closing:${conversationId(item)}:${asDate(item.lastInboundAt)?.getTime()}`;
  if(wa.reminderKeys.has(key))return;wa.reminderKeys.add(key);
  notify(`Reply window closing soon: ${item.contact?.companyName || item.contact?.contactPerson || 'client'}`);
}

function smartSendKey(id, body) {
  const wa=state.whatsapp;const signature=JSON.stringify(body);
  if (wa.pendingSends[id]?.signature !== signature) wa.pendingSends[id]={signature,key:`${id}-${Date.now()}-${Math.random().toString(36).slice(2)}`};
  return wa.pendingSends[id].key;
}

function referencePreferences() {
  try { return JSON.parse(localStorage.getItem(`rx-reference-ui:${state.session?.userId || state.session?.email || 'guest'}`) || '{}'); } catch { return {}; }
}
function saveReferencePreferences(patch) {
  try { localStorage.setItem(`rx-reference-ui:${state.session?.userId || state.session?.email || 'guest'}`, JSON.stringify({...referencePreferences(),...patch})); } catch { /* UI still works without persistent storage. */ }
}
function referenceReplyTimer(item) {
  const expires = (asDate(item.lastInboundAt)?.getTime() || 0) + 86400000;
  const minutes = Math.ceil((expires - Date.now()) / 60000);
  if (minutes <= 0) return '';
  const text = `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
  return `<span class="ref-reply-timer" title="Free reply window remaining">● ${text}</span>`;
}
function referenceChatHint(item) {
  const products = item.lead?.productRequired;
  const parts = [item.preferences?.draft ? 'Draft saved' : '', ...(Array.isArray(products) ? products : products ? [products] : []), item.lead?.leadStatus ? pretty(item.lead.leadStatus) : ''];
  return parts.filter(Boolean).length ? `<em class="wa-smart-hint">${esc(parts.filter(Boolean).join(' · '))}</em>` : '';
}
function applyReferencePreferences() {
  const prefs = referencePreferences();
  const root = document.querySelector('.wa-shell'); if (!root) return;
  root.style.setProperty('--reference-inbox-width', `${Math.max(290,Math.min(520,Number(prefs.width) || 370))}px`);
  root.style.setProperty('--reference-message-size', `${Math.max(14,Math.min(22,Number(prefs.fontSize) || 16))}px`);
  root.dataset.referenceTheme = prefs.theme === 'dark' ? 'dark' : 'light';
  root.dataset.referenceWallpaper = prefs.wallpaper === 'plain' ? 'plain' : 'grid';
}
function bindReferenceWhatsapp() {
  if (!document.querySelector(".wa-shell")?.dataset.referenceTheme) applyReferencePreferences();
  const on=(selector,handler)=>bindLiveEvent(document.querySelector(selector), "binding-234919", 'click',handler);
  on('#wa-toggle-filters',event=>{
    const filters=document.querySelector('#wa-reference-filters'); filters.hidden=!filters.hidden;
    event.currentTarget.setAttribute('aria-expanded',String(!filters.hidden)); saveReferencePreferences({filtersCollapsed:filters.hidden});
  });
  on('#wa-reference-refresh',()=>document.querySelector('#wa-smart-refresh')?.click());
  on('#wa-reference-suggest',()=>document.querySelector('#wa-ai-suggest')?.click());
  on('#wa-reference-search',()=>{ const details=document.querySelector('.ref-chat-tools'); details.open=!details.open; if(details.open)document.querySelector('#wa-message-search')?.focus(); });
  on('#wa-reference-photos',()=>{ const input=document.querySelector('#wa-attachment-input'); input.accept='image/*,video/*'; input.click(); });
  on('#wa-reference-emoji',openReferenceEmoji);
  on('#wa-reference-new-chat',openReferenceNewChat);
  if (state.whatsapp.recording && !document.querySelector("#wa-pause-recording")) {
    const pause = document.createElement('button'); pause.id='wa-pause-recording'; pause.type='button'; pause.className='wa-tool-button'; pause.textContent='Ⅱ'; pause.setAttribute('aria-label','Pause recording');
    document.querySelector('#wa-record-audio')?.before(pause);
    pause.onclick=()=>{const recorder=state.whatsapp.mediaRecorder;if(recorder?.state==='recording'){recorder.pause();pause.textContent='▶';pause.setAttribute('aria-label','Resume recording');}else if(recorder?.state==='paused'){recorder.resume();pause.textContent='Ⅱ';pause.setAttribute('aria-label','Pause recording');}};
  }
  on('#wa-reference-settings',()=>{
    const p=referencePreferences();
    const dialog=smartDialog('Chat settings',`<label>Appearance<select id="ref-theme"><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Wallpaper<select id="ref-wallpaper"><option value="grid">Grid</option><option value="plain">Plain</option></select></label><label>Message size<input id="ref-size" type="range" min="14" max="22" value="${Math.max(14,Math.min(22,Number(p.fontSize)||16))}"></label><button id="ref-alerts" type="button">Enable desktop alerts</button>`);
    dialog.querySelector('#ref-theme').value=p.theme==='dark'?'dark':'light'; dialog.querySelector('#ref-wallpaper').value=p.wallpaper==='plain'?'plain':'grid';
    dialog.querySelectorAll('select,input').forEach(input=>bindLiveEvent(input, "binding-237314", 'input',()=>{saveReferencePreferences({theme:dialog.querySelector('#ref-theme').value,wallpaper:dialog.querySelector('#ref-wallpaper').value,fontSize:Number(dialog.querySelector('#ref-size').value)});applyReferencePreferences();}));
    dialog.querySelector('#ref-alerts').onclick=enableDesktopAlerts;
  });
  const resizer=document.querySelector('#wa-reference-resizer');
  if(resizer){
    const setWidth=value=>{ const width=Math.max(290,Math.min(520,value));saveReferencePreferences({width});applyReferencePreferences();resizer.setAttribute('aria-valuenow',width); };
    resizer.setAttribute('aria-valuemin','290');resizer.setAttribute('aria-valuemax','520');resizer.setAttribute('aria-valuenow',String(referencePreferences().width||370));
    bindLiveEvent(resizer, "binding-238093", 'pointerdown',event=>{resizer.setPointerCapture(event.pointerId);});
    bindLiveEvent(resizer, "binding-238192", 'pointermove',event=>{if(resizer.hasPointerCapture(event.pointerId))setWidth(event.clientX-document.querySelector('.wa-shell').getBoundingClientRect().left);});
    bindLiveEvent(resizer, "binding-238383", 'dblclick',()=>setWidth(370));
    bindLiveEvent(resizer, "binding-238444", 'keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();setWidth((Number(referencePreferences().width)||370)+(event.key==='ArrowLeft'?-20:20));}});
  }
}
async function openReferenceEmoji() {
  const id=state.whatsapp.selectedId;
  const dialog=smartDialog('Choose emoji','<input id="ref-emoji-search" type="search" placeholder="Search emojis" aria-label="Search emojis"><div id="ref-emoji-grid" class="ref-emoji-grid">Loading…</div>');
  try {
    const response=await fetch('/emoji-data.json');if(!response.ok)throw new Error('Emoji list unavailable');
    const emojis=await response.json();
    const render=()=>{
      const needle=dialog.querySelector('#ref-emoji-search').value.toLowerCase();
      dialog.querySelector('#ref-emoji-grid').innerHTML=emojis.filter(item=>item.name.toLowerCase().includes(needle)).slice(0,160).map(item=>`<button type="button" data-reference-emoji="${attr(item.emoji)}" title="${attr(item.name)}" aria-label="${attr(item.name)}">${esc(item.emoji)}</button>`).join('') || '<p>No matching emojis.</p>';
      dialog.querySelectorAll('[data-reference-emoji]').forEach(button=>button.onclick=()=>{
        if(state.whatsapp.selectedId!==id)return;
        const input=document.querySelector('#wa-message-input');if(!input)return;
        input.setRangeText(button.dataset.referenceEmoji,input.selectionStart,input.selectionEnd,'end');saveSmartDraft();dialog.close();dialog.remove();input.focus();
      });
    };
    dialog.querySelector('#ref-emoji-search').oninput=render;render();dialog.querySelector('#ref-emoji-search').focus();
  }catch(error){dialog.querySelector('#ref-emoji-grid').textContent=error.message;}
}
function previewReferenceAttachments(files, caption='') {
  if(!files.length)return;
  const id=state.whatsapp.selectedId;
  const recipient=selectedConversation()?.contact;
  const dialog=smartDialog('Preview before sending',`<p>To ${esc(recipient?.companyName || recipient?.contactPerson || recipient?.primaryPhone || 'selected client')}</p><div class="ref-file-list"></div><p id="ref-file-status" role="status"></p><button id="ref-send-files" type="button">Send selected files</button>`);
  const urls=[];
  const rows=files.map((file,index)=>{
    const url=URL.createObjectURL(file);urls.push(url);
    const row=document.createElement('section');row.className='ref-file-preview';
    const type=messageTypeForFile(file);
    row.innerHTML=`<header><strong>${esc(file.name)}</strong><button type="button" aria-label="Remove ${attr(file.name)}">×</button></header>${type==='IMAGE'?`<img src="${attr(url)}" alt="Selected image">`:type==='VIDEO'?`<video src="${attr(url)}" controls preload="metadata"></video>`:type==='AUDIO'?`<audio src="${attr(url)}" controls></audio>`:'<p>Document attachment</p>'}${type==='AUDIO'?'':`<label>Caption<textarea maxlength="4096">${esc(index===0?caption:'')}</textarea></label>`}`;
    const data={file,row,removed:false};row.querySelector('button').onclick=()=>{data.removed=true;row.querySelectorAll('video,audio').forEach(m=>m.pause());row.remove();};
    dialog.querySelector('.ref-file-list').append(row);return data;
  });
  const cleanup=()=>{dialog.querySelectorAll('video,audio').forEach(m=>{m.pause();m.removeAttribute('src');m.load();});urls.forEach(url=>URL.revokeObjectURL(url));};
  dialog.addEventListener('close',cleanup,{once:true});
  dialog.querySelector('#ref-send-files').onclick=async event=>{
    const button=event.currentTarget;button.disabled=true;
    const status=dialog.querySelector('#ref-file-status');
    const selected=rows.filter(row=>!row.removed);
    if(!selected.length){status.textContent='Choose at least one file.';button.disabled=false;return;}
    selected.forEach(entry=>entry.row.querySelectorAll('button,textarea').forEach(control=>control.disabled=true));
    for(const entry of selected){
      if(!dialog.open || state.whatsapp.selectedId!==id){status.textContent='Chat changed or preview closed. Remaining files were not sent.';return;}
      status.textContent=`Sending ${entry.file.name}…`;
      const sent=await sendAttachmentFile(entry.file,entry.row.querySelector('textarea')?.value.trim()||'');
      if(!sent){status.textContent='Stopped after an error. Check the conversation before trying again.';return;}
      entry.row.querySelectorAll('button,textarea').forEach(control=>control.disabled=true);
    }
    status.textContent='Selected files queued.';button.textContent='Queued';
  };
}

async function encodeReferenceVoice(file) {
  const context = new (window.AudioContext || window.webkitAudioContext)();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    const samples = decoded.getChannelData(0).slice();
    const worker = new Worker('/audio-encoder.js');
    const blob = await new Promise((resolve,reject) => {
      const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Encoding timed out'));},30000);
      worker.onmessage=event=>{clearTimeout(timeout);worker.terminate();event.data.error?reject(new Error(event.data.error)):resolve(event.data.blob);};
      worker.onerror=()=>{clearTimeout(timeout);worker.terminate();reject(new Error('Audio encoder unavailable'));};
      worker.postMessage({samples,sampleRate:decoded.sampleRate},[samples.buffer]);
    });
    return new File([blob],`voice-note-${Date.now()}.mp3`,{type:'audio/mpeg'});
  } finally { await context.close(); }
}

function openReferenceNewChat() {
  const dialog=smartDialog('New conversation','<p>Choose an existing client. Opening a chat does not send a message.</p><input id="ref-client-search" type="search" placeholder="Search name or phone" aria-label="Search clients"><div id="ref-client-results">Type a name or number.</div><a href="#clients">Open client directory / add a client</a>');
  let timer,searchVersion=0;
  dialog.querySelector('#ref-client-search').oninput=event=>{
    clearTimeout(timer);const needle=event.target.value.trim();const version=++searchVersion;
    if(!needle){dialog.querySelector('#ref-client-results').textContent='Type a name or number.';return;}
    timer=setTimeout(async()=>{
      try{
        const {data,pagination}=await api(`/contacts?limit=100&search=${encodeURIComponent(needle)}`);
        if(!dialog.open||version!==searchVersion)return;
        dialog.querySelector('#ref-client-results').innerHTML=data.map(contact=>`<button class="ref-new-client" type="button" data-ref-contact="${attr(contact.contactId)}" ${contact.primaryPhone?'':'disabled'}><strong>${esc(contact.companyName||contact.contactPerson||'Client')}</strong><small>${esc(contact.primaryPhone||'No phone number')}</small></button>`).join('') || '<p>No matching clients in this search page. Try the full number or use the client directory.</p>';
        if(pagination?.hasMore)dialog.querySelector('#ref-client-results').insertAdjacentHTML('beforeend','<p>More results available in the client directory.</p>');
        dialog.querySelectorAll('[data-ref-contact]').forEach(button=>button.onclick=async()=>{
          button.disabled=true;
          try{const {data:conversation}=await api('/conversations/start',{method:'POST',body:{contactId:button.dataset.refContact}});dialog.close();dialog.remove();location.hash=`#whatsapp/${conversationId(conversation)}`;}catch(error){notify(error.message,true);button.disabled=false;}
        });
      }catch(error){if(dialog.open&&version===searchVersion)dialog.querySelector('#ref-client-results').textContent=error.message;}
    },300);
  };
  dialog.addEventListener('close',()=>clearTimeout(timer),{once:true});dialog.querySelector('#ref-client-search').focus();
}




async function loadQuotationTools() {
  if (!loadQuotationTools.pending) loadQuotationTools.pending = (async () => {
    if (!window.jspdf?.jsPDF) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/jspdf.umd.min.js'; script.onload = resolve;
      script.onerror = () => { script.remove(); reject(new Error('Could not load quotation tools. Try again.')); };
      document.head.append(script);
    });
    return Promise.all([import('./quotation-tools.mjs'), import('./quotation-client.mjs')]);
  })().catch(error => { loadQuotationTools.pending = null; throw error; });
  return loadQuotationTools.pending;
}

async function openQuotationForClient(contact, chatId = null, saved = null) {
  if (openQuotationForClient.opening || document.querySelector(".wa-quote-dialog")) return;
  openQuotationForClient.opening = true;
  try {
    const sessionUser = state.session?.userId;
    const checkSession = () => { if (!sessionUser || state.session?.userId !== sessionUser) throw new Error('Session changed. Reopen the quotation.'); };
    const [ui, client] = await loadQuotationTools();
    checkSession();
    const contactId = contact.contactId || contact.id;
    if (!chatId) chatId = conversationId((await api('/conversations/start',{method:'POST',body:{contactId}})).data);
    checkSession();
    const session = client.createQuotationSession({api,upload:uploadAttachment,contactId,conversationId:chatId,saved,checkSession});
    const tools = ui.createQuotationTools({esc,notify,preparedBy:state.session.name || 'RX Team',save:session.save,
      send:async quote => {
        await session.send(quote);
        if (location.hash.startsWith('#whatsapp') && state.whatsapp.selectedId === chatId) {
          loadWhatsappConversation(chatId,{incremental:true}).then(renderWhatsappBackground).catch(() => {});
        }
      }
    });
    tools.open({...contact,id:contactId,phone:contact.primaryPhone,name:contact.contactPerson},saved ? {...saved,createdAt:asDate(saved.createdAt)?.toISOString()} : null);
  } catch(error) { notify(error.message,true); }
  finally {openQuotationForClient.opening = false;}
}

async function openCurrentQuotation() {
  const conversation = selectedConversation();
  if (!conversation) return;
  const id = conversationId(conversation);
  try {
    const contactId = conversation.contactId;
    const contact = (await api(`/contacts/${encodeURIComponent(contactId)}`)).data;
    await openQuotationForClient(contact,id);
  } catch(error) { notify(error.message,true); }
}

async function showSavedQuotation(id) {
  const {data:quote} = await api(`/quotations/${encodeURIComponent(id)}`);
  if (!quote.pdfAttachmentId) {
    const {data:contact} = await api(`/contacts/${encodeURIComponent(quote.contactId)}`);
    return openQuotationForClient(contact,quote.conversationId,quote);
  }
  const blob = await fetchAttachmentBlob(quote.pdfAttachmentId);
  const url = URL.createObjectURL(blob);
  const dialog = document.createElement('dialog');
  dialog.className = 'wa-quote-dialog wa-quote-dialog--preview';
  dialog.setAttribute('aria-label','Saved quotation');
  dialog.innerHTML = `<header class="wa-quote-dialog__header"><div><span>${esc(quote.quotationNumber || id)} · ${esc(pretty(quote.status))}</span><h2>${esc(quote.companyName)}</h2></div><button class="wa-quote-dialog__close" aria-label="Close">×</button></header><div class="wa-quote-dialog__body"><section class="wa-quote-preview"><button class="wa-quote-preview__close" aria-label="Close saved quotation">×</button><iframe title="Saved quotation PDF" src="${url}#toolbar=1&view=FitV"></iframe><div class="wa-quote-preview__actions"><a class="button button-secondary" href="${url}" download="${attr(quote.quotationNumber || id)}.pdf">Download PDF</a>${quote.status === 'DRAFT' ? '<button class="wa-quote-secondary" data-quote-edit>Edit draft</button><button class="wa-quote-primary" data-quote-send>Send on WhatsApp</button>' : ''}${quote.conversationId ? `<a class="button button-secondary" href="#whatsapp/${attr(quote.conversationId)}" data-quote-chat>View chat & delivery</a>` : ''}<p class="wa-quote-notice" role="status">${quote.status === 'QUEUED' ? 'Queued for sending. Check actual delivery in the chat.' : 'This is the saved PDF. Sending requires an open 24-hour reply window.'}</p></div></section></div>`;
  document.body.append(dialog);
  let busy = false;
  const close = () => { if(busy) return; dialog.close(); dialog.remove(); URL.revokeObjectURL(url); };
  dialog.querySelector('.wa-quote-dialog__close').onclick = close;
  dialog.querySelector('.wa-quote-preview__close').onclick = close;
  dialog.addEventListener('cancel',event => {event.preventDefault();close();});
  dialog.querySelector('[data-quote-chat]')?.addEventListener('click',close);
  dialog.querySelector('[data-quote-edit]')?.addEventListener('click',async () => {
    try { const {data:contact} = await api(`/contacts/${encodeURIComponent(quote.contactId)}`); close(); await openQuotationForClient(contact,quote.conversationId,quote); }
    catch(error) {notify(error.message,true);}
  });
  dialog.querySelector('[data-quote-send]')?.addEventListener('click',async event => {
    busy = true; event.currentTarget.disabled = true;
    dialog.querySelector('[data-quote-edit]').disabled = true;
    const status = dialog.querySelector('[role="status"]'); status.textContent = 'Queuing quotation…';
    try {
      await api(`/quotations/${encodeURIComponent(id)}/send`,{method:'POST',body:{}});
      busy = false; close(); notify('Quotation queued. Check delivery in WhatsApp.');
      if(location.hash === '#quotations') await renderQuotations();
    } catch(error) {
      status.textContent = error.message; notify(error.message,true);
      dialog.querySelector('[data-quote-send]').disabled = false;
      dialog.querySelector('[data-quote-edit]').disabled = false;
    } finally {busy = false;}
  });
  dialog.showModal();
}

async function renderQuotations() {
  pageTitle.textContent = 'Quotations';
  page.innerHTML = `<div class="section-head"><div><h1>Quotations</h1><p>Saved drafts and PDFs, linked to your clients.</p></div><a class="button button-primary" href="#clients">Choose client · New quotation</a></div><section class="panel"><div class="quotation-actions"><input id="quotation-search" type="search" placeholder="Find in loaded quotations: client, number, phone" aria-label="Search loaded quotations"/><button id="quotation-refresh" class="button button-secondary">Refresh</button></div><div class="table-wrap"><table><thead><tr><th>Quotation / client</th><th>Date</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody id="quotation-rows"></tbody></table></div><p id="quotation-status" class="muted" role="status"></p><button id="quotation-more" class="button button-secondary" hidden>Load more</button></section>`;
  const rows = document.querySelector('#quotation-rows');
  const search = document.querySelector('#quotation-search');
  const more = document.querySelector('#quotation-more');
  const status = document.querySelector('#quotation-status');
  let loaded = [], cursor = null;
  const draw = () => {
    const needle = search.value.trim().toLowerCase();
    const visible = loaded.filter(q => [q.quotationNumber,q.companyName,q.phone].some(v => String(v || '').toLowerCase().includes(needle)));
    rows.innerHTML = visible.length ? visible.map(q => `<tr><td><strong>${esc(q.quotationNumber || q.quotationId)}</strong><br>${esc(q.companyName || 'Client')}<br><small>${esc(q.phone)}</small></td><td>${esc(date(q.createdAt))}</td><td>${new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:2}).format(q.totalAmount || 0)}</td><td>${esc(pretty(q.status))}${q.status === 'QUEUED' ? '<br><small>See chat for delivery</small>' : ''}</td><td><button class="button button-secondary" data-quotation="${attr(q.quotationId)}">${q.pdfAttachmentId ? 'Preview' : 'Open draft'}</button></td></tr>`).join('') : '<tr><td colspan="5">No matching quotations in loaded records.</td></tr>';
    rows.querySelectorAll('[data-quotation]').forEach(button => button.onclick = async () => {
      button.disabled = true; try {await showSavedQuotation(button.dataset.quotation);} catch(error) {notify(error.message,true);} finally {button.disabled = false;}
    });
  };
  const load = async () => {
    more.disabled = true; status.textContent = 'Loading quotations…';
    try {
      const result = await api(`/quotations?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if(!rows.isConnected) return;
      loaded = [...new Map([...loaded,...result.data].map(q => [q.quotationId,q])).values()];
      cursor = result.pagination?.nextCursor;
      more.hidden = !result.pagination?.hasMore;
      status.textContent = `${loaded.length} quotations loaded${more.hidden ? '' : ' · Load more for older records'}`;
      draw();
    } catch(error) {status.textContent = error.message; more.hidden = false;more.textContent='Retry loading';}
    finally {more.disabled=false;}
  };
  search.oninput = draw;
  more.onclick = load;
  document.querySelector('#quotation-refresh').onclick = renderQuotations;
  await load();
}


