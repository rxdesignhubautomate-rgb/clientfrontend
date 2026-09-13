const els = {
  pinInput: document.querySelector("#pinInput"),
  laptopCode: document.querySelector("#laptopCode"),
  roleSelect: document.querySelector("#roleSelect"),
  copyLaptopBtn: document.querySelector("#copyLaptopBtn"),
  connectBtn: document.querySelector("#connectBtn"),
  logoutBtn: document.querySelector("#logoutBtn"),
  refreshBtn: document.querySelector("#refreshBtn"),
  teamRefreshBtn: document.querySelector("#teamRefreshBtn"),
  connectionStatus: document.querySelector("#connectionStatus"),
  metricCards: document.querySelectorAll("[data-metric-filter]"),
  metricTotal: document.querySelector("#metricTotal"),
  metricOpen: document.querySelector("#metricOpen"),
  metricNew: document.querySelector("#metricNew"),
  metricHot: document.querySelector("#metricHot"),
  metricFollow: document.querySelector("#metricFollow"),
  metricQuotation: document.querySelector("#metricQuotation"),
  metricFuture: document.querySelector("#metricFuture"),
  metricDueToday: document.querySelector("#metricDueToday"),
  metricWon: document.querySelector("#metricWon"),
  metricLost: document.querySelector("#metricLost"),
  metricWinRate: document.querySelector("#metricWinRate"),
  leadPanel: document.querySelector("#leadPanel"),
  leadSummary: document.querySelector("#leadSummary"),
  toggleLeadControlsBtn: document.querySelector("#toggleLeadControlsBtn"),
  teamList: document.querySelector("#teamList"),
  leadRows: document.querySelector("#leadRows"),
  searchInput: document.querySelector("#searchInput"),
  assigneeFilter: document.querySelector("#assigneeFilter"),
  statusFilter: document.querySelector("#statusFilter"),
  temperatureFilter: document.querySelector("#temperatureFilter"),
  monthFilter: document.querySelector("#monthFilter"),
  sortSelect: document.querySelector("#sortSelect"),
  detailPanel: document.querySelector("#detailPanel"),
  detailContent: document.querySelector("#detailContent"),
  closeDetailBtn: document.querySelector("#closeDetailBtn"),
  actionCenter: document.querySelector("#actionCenter"),
  actionCards: document.querySelector("#actionCards"),
  smartOwnerControl: document.querySelector("#smartOwnerControl"),
  smartOwnerSelect: document.querySelector("#smartOwnerSelect"),
  clearSmartBtn: document.querySelector("#clearSmartBtn"),
  toggleSmartBtn: document.querySelector("#toggleSmartBtn"),
  toggleChromeBtn: document.querySelector("#toggleChromeBtn"),
  syncInfo: document.querySelector("#syncInfo"),
  notifyBtn: document.querySelector("#notifyBtn"),
  notifyBadge: document.querySelector("#notifyBadge")
};

const team = ["ankit", "reshu", "shubham"];
const BACKEND_URL = "https://rx-whatsapp-agent.onrender.com";
const DASHBOARD_API_KEY = "12345";
const ROLE_AUTH = {
  admin: { pin: "9090", deviceCode: "7A3FCC19", name: "Admin", laptopCode: "" },
  ankit: { pin: "2002", deviceCode: "A0F9EF19", name: "Ankit", laptopCode: "WEB4BC0C648" },
  reshu: { pin: "5757", deviceCode: "D9F49CAC", name: "Reshu", laptopCode: "" },
  shubham: { pin: "2026", deviceCode: "121D5F4C", name: "Shubham", laptopCode: "" }
};

// -------------------------------------------------------------------------
// Client cache: leads + stats are stored in localStorage. On page load the
// dashboard renders instantly from cache, then refreshes in the background
// only if the cache is older than CACHE_FRESH_MS (stale-while-revalidate).
// -------------------------------------------------------------------------
const CACHE_KEY = "rxCrm.cache.v2";
const CACHE_FRESH_MS = 2 * 60 * 1000;   // treat cache as fresh for 2 min
const AUTO_REFRESH_MS = 3 * 60 * 1000;  // background auto refresh

const state = {
  leads: [],
  visibleLeads: [],
  stats: null,
  selectedLead: null,
  loading: false,
  token: "",
  sessionRole: "",
  sessionDeviceCode: "",
  smartFilter: "",
  smartOwner: "",
  metricFilter: "",
  lastSyncAt: 0,
  leadSyncAt: "",
  notifyOn: false,
  prevUrgentIds: []
};

// -------------------------------------------------------------------------
// Which Smart Action cards trigger a desktop notification. Edit this list to
// change what the bell alerts on (keys must match ISSUE_RULES keys).
// -------------------------------------------------------------------------
const NOTIFY_ISSUES = ["overdue", "dueToday", "hotIdle"];
const NOTIFY_STATE_KEY = "rxCrm.notify.v1";
const LEAD_CONTROLS_KEY = "rxCrm.leadControlsCollapsed.v1";
const DETAIL_IMAGE_LIMIT = 5 * 1024 * 1024;
const DETAIL_MEDIA_LIMIT = 16 * 1024 * 1024;
const DETAIL_MEDIA_MIME_BY_EXTENSION = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  pdf: "application/pdf",
  txt: "text/plain",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};
const DETAIL_MEDIA_MIMES = new Set(Object.values(DETAIL_MEDIA_MIME_BY_EXTENSION));
let detailReplyAttachment = null;
let detailReplyPreviewUrl = "";

// -------------------------------------------------------------------------
// Smart issue engine: every rule marks a lead as a "mistake" (employee slip)
// or an "uncovered" lead (nobody is on it). Used by the Action Center,
// team panel and row badges.
// -------------------------------------------------------------------------
const ISSUE_RULES = [
  {
    key: "dueToday",
    label: "Due Today",
    kind: "opportunity",
    hint: "Next actions scheduled for today",
    test: isDueTodayLead
  },
  {
    key: "overdue",
    label: "Overdue Follow Up",
    kind: "mistake",
    hint: "Follow-up time already passed, lead still open",
    test: isOverdueLead
  },
  {
    key: "hotIdle",
    label: "Hot Lead Not Called",
    kind: "mistake",
    hint: "Temperature is HOT but nobody has called",
    test: (lead) => isHotLead(lead) && ["", "not_called"].includes(clean(lead.callStatus))
  },
  {
    key: "quotePending",
    label: "Quote Follow Up",
    kind: "opportunity",
    hint: "Quotation was sent and the next follow-up is missing or due",
    test: isQuoteFollowUpLead
  },
  {
    key: "noFollowDate",
    label: "Follow Up Without Date",
    kind: "mistake",
    hint: "Status is Follow Up but no date/time is set",
    test: (lead) => clean(lead.status) === "follow_up" && !lead.followUpAt
  },
  {
    key: "noNote",
    label: "Worked Without Note",
    kind: "mistake",
    hint: "Lead was contacted but sales note is empty",
    test: (lead) => ["follow_up", "quotation_sent"].includes(clean(lead.status)) || clean(lead.callStatus) === "interested" ? !String(lead.salesNote || "").trim() : false
  },
  {
    key: "unassigned",
    label: "Unassigned Lead",
    kind: "uncovered",
    hint: "No owner - nobody is responsible",
    test: (lead) => isOpenLead(lead) && !team.includes(cleanAssignee(lead.assignedTo))
  },
  {
    key: "untouchedNew",
    label: "Fresh Leads Untouched",
    kind: "uncovered",
    hint: "New leads that have not been called yet",
    test: isFreshUntouchedLead
  },
  {
    key: "silent72",
    label: "Silent 3+ Days",
    kind: "uncovered",
    hint: "Open lead with no message activity for 3 days",
    test: (lead) => isOpenLead(lead) && hoursSince(lead.lastMessageAt || lead.updatedAt || lead.createdAt) > 72
  },
  {
    key: "repeat30",
    label: "Won 30+ Days",
    kind: "opportunity",
    hint: "Past won customer with no activity for 30 days - check for a repeat order",
    test: isRepeatOpportunityLead
  }
];

