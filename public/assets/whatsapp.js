import {
  escape as esc,
  linkify,
  initials,
  time,
  day,
  messagePreview,
  statusMarkup,
  mergeMessages,
  SAMPLE_LINKS,
  mediaType,
  inboxReadSummary,
  inboxChatStatus,
  markInboxRead,
  replyWindow,
  replyWindowCountdown,
} from "./chat-utils.mjs?v=9-evisual-samples";
import { installChatTools } from "./chat-tools.mjs?v=26-campaign-history";
import { installMarketingWorkspace } from "./marketing.mjs?v=1-campaign-history";
let extra = {};
let marketing = { refresh() {}, sessionChanged() {} };
let draftSaveTimer = 0;
const $ = (id) => document.getElementById(id),
  crm = window.RXCRM;
const INBOX_CONTROLS_KEY = "rx-chat-v2:inbox-controls-collapsed";
const INBOX_WIDTH_KEY = "rx-chat-v3:inbox-width";
const DEFAULT_INBOX_WIDTH = 370;
const INBOX_CACHE_PREFIX = "rx-chat-v3:inbox:";
const INBOX_CACHE_VERSION = 3;
const INBOX_CACHE_MAX_CHATS = 6000;
const INBOX_FULL_SYNC_MS = 24 * 60 * 60 * 1000;
const MARKETING_REPLIES_FROM = Date.parse("2026-09-13T00:00:00+05:30");
const s = {
  chats: [],
  active: null,
  messages: [],
  filter: "all",
  samples: SAMPLE_LINKS,
  modern: false,
  delta: false,
  marketingTracking: false,
  checked: false,
  cursor: null,
  older: null,
  loading: false,
  epoch: 0,
  session: "",
  syncAt: "",
  fullSyncAt: 0,
  cacheHydrated: false,
  cacheComplete: false,
  drafts: new Map(),
  media: new Map(),
  attachment: null,
  attachmentUrl: "",
  reply: null,
  view: "whatsapp",
  preview: false,
  previewThreads: new Map(),
  pending: new Map(),
  signature: "",
  readCount: -1,
  recording: null,
  recordingEpoch: 0,
  encoding: false,
  replyWindowKey: "",
  replyWindowListKey: "",
};
const notify = (message) => crm.toast(message),
  current = () => s.chats.find((chat) => chat.id === s.active);
const icon = (name) =>
  `<svg aria-hidden="true"><use href="#wa-i-${name}"/></svg>`;
function avatarStyle(name) {
  const palette = [
    ["#d9e8df", "#486852"],
    ["#e9dfe8", "#825b7b"],
    ["#dbe5ef", "#4e6c87"],
    ["#f0e2cc", "#8a6d3d"],
    ["#e1e3ef", "#646c91"],
    ["#f0ddd6", "#986556"],
  ];
  const index =
    [...String(name || "")].reduce(
      (sum, letter) => sum + letter.codePointAt(0),
      0,
    ) % palette.length;
  return `--avatar-bg:${palette[index][0]};--avatar-fg:${palette[index][1]}`;
}
const PRODUCT_NAMES = {
  visual_aid: "Visual Aid",
  reminder_card: "Reminder Card",
  chit_pad: "Chit Pad",
  chemist_book: "Chemist Order Book",
  chemist_order_book: "Chemist Order Book",
  prescription_pad: "Prescription Pad",
  evisual_app: "E-Visual App",
  e_visual_app: "E-Visual App",
  diary: "Diary",
  calendar: "Calendar",
};
const PRODUCT_MATCHERS = [
  [
    "E-Visual App",
    [
      "e visual",
      "evisual",
      "digital visual aid",
      "visual app",
      "android app",
      "tablet app",
      "presentation app",
    ],
  ],
  [
    "Chemist Order Book",
    ["chemist book", "chemist order book", "chemist pad", "order book"],
  ],
  ["Prescription Pad", ["prescription pad", "rx pad"]],
  ["Reminder Card", ["reminder card", "appointment card"]],
  ["Chit Pad", ["chit pad", "slip pad", "writing pad"]],
  ["Visual Aid", ["visual aid", "visual book", "va book"]],
  ["Diary", ["diary", "planner"]],
  ["Calendar", ["calendar"]],
];
function requestedProduct(lead = {}) {
  const explicit = [
    lead.productName,
    typeof lead.product === "string" ? lead.product : lead.product?.name,
    lead.sequenceProduct,
  ].find((value) => String(value || "").trim());
  const explicitKey = String(explicit || "")
    .trim()
    .toLowerCase()
    .replaceAll(" ", "_")
    .replaceAll("-", "_");
  if (PRODUCT_NAMES[explicitKey]) return PRODUCT_NAMES[explicitKey];
  const source =
    " " +
    [explicit, lead.requirement, lead.leadSummary, lead.lastMessageText]
      .filter(Boolean)
      .join(" · ")
      .toLowerCase()
      .replaceAll("-", " ")
      .replaceAll("_", " ")
      .replaceAll("·", " ")
      .replaceAll(",", " ")
      .replaceAll(";", " ")
      .replaceAll(":", " ")
      .replaceAll("/", " ")
      .replaceAll("(", " ")
      .replaceAll(")", " ")
      .split(" ")
      .filter(Boolean)
      .join(" ") +
    " ";
  const products = PRODUCT_MATCHERS.filter(([name, aliases]) => {
    if (
      name === "Visual Aid" &&
      source.includes(" digital visual aid ") &&
      !source.replaceAll(" digital visual aid ", " ").includes(" visual aid ")
    )
      return false;
    return aliases.some((alias) => source.includes(" " + alias + " "));
  }).map(([name]) => name);
  return [...new Set(products)].join(" + ") || "Product not identified";
}
function requestedProductDetails(lead = {}) {
  const requirement = String(lead.requirement || "").trim();
  if (!requirement) return requestedProduct(lead);
  return requirement
    .replaceAll(" pages", " pg")
    .replaceAll(" page", " pg")
    .replaceAll(" Pages", " pg")
    .replaceAll(" Page", " pg")
    .replaceAll("quantity", "qty")
    .replaceAll("Quantity", "qty")
    .replaceAll("pieces", "pcs")
    .replaceAll("Pieces", "pcs")
    .replaceAll(",", " · ")
    .replaceAll(";", " · ")
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}
const request = (url, options = {}) =>
  crm.request(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(45000),
  });
const post = (url, body) =>
    request(url, { method: "POST", body: JSON.stringify(body) }),
  chatPath = (id) => `/api/chats/${encodeURIComponent(id)}`;