// -------------------------------------------------------------------------
// MUTUALLY EXCLUSIVE Smart Action cards.
// Every lead is placed in exactly ONE card: the first key below (top = most
// urgent) whose rule matches. To change which card "wins" when a lead
// qualifies for several, just reorder these keys.
// -------------------------------------------------------------------------
const ISSUE_PRIORITY = [
  "overdue",       // deadline already passed -> act first
  "dueToday",      // scheduled for today, still upcoming
  "untouchedNew",  // fresh lead never called
  "quotePending",  // quotation sent, needs chase
  "hotIdle",       // hot lead nobody called
  "noFollowDate",  // follow-up status but no date set
  "unassigned",    // no owner
  "silent72",      // open but silent 3+ days
  "noNote",        // worked but note missing (hygiene)
  "repeat30"       // won 30+ days ago (isolated anyway)
];

const METRIC_FILTERS = {
  open: { label: "Open", test: isOpenLead },
  new: { label: "New", test: isNewLead },
  hot: { label: "Hot", test: isHotLead },
  follow: { label: "Follow Up / Interested", test: isFollowLead },
  quotation: { label: "Quotation", test: isQuotationLead },
  future: { label: "Future", test: isFutureLead },
  dueToday: { label: "Due Today", test: isDueTodayLead },
  won: { label: "Won", test: isWonLead },
  lost: { label: "Lost", test: isLostLead }
};

restoreSettings();
restoreLeadControls();
bindEvents();
restoreNotifyState();

renderEmptyTeam();
bootFromCache();
startAutoRefresh();

function bindEvents() {
  els.connectBtn.addEventListener("click", connect);
  els.logoutBtn.addEventListener("click", logout);
  els.copyLaptopBtn.addEventListener("click", copyLaptopCode);
  if (els.notifyBtn) {
    els.notifyBtn.addEventListener("click", toggleNotifications);
  }
  els.refreshBtn.addEventListener("click", () => loadDashboard({ force: true }));
  if (els.teamRefreshBtn) {
    els.teamRefreshBtn.addEventListener("click", () => loadDashboard({ force: true }));
  }
  els.roleSelect.addEventListener("change", saveSettings);
  els.closeDetailBtn.addEventListener("click", () => {
    clearDetailReplyAttachment();
    state.selectedLead = null;
    els.detailContent.className = "detail-empty";
    els.detailContent.textContent = "Select a lead";
  });
  if (els.clearSmartBtn) {
    els.clearSmartBtn.addEventListener("click", () => {
      state.smartFilter = "";
      renderActionCenter();
      renderLeads();
    });
  }
  if (els.smartOwnerSelect) {
    els.smartOwnerSelect.addEventListener("change", () => {
      state.smartOwner = normalizeTeamMember(els.smartOwnerSelect.value);
      if (isAdminView()) {
        els.assigneeFilter.value = state.smartOwner;
      }
      renderMetrics();
      renderActionCenter();
      renderLeads();
    });
  }
  els.metricCards.forEach((button) => {
    button.addEventListener("click", () => applyMetricFilter(button.dataset.metricFilter));
  });
  if (els.toggleSmartBtn && els.actionCenter) {
    els.toggleSmartBtn.addEventListener("click", () => {
      const collapsed = els.actionCenter.classList.toggle("is-collapsed");
      els.toggleSmartBtn.setAttribute("aria-expanded", String(!collapsed));
      els.toggleSmartBtn.setAttribute("aria-label", collapsed ? "Show Smart Action Center" : "Hide Smart Action Center");
      els.toggleSmartBtn.setAttribute("title", collapsed ? "Show Smart Action Center" : "Hide Smart Action Center");
      els.toggleSmartBtn.querySelector("span").textContent = collapsed ? "⌄" : "⌃";
    });
  }

  if (els.toggleChromeBtn) {
    els.toggleChromeBtn.addEventListener("click", () => {
      const shell = document.querySelector(".app-shell");
      const hidden = shell.classList.toggle("lead-focus-mode");
      els.toggleChromeBtn.setAttribute("aria-expanded", String(!hidden));
      els.toggleChromeBtn.setAttribute("aria-label", hidden ? "Show top panels" : "Hide top panels");
      els.toggleChromeBtn.setAttribute("title", hidden ? "Show top panels" : "Hide top panels");
      els.toggleChromeBtn.querySelector("span").textContent = hidden ? "v" : "^";
    });
  }

  if (els.toggleLeadControlsBtn && els.leadPanel) {
    els.toggleLeadControlsBtn.addEventListener("click", () => {
      setLeadControlsCollapsed(!els.leadPanel.classList.contains("controls-collapsed"));
    });
  }

  [els.searchInput, els.sortSelect]
    .forEach((el) => el.addEventListener("input", renderLeads));
  els.assigneeFilter.addEventListener("input", () => {
    if (isAdminView()) {
      state.smartOwner = normalizeTeamMember(els.assigneeFilter.value);
      if (els.smartOwnerSelect) els.smartOwnerSelect.value = state.smartOwner;
      renderMetrics();
      renderActionCenter();
    }
    renderLeads();
  });
  [els.statusFilter, els.temperatureFilter]
    .forEach((el) => el.addEventListener("input", () => {
      state.metricFilter = "";
      renderLeads();
    }));
  if (els.monthFilter) {
    els.monthFilter.addEventListener("input", () => {
      renderMetrics();
      renderActionCenter();
      renderLeads();
    });
  }
}

function restoreLeadControls() {
  if (!els.toggleLeadControlsBtn || !els.leadPanel) return;
  setLeadControlsCollapsed(localStorage.getItem(LEAD_CONTROLS_KEY) === "true");
}

function setLeadControlsCollapsed(collapsed) {
  if (!els.toggleLeadControlsBtn || !els.leadPanel) return;
  els.leadPanel.classList.toggle("controls-collapsed", collapsed);
  els.toggleLeadControlsBtn.setAttribute("aria-expanded", String(!collapsed));
  els.toggleLeadControlsBtn.setAttribute("aria-label", collapsed ? "Show lead filters" : "Hide lead filters");
  els.toggleLeadControlsBtn.setAttribute("title", collapsed ? "Show lead filters" : "Hide lead filters");
  const icon = els.toggleLeadControlsBtn.querySelector("span");
  if (icon) icon.textContent = collapsed ? "⌄" : "⌃";
  localStorage.setItem(LEAD_CONTROLS_KEY, String(collapsed));
}

function restoreSettings() {
  els.roleSelect.value = localStorage.getItem("rxCrm.role") || "admin";
  els.laptopCode.value = getOrCreateLaptopCode();
  state.token = localStorage.getItem("rxCrm.sessionToken") || "";
  state.sessionRole = localStorage.getItem("rxCrm.sessionRole") || "";
  state.sessionDeviceCode = localStorage.getItem("rxCrm.sessionDeviceCode") || "";
  if (state.token && state.sessionRole) {
    els.roleSelect.value = state.sessionRole;
    els.roleSelect.disabled = true;
  }
  setStatus(state.token ? "Logged in" : "Not logged in", state.token ? "ok" : "");
}

function saveSettings() {
  localStorage.setItem("rxCrm.role", els.roleSelect.value);
}

// Render cached data instantly, then refresh only if stale.
function bootFromCache() {
  if (!state.token) return;
  const cached = readCache();
  if (cached) {
    state.leads = normalizeLeadStatuses(cached.leads);
    state.stats = cached.stats;
    state.lastSyncAt = cached.at;
    state.leadSyncAt = cached.syncAt || "";
    renderAll();
    setStatus("Connected (cached)", "ok");
  }
  const stale = !cached || Date.now() - cached.at > CACHE_FRESH_MS;
  if (stale) loadDashboard({ background: Boolean(cached) });
  else updateSyncInfo();
}

function startAutoRefresh() {
  window.setInterval(() => {
    if (!state.token || state.loading) return;
    // Normally pause when the tab is hidden. But if reminders are on, keep
    // polling in the background so alerts still fire when the CRM is not focused.
    if (document.hidden && !state.notifyOn) return;
    if (Date.now() - state.lastSyncAt < CACHE_FRESH_MS) return;
    loadDashboard({ background: true });
  }, AUTO_REFRESH_MS);
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data.leads) || data.role !== state.sessionRole) return null;
    return data;
  } catch (_error) {
    return null;
  }
}

function writeCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      at: Date.now(),
      role: state.sessionRole,
      leads: state.leads,
      stats: state.stats,
      syncAt: state.leadSyncAt
    }));
  } catch (_error) {
    localStorage.removeItem(CACHE_KEY); // storage full - drop cache
  }
}

function clearCache() {
  localStorage.removeItem(CACHE_KEY);
}

async function connect() {
  try {
    saveSettings();
    await login();
    await loadDashboard({ force: true });
  } catch (error) {
    setStatus("Login error", "bad");
    toast(error.message);
  }
}

async function login() {
  const role = clean(els.roleSelect.value);
  const pin = els.pinInput.value.trim();
  const laptopCode = String(els.laptopCode.value || "").trim().toUpperCase();
  const config = ROLE_AUTH[role];
  if (!config || !pin) {
    throw new Error("Role and PIN are required");
  }
  if (pin !== config.pin) {
    throw new Error("Wrong PIN");
  }
  if (config.laptopCode && laptopCode !== config.laptopCode) {
    throw new Error(`${config.name} can login only from registered laptop`);
  }
  state.token = `direct-${role}-${Date.now()}`;
  state.sessionRole = role;
  state.sessionDeviceCode = config.deviceCode;
  clearCache();
  localStorage.setItem("rxCrm.sessionToken", state.token);
  localStorage.setItem("rxCrm.sessionRole", state.sessionRole);
  localStorage.setItem("rxCrm.sessionDeviceCode", state.sessionDeviceCode);
  els.roleSelect.disabled = true;
  els.pinInput.value = "";
  setStatus(`Logged in as ${config.name}`, "ok");
}

function logout() {
  clearDetailReplyAttachment();
  state.token = "";
  state.sessionRole = "";
  state.sessionDeviceCode = "";
  state.leads = [];
  state.stats = null;
  state.leadSyncAt = "";
  state.selectedLead = null;
  state.smartFilter = "";
  state.smartOwner = "";
  clearCache();
  localStorage.removeItem("rxCrm.sessionToken");
  localStorage.removeItem("rxCrm.sessionRole");
  localStorage.removeItem("rxCrm.sessionDeviceCode");
  els.roleSelect.disabled = false;
  setStatus("Logged out", "");
  renderAll();
  els.detailContent.className = "detail-empty";
  els.detailContent.textContent = "Select a lead";
}

async function loadDashboard(options = {}) {
  const { force = false, background = false, sync = false } = options;
  if (state.loading) return;
  if (!state.token) {
    toast("Login first");
    return;
  }

  // Fresh cache and no force -> skip network completely
  if (!force && !sync && state.lastSyncAt && Date.now() - state.lastSyncAt < CACHE_FRESH_MS) {
    updateSyncInfo();
    return;
  }

  state.loading = true;
  if (!background) setStatus("Loading", "");

  try {
    const headers = force ? { "x-no-cache": "1" } : {};
    let leadData;
    let changed = true;
    if (!force && state.leadSyncAt) {
      leadData = await apiGet(
        `/api/leads/changes?since=${encodeURIComponent(state.leadSyncAt)}&fields=list`,
        headers
      );
      if (leadData.resetRequired) {
        leadData = await apiGet("/api/leads?limit=4000&fields=list", headers);
        state.leads = normalizeLeadStatuses(Array.isArray(leadData.leads) ? leadData.leads : []);
      } else {
        const removed = new Set(Array.isArray(leadData.removedIds) ? leadData.removedIds : []);
        const map = new Map(state.leads.filter((lead) => !removed.has(lead.id)).map((lead) => [lead.id, lead]));
        for (const lead of normalizeLeadStatuses(Array.isArray(leadData.leads) ? leadData.leads : [])) {
          map.set(lead.id, { ...map.get(lead.id), ...lead });
        }
        state.leads = [...map.values()];
        changed = removed.size > 0 || (leadData.leads || []).length > 0;
      }
    } else {
      leadData = await apiGet("/api/leads?limit=4000&fields=list", headers);
      state.leads = normalizeLeadStatuses(Array.isArray(leadData.leads) ? leadData.leads : []);
    }
    state.leadSyncAt = leadData.syncAt || state.leadSyncAt;
    state.stats = null;
    state.lastSyncAt = Date.now();
    writeCache();
    setStatus("Connected", "ok");
    if (changed || force) {
      renderAll();
      runNotifications();
    } else {
      updateSyncInfo();
    }
  } catch (error) {
    if (String(error.message).includes("Login required")) {
      logout();
      toast("Session expired, login again");
    } else {
      setStatus("Error", "bad");
      if (!background) toast(error.message);
    }
  } finally {
    state.loading = false;
  }
}

function renderAll() {
  updateMonthOptions();
  renderMetrics();
  renderActionCenter();
  renderTeam();
  renderLeads();
  updateSyncInfo();
  updateNotifyBadge();
  window.dispatchEvent(new CustomEvent("rxcrm:state"));
}

// -------------------------------------------------------------------------
// Desktop notifications
// -------------------------------------------------------------------------
function notifySupported() {
  return typeof window !== "undefined" && "Notification" in window;
}

function restoreNotifyState() {
  try {
    const raw = localStorage.getItem(NOTIFY_STATE_KEY);
    const data = raw ? JSON.parse(raw) : {};
    state.notifyOn = Boolean(data.on) && notifySupported() && Notification.permission === "granted";
    state.prevUrgentIds = Array.isArray(data.ids) ? data.ids : [];
  } catch (_error) {
    state.notifyOn = false;
    state.prevUrgentIds = [];
  }
  updateNotifyButton();
}

function saveNotifyState() {
  try {
    localStorage.setItem(NOTIFY_STATE_KEY, JSON.stringify({
      on: state.notifyOn,
      ids: state.prevUrgentIds
    }));
  } catch (_error) { /* ignore */ }
}

async function toggleNotifications() {
  if (!notifySupported()) {
    toast("This browser does not support desktop notifications");
    return;
  }
  if (state.notifyOn) {
    state.notifyOn = false;
    saveNotifyState();
    updateNotifyButton();
    toast("Reminders turned off");
    return;
  }
  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") {
    toast("Allow notifications for this site in your browser settings");
    return;
  }
  state.notifyOn = true;
  state.prevUrgentIds = urgentLeads().map((lead) => lead.id); // seed, no burst
  saveNotifyState();
  updateNotifyButton();
  const count = state.prevUrgentIds.length;
  toast(count ? `Reminders on — ${count} lead${count > 1 ? "s" : ""} need action` : "Reminders on");
  if (count) fireNotification("RX CRM reminders on", `${count} lead${count > 1 ? "s" : ""} need action right now`);
}

function updateNotifyButton() {
  if (!els.notifyBtn) return;
  els.notifyBtn.classList.toggle("on", state.notifyOn);
  els.notifyBtn.setAttribute("aria-pressed", state.notifyOn ? "true" : "false");
  els.notifyBtn.title = state.notifyOn ? "Desktop reminders on — click to turn off" : "Turn on desktop reminders";
}

function urgentLeads() {
  return filteredByOwner(state.leads).filter((lead) => {
    const rule = primaryIssue(lead);
    return rule && NOTIFY_ISSUES.includes(rule.key);
  });
}

function updateNotifyBadge() {
  if (!els.notifyBadge) return;
  const count = state.token ? urgentLeads().length : 0;
  els.notifyBadge.textContent = String(count);
  els.notifyBadge.hidden = count === 0;
}