function inboxCacheKey() {
  return s.session ? INBOX_CACHE_PREFIX + encodeURIComponent(s.session) : "";
}
function mergeInbox(base, updates) {
  const map = new Map(base.map((chat) => [chat.id, chat]));
  updates.forEach((chat) => map.set(chat.id, { ...map.get(chat.id), ...chat }));
  return [...map.values()];
}
function saveInboxCache(writeChats = true) {
  const key = inboxCacheKey();
  if (!key || s.preview) return;
  const meta = {
    version: INBOX_CACHE_VERSION,
    session: s.session,
    savedAt: Date.now(),
    syncAt: s.syncAt,
    fullSyncAt: s.fullSyncAt,
  };
  try {
    localStorage.setItem(key + ":meta", JSON.stringify(meta));
  } catch {
    return;
  }
  if (!writeChats) return;
  const ordered = [...s.chats].sort((a, b) =>
    String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")),
  );
  for (const maximum of [INBOX_CACHE_MAX_CHATS, 2500, 1000, 250]) {
    const chats = ordered.slice(0, maximum);
    try {
      localStorage.setItem(
        key,
        JSON.stringify({
          ...meta,
          chats,
          cursor: chats.length === ordered.length ? s.cursor : null,
          complete:
            s.cacheComplete && chats.length === ordered.length && !s.cursor,
        }),
      );
      return;
    } catch {
      // Try a smaller safe cache when browser storage is nearly full.
    }
  }
}
function hydrateInboxCache() {
  const key = inboxCacheKey();
  if (!key) return false;
  try {
    const data = JSON.parse(localStorage.getItem(key) || "null");
    const meta = JSON.parse(localStorage.getItem(key + ":meta") || "null");
    if (
      data?.version !== INBOX_CACHE_VERSION ||
      data.session !== s.session ||
      !Array.isArray(data.chats)
    )
      return false;
    s.chats = data.chats.filter((chat) => chat?.id);
    s.cursor = data.cursor || null;
    s.syncAt = meta?.syncAt || data.syncAt || "";
    s.fullSyncAt = Number(meta?.fullSyncAt || data.fullSyncAt) || 0;
    s.cacheHydrated = true;
    s.cacheComplete = data.complete === true;
    extra.inboxReceived?.(s.chats);
    renderChats();
    $("waConnection").textContent =
      `${s.chats.length} chats · Cached · Syncing…`;
    return true;
  } catch {
    return false;
  }
}
async function fetchCompleteInbox(session) {
  const old = [...s.chats];
  const fresh = new Map();
  let cursor = "";
  let syncAt = "";
  let pages = 0;
  do {
    const data = await request(
      `/api/chats/${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
    );
    if (session !== s.session || !crm.snapshot().connected) return null;
    if (!syncAt) syncAt = data.syncAt || new Date().toISOString();
    (data.chats || []).forEach((chat) => fresh.set(chat.id, chat));
    cursor = data.nextCursor || "";
    s.cursor = cursor || null;
    s.chats = mergeInbox(old, [...fresh.values()]);
    renderChats();
    $("waConnection").textContent =
      `Preparing fast cache · ${fresh.size.toLocaleString()} chats`;
    pages += 1;
    if (pages >= 100 && cursor)
      throw new Error("Inbox is too large to cache in one refresh.");
  } while (cursor);
  return {
    chats: [...fresh.values()],
    syncAt,
  };
}
function switchView(view) {
  if (s.view !== view) stashDraft();
  s.view = view;
  closeAccount();
  document.body.classList.toggle("whatsapp-mode", view === "whatsapp");
  document.body.classList.toggle("dashboard-mode", view === "dashboard");
  document.body.classList.toggle("marketing-mode", view === "marketing");
  const rail = $("workspaceRail");
  const host =
    view === "whatsapp"
      ? $("whatsappWorkspace")
      : view === "marketing"
        ? $("marketingNav")
        : $("dashboardNav");
  if (rail.parentElement !== host) host.prepend(rail);
  $("dashboardNav").hidden = view !== "dashboard";
  $("marketingNav").hidden = view !== "marketing";
  for (const [id, selected] of [
    ["waRailChats", view === "whatsapp"],
    ["waRailDashboard", view === "dashboard"],
    ["waRailMarketing", view === "marketing"],
  ]) {
    $(id).classList.toggle("selected", selected);
    $(id).setAttribute("aria-pressed", String(selected));
  }
  $("whatsappWorkspace").hidden = view !== "whatsapp";
  $("marketingWorkspace").hidden = view !== "marketing";
  $("showWhatsApp").setAttribute("aria-pressed", String(view === "whatsapp"));
  $("showDashboard").setAttribute("aria-pressed", String(view === "dashboard"));
  if (view === "whatsapp") {
    resizeInboxPane(readInboxWidth());
    refresh();
  } else {
    stopRecording(true);
    if (view === "marketing") marketing.refresh();
  }
}
$("showWhatsApp").onclick = () => switchView("whatsapp");
$("showDashboard").onclick = () => switchView("dashboard");
function accountExpanded(expanded) {
  for (const id of [
    "waAccount",
    "waRailAccount",
    "waMobileAccount",
    "waWelcomeAccount",
  ])
    $(id).setAttribute("aria-expanded", String(expanded));
}
function openAccount() {
  const dialog = $("crmAccountDialog");
  if (dialog.open) return;
  $("waAccountStatus").textContent = $("connectionStatus").textContent;
  $("waAccountFeedback").hidden = true;
  dialog.showModal();
  document.body.classList.add("show-account");
  accountExpanded(true);
  $("pinInput").focus();
}
function closeAccount() {
  const dialog = $("crmAccountDialog");
  if (dialog.open) dialog.close();
  document.body.classList.remove("show-account");
  accountExpanded(false);
}
$("crmAccountDialog").addEventListener("close", () => {
  if ($("crmAccountDialog").open) return;
  document.body.classList.remove("show-account");
  accountExpanded(false);
});
$("crmAccountDialog").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeAccount();
});
$("crmAccountDialog").addEventListener("click", (event) => {
  if (event.target !== $("crmAccountDialog")) return;
  const rect = event.target.getBoundingClientRect();
  if (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  )
    closeAccount();
});
$("waAccount").onclick = openAccount;
$("waRailChats").onclick = () => {
  if (s.view !== "whatsapp") switchView("whatsapp");
  closeDrawer();
  if (
    !document
      .querySelector(".wa-inbox")
      ?.classList.contains("controls-collapsed")
  ) {
    $("waSearch").focus();
  }
};
$("waRailDashboard").onclick = () => switchView("dashboard");
$("waRailMarketing").onclick = () => switchView("marketing");
$("waMobileDashboard").onclick = () => switchView("dashboard");
$("waRailSamples").onclick = () => {
  if (s.view !== "whatsapp") switchView("whatsapp");
  showSamples();
};
$("waRailAccount").onclick =
  $("waMobileAccount").onclick =
  $("waWelcomeAccount").onclick =
    openAccount;
$("waAccountClose").onclick = closeAccount;
$("waFindChat").addEventListener("click", () => {
  setInboxControlsCollapsed(false);
});
function setInboxControlsCollapsed(collapsed) {
  const inbox = document.querySelector(".wa-inbox");
  const button = $("waToggleInboxControls");
  if (!inbox || !button) return;
  inbox.classList.toggle("controls-collapsed", collapsed);
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute(
    "aria-label",
    collapsed ? "Show inbox filters" : "Hide inbox filters",
  );
  button.setAttribute(
    "title",
    collapsed ? "Show inbox filters" : "Hide inbox filters",
  );
  localStorage.setItem(INBOX_CONTROLS_KEY, String(collapsed));
}
function inboxWidthBounds() {
  const workspace = $("whatsappWorkspace");
  const viewport = workspace.clientWidth || window.innerWidth || 1280;
  const narrow = window.matchMedia("(max-width:960px)").matches;
  const min = narrow ? 260 : 280;
  const drawer =
    workspace.classList.contains("drawer-open") && viewport > 1250 ? 320 : 0;
  const rail = narrow ? 60 : 64;
  const max = Math.max(min, Math.min(640, viewport - rail - drawer - 360));
  return { min, max };
}
function readInboxWidth() {
  const saved = Number(localStorage.getItem(INBOX_WIDTH_KEY));
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_INBOX_WIDTH;
}
function resizeInboxPane(width, save = false) {
  const workspace = $("whatsappWorkspace");
  const resizer = $("waPaneResizer");
  if (!workspace || !resizer) return DEFAULT_INBOX_WIDTH;
  const { min, max } = inboxWidthBounds();
  const next = Math.round(
    Math.min(max, Math.max(min, Number(width) || DEFAULT_INBOX_WIDTH)),
  );
  workspace.style.setProperty("--wa-inbox-width", String(next) + "px");
  resizer.setAttribute("aria-valuemin", String(min));
  resizer.setAttribute("aria-valuemax", String(max));
  resizer.setAttribute("aria-valuenow", String(next));
  if (save) localStorage.setItem(INBOX_WIDTH_KEY, String(next));
  return next;
}
function installPaneResizer() {
  const workspace = $("whatsappWorkspace");
  const resizer = $("waPaneResizer");
  if (!workspace || !resizer) return;
  resizeInboxPane(readInboxWidth());
  resizer.addEventListener("pointerdown", (event) => {
    if (window.matchMedia("(max-width:700px)").matches) return;
    event.preventDefault();
    workspace.classList.add("resizing-panes");
    resizer.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const left = workspace.getBoundingClientRect().left;
      const rail = window.matchMedia("(max-width:960px)").matches ? 60 : 64;
      resizeInboxPane(moveEvent.clientX - left - rail);
    };
    const finish = () => {
      workspace.classList.remove("resizing-panes");
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      resizeInboxPane(Number(resizer.getAttribute("aria-valuenow")), true);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  });
  resizer.addEventListener("keydown", (event) => {
    const currentWidth = Number(resizer.getAttribute("aria-valuenow"));
    const { min, max } = inboxWidthBounds();
    const next =
      event.key === "ArrowLeft"
        ? currentWidth - 20
        : event.key === "ArrowRight"
          ? currentWidth + 20
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    resizeInboxPane(next, true);
  });
  resizer.addEventListener("dblclick", () =>
    resizeInboxPane(DEFAULT_INBOX_WIDTH, true),
  );
  window.addEventListener("resize", () => resizeInboxPane(readInboxWidth()));
}
$("waToggleInboxControls").onclick = () => {
  const inbox = document.querySelector(".wa-inbox");
  setInboxControlsCollapsed(!inbox?.classList.contains("controls-collapsed"));
};
setInboxControlsCollapsed(localStorage.getItem(INBOX_CONTROLS_KEY) === "true");
installPaneResizer();
$("waRefresh").onclick = () => refresh(true);
$("waSearch").oninput = renderChats;
document.querySelectorAll("[data-wa-filter]").forEach(
  (button) =>
    (button.onclick = () => {
      s.filter = button.dataset.waFilter;
      document
        .querySelectorAll("[data-wa-filter]")
        .forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
      renderChats();
    }),
);
$("waBack").onclick = () => {
  stashDraft();
  clearAttachment();
  stopRecording(true);
  s.epoch++;
  s.active = null;
  $("whatsappWorkspace").classList.remove("chat-open");
  renderChats();
};
$("waSearchThread").onclick = () => {
  $("waThreadSearch").hidden = !$("waThreadSearch").hidden;
  if (!$("waThreadSearch").hidden) $("waMessageSearch").focus();
  else {
    $("waMessageSearch").value = "";
    renderMessages(true);
  }
};
$("waMessageSearch").oninput = () => renderMessages(true);
$("waDetails").onclick = $("waContact").onclick = showDetails;
$("waPhotos").onclick = () => extra.chooseFiles("photos");
$("waEmoji").onclick = showEmoji;
$("waAttach").onclick = showAttachments;
$("waCloseDrawer").onclick = closeDrawer;
$("waOlder").onclick = loadOlder;
$("waLatest").onclick = () => {
  $("waMessages").scrollTop = $("waMessages").scrollHeight;
  $("waLatest").hidden = true;
  markRead();
};
$("waMessages").addEventListener("scroll", () => {
  $("waLatest").hidden = nearBottom();
  if (nearBottom()) markRead();
});
$("waDraft").oninput = () => {
  resizeDraft();
  queueDraftSave();
};
$("waDraft").onkeydown = (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing &&
    window.matchMedia("(min-width:701px)").matches
  ) {
    event.preventDefault();
    if (extra.expandQuickReply?.()) return;
    send();
  }
};
$("waComposer").onsubmit = (event) => {
  event.preventDefault();
  if (extra.expandQuickReply?.()) return;
  send();
};
$("waFile").onchange = () => {
  if ($("waFile").files[0]) attachFile($("waFile").files[0]);
  $("waFile").value = "";
};
$("waMic").onclick = startRecording;
$("whatsappWorkspace").addEventListener("dragover", (event) => {
  if (s.active) event.preventDefault();
});
$("whatsappWorkspace").addEventListener("drop", (event) => {
  if (!s.active) return;
  event.preventDefault();
  if (event.dataTransfer.files[0]) attachFile(event.dataTransfer.files[0]);
});
$("waDraft").addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items || [])].find(
    (item) => item.kind === "file",
  );
  if (item) {
    event.preventDefault();
    attachFile(item.getAsFile());
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAccount();
    closeDrawer();
    s.reply = null;
    renderReply();
  }
});
window.addEventListener("rxcrm:state", sessionChanged);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
window.addEventListener("beforeunload", () => {
  stashDraft();
  stopRecording(true);
});
window.RXWhatsApp = {
  open: async (id) => {
    switchView("whatsapp");
    await openChat(id);
  },
};
function resetSession() {
  extra.reset?.();
  s.epoch++;
  s.chats = [];
  s.active = null;
  s.messages = [];
  s.drafts.clear();
  s.pending.clear();
  s.previewThreads.clear();
  s.checked = false;
  s.modern = false;
  s.delta = false;
  s.marketingTracking = false;
  s.loading = false;
  s.cursor = null;
  s.syncAt = "";
  s.fullSyncAt = 0;
  s.cacheHydrated = false;
  s.cacheComplete = false;
  clearAttachment();
  releaseMedia();
  stopRecording(true);
  closeDrawer();
  $("waThread").hidden = true;
  $("waWelcome").hidden = false;
  $("whatsappWorkspace").classList.remove("chat-open");
}
function sessionChanged() {
  const snapshot = crm.snapshot(),
    session = snapshot.connected
      ? `${snapshot.role || "user"}:${snapshot.device || "device"}`
      : "";
  marketing.sessionChanged(snapshot);
  if (snapshot.connected && s.preview) {
    s.preview = false;
    resetSession();
  }
  document.body.classList.toggle(
    "session-active",
    snapshot.connected || s.preview,
  );
  document.body.classList.toggle("wa-preview-mode", s.preview);
  $("waWelcomeAccount").hidden = snapshot.connected;
  previewButton.hidden = snapshot.connected;
  $("waInboxFooter").textContent = s.preview
    ? "Preview · Sample conversations"
    : "RX Design Hub · Team inbox";
  if (session !== s.session) {
    s.session = session;
    resetSession();
    if (session) {
      closeAccount();
      hydrateInboxCache();
    }
  }
  if (snapshot.connected && !s.preview) refresh();
  else if (!s.preview) {
    $("waConnection").textContent = "Sign in to load your chats";
    renderChats();
  }
}
async function refresh(force = false, more = false, refreshActive = false) {
  if (s.preview) {
    renderChats();
    return;
  }
  if (
    !crm.snapshot().connected ||
    s.loading ||
    (s.view !== "whatsapp" && !force)
  )
    return;
  const session = s.session;
  s.loading = true;
  $("waConnection").textContent = "Updating chats…";
  try {
    if (!s.checked) {
      try {
        const data = await request("/api/chats/config");
        if (![1, 2].includes(data.version))
          throw new Error("Unknown chat response");
        s.advanced = data.version >= 2;
        s.modern = true;
        s.delta = data.features?.inboxDelta === true;
        s.marketingTracking = data.features?.marketingReplies === true;
        s.samples = data.samples || SAMPLE_LINKS;
      } catch (error) {
        if (error.status !== 404) throw error;
        s.modern = false;
        s.delta = false;
        s.marketingTracking = false;
      }
      s.checked = true;
    }
    let chats;
    let received;
    let changedIds = new Set();
    let mode = "full";
    if (s.modern) {
      const cacheExpired =
        !s.cacheComplete ||
        !s.syncAt ||
        Date.now() - s.fullSyncAt >= INBOX_FULL_SYNC_MS;
      if (s.delta && !more && (force || cacheExpired)) {
        const result = await fetchCompleteInbox(session);
        if (!result) return;
        chats = result.chats;
        received = chats;
        changedIds = new Set(chats.map((chat) => chat.id));
        s.cursor = null;
        s.syncAt = result.syncAt;
        s.fullSyncAt = Date.now();
        s.cacheComplete = true;
      } else if (s.delta && !more) {
        mode = "delta";
        const data = await request(
          `/api/chats/changes?since=${encodeURIComponent(s.syncAt)}`,
        );
        if (data.resetRequired) {
          mode = "full";
          const result = await fetchCompleteInbox(session);
          if (!result) return;
          chats = result.chats;
          received = chats;
          changedIds = new Set(chats.map((chat) => chat.id));
          s.cursor = null;
          s.syncAt = result.syncAt;
          s.fullSyncAt = Date.now();
          s.cacheComplete = true;
        } else {
          received = data.chats || [];
          changedIds = new Set(received.map((chat) => chat.id));
          chats = mergeInbox(s.chats, received);
          s.syncAt = data.syncAt || s.syncAt;
        }
      } else {
        const data = await request(
          `/api/chats/${more && s.cursor ? "?cursor=" + encodeURIComponent(s.cursor) : ""}`,
        );
        received = data.chats || [];
        s.cursor = data.nextCursor;
        chats = mergeInbox(more ? s.chats : [], received);
        s.syncAt = data.syncAt || s.syncAt;
        s.cacheComplete = !s.cursor;
      }
    } else {
      const data = await request("/api/leads?limit=4000");
      chats = data.leads || [];
      received = chats;
      s.cursor = null;
    }
    if (session !== s.session || !crm.snapshot().connected) return;
    extra.inboxReceived?.(received || chats);
    s.chats = chats;
    if (mode !== "delta" || changedIds.size) renderChats();
    if (s.modern) saveInboxCache(mode !== "delta" || changedIds.size > 0);
    $("waConnection").textContent =
      `${s.chats.length.toLocaleString()} chats · ${s.delta ? (mode === "delta" && !changedIds.size ? "Up to date" : "Cache ready") : s.modern ? "Connected" : "Text messaging"}`;
    if (
      s.active &&
      (refreshActive || mode !== "delta" || changedIds.has(s.active))
    )
      await fetchThread(false);
    await extra.connected?.();
  } catch (error) {
    $("waConnection").textContent = "Could not update · Tap refresh";
    if (force) notify(error.message);
  } finally {
    s.loading = false;
  }
}
function marketingReplyBadge(chat) {
  if (s.filter !== "marketing") return "";
  const pending = chat.marketingReplyPending === true;
  return `<span class="wa-marketing-reply-state ${pending ? "pending" : "answered"}">${pending ? "Pending" : "Answered"}</span>`;
}
function isCurrentMarketingReply(chat) {
  const replyAt = Date.parse(
    chat.lastMarketingReplyAt || chat.lastInboundAt || "",
  );
  return (
    (chat.marketingReplyTracked === true ||
      chat.marketingReplyPending === true) &&
    Number.isFinite(replyAt) &&
    replyAt >= MARKETING_REPLIES_FROM &&
    chat.status !== "lost" &&
    chat.optedOut !== true
  );
}
function renderChats() {
  const countsAvailable = s.preview || (s.modern && crm.snapshot().connected);
  const marketingTrackingAvailable =
    s.preview || (countsAvailable && s.marketingTracking);
  if (
    (!countsAvailable && ["read", "unread", "open"].includes(s.filter)) ||
    (!marketingTrackingAvailable && s.filter === "marketing")
  )
    s.filter = "all";
  const now = Date.now(),
    query = $("waSearch").value.trim().toLowerCase(),
    matching = s.chats
      .filter(
        (chat) =>
          !query ||
          [
            chat.name,
            chat.phone,
            chat.city,
            chat.requirement,
            requestedProductDetails(chat),
          ]
            .join(" ")
            .toLowerCase()
            .includes(query),
      )
      .filter((chat) => !extra.chatMatches || Boolean(extra.chatMatches(chat))),
    list = matching
      .filter(
        (chat) =>
          (!["read", "unread"].includes(s.filter) ||
            inboxChatStatus(chat) === s.filter) &&
          (s.filter !== "open" || replyWindow(chat).open) &&
          (s.filter !== "marketing" || isCurrentMarketingReply(chat)) &&
          (s.filter !== "hot" || chat.temperature === "hot"),
      )
      .sort((a, b) =>
        String(b.lastMessageAt || "").localeCompare(
          String(a.lastMessageAt || ""),
        ),
      );
  s.replyWindowListKey = replyWindowListKey(now);
  $("waChatList").innerHTML = list.length
    ? list
        .map(
          (chat) =>
            `<button class="wa-chat-row ${chat.id === s.active ? "active" : ""}" data-chat="${esc(chat.id)}" aria-label="Open chat with ${esc(chat.name || chat.phone)}" ${chat.id === s.active ? 'aria-current="true"' : ""}><span class="wa-avatar" style="${avatarStyle(chat.name || chat.phone)}">${esc(initials(chat.name || chat.phone))}</span><span class="wa-chat-summary"><span class="wa-chat-line"><strong>${esc(chat.name || chat.phone || "Customer")}</strong><span class="wa-chat-meta"><time>${esc(day(chat.lastMessageAt) === "Today" ? time(chat.lastMessageAt) : day(chat.lastMessageAt))}</time>${replyTimerMarkup(chat, now)}</span></span><span class="wa-chat-line"><span class="wa-chat-preview">${s.drafts.get(chat.id)?.trim() ? '<span class="wa-draft-label">Draft:</span>' : chat.lastMessageRole && chat.lastMessageRole !== "user" && ["sent", "delivered", "read"].includes(chat.lastMessageStatus) ? statusMarkup(chat.lastMessageStatus) : ""}<span class="wa-chat-preview-text">${esc(requestedProductDetails(chat))}</span></span>${marketingReplyBadge(chat)}${chat.manualUnread === true && !(chat.unreadMessageCount > 0) ? '<span class="wa-unread wa-unread-dot" aria-label="Marked unread" title="Marked unread"></span>' : chat.unreadCount ? `<span class="wa-unread" aria-label="${Number(chat.unreadCount)} unread messages">${Number(chat.unreadCount)}</span>` : ""}</span></span></button>`,
        )
        .join("")
    : `<div class="wa-empty-list">${!crm.snapshot().connected && !s.preview ? "Sign in through Account to see your customer conversations." : s.filter === "open" ? "No open reply windows in these loaded chats. Choose All to send an approved template, or load more chats." : s.filter === "marketing" ? "No marketing replies in these loaded chats." : s.filter === "unread" && !s.modern ? "Unread counts become available after the chat backend update." : "No chats match this view."}</div>`;
  $("waChatList")
    .querySelectorAll("[data-chat]")
    .forEach(
      (button) => (button.onclick = () => openChat(button.dataset.chat)),
    );
  if (s.cursor) {
    const button = document.createElement("button");
    button.className = "wa-older";
    button.textContent = "Load more chats";
    button.onclick = () => refresh(true, true);
    $("waChatList").append(button);
  }
  const counts = inboxReadSummary(matching, countsAvailable);
  const openChats = matching.filter((chat) => replyWindow(chat).open).length;
  const marketingReplies = matching.filter(isCurrentMarketingReply).length;
  const number = (value) => value.toLocaleString();
  $("waAllChatCount").textContent = number(counts.chats);
  $("waUnreadChatCount").textContent = countsAvailable
    ? number(counts.unreadChats)
    : "—";
  $("waReadChatCount").textContent = countsAvailable
    ? number(counts.readChats)
    : "—";
  $("waOpenChatCount").textContent = countsAvailable ? number(openChats) : "—";
  $("waMarketingReplyCount").textContent = marketingTrackingAvailable
    ? number(marketingReplies)
    : "—";
  const hasMessageCounts =
    countsAvailable && (counts.trackedChats > 0 || !counts.chats);
  $("waUnreadMessageCount").textContent = hasMessageCounts
    ? number(counts.unreadMessages)
    : "—";
  $("waReadMessageCount").textContent = hasMessageCounts
    ? number(counts.readMessages)
    : "—";
  $("waCountScope").textContent = !countsAvailable
    ? crm.snapshot().connected
      ? "Read/unread counts need the updated backend."
      : "Sign in to see read and unread counts."
    : `${number(counts.chats)} matching chats loaded${s.cursor ? " · Load more for remaining counts" : ""}. Incoming messages recorded by CRM${counts.trackedChats < counts.chats ? `; counts missing for ${number(counts.chats - counts.trackedChats)} chats` : ""}.`;
  document.querySelectorAll("[data-wa-filter]").forEach((button) => {
    const filter = button.dataset.waFilter;
    button.setAttribute("aria-pressed", String(s.filter === filter));
    if (["read", "unread"].includes(filter)) {
      button.disabled = !countsAvailable;
      button.setAttribute(
        "aria-label",
        countsAvailable
          ? `Show ${filter === "read" ? counts.readChats : counts.unreadChats} ${filter} chats`
          : `${filter} counts unavailable`,
      );
    }
    if (filter === "open") {
      button.disabled = !countsAvailable;
      button.setAttribute(
        "aria-label",
        countsAvailable
          ? `Show ${openChats} chats with an open reply window`
          : "Open reply windows unavailable",
      );
    }
    if (filter === "marketing") {
      button.disabled = !marketingTrackingAvailable;
      button.setAttribute(
        "aria-label",
        marketingTrackingAvailable
          ? `Show ${marketingReplies} marketing replies received from 13 September onward`
          : "Marketing reply tracking needs the updated backend",
      );
    }
  });
  const total = inboxReadSummary(s.chats, countsAvailable).unreadChats;
  $("waTotalUnread").textContent = total;
  $("waTotalUnread").hidden = !total;
  $("waRailUnread").textContent = total > 99 ? "99+" : total;
  $("waRailUnread").hidden = !total;
  $("waRailUnread").title = `${total} unread chats loaded`;
  $("waTotalUnread").title = `${total} unread chats loaded`;
  extra.afterChats?.();
}
function stashDraft() {
  if (!s.active) return;
  clearTimeout(draftSaveTimer);
  draftSaveTimer = 0;
  const value = $("waDraft").value;
  s.drafts.set(s.active, value);
  extra.saveDraft?.(s.active, value);
}
function queueDraftSave() {
  const id = s.active;
  if (!id) return;
  s.drafts.set(id, $("waDraft").value);
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = 0;
    extra.saveDraft?.(id, s.drafts.get(id) || "");
  }, 250);
}
async function openChat(id) {
  if (id === s.active) {
    extra.reopen?.();
    await markRead();
    return;
  }
  stashDraft();
  clearAttachment();
  stopRecording(true);
  releaseMedia();
  closeDrawer();
  s.epoch++;
  s.active = id;
  extra.opening?.(id);
  s.messages = [];
  s.older = null;
  s.reply = null;
  s.signature = "";
  s.readCount = -1;
  $("waThread").hidden = false;
  $("waWelcome").hidden = true;
  $("whatsappWorkspace").classList.add("chat-open");
  $("waDraft").value = s.drafts.get(id) || "";
  $("waMessageSearch").value = "";
  $("waThreadSearch").hidden = true;
  $("waMessageItems").innerHTML =
    '<p class="wa-empty-history">Loading conversation…</p>';
  $("waOlder").hidden = true;
  renderHeader();
  renderChats();
  renderReply();
  resizeDraft();
  syncComposer();
  if (s.preview) {
    if (!s.previewThreads.has(id))
      s.previewThreads.set(id, previewMessages(id));
    s.messages = s.previewThreads.get(id);
    markInboxRead(current());
    renderMessages(true);
    renderChats();
    await extra.opened?.(id);
    return;
  }
  await fetchThread(true);
  if (current()) await extra.opened?.(id);
}
async function fetchThread(initial) {
  if (!s.active || s.preview) return;
  const id = s.active,
    epoch = s.epoch;
  try {
    const data = await request(
      s.modern
        ? `${chatPath(id)}/messages`
        : `/api/leads/${encodeURIComponent(id)}?messages=50`,
    );
    if (id !== s.active || epoch !== s.epoch) return;
    if (!data.lead) throw new Error("Conversation unavailable");
    const index = s.chats.findIndex((chat) => chat.id === id);
    if (index >= 0) s.chats[index] = { ...s.chats[index], ...data.lead };
    else s.chats.push(data.lead);
    s.messages = mergeMessages(
      initial ? [] : s.messages,
      data.messages || data.lead.messages || [],
    );
    if (initial) s.older = data.nextCursor || null;
    renderHeader();
    renderMessages(initial);
    renderChats();
    saveInboxCache();
    extra.threadReceived?.();
    if (nearBottom()) markRead();
  } catch (error) {
    if (id !== s.active || epoch !== s.epoch) return;
    if (error.status === 403 || error.status === 404) {
      s.messages = [];
      releaseMedia();
      s.chats = s.chats.filter((chat) => chat.id !== id);
      renderMessages(true);
      renderChats();
      saveInboxCache();
      renderHeader();
    }
    $("waNotice").hidden = false;
    $("waNotice").textContent = error.message;
    if (initial)
      $("waMessageItems").innerHTML =
        '<p class="wa-empty-history">Could not load this conversation. Use refresh to try again.</p>';
  }
}
function replyWindowKey() {
  const lead = current() || {};
  return [
    s.active,
    replyWindow(lead).open,
    lead.optedOut,
    lead.whatsappBlocked,
  ].join(":");
}
function replyWindowListKey(now = Date.now()) {
  return s.chats
    .map((chat) => `${chat.id}:${replyWindow(chat, now).open ? 1 : 0}`)
    .join("|");
}
function applyReplyTimer(element, chat, now = Date.now()) {
  if (!element) return;
  const countdown = replyWindowCountdown(chat, now);
  const text =
    element.dataset.timerKind === "header"
      ? countdown.header
      : countdown.short;
  const className =
    "wa-reply-timer" +
    (element.dataset.timerKind === "header" ? " wa-reply-timer-header" : "") +
    ` ${countdown.state}`;
  if (element.textContent !== text) element.textContent = text;
  if (element.className !== className) element.className = className;
  if (element.dataset.windowState !== countdown.state)
    element.dataset.windowState = countdown.state;
  if (element.title !== countdown.label) element.title = countdown.label;
  if (element.getAttribute("aria-label") !== countdown.label)
    element.setAttribute("aria-label", countdown.label);
}
function replyTimerMarkup(chat, now = Date.now()) {
  const countdown = replyWindowCountdown(chat, now);
  return `<span class="wa-reply-timer ${countdown.state}" data-reply-window="${esc(chat.id)}" data-window-state="${countdown.state}" title="${esc(countdown.label)}" aria-label="${esc(countdown.label)}">${esc(countdown.short)}</span>`;
}
function updateReplyTimers(now = Date.now()) {
  const chats = new Map(s.chats.map((chat) => [String(chat.id), chat]));
  $("waChatList")
    .querySelectorAll("[data-reply-window]")
    .forEach((element) => {
      const chat = chats.get(element.dataset.replyWindow);
      if (chat) applyReplyTimer(element, chat, now);
    });
  applyReplyTimer($("waReplyTimer"), current() || {}, now);
}
function tickReplyWindows() {
  if (document.hidden || s.view !== "whatsapp") return;
  const now = Date.now();
  if (s.replyWindowListKey !== replyWindowListKey(now)) renderChats();
  updateReplyTimers(now);
  if (s.replyWindowKey !== replyWindowKey()) renderHeader();
}
function renderHeader() {
  const lead = current() || {};
  $("waName").textContent = lead.name || lead.phone || "Customer";
  $("waAvatar").textContent = initials(lead.name || lead.phone);
  $("waAvatar").style.cssText = avatarStyle(lead.name || lead.phone);
  $("waSubtitle").textContent = [
    lead.name && lead.phone ? lead.phone : "",
    requestedProductDetails(lead),
  ]
    .filter(Boolean)
    .join(" · ");
  $("waCall").href = "tel:+" + String(lead.phone || "").replace(/\D/g, "");
  $("waCall").hidden =
    s.preview ||
    !/^\d{7,15}$/.test(String(lead.phone || "").replace(/\D/g, ""));
  const windowState = replyWindow(lead);
  const expired = !s.preview && s.modern && !windowState.open;
  s.replyWindowKey = replyWindowKey();
  $("waReplyTimer").hidden = !lead.id;
  applyReplyTimer($("waReplyTimer"), lead);
  const notice = s.preview
    ? "Preview · Try a message below. Your messages stay in this demo."
    : lead.optedOut
      ? "This customer stopped messages. Wait for them to opt in again."
      : lead.whatsappBlocked
        ? "This contact is blocked on WhatsApp."
        : expired
          ? windowState.known
            ? "The 24-hour reply window has closed. Use an approved template or wait for a new customer message."
            : "No valid customer message time is recorded. Use an approved template or wait for a new customer message."
          : !s.modern
            ? "Text and sample links are available. Attachments, reply-to, unread counts and delivery ticks need the accompanying chat backend update."
            : !s.advanced
              ? "New chat tools need the latest backend update. Existing messaging remains available."
              : "";
  $("waNotice").textContent = notice;
  $("waNotice").hidden = !notice;
  const blocked = lead.optedOut || lead.whatsappBlocked || expired || !lead.id;
  $("waSend").disabled = Boolean(
    blocked || s.pending.has(s.active) || s.recording || s.encoding,
  );
  $("waMic").disabled = Boolean(
    blocked || !s.modern || s.recording || s.encoding,
  );
  $("waAttach").disabled = Boolean(blocked);
  $("waPhotos").disabled = Boolean(blocked);
  syncComposer();
  extra.afterHeader?.();
}
function syncComposer() {
  const hasContent = Boolean(
    $("waDraft").value.trim() || s.attachment || extra.hasFiles?.(),
  );
  $("waSend").hidden = !hasContent;
  $("waMic").hidden = hasContent;
}
function nearBottom() {
  const box = $("waMessages");
  return box.scrollHeight - box.scrollTop - box.clientHeight < 100;
}
function renderMessages(force = false) {
  const query = $("waMessageSearch").value.toLowerCase().trim(),
    signature =
      JSON.stringify(s.messages) + query + (extra.signature?.() || "");
  if (!force && signature === s.signature) return;
  s.signature = signature;
  const box = $("waMessages"),
    wasBottom = nearBottom(),
    scroll = box.scrollTop,
    messages = (extra.visibleMessages?.() || s.messages).filter(
      (message) =>
        message.type !== "reaction" &&
        (extra.searchActive?.() ||
          !query ||
          [message.text, message.media?.filename]
            .join(" ")
            .toLowerCase()
            .includes(query)),
    );
  $("waSearchCount").textContent = query ? `${messages.length} matches` : "";
  let date = "";
  $("waMessageItems").innerHTML =
    messages
      .map((message) => {
        const label = day(message.timestamp),
          separator =
            label !== date ? `<div class="wa-day">${esc(label)}</div>` : "";
        date = label;
        const outbound = message.role !== "user";
        let attachment = "";
        if (message.mediaHidden)
          attachment = '<span class="wa-muted">Attachment hidden in CRM</span>';
        else if (message.media?.id) {
          const cached =
            s.media.get(message.id) ||
            extra.previewMedia?.(message.id) ||
            extra.previewMedia?.(message.media.id);
          attachment = cached
            ? renderMedia(message, cached)
            : `<button class="wa-media-load" type="button" data-media="${esc(message.id)}">${esc(message.media.filename || messagePreview({ ...message, text: "" }) || "Attachment")} · Open</button>`;
        } else if (
          message.media?.link &&
          /^https:\/\//i.test(message.media.link)
        )
          attachment = `<a class="wa-file-link" href="${esc(message.media.link)}" target="_blank" rel="noopener noreferrer">Open shared ${esc(message.type || "attachment")} ↗</a>`;
        else if (
          message.type === "location" &&
          Number.isFinite(message.location?.latitude) &&
          Number.isFinite(message.location?.longitude)
        )
          attachment = `<a class="wa-file-link" href="https://maps.google.com/?q=${message.location.latitude},${message.location.longitude}" target="_blank" rel="noopener noreferrer">View shared location ↗</a>`;
        else if (message.type === "contacts")
          attachment = `<div class="wa-quote">${(message.contacts || []).map((contact) => esc(contact.name?.formatted_name || "Contact") + "<br>" + (contact.phones || []).map((phone) => esc(phone.phone)).join("<br>")).join("<br>")}</div>`;
        const original = message.context?.id
            ? s.messages.find(
                (item) =>
                  item.whatsappMessageId === message.context.id ||
                  item.id === message.context.id,
              )
            : null,
          quote = message.context
            ? `<div class="wa-quote"><strong>${esc(original?.role === "user" ? current()?.name || "Customer" : "Reply")}</strong>${esc(message.context.text || (original ? messagePreview(original) : "Earlier message"))}</div>`
            : "";
        attachment += extra.messageContent?.(message) || "";
        return (
          separator +
          `<article class="wa-message ${outbound ? "outgoing" : "incoming"}" data-message="${esc(message.id)}"><div class="wa-bubble">${outbound && ["ai", "sequence", "broadcast"].includes(message.role) ? `<div class="wa-message-author">${esc({ ai: "AI assistant", sequence: "Scheduled message", broadcast: "Broadcast" }[message.role])}</div>` : ""}${quote}${attachment}${message.text ? `<div class="wa-message-text">${linkify(message.text)}</div>` : ""}<div class="wa-message-meta"><time>${esc(time(message.timestamp))}</time>${outbound ? statusMarkup(message.status) : ""}</div>${message.error ? `<div class="wa-message-error">${esc(message.error)}</div>` : ""}</div><div class="wa-message-tools">${s.preview || (s.modern && message.whatsappMessageId) ? `<button type="button" data-reply="${esc(message.id)}">Reply</button>` : ""}${message.text ? `<button type="button" data-copy="${esc(message.id)}">Copy</button>` : ""}</div></article>`
        );
      })
      .join("") || '<p class="wa-empty-history">No messages to show.</p>';
  $("waOlder").hidden = !s.older || Boolean(query);
  $("waMessageItems")
    .querySelectorAll("[data-media]")
    .forEach(
      (button) =>
        (button.onclick = () => loadMedia(button.dataset.media, button)),
    );
  extra.afterMessages?.(messages);
  $("waMessageItems")
    .querySelectorAll("[data-reply]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          s.reply = (extra.visibleMessages?.() || s.messages).find(
            (message) => message.id === button.dataset.reply,
          );
          renderReply();
          $("waDraft").focus();
        }),
    );
  $("waMessageItems")
    .querySelectorAll("[data-copy]")
    .forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              (extra.visibleMessages?.() || s.messages).find(
                (message) => message.id === button.dataset.copy,
              ).text,
            );
            notify("Message copied");
          } catch {
            notify("Select the text to copy it.");
          }
        }),
    );
  if ((force || wasBottom) && !query) box.scrollTop = box.scrollHeight;
  else box.scrollTop = scroll;
}
function renderMedia(message, url) {
  if (["image", "sticker"].includes(message.type))
    return `<button type="button" class="wa-image-open" data-view-image="${esc(message.id)}" aria-label="Open photo"><img src="${esc(url)}" alt="${esc(message.text || "Shared image")}"></button>`;
  if (message.type === "video")
    return `<video controls preload="metadata" src="${esc(url)}"></video>`;
  if (message.type === "audio")
    return `<audio controls preload="metadata" src="${esc(url)}"></audio><button type="button" class="wa-speed" aria-label="Change playback speed">1×</button>`;
  return `<a class="wa-file-link" href="${esc(url)}" download="${esc(message.media?.filename || "document")}">▧ ${esc(message.media?.filename || "Download document")} ↓</a>`;
}
async function loadMedia(id, button) {
  const active = s.active,
    epoch = s.epoch;
  button.disabled = true;
  button.textContent = "Loading attachment…";
  try {
    const blob = await request(
      `${chatPath(active)}/messages/${encodeURIComponent(id)}/media`,
      { responseType: "blob" },
    );
    if (active !== s.active || epoch !== s.epoch) return;
    s.media.set(id, URL.createObjectURL(blob));
    s.signature = "";
    renderMessages();
  } catch (error) {
    if (active === s.active) {
      button.disabled = false;
      button.textContent = "Try loading attachment again";
      notify(error.message);
    }
  }
}
function releaseMedia() {
  for (const url of s.media.values()) URL.revokeObjectURL(url);
  s.media.clear();
}
async function loadOlder() {
  if (!s.older || !s.modern) return;
  const id = s.active,
    epoch = s.epoch,
    box = $("waMessages"),
    height = box.scrollHeight,
    top = box.scrollTop;
  $("waOlder").disabled = true;
  try {
    const data = await request(
      `${chatPath(id)}/messages?before=${encodeURIComponent(s.older)}`,
    );
    if (id !== s.active || epoch !== s.epoch) return;
    s.messages = mergeMessages(s.messages, data.messages);
    s.older = data.nextCursor;
    renderMessages();
    box.scrollTop = top + box.scrollHeight - height;
  } catch (error) {
    notify(error.message);
  } finally {
    $("waOlder").disabled = false;
  }
}
async function markRead() {
  if (
    !s.modern ||
    s.preview ||
    document.hidden ||
    s.view !== "whatsapp" ||
    !s.active ||
    extra.suppressRead?.()
  )
    return;
  const lead = current(),
    last = s.messages.filter((message) => message.role === "user").at(-1),
    count = Number(lead?.inboundCount) || 0;
  if (!last || s.readCount === count) return;
  s.readCount = count;
  const id = s.active,
    epoch = s.epoch;
  try {
    await post(`${chatPath(id)}/read`, {
      inboundCount: count,
      messageId: last.id,
    });
    if (id === s.active && epoch === s.epoch) {
      markInboxRead(current(), count);
      renderChats();
      saveInboxCache();
    }
  } catch {
    if (id === s.active && epoch === s.epoch) s.readCount = -1;
  }
}
function renderReply() {
  $("waReplyPreview").hidden = !s.reply;
  $("waReplyPreview").innerHTML = s.reply
    ? `<div><strong>${esc(s.reply.role === "user" ? current()?.name || "Customer" : "You")}</strong>${esc(messagePreview(s.reply).slice(0, 150))}</div><button class="wa-icon-btn" id="waCancelReply" type="button" aria-label="Cancel reply">×</button>`
    : "";
  if (s.reply)
    $("waCancelReply").onclick = () => {
      s.reply = null;
      renderReply();
    };
}
function resizeDraft() {
  const input = $("waDraft");
  if (!window.CSS?.supports?.("field-sizing", "content")) {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 140) + "px";
  }
  syncComposer();
}
async function send() {
  if (extra.hasFiles?.()) return extra.sendFiles();
  const lead = current(),
    id = s.active,
    epoch = s.epoch,
    text = $("waDraft").value.trim(),
    file = s.attachment;
  if (!lead || s.pending.has(id) || (!text && !file) || $("waSend").disabled)
    return;
  if (file && !s.modern) {
    notify("Update the chat backend to send attachments.");
    return;
  }
  if (text.length > (file ? 1024 : 4096)) {
    notify("Message is too long. Shorten it before sending.");
    return;
  }
  if (file && mediaType(file) === "audio" && text) {
    notify("Send voice messages without a caption. Send your text separately.");
    return;
  }
  if (s.preview) {
    if (file) return;
    const message = {
      id: crypto.randomUUID(),
      role: "sales",
      type: "text",
      text,
      status: "preview",
      timestamp: new Date().toISOString(),
      ...(s.reply
        ? {
            context: {
              id: s.reply.whatsappMessageId || s.reply.id,
              text: messagePreview(s.reply),
              role: s.reply.role,
            },
          }
        : {}),
    };
    s.messages = mergeMessages(s.messages, [message]);
    s.previewThreads.set(id, s.messages);
    Object.assign(lead, {
      lastMessageText: text,
      lastMessageType: "text",
      lastMessageAt: message.timestamp,
      lastMessageRole: "sales",
      lastMessageStatus: "preview",
    });
    $("waDraft").value = "";
    s.drafts.delete(id);
    extra.saveDraft?.(id, "");
    s.reply = null;
    resizeDraft();
    renderReply();
    renderMessages(true);
    renderChats();
    return;
  }
  const key = crypto.randomUUID(),
    pending = {
      id: key,
      clientMessageId: key,
      text,
      role: "sales",
      type: file ? mediaType(file) : "text",
      timestamp: new Date().toISOString(),
      status: "sending",
    },
    reply = s.reply;
  s.pending.set(id, pending);
  s.messages = mergeMessages(s.messages, [pending]);
  renderMessages(true);
  renderHeader();
  try {
    let result;
    if (file) {
      const params = new URLSearchParams({
        clientMessageId: key,
        filename: file.name,
        caption: text,
        ...(reply ? { replyTo: reply.id } : {}),
      });
      result = await request(`${chatPath(id)}/send-media?${params}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
    } else
      result = await post(
        s.modern
          ? `${chatPath(id)}/send`
          : `/api/leads/${encodeURIComponent(id)}/send`,
        { text, clientMessageId: key, ...(reply ? { replyTo: reply.id } : {}) },
      );
    if (id === s.active && epoch === s.epoch) {
      s.messages = s.messages.filter((message) => message.id !== key);
      if (result.message)
        s.messages = mergeMessages(s.messages, [result.message]);
      if ($("waDraft").value.trim() === text) {
        $("waDraft").value = "";
        s.drafts.delete(id);
        extra.saveDraft?.(id, "");
        resizeDraft();
      }
      if (s.attachment === file) clearAttachment();
      s.reply = null;
      renderReply();
      await fetchThread(false);
      renderMessages(true);
    }
  } catch (error) {
    if (id === s.active && epoch === s.epoch) {
      pending.status = "unknown";
      pending.error = error.message;
      s.messages = mergeMessages(s.messages, [pending]);
      renderMessages(true);
    }
    notify(error.message);
  } finally {
    s.pending.delete(id);
    if (id === s.active && epoch === s.epoch) renderHeader();
  }
}
function drawer(title, html) {
  $("waDrawerTitle").textContent = title;
  $("waDrawerBody").innerHTML = html;
  $("waDrawer").hidden = false;
  $("whatsappWorkspace").classList.add("drawer-open");
  resizeInboxPane(readInboxWidth());
}
function closeDrawer() {
  $("waDrawer").hidden = true;
  $("whatsappWorkspace").classList.remove("drawer-open");
  resizeInboxPane(readInboxWidth());
}
function insertDraft(text) {
  const input = $("waDraft");
  input.setRangeText(text, input.selectionStart, input.selectionEnd, "end");
  resizeDraft();
  stashDraft();
  input.focus();
}
function showSamples() {
  drawer(
    "Product samples",
    "<p>Choose a sample to add its link to your message.</p>" +
      s.samples
        .map(
          (sample, index) =>
            `<article class="wa-sample-card"><strong>${esc(sample.name)}</strong><a href="${esc(sample.url)}" target="_blank" rel="noopener noreferrer">View samples ↗</a><button type="button" data-sample="${index}" ${current() ? "" : "disabled"}>Add to message</button> <button class="wa-secondary" type="button" data-sample-copy="${index}">Copy link</button></article>`,
        )
        .join(""),
  );
  $("waDrawerBody")
    .querySelectorAll("[data-sample]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          const sample = s.samples[Number(button.dataset.sample)];
          insertDraft(`Here are our ${sample.name} samples:\n${sample.url}`);
          closeDrawer();
        }),
    );
  $("waDrawerBody")
    .querySelectorAll("[data-sample-copy]")
    .forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            await navigator.clipboard.writeText(
              s.samples[Number(button.dataset.sampleCopy)].url,
            );
            notify("Sample link copied");
          } catch {
            notify("Open the sample link to copy its address.");
          }
        }),
    );
}
function showEmoji() {
  if (extra.showEmoji) return extra.showEmoji();
  drawer(
    "Emoji",
    `<div class="wa-emoji-grid">${["😊", "👍", "🙏", "✅", "📦", "📄", "🎨", "📞", "✨", "🙌", "🙂", "💚", "👌", "🤝", "📍", "🎉", "💬", "🖨️", "📅", "⏰"].map((emoji) => `<button type="button" aria-label="Insert ${emoji}">${emoji}</button>`).join("")}</div>`,
  );
  $("waDrawerBody")
    .querySelectorAll("button")
    .forEach(
      (button) => (button.onclick = () => insertDraft(button.textContent)),
    );
}
function showDetails() {
  const lead = current() || {};
  drawer(
    "Contact details",
    `<div class="wa-avatar" style="margin:8px auto 16px">${esc(initials(lead.name || lead.phone))}</div><h3 style="text-align:center">${esc(lead.name || lead.phone)}</h3>${[
      ["Phone", lead.phone],
      ["Owner", lead.assignedTo],
      ["Status", lead.status],
      ["Temperature", lead.temperature],
      ["City", lead.city],
      ["Requirement", lead.requirement],
      ["Sales note", lead.salesNote],
    ]
      .map(
        ([label, value]) =>
          `<div class="wa-detail-row"><span>${label}</span>${esc(value || "—")}</div>`,
      )
      .join(
        "",
      )}<p><button type="button" class="wa-action" id="waOpenCRM">Open lead in CRM</button></p><button type="button" class="wa-action" id="waDetailSamples">Product samples</button>`,
  );
  $("waOpenCRM").onclick = () => {
    closeDrawer();
    if (!s.preview) crm.openLead(s.active);
    else notify("Sample contact — no live CRM record.");
  };
  $("waDetailSamples").onclick = showSamples;
  extra.contactTools?.();
}
function showAttachments() {
  if (extra.showAttachments) return extra.showAttachments();
  if (!s.modern) {
    notify("Attachments need the accompanying chat backend update.");
    return;
  }
  drawer(
    "Attach",
    `<div class="wa-attach-options"><button type="button" class="wa-attach-option" data-file-kind="photos" ${s.preview ? "disabled" : ""}>${icon("image")}Photos & videos</button><button type="button" class="wa-attach-option" data-file-kind="documents" ${s.preview ? "disabled" : ""}>${icon("file")}Documents</button><button type="button" class="wa-attach-option" data-file-kind="audio" ${s.preview ? "disabled" : ""}>${icon("mic")}Audio</button><button type="button" class="wa-attach-option" id="waAttachSamples">${icon("chat")}Product samples</button></div><p>${s.preview ? "Sign in to attach files and record voice messages. You can try sample links in this preview." : "Photos up to 5 MB. Videos, audio and documents up to 16 MB. You can also drop a file into the conversation."}</p>`,
  );
  $("waDrawerBody")
    .querySelectorAll("[data-file-kind]")
    .forEach(
      (button) =>
        (button.onclick = () => {
          $("waFile").accept = {
            photos: "image/jpeg,image/png,video/mp4,video/3gpp",
            documents: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt",
            audio: "audio/mpeg,audio/mp4,audio/ogg,audio/aac,audio/amr",
          }[button.dataset.fileKind];
          $("waFile").click();
        }),
    );
  $("waAttachSamples").onclick = showSamples;
}
function attachFile(file) {
  if (extra.attachFiles) return extra.attachFiles([file]);
  if (!file || !s.active) return;
  if (!s.modern || s.preview) {
    notify("Attachments are available with the updated chat backend.");
    return;
  }
  try {
    const type = mediaType(file),
      limit = (type === "image" ? 5 : 16) * 1024 * 1024;
    if (!file.size || file.size > limit)
      throw new Error(
        `Choose a file smaller than ${type === "image" ? 5 : 16} MB.`,
      );
    clearAttachment();
    s.attachment = file;
    s.attachmentUrl = URL.createObjectURL(file);
    closeDrawer();
    $("waAttachmentPreview").hidden = false;
    $("waAttachmentPreview").innerHTML =
      `${type === "image" ? `<img src="${s.attachmentUrl}" alt="Attachment preview">` : type === "audio" ? `<audio src="${s.attachmentUrl}" controls></audio>` : ""}<div><strong>${esc(file.name)}</strong><br>${(file.size / 1024).toFixed(0)} KB · ${esc(type)}</div><button type="button" id="waRemoveAttachment" class="wa-icon-btn" aria-label="Remove attachment">×</button>`;
    $("waRemoveAttachment").onclick = clearAttachment;
    $("waDraft").placeholder =
      type === "audio"
        ? "Send voice message using the send button"
        : "Add a caption";
    syncComposer();
  } catch (error) {
    notify(error.message);
  }
}
function clearAttachment() {
  extra.clearFiles?.();
  if (s.attachmentUrl) URL.revokeObjectURL(s.attachmentUrl);
  s.attachment = null;
  s.attachmentUrl = "";
  $("waAttachmentPreview").hidden = true;
  $("waAttachmentPreview").innerHTML = "";
  $("waDraft").placeholder = "Type a message";
  syncComposer();
}
async function startRecording() {
  if (!s.active || s.recording || s.encoding || !s.modern) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    notify(
      "Voice recording is unavailable in this browser. Attach an audio file instead.",
    );
    return;
  }
  const epoch = ++s.recordingEpoch,
    id = s.active;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (epoch !== s.recordingEpoch || id !== s.active) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    const recorder = new MediaRecorder(stream),
      chunks = [],
      started = Date.now(),
      recording = {
        recorder,
        stream,
        cancel: false,
        timer: null,
        id,
        elapsed: 0,
        lastTick: started,
      };
    s.recording = recording;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      clearInterval(recording.timer);
      extra.stopWave?.();
      if (s.recording === recording) s.recording = null;
      if (recording.cancel || id !== s.active || epoch !== s.recordingEpoch) {
        $("waRecording").hidden = true;
        renderHeader();
        return;
      }
      s.encoding = true;
      $("waRecording").textContent = "Preparing your voice message…";
      renderHeader();
      try {
        const mp3 = await encodeVoice(
          new Blob(chunks, { type: recorder.mimeType }),
        );
        if (epoch === s.recordingEpoch && id === s.active)
          attachFile(
            new File([mp3], `voice-${Date.now()}.mp3`, { type: "audio/mpeg" }),
          );
      } catch (error) {
        notify("Could not prepare the recording. " + error.message);
      } finally {
        s.encoding = false;
        $("waRecording").hidden = true;
        renderHeader();
      }
    };
    recorder.onerror = () => {
      notify("Recording failed. Please try again.");
      stopRecording(true);
    };
    recorder.start();
    $("waRecording").hidden = false;
    $("waRecording").innerHTML =
      '<span aria-hidden="true">●</span><strong id="waRecordingTime">0:00</strong><span>Recording</span><button id="waStopRecording" type="button">Stop & preview</button><button id="waCancelRecording" type="button">Cancel</button>';
    $("waStopRecording").onclick = () => stopRecording(false);
    $("waCancelRecording").onclick = () => stopRecording(true);
    extra.recordingStarted?.(recording);
    recording.timer = setInterval(() => {
      const tick = Date.now();
      if (recorder.state === "recording")
        recording.elapsed += tick - recording.lastTick;
      recording.lastTick = tick;
      const seconds = Math.floor(recording.elapsed / 1000);
      if ($("waRecordingTime"))
        $("waRecordingTime").textContent =
          Math.floor(seconds / 60) +
          ":" +
          String(seconds % 60).padStart(2, "0");
      if (seconds >= 120) stopRecording(false);
    }, 250);
    renderHeader();
  } catch (error) {
    notify(
      error.name === "NotAllowedError"
        ? "Microphone access was not granted. You can attach an audio file instead."
        : error.message,
    );
  }
}
function stopRecording(cancel) {
  extra.stopWave?.();
  if (cancel) s.recordingEpoch++;
  if (s.recording) {
    s.recording.cancel = cancel;
    clearInterval(s.recording.timer);
    if (s.recording.recorder.state !== "inactive") s.recording.recorder.stop();
    s.recording.stream.getTracks().forEach((track) => track.stop());
  }
}
async function encodeVoice(blob) {
  const context = new AudioContext();
  let buffer;
  try {
    buffer = await context.decodeAudioData(await blob.arrayBuffer());
  } finally {
    await context.close();
  }
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++)
      samples[i] += source[i] / buffer.numberOfChannels;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker("assets/audio-encoder.js"),
      timer = setTimeout(() => {
        worker.terminate();
        reject(new Error("Audio encoding timed out."));
      }, 30000);
    worker.onmessage = (event) => {
      clearTimeout(timer);
      worker.terminate();
      event.data.error
        ? reject(new Error(event.data.error))
        : resolve(event.data.blob);
    };
    worker.onerror = () => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error("Audio encoder unavailable."));
    };
    worker.postMessage({ samples, sampleRate: buffer.sampleRate }, [
      samples.buffer,
    ]);
  });
}
function previewMessages(id) {
  const now = Date.now(),
    at = (minutes) => new Date(now - minutes * 60000).toISOString();
  if (id !== "preview-1")
    return [
      {
        id: id + "-m1",
        role: "user",
        text: "Hello, could you share a few product samples?",
        timestamp: at(30),
        type: "text",
      },
    ];
  return [
    {
      id: "p1",
      role: "user",
      text: "Hi! We are looking for a new visual aid for our pharma team.",
      timestamp: at(50),
      type: "text",
    },
    {
      id: "p2",
      role: "sales",
      text: "Hi Aarav! Happy to help. Do you have a size and page count in mind?",
      timestamp: at(48),
      status: "read",
      type: "text",
    },
    {
      id: "p3",
      role: "user",
      text: "Around 20 pages. Could you share your latest samples?",
      timestamp: at(45),
      type: "text",
    },
    {
      id: "p4",
      role: "sales",
      text:
        "Of course. Here are our Visual Aid samples:\n" + SAMPLE_LINKS[0].url,
      timestamp: at(43),
      status: "read",
      type: "text",
    },
    {
      id: "p5",
      role: "user",
      text: "These look great. We need 50 copies. Can we discuss the finish?",
      timestamp: at(5),
      type: "text",
    },
  ];
}
function startPreview() {
  resetSession();
  s.preview = true;
  s.modern = true;
  s.advanced = true;
  s.marketingTracking = true;
  s.chats = [
    {
      id: "preview-1",
      name: "Aarav Sharma",
      phone: "Sample contact",
      assignedTo: "ankit",
      temperature: "hot",
      status: "new",
      aiEnabled: false,
      requirement: "Visual Aid · 20 pages · 50 copies",
      lastMessageAt: new Date().toISOString(),
      lastMessageText: "Can we discuss the finish?",
      marketingReplyPending: true,
      lastMarketingTemplate: "visual_aid_marketing",
      unreadCount: 2,
    },
    {
      id: "preview-2",
      name: "Meera Kapoor",
      phone: "Sample contact",
      assignedTo: "reshu",
      temperature: "warm",
      status: "follow_up",
      lastMessageAt: new Date(Date.now() - 3600000).toISOString(),
      lastMessageText: "Could you share a few product samples?",
      unreadCount: 1,
    },
  ];
  const moreSamples = [
    ["Rohan Mehta", "Please share the prescription pad samples.", "warm"],
    ["Neha Gupta", "Thank you! I will confirm the quantity today.", "hot"],
    ["Vikram Singh", "Could we discuss the design tomorrow?", "warm"],
    ["Priya Verma", "Received the details, thank you.", "cold"],
  ];
  moreSamples.forEach(([name, text, temperature], index) =>
    s.chats.push({
      id: `preview-${index + 3}`,
      name,
      phone: "Sample contact",
      assignedTo: "ankit",
      temperature,
      status: "new",
      lastMessageAt: new Date(Date.now() - (index + 2) * 3600000).toISOString(),
      lastMessageText: text,
      unreadCount: index === 0 ? 1 : 0,
    }),
  );
  s.chats.forEach((chat) => {
    chat.lastInboundAt = chat.lastMessageAt;
    chat.inboundCount = previewMessages(chat.id).filter(
      (message) => message.role === "user",
    ).length;
    chat.unreadMessageCount = Math.min(chat.inboundCount, chat.unreadCount);
    chat.readMessageCount = chat.inboundCount - chat.unreadMessageCount;
    chat.readTrackingAvailable = true;
  });
  document.body.classList.add("session-active");
  document.body.classList.add("wa-preview-mode");
  closeAccount();
  $("waInboxFooter").textContent = "Preview · Sample conversations";
  $("waConnection").textContent = "Preview · Sample conversations";
  renderChats();
  openChat("preview-1");
  extra.previewStarted?.();
}
const previewButton = document.createElement("button");
previewButton.type = "button";
previewButton.className = "wa-preview-button";
previewButton.textContent = "Preview chat layout";
previewButton.onclick = () => {
  if (!crm.snapshot().connected) startPreview();
};
$("waWelcome").append(previewButton);
extra = installChatTools({
  s,
  $,
  crm,
  esc,
  notify,
  request,
  post,
  chatPath,
  current,
  renderChats,
  renderHeader,
  renderMessages,
  renderMedia,
  renderReply,
  openChat,
  fetchThread,
  refresh,
  cacheInbox: saveInboxCache,
  insertDraft,
  resizeDraft,
  syncComposer,
  drawer,
  closeDrawer,
  showDetails,
  showSamples,
  startRecording,
  stopRecording,
  mediaType,
  messagePreview,
  mergeMessages,
});
marketing = installMarketingWorkspace({
  $,
  crm,
  openMarketingReplies: () => {
    switchView("whatsapp");
    s.filter = "marketing";
    renderChats();
    document
      .querySelector('[data-wa-filter="marketing"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  },
});
sessionChanged();
switchView("whatsapp");
if (
  new URLSearchParams(location.search).get("preview") === "1" &&
  !crm.snapshot().connected
)
  startPreview();
setInterval(() => {
  tickReplyWindows();
  if (!document.hidden && s.view === "whatsapp" && !extra.streaming?.())
    refresh();
}, 15000);