// Called only after a real network refresh, so it does not fire on filtering.
function runNotifications() {
  updateNotifyBadge();
  if (!state.notifyOn || !notifySupported() || Notification.permission !== "granted") return;

  const urgent = urgentLeads();
  const currentIds = urgent.map((lead) => lead.id);
  const prev = new Set(state.prevUrgentIds || []);
  const fresh = urgent.filter((lead) => !prev.has(lead.id));

  state.prevUrgentIds = currentIds; // resets when a lead is resolved, so it can re-alert later
  saveNotifyState();

  if (!fresh.length) return;
  if (fresh.length <= 3) {
    fresh.forEach((lead) => {
      const rule = primaryIssue(lead);
      const who = lead.name || lead.phone || lead.id;
      fireNotification(`${rule ? rule.label : "Action needed"}: ${who}`, shortText(lead.requirement || lead.leadSummary || "Open this lead in the CRM"));
    });
  } else {
    fireNotification(`${fresh.length} leads need action`, "Open the CRM to work the priority queue");
  }
}

function fireNotification(title, body) {
  try {
    const note = new Notification(title, {
      body: body || "",
      tag: "rx-crm"
    });
    note.onclick = () => { window.focus(); note.close(); };
  } catch (_error) { /* ignore */ }
}

function updateSyncInfo() {
  if (!els.syncInfo) return;
  els.syncInfo.textContent = state.lastSyncAt
    ? `Synced ${formatDate(new Date(state.lastSyncAt).toISOString())}`
    : "";
}

function applyMetricFilter(filterKey) {
  const key = String(filterKey || "");
  state.smartFilter = "";
  els.statusFilter.value = "";
  els.temperatureFilter.value = "";

  if (key === "total") {
    state.metricFilter = "";
  } else if (METRIC_FILTERS[key]) {
    state.metricFilter = state.metricFilter === key ? "" : key;
  }

  renderActionCenter();
  renderLeads();
}

function updateMonthOptions() {
  if (!els.monthFilter) return;
  const selected = els.monthFilter.value;
  const currentMonth = dateMonthKey(new Date());
  const months = Array.from(new Set(
    filteredByOwner(state.leads).map(leadMonthKey).filter(Boolean)
  )).sort().reverse();

  els.monthFilter.innerHTML = [
    '<option value="">All months</option>',
    ...months.map((month) => {
      const currentLabel = month === currentMonth ? " (Current)" : "";
      return `<option value="${month}">${escapeHtml(formatMonthKey(month))}${currentLabel}</option>`;
    })
  ].join("");
  els.monthFilter.value = months.includes(selected) ? selected : "";
}

function filterLeadsByMonth(leads) {
  const selected = els.monthFilter ? els.monthFilter.value : "";
  if (!selected) return leads;
  return leads.filter((lead) => leadMonthKey(lead) === selected);
}

function leadMonthKey(lead) {
  return dateMonthKey(new Date(lead?.createdAt || ""));
}

function dateMonthKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthKey(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ""));
  if (!match) return "Unknown month";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function renderMetrics() {
  const leads = actionCenterLeads();
  const open = leads.filter(isOpenLead).length;
  const newLeads = leads.filter(isNewLead).length;
  const hot = leads.filter(isHotLead).length;
  const follow = leads.filter(isFollowLead).length;
  const quotation = leads.filter(isQuotationLead).length;
  const future = leads.filter(isFutureLead).length;
  const dueToday = leads.filter(isDueTodayLead).length;
  const won = leads.filter(isWonLead).length;
  const lost = leads.filter(isLostLead).length;

  setAnimatedMetric(els.metricTotal, leads.length);
  els.metricOpen.textContent = open;
  if (els.metricNew) els.metricNew.textContent = newLeads;
  els.metricHot.textContent = hot;
  els.metricFollow.textContent = follow;
  if (els.metricQuotation) els.metricQuotation.textContent = quotation;
  if (els.metricFuture) els.metricFuture.textContent = future;
  if (els.metricDueToday) els.metricDueToday.textContent = dueToday;
  setAnimatedMetric(els.metricWon, won);
  setAnimatedMetric(els.metricLost, lost);
  renderPerformanceBoard(leads.length, won, lost);

  updateMetricCards();
}

function setAnimatedMetric(element, value) {
  if (!element) return;
  const target = Math.max(0, Number(value) || 0);
  const current = Number(String(element.textContent || "0").replace(/,/g, "")) || 0;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  if (element._metricAnimation) cancelAnimationFrame(element._metricAnimation);
  if (reduceMotion || current === target) {
    element.textContent = target.toLocaleString("en-IN");
    return;
  }

  const startedAt = performance.now();
  const duration = 620;
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const displayed = Math.round(current + (target - current) * eased);
    element.textContent = displayed.toLocaleString("en-IN");
    if (progress < 1) element._metricAnimation = requestAnimationFrame(tick);
  };
  element._metricAnimation = requestAnimationFrame(tick);
}

function renderPerformanceBoard(total, won, lost) {
  const winRate = total ? (won / total) * 100 : 0;
  setAnimatedPercent(els.metricWinRate, winRate, 2);
}

function setAnimatedPercent(element, value, decimals = 0) {
  if (!element) return;
  const target = Math.max(0, Math.min(100, Number(value) || 0));
  const current = Number.parseFloat(String(element.textContent || "0").replace(/,/g, "")) || 0;
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const format = (number) => `${Number(number).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })}%`;

  if (element._metricAnimation) cancelAnimationFrame(element._metricAnimation);
  if (reduceMotion || current.toFixed(decimals) === target.toFixed(decimals)) {
    element.textContent = format(target);
    return;
  }

  const startedAt = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - startedAt) / 650);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = format(current + (target - current) * eased);
    if (progress < 1) element._metricAnimation = requestAnimationFrame(tick);
  };
  element._metricAnimation = requestAnimationFrame(tick);
}

function updateMetricCards() {
  els.metricCards.forEach((button) => {
    const key = button.dataset.metricFilter;
    const active = key === "total"
      ? !state.metricFilter && !state.smartFilter && !clean(els.statusFilter.value) && !clean(els.temperatureFilter.value)
      : state.metricFilter === key;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

// ------------------------- Smart Action Center ---------------------------

function leadIssues(lead) {
  return ISSUE_RULES.filter((rule) => {
    try { return rule.test(lead); } catch (_error) { return false; }
  });
}

// Returns the single highest-priority rule a lead matches (or null).
// This is what makes the Smart Action cards mutually exclusive.
function primaryIssue(lead) {
  for (const key of ISSUE_PRIORITY) {
    const rule = ISSUE_RULES.find((r) => r.key === key);
    if (!rule) continue;
    try { if (rule.test(lead)) return rule; } catch (_error) { /* skip */ }
  }
  return null;
}

function actionCenterLeads() {
  const owner = currentSmartOwner();
  return filterLeadsByMonth(filteredByOwner(state.leads)).filter((lead) => {
    return !owner || cleanAssignee(lead.assignedTo) === owner;
  });
}

function updateSmartOwnerControl() {
  if (!els.smartOwnerControl || !els.smartOwnerSelect) return;
  const visible = isAdminView();
  els.smartOwnerControl.hidden = !visible;
  if (!visible) {
    state.smartOwner = "";
    els.smartOwnerSelect.value = "";
    return;
  }
  els.smartOwnerSelect.value = state.smartOwner;
}

function currentSmartOwner() {
  if (!isAdminView()) return "";
  return normalizeTeamMember(state.smartOwner);
}

function renderActionCenter() {
  if (!els.actionCards) return;
  updateSmartOwnerControl();
  const leads = actionCenterLeads();
  const counts = {};
  ISSUE_RULES.forEach((rule) => { counts[rule.key] = 0; });
  leads.forEach((lead) => {
    const rule = primaryIssue(lead);
    if (rule) counts[rule.key] += 1;
  });

  els.actionCards.innerHTML = ISSUE_RULES.map((rule) => `
    <button class="action-card ${rule.kind} issue-${rule.key} ${state.smartFilter === rule.key ? "active" : ""} ${counts[rule.key] ? "" : "empty"}"
      type="button" data-smart="${rule.key}" title="${escapeAttr(rule.hint)}">
      <strong>${counts[rule.key]}</strong>
      <span>${rule.label}</span>
    </button>
  `).join("");

  els.actionCards.querySelectorAll("[data-smart]").forEach((button) => {
    button.addEventListener("click", () => {
      state.metricFilter = "";
      els.statusFilter.value = "";
      els.temperatureFilter.value = "";
      state.smartFilter = state.smartFilter === button.dataset.smart ? "" : button.dataset.smart;
      renderActionCenter();
      renderLeads();
    });
  });

  if (els.clearSmartBtn) {
    els.clearSmartBtn.style.display = state.smartFilter ? "" : "none";
  }
}

function renderTeam() {
  if (!els.teamList) return;
  const grouped = makeTeamStats();
  els.teamList.innerHTML = team.map((member) => {
    const s = grouped[member] || blankStats();
    return `
      <button class="team-item" type="button" data-team="${member}">
        <strong>${displayName(member)}</strong>
        <span class="team-stats">
          <span>${s.total} total</span>
          <span>${s.openLeads} open</span>
          <span>${s.hot} hot</span>
        </span>
      </button>
    `;
  }).join("");

  els.teamList.querySelectorAll("[data-team]").forEach((button) => {
    button.addEventListener("click", () => {
      els.assigneeFilter.value = button.dataset.team;
      renderLeads();
    });
  });
}

function makeTeamMistakes() {
  const result = {};
  team.forEach((member) => { result[member] = { mistake: 0, uncovered: 0 }; });
  filteredByOwner(state.leads).forEach((lead) => {
    const owner = cleanAssignee(lead.assignedTo);
    if (!result[owner]) return;
    leadIssues(lead).forEach((rule) => { result[owner][rule.kind] += 1; });
  });
  return result;
}

function renderEmptyTeam() {
  if (!els.teamList) return;
  els.teamList.innerHTML = team.map((member) => `
    <div class="team-item">
      <strong>${displayName(member)}</strong>
      <span class="team-stats"><span>0 total</span><span>0 open</span><span>0 hot</span></span>
    </div>
  `).join("");
}

function renderLeads() {
  const query = clean(els.searchInput.value);
  const assignee = clean(els.assigneeFilter.value);
  const status = clean(els.statusFilter.value);
  const temperature = clean(els.temperatureFilter.value);
  const month = els.monthFilter ? els.monthFilter.value : "";
  const sort = els.sortSelect.value;
  const smartRule = ISSUE_RULES.find((rule) => rule.key === state.smartFilter);
  const metricRule = METRIC_FILTERS[state.metricFilter];
  const allScopedLeads = filteredByOwner(state.leads);
  const monthLeads = filterLeadsByMonth(allScopedLeads);

  let leads = monthLeads.filter((lead) => {
    if (metricRule && !metricRule.test(lead)) return false;
    if (smartRule && primaryIssue(lead)?.key !== smartRule.key) return false;
    if (assignee && cleanAssignee(lead.assignedTo) !== assignee) return false;
    if (status === "new" && !isNewLead(lead)) return false;
    if (status === "fresh_untouched" && !isFreshUntouchedLead(lead)) return false;
    if (status === "interested" && clean(lead.callStatus) !== "interested") return false;
    if (status && !["new", "fresh_untouched", "interested"].includes(status) && clean(lead.status || "new") !== status) return false;
    if (temperature && clean(lead.temperature || "cold") !== temperature) return false;
    if (query && !searchText(lead).includes(query)) return false;
    return true;
  });

  leads = sortLeads(leads, sort);
  state.visibleLeads = leads;
  const filterLabels = [];
  if (assignee) filterLabels.push(displayName(assignee));
  if (month) filterLabels.push(formatMonthKey(month));
  if (metricRule) filterLabels.push(metricRule.label);
  if (smartRule) filterLabels.push(smartRule.label);
  const activeLabel = filterLabels.length ? ` | Filter: ${filterLabels.join(" + ")}` : "";
  const loadedLabel = month
    ? `${leads.length} visible of ${monthLeads.length} in month (${allScopedLeads.length} loaded)`
    : `${leads.length} visible of ${allScopedLeads.length} loaded`;
  els.leadSummary.textContent = `${loadedLabel}${activeLabel}`;
  updateMetricCards();

  if (!leads.length) {
    els.leadRows.innerHTML = `<tr><td colspan="3">No leads found</td></tr>`;
    return;
  }

  els.leadRows.innerHTML = leads.map((lead) => {
    const primary = primaryIssue(lead);
    const badges = primary
      ? `<span class="issue-badge ${primary.kind}" title="${escapeAttr(primary.hint)}">${primary.label}</span>`
      : "";
    return `
    <tr data-lead-id="${escapeAttr(lead.id)}" class="${primary ? "has-issues" : ""}">
      <td>
        <span class="customer-phone">${escapeHtml(lead.phone || lead.id || "")}</span>
        <span class="customer-name">${escapeHtml(lead.name || "Unknown")}</span>
        <span class="customer-sub">${escapeHtml(shortText(lead.requirement || lead.leadSummary || ""))}</span>
        ${badges ? `<span class="issue-row">${badges}</span>` : ""}
      </td>
      <td><span class="chip">${formatOption(lead.status || "new")}</span></td>
      <td class="lead-signal-cell">
        <span class="chip ${clean(lead.temperature || "cold")}">${formatOption(lead.temperature || "cold")}</span>
        <strong class="lead-score" title="Lead score">${Number(lead.leadScore) || 0}</strong>
      </td>
    </tr>
  `;
  }).join("");

  els.leadRows.querySelectorAll("[data-lead-id]").forEach((row) => {
    row.addEventListener("click", () => openLead(row.dataset.leadId));
  });
}

async function openLead(leadId) {
  clearDetailReplyAttachment();
  els.detailContent.className = "detail-empty";
  els.detailContent.textContent = "Loading lead...";
  try {
    const data = await apiGet(`/api/leads/${encodeURIComponent(leadId)}?messages=30`, { "x-no-cache": "1" });
    state.selectedLead = normalizeLeadStatus(data.lead);
    renderDetail(state.selectedLead);
  } catch (error) {
    toast(error.message);
    els.detailContent.textContent = "Could not load lead";
  }
}

function renderDetail(lead) {
  const messages = Array.isArray(lead.messages) ? lead.messages : [];
  const primary = primaryIssue(lead);
  const nextAction = describeNextAction(lead);
  els.detailContent.className = "detail-body";
  els.detailContent.innerHTML = `
    ${primary ? `<div class="issue-row detail-issues"><span class="issue-badge ${primary.kind}" title="${escapeAttr(primary.hint)}">${primary.label}</span></div>` : ""}
    <section class="customer-journey" aria-label="Customer journey">
      <div class="journey-heading">
        <h3>Customer Journey</h3>
        <span class="next-action ${nextAction.tone}">${escapeHtml(nextAction.label)}</span>
      </div>
      <div class="journey-grid">
        <div><span>Created</span><strong>${escapeHtml(formatDate(lead.createdAt))}</strong></div>
        <div><span>Last Contact</span><strong>${escapeHtml(formatDate(lead.lastMessageAt || lead.updatedAt || lead.createdAt))}</strong></div>
        <div><span>Stage</span><strong>${escapeHtml(formatOption(lead.status || "new"))}</strong></div>
        <div><span>Owner</span><strong>${escapeHtml(displayName(cleanAssignee(lead.assignedTo) || "unassigned"))}</strong></div>
      </div>
    </section>
    <div class="detail-grid">
      <label class="wide detail-phone-label">Phone Number<input id="detailPhone" value="${escapeAttr(lead.phone || lead.id || "")}" readonly></label>
      <label>Name<input id="detailName" value="${escapeAttr(lead.name || "")}"></label>
      <label>City<input id="detailCity" value="${escapeAttr(lead.city || "")}"></label>
      <label>Owner
        <select id="detailAssignee">
          ${team.map((member) => `<option value="${member}" ${cleanAssignee(lead.assignedTo) === member ? "selected" : ""}>${displayName(member)}</option>`).join("")}
        </select>
      </label>
      <label>Status
        <select id="detailStatus">
          ${["new", "follow_up", "quotation_sent", "future", "converted", "lost"].map((item) => option(item, lead.status || "new")).join("")}
        </select>
      </label>
      <label>Temperature
        <select id="detailTemp">
          ${["hot", "warm", "cold"].map((item) => option(item, lead.temperature || "cold")).join("")}
        </select>
      </label>
      <label>Call
        <select id="detailCall">
          ${["not_called", "called", "no_answer", "callback", "interested", "not_interested", "converted"].map((item) => option(item, lead.callStatus || "not_called")).join("")}
        </select>
      </label>
      <label class="wide">Requirement<input id="detailRequirement" value="${escapeAttr(lead.requirement || "")}"></label>
      <label class="wide">Next Action Time<input id="detailFollow" type="datetime-local" value="${toLocalInputValue(lead.followUpAt)}"></label>
      <div class="wide quick-follow" aria-label="Quick next action">
        <span>Quick schedule</span>
        <button class="ghost-button" type="button" data-follow-days="1">Tomorrow 10 AM</button>
        <button class="ghost-button" type="button" data-follow-days="3">+3 Days</button>
        <button class="ghost-button" type="button" data-follow-days="7">+7 Days</button>
      </div>
      <label class="wide">Sales Note<textarea id="detailNote">${escapeHtml(lead.salesNote || "")}</textarea></label>
    </div>
    <div class="detail-actions">
      <button id="saveLeadBtn" class="primary-action compact" type="button">Save Lead</button>
      <button id="whatsappBtn" class="ghost-button" type="button">Open WhatsApp</button>
    </div>
    <h3>Messages</h3>
    <div class="message-list">
      ${messages.length ? messages.map(renderMessage).join("") : "<p class=\"detail-empty\">No messages loaded</p>"}
    </div>
    <section class="detail-chat-composer" aria-label="Send WhatsApp message">
      <div class="detail-chat-heading">
        <div>
          <h3>WhatsApp Reply</h3>
          <small>Send text, image, video or document</small>
        </div>
        <span class="detail-chat-live"><i aria-hidden="true"></i> Ready</span>
      </div>
      <label class="detail-reply-label" for="replyText">Message or caption</label>
      <textarea id="replyText" maxlength="4096" placeholder="Type a WhatsApp message"></textarea>
      <div id="detailAttachmentPreview" class="detail-attachment-preview" hidden></div>
      <input
        id="detailReplyFile"
        type="file"
        hidden
        accept="image/jpeg,image/png,video/mp4,video/3gpp,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
      >
      <div class="detail-chat-actions">
        <button id="detailAttachBtn" class="ghost-button detail-attach-button" type="button">
          <span aria-hidden="true">＋</span> Attach
        </button>
        <button id="detailRemoveFileBtn" class="ghost-button detail-remove-file" type="button" hidden>Remove file</button>
        <button id="sendReplyBtn" class="primary-action compact detail-send-button" type="button">Send</button>
      </div>
      <small class="detail-upload-hint">Images up to 5 MB; video and documents up to 16 MB.</small>
    </section>
  `;

  document.querySelector("#saveLeadBtn").addEventListener("click", () => saveLead(lead.id));
  document.querySelector("#sendReplyBtn").addEventListener("click", () => sendReply(lead.id));
  document.querySelector("#detailAttachBtn").addEventListener("click", () => {
    document.querySelector("#detailReplyFile")?.click();
  });
  document.querySelector("#detailReplyFile").addEventListener("change", (event) => {
    handleDetailReplyFile(event.target.files?.[0]);
  });
  document.querySelector("#detailRemoveFileBtn").addEventListener("click", clearDetailReplyAttachment);
  document.querySelector("#detailCall").addEventListener("change", syncStatusFromCall);
  document.querySelectorAll("[data-follow-days]").forEach((button) => {
    button.addEventListener("click", () => setQuickNextAction(Number(button.dataset.followDays)));
  });
  document.querySelector("#whatsappBtn").addEventListener("click", () => {
    if (window.RXWhatsApp) window.RXWhatsApp.open(lead.id);
  });
}

function setQuickNextAction(days) {
  const input = document.querySelector("#detailFollow");
  const status = document.querySelector("#detailStatus");
  const call = document.querySelector("#detailCall");
  if (!input || !Number.isFinite(days)) return;

  const due = new Date();
  due.setDate(due.getDate() + days);
  due.setHours(10, 0, 0, 0);
  input.value = toLocalInputValue(due.toISOString());

  const keepNew = clean(status?.value) === "new" && shouldKeepNewStatus(call?.value);
  if (status && !keepNew && clean(status.value) === "new") {
    status.value = "follow_up";
  }
  toast(`Next action set for ${formatDate(due.toISOString())}`);
}

function syncStatusFromCall() {
  const status = document.querySelector("#detailStatus");
  const call = document.querySelector("#detailCall");
  if (!status || !call) return;

  const nextStatus = statusForCallOutcome(status.value, call.value);
  if (nextStatus !== clean(status.value)) {
    status.value = nextStatus;
    if (nextStatus === "follow_up") toast("Interested lead moved to Follow Up");
  }
}

function shouldKeepNewStatus(callStatus) {
  return ["not_called", "called", "callback", "no_answer", "called_no_answer", "not_interested"].includes(clean(callStatus));
}

function statusForCallOutcome(status, callStatus) {
  const cleanedStatus = clean(status || "new");
  const currentStatus = cleanedStatus === "contacted" ? "new" : cleanedStatus;
  const outcome = clean(callStatus);
  if (currentStatus === "quotation_sent") return "quotation_sent";
  if (outcome === "converted") return "converted";
  if (outcome === "interested") return "follow_up";
  if (["new", "follow_up"].includes(currentStatus) && shouldKeepNewStatus(outcome)) return "new";
  return currentStatus;
}

async function saveLead(leadId) {
  const body = {
    name: document.querySelector("#detailName").value.trim(),
    city: document.querySelector("#detailCity").value.trim(),
    assignedTo: document.querySelector("#detailAssignee").value,
    status: document.querySelector("#detailStatus").value,
    temperature: document.querySelector("#detailTemp").value,
    callStatus: document.querySelector("#detailCall").value,
    requirement: document.querySelector("#detailRequirement").value.trim(),
    followUpAt: fromLocalInputValue(document.querySelector("#detailFollow").value),
    salesNote: document.querySelector("#detailNote").value.trim()
  };
  body.status = statusForCallOutcome(body.status, body.callStatus);
  document.querySelector("#detailStatus").value = body.status;

  const statusKey = clean(body.status);
  const closed = ["converted", "lost"].includes(statusKey);
  const parkedFuture = statusKey === "future";
  const worked = !["new", "future", "converted", "lost"].includes(statusKey)
    || ["callback", "interested"].includes(clean(body.callStatus));
  if (!closed && !parkedFuture && worked && !body.followUpAt) {
    toast("Set a future Next Action time, or mark the lead Won/Lost/Future");
    document.querySelector("#detailFollow").focus();
    return;
  }
  if (!closed && !parkedFuture && worked && new Date(body.followUpAt).getTime() <= Date.now()) {
    toast("Next Action time must be in the future");
    document.querySelector("#detailFollow").focus();
    return;
  }

  try {
    await apiPost(`/api/leads/${encodeURIComponent(leadId)}/update`, body);
    toast(statusKey === "converted" ? "Deal won" : statusKey === "quotation_sent" ? "Quotation sent" : "Lead saved");
    await loadDashboard({ sync: true });
    await openLead(leadId);
  } catch (error) {
    toast(error.message);
  }
}

function detailReplyMime(file) {
  const supplied = clean(String(file?.type || "").split(";")[0]);
  if (DETAIL_MEDIA_MIMES.has(supplied)) return supplied;
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  return DETAIL_MEDIA_MIME_BY_EXTENSION[extension] || "";
}

function detailReplyKind(mime) {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return "document";
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function clearDetailReplyAttachment() {
  if (detailReplyPreviewUrl && window.URL && typeof window.URL.revokeObjectURL === "function") {
    window.URL.revokeObjectURL(detailReplyPreviewUrl);
  }
  detailReplyPreviewUrl = "";
  detailReplyAttachment = null;
  const input = document.querySelector("#detailReplyFile");
  const preview = document.querySelector("#detailAttachmentPreview");
  const removeButton = document.querySelector("#detailRemoveFileBtn");
  if (input) input.value = "";
  if (preview) {
    preview.innerHTML = "";
    preview.hidden = true;
  }
  if (removeButton) removeButton.hidden = true;
}

function handleDetailReplyFile(file) {
  if (!file) return;
  const mime = detailReplyMime(file);
  if (!mime || !DETAIL_MEDIA_MIMES.has(mime)) {
    clearDetailReplyAttachment();
    toast("Choose a JPG, PNG, MP4, 3GP, PDF or Office document");
    return;
  }

  const kind = detailReplyKind(mime);
  const maxBytes = kind === "image" ? DETAIL_IMAGE_LIMIT : DETAIL_MEDIA_LIMIT;
  if (!file.size || file.size > maxBytes) {
    clearDetailReplyAttachment();
    toast(kind === "image" ? "Image must be 5 MB or smaller" : "File must be 16 MB or smaller");
    return;
  }

  clearDetailReplyAttachment();
  detailReplyAttachment = { file, mime, kind };
  if (window.URL && typeof window.URL.createObjectURL === "function") {
    detailReplyPreviewUrl = window.URL.createObjectURL(file);
  }

  const preview = document.querySelector("#detailAttachmentPreview");
  const removeButton = document.querySelector("#detailRemoveFileBtn");
  if (!preview) return;
  const visual = detailReplyPreviewUrl && kind === "image"
    ? `<img src="${escapeAttr(detailReplyPreviewUrl)}" alt="Selected attachment preview">`
    : detailReplyPreviewUrl && kind === "video"
      ? `<video src="${escapeAttr(detailReplyPreviewUrl)}" controls preload="metadata"></video>`
      : `<span class="detail-file-icon" aria-hidden="true">DOC</span>`;
  preview.innerHTML = `
    ${visual}
    <div class="detail-file-meta">
      <strong>${escapeHtml(file.name || "Attachment")}</strong>
      <span>${escapeHtml(formatOption(kind))} · ${escapeHtml(formatFileSize(file.size))}</span>
    </div>
  `;
  preview.hidden = false;
  if (removeButton) removeButton.hidden = false;
}

function makeClientMessageId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `crm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function sendReply(leadId) {
  const replyInput = document.querySelector("#replyText");
  const sendButton = document.querySelector("#sendReplyBtn");
  const attachButton = document.querySelector("#detailAttachBtn");
  const text = replyInput?.value.trim() || "";
  const attachment = detailReplyAttachment;
  if (!text && !attachment) {
    toast("Type a message or attach a file");
    return;
  }
  if (attachment && text.length > 1024) {
    toast("Attachment caption can contain up to 1024 characters");
    replyInput.focus();
    return;
  }

  if (sendButton) {
    sendButton.disabled = true;
    sendButton.textContent = "Sending...";
  }
  if (attachButton) attachButton.disabled = true;
  try {
    const clientMessageId = makeClientMessageId();
    if (attachment) {
      const params = new URLSearchParams({
        clientMessageId,
        filename: attachment.file.name || "attachment",
        caption: text
      });
      await apiFetch(`/api/chats/${encodeURIComponent(leadId)}/send-media?${params}`, {
        method: "POST",
        headers: { "Content-Type": attachment.mime },
        body: attachment.file
      });
      toast("Attachment sent");
    } else {
      await apiPost(`/api/chats/${encodeURIComponent(leadId)}/send`, { text, clientMessageId });
      toast("Reply sent");
    }
    clearDetailReplyAttachment();
    if (replyInput) replyInput.value = "";
    await openLead(leadId);
    await loadDashboard({ sync: true });
  } catch (error) {
    toast(error.message);
  } finally {
    if (sendButton) {
      sendButton.disabled = false;
      sendButton.textContent = "Send";
    }
    if (attachButton) attachButton.disabled = false;
  }
}

// Owner scoping uses the LOGGED-IN role (server also enforces this).
function filteredByOwner(leads) {
  const role = clean(state.sessionRole || els.roleSelect.value);
  if (role === "admin") return leads;
  return leads.filter((lead) => cleanAssignee(lead.assignedTo) === role);
}

function isAdminView() {
  return clean(state.sessionRole || els.roleSelect.value) === "admin";
}

function normalizeTeamMember(value) {
  const member = cleanAssignee(value);
  return team.includes(member) ? member : "";
}

function makeTeamStats() {
  if (state.stats && state.stats.stats) return state.stats.stats;
  const stats = {};
  team.forEach((member) => { stats[member] = blankStats(); });
  state.leads.forEach((lead) => {
    const owner = cleanAssignee(lead.assignedTo);
    if (!stats[owner]) return;
    stats[owner].total += 1;
    if (isOpenLead(lead)) stats[owner].openLeads += 1;
    if (isHotLead(lead)) stats[owner].hot += 1;
  });
  return stats;
}

function blankStats() {
  return { total: 0, openLeads: 0, hot: 0 };
}

function isOpenLead(lead) {
  return !isWonLead(lead) && !isLostLead(lead);
}

function isNewLead(lead) {
  if (!isOpenLead(lead)) return false;
  const status = clean(lead.status || "new");
  if (["quotation_sent", "future"].includes(status)) return false;
  return !isInterestedLead(lead);
}

function isFreshUntouchedLead(lead) {
  const status = clean(lead.status || "new");
  const callStatus = clean(lead.callStatus || "");
  return status === "new" && ["", "not_called"].includes(callStatus);
}

function isHotLead(lead) {
  return isOpenLead(lead) && clean(lead.temperature || "cold") === "hot";
}

function isFollowLead(lead) {
  const status = clean(lead.status || "new");
  if (["quotation_sent", "future", "converted", "lost"].includes(status)) return false;
  return isInterestedLead(lead);
}

function isInterestedLead(lead) {
  return clean(lead.status) === "interested" || clean(lead.callStatus) === "interested";
}

function isWonLead(lead) {
  return clean(lead.status) === "converted" || clean(lead.callStatus) === "converted";
}

function isLostLead(lead) {
  return clean(lead.status) === "lost";
}

function isQuotationLead(lead) {
  return clean(lead.status || "new") === "quotation_sent";
}

function isFutureLead(lead) {
  return clean(lead.status || "new") === "future";
}

function isOverdueLead(lead) {
  if (!isOpenLead(lead) || !lead.followUpAt) return false;
  const due = new Date(lead.followUpAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

function isDueTodayLead(lead) {
  if (!isOpenLead(lead) || !lead.followUpAt) return false;
  const due = new Date(lead.followUpAt);
  const today = new Date();
  if (Number.isNaN(due.getTime())) return false;
  return due.getFullYear() === today.getFullYear()
    && due.getMonth() === today.getMonth()
    && due.getDate() === today.getDate();
}

function isQuoteFollowUpLead(lead) {
  if (!isOpenLead(lead) || clean(lead.status) !== "quotation_sent") return false;
  if (!lead.followUpAt) return true;
  const due = new Date(lead.followUpAt);
  if (Number.isNaN(due.getTime())) return true;
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  return due.getTime() <= endOfToday.getTime();
}

function isRepeatOpportunityLead(lead) {
  if (!isWonLead(lead)) return false;
  const activity = latestActivityAt(lead);
  return Boolean(activity) && hoursSince(activity) >= 24 * 30;
}

function latestActivityAt(lead) {
  const times = [lead.lastMessageAt, lead.updatedAt, lead.createdAt]
    .map((value) => new Date(value || "").getTime())
    .filter((value) => Number.isFinite(value));
  return times.length ? new Date(Math.max(...times)).toISOString() : "";
}

function describeNextAction(lead) {
  if (isWonLead(lead)) {
    return isRepeatOpportunityLead(lead)
      ? { label: "Repeat check due", tone: "attention" }
      : { label: "Won", tone: "done" };
  }
  if (clean(lead.status) === "lost") return { label: "Lost", tone: "muted" };

  if (lead.followUpAt) {
    const due = new Date(lead.followUpAt);
    if (!Number.isNaN(due.getTime())) {
      if (isOverdueLead(lead)) return { label: `Overdue · ${formatDate(lead.followUpAt)}`, tone: "overdue" };
      if (isDueTodayLead(lead)) return { label: `Due today · ${formatDate(lead.followUpAt)}`, tone: "today" };
      return { label: `Scheduled · ${formatDate(lead.followUpAt)}`, tone: "scheduled" };
    }
  }

  if (clean(lead.status) === "future") return { label: "Future client", tone: "scheduled" };
  if (isFreshUntouchedLead(lead)) return { label: "Contact now", tone: "attention" };
  if (clean(lead.status) === "quotation_sent") return { label: "Set quote follow-up", tone: "attention" };
  return { label: "Set next action", tone: "attention" };
}

function workPriorityScore(lead) {
  let score = Number(lead.leadScore) || 0;
  if (isOverdueLead(lead)) score += 1000;
  if (isDueTodayLead(lead)) score += 850;
  if (isFreshUntouchedLead(lead)) score += 800;
  if (isQuoteFollowUpLead(lead)) score += 700;
  if (isHotLead(lead)) score += 650;
  if (isInterestedLead(lead)) score += 600;
  if (isRepeatOpportunityLead(lead)) score += 450;
  if (isFollowLead(lead)) score += 300;
  if (clean(lead.status) === "lost") score -= 1000;
  return score;
}

function hoursSince(value) {
  if (!value) return Infinity;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Infinity;
  return (Date.now() - date.getTime()) / 36e5;
}

async function apiGet(path, headers) {
  return apiFetch(path, { headers });
}

async function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    body: JSON.stringify(body || {})
  });
}

async function apiFetch(path, options = {}) {
  const role = clean(state.sessionRole || els.roleSelect.value);
  const config = ROLE_AUTH[role] || {};
  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-dashboard-key": DASHBOARD_API_KEY,
      "x-device-code": state.sessionDeviceCode || config.deviceCode || "",
      "x-device-role": role,
      "x-device-user": displayName(role),
      ...(options.headers || {})
    }
  });
  if (options.responseType === "blob" && response.ok) return response.blob();
  if (options.responseType === 'stream' && response.ok) return response;
  const text = await response.text();
  const data = parseJsonText(text);
  if (!response.ok) {
    throw Object.assign(new Error(data.error || data.detail || `API error ${response.status}`), { status: response.status });
  }
  return data;
}

async function readJsonResponse(response) {
  const text = await response.text();
  return parseJsonText(text);
}

function parseJsonText(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    if (/^\s*</.test(text)) {
      return {
        error: "Backend returned a web page instead of CRM data. Check backend URL."
      };
    }
    return {
      error: text.slice(0, 180)
    };
  }
}

function searchText(lead) {
  return clean([lead.name, lead.phone, lead.city, lead.requirement, lead.leadSummary, lead.salesNote].join(" "));
}

function sortLeads(leads, mode) {
  return [...leads].sort((a, b) => {
    if (mode === "priority") {
      const priority = workPriorityScore(b) - workPriorityScore(a);
      if (priority) return priority;
      const due = String(a.followUpAt || "9999").localeCompare(String(b.followUpAt || "9999"));
      if (due) return due;
    }
    if (mode === "score") return (Number(b.leadScore) || 0) - (Number(a.leadScore) || 0);
    if (mode === "followup") return String(a.followUpAt || "9999").localeCompare(String(b.followUpAt || "9999"));
    return String(b.lastMessageAt || b.updatedAt || b.createdAt || "").localeCompare(String(a.lastMessageAt || a.updatedAt || a.createdAt || ""));
  });
}

function option(value, selected) {
  return `<option value="${value}" ${clean(value) === clean(selected) ? "selected" : ""}>${formatOption(value)}</option>`;
}

function renderMessage(message) {
  const type = clean(message.type || "text");
  const filename = message.media?.filename || "";
  const hasAttachment = Boolean(message.media || (type && type !== "text"));
  const mediaBadge = type === "image"
    ? "IMG"
    : type === "video"
      ? "VID"
      : type === "location"
        ? "LOC"
        : type === "contacts"
          ? "CON"
          : "DOC";
  const attachment = hasAttachment
    ? `<span class="detail-message-attachment"><i aria-hidden="true">${mediaBadge}</i>${escapeHtml(filename || formatOption(type || "attachment"))}</span>`
    : "";
  return `
    <div class="message ${escapeAttr(clean(message.role || ""))}">
      <small>${escapeHtml(formatOption(message.role || "message"))} | ${escapeHtml(formatDate(message.timestamp))}</small>
      ${attachment}
      ${message.text ? `<span class="detail-message-text">${escapeHtml(message.text)}</span>` : ""}
    </div>
  `;
}

function displayName(value) {
  const key = clean(value);
  if (key === "ankit" || key === "pinky") return "Ankit";
  if (key === "reshu") return "Reshu";
  if (key === "shubham") return "Shubham";
  if (key === "admin") return "Admin";
  return value ? String(value) : "Unassigned";
}

function cleanAssignee(value) {
  const key = clean(value);
  return key === "pinky" ? "ankit" : key;
}

function normalizeLeadStatus(lead) {
  if (!lead || typeof lead !== "object") return lead;
  const status = clean(lead.status);
  if (status === "contacted") return { ...lead, status: "new" };
  if (status === "follow_up" && !isInterestedLead(lead)) return { ...lead, status: "new" };
  return lead;
}

function normalizeLeadStatuses(leads) {
  return Array.isArray(leads) ? leads.map(normalizeLeadStatus) : [];
}

function formatOption(value) {
  if (clean(value) === "contacted") return "New";
  if (clean(value) === "converted") return "Won";
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortText(value) {
  const text = String(value || "").trim();
  return text.length > 88 ? `${text.slice(0, 88)}...` : text;
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInputValue(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function setStatus(text, mode) {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = `status-pill ${mode || ""}`.trim();
  const accountStatus = document.querySelector("#waAccountStatus");
  if (accountStatus) accountStatus.textContent = text;
}

function getOrCreateLaptopCode() {
  const existing = localStorage.getItem("rxCrm.laptopCode");
  if (existing) return existing;

  let code = "";
  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(4);
    window.crypto.getRandomValues(bytes);
    code = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  } else {
    code = Math.random().toString(16).slice(2, 10).toUpperCase();
  }

  const laptopCode = `WEB${code}`;
  localStorage.setItem("rxCrm.laptopCode", laptopCode);
  return laptopCode;
}

async function copyLaptopCode() {
  const code = els.laptopCode.value.trim();
  try {
    await navigator.clipboard.writeText(code);
    toast("Laptop code copied");
  } catch (_error) {
    els.laptopCode.select();
    document.execCommand("copy");
    toast("Laptop code copied");
  }
}

function toast(message) {
  const accountFeedback = document.querySelector("#crmAccountDialog[open] #waAccountFeedback");
  if (accountFeedback) {
    accountFeedback.textContent = message;
    accountFeedback.hidden = false;
  }
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  window.setTimeout(() => node.remove(), 4200);
}

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

window.RXCRM = {
  snapshot: () => ({ connected: Boolean(state.token), role: state.sessionRole, device: state.sessionDeviceCode, leads: filteredByOwner(state.leads) }),
  request: apiFetch,
  refresh: () => loadDashboard({ sync: true, background: true }),
  openLead: leadId => { document.querySelector("#showDashboard").click(); openLead(leadId); },
  toast
};
