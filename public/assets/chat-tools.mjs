import { createAttachmentTools } from "./attachment-tools.mjs?v=4-drawer";
import { createMessagingTools } from "./messaging-tools.mjs?v=15-campaign-history";
import { createQuotationTools } from "./quotation-tools.mjs?v=4-custom-suggestions";
import { markInboxRead } from "./chat-utils.mjs?v=9-evisual-samples";

const RX_QUICK_REPLIES = [
  {
    title: "/social",
    text: `Take a look at our work at *RX Design Hub*—explore our pharma designs, recent projects and services.

📸 *Instagram | Designs & Inspiration*
https://www.instagram.com/rxdesignhub/

📘 *Facebook | Recent Work & Updates*
https://www.facebook.com/rxdesignhub

🌐 *Website | Explore Our Services*
https://www.rxdesignhub.com/

*See a style you like?* Share it with us here—it’ll help us understand the look you have in mind for your brand.

For any questions, just drop me a message. Happy to help!`,
  },
  {
    title: "/glosscardiadiabetic",
    label: "gloss cardia diabetic",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/104",
  },
  {
    title: "/mattderma",
    label: "matt derma",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/101",
  },
  {
    title: "/velvetgeneral",
    label: "velvet general",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/102",
  },
  {
    title: "/mattuvgeneral",
    label: "mattuvgeneral",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/107",
  },
  {
    title: "/ntrgeneral",
    label: "ntr general",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/105",
  },
  {
    title: "/evisual",
    text: "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s/108",
  },
  {
    title: "/website",
    text: "https://www.rxdesignhub.com/",
  },
  {
    title: "/paymentterms",
    text: `To proceed, we require a *50% advance before production*, with the remaining balance cleared before dispatch.

Freight and courier charges are payable by the client.

Please make the payment and send us the transaction reference so we can confirm receipt.`,
  },
  {
    title: "/orderconfirmed",
    text: `Hi [Name], thank you for placing your order with *RX Design Hub*!

We’ve received your order, and our design team will get in touch within *1–2 days* to discuss your requirements and the next steps.

For any queries, just reply here. In an emergency, you can contact our 24×7 helpline at *+91 9129172980*.`,
  },
  {
    title: "/timeline",
    text: `We’re planning to share your design draft within *2–5 days*. Once you approve the final design, production is expected to take *8–10 days*.

We’ll confirm the dispatch date at that stage. Courier delivery time will be additional.`,
  },
  {
    title: "/location",
    text: `We’re based in *Vikas Nagar, Lucknow*.

Here’s our office location:
https://share.google/QyB9qBQ6Zuqm3fDXp

Planning to visit? Give us a call on *+91 9129172980* before coming, and we’ll help you with directions.`,
  },
  {
    title: "/urgent",
    text: `Understood, [Name]. What date do you need the order in hand?

Let me check the design, production and delivery schedule with the team. I’ll get back to you within 24 hours with the earliest workable timeline.`,
  },
  {
    title: "/delay",
    text: `I’m sorry you’ve had to keep following up, [Name]. We should have kept you better updated.

I’ll check exactly where things stand with the team and get back to you within 24 hours with a clear update on what’s pending and when you can expect it.`,
  },
  {
    title: "/designconcern",
    text: `Thanks for being clear with us, [Name]. I’m sorry this version hasn’t matched what you had in mind.

Please point out what feels off, or share a reference closer to your expectations. I’ll go through it with the designer so we can address the right things in the next revision.`,
  },
];

function withRxQuickReplies(replies = []) {
  const saved = Array.isArray(replies) ? replies : [];
  const byTitle = new Map(
    saved.map((reply) => [
      String(reply.title || "")
        .trim()
        .toLowerCase(),
      reply,
    ]),
  );
  const defaultTitles = new Set(
    RX_QUICK_REPLIES.map((reply) => reply.title),
  );
  return [
    ...RX_QUICK_REPLIES.map((reply) => ({
      ...(byTitle.get(reply.title) || reply),
      title: reply.title,
      ...(reply.label ? { label: reply.label } : {}),
      builtIn: true,
    })),
    ...saved
      .filter(
        (reply) =>
          !defaultTitles.has(
            String(reply.title || "")
              .trim()
              .toLowerCase(),
          ),
      )
      .map((reply) => ({ ...reply, builtIn: false })),
  ];
}

export function installChatTools(c) {
  const {
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
    renderMessages,
    renderHeader,
    drawer,
    closeDrawer,
    openChat,
    insertDraft,
  } = c;
  const x = {
    prefs: {
      theme: "light",
      wallpaper: "default",
      fontSize: 16,
      sound: false,
      notifications: false,
      typing: true,
      recentEmoji: [],
    },
    views: {},
    favourites: false,
    label: "",
    ownerFilter: "",
    stageFilter: "",
    selected: new Set(),
    search: null,
    searchToken: 0,
    stream: null,
    streamKey: "",
    live: false,
    retry: 1000,
    loaded: "",
    draftTimers: new Map(),
    draftWrites: new Map(),
    suppress: "",
    quickReplies: withRxQuickReplies(),
    team: [],
    role: "",
    seen: new Map(),
    recent: [],
    refreshThread: false,
  };
  const namespace = () =>
    s.preview
      ? "preview"
      : `${crm.snapshot().role || "guest"}:${crm.snapshot().device || ""}`;
  const cacheKey = (name) => `rx-chat-v2:${namespace()}:${name}`;
  const cache = (name, fallback) => {
    try {
      return JSON.parse(localStorage.getItem(cacheKey(name))) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const saveCache = (name, value) => {
    try {
      localStorage.setItem(cacheKey(name), JSON.stringify(value));
    } catch {
      /* The server remains authoritative for saved settings. */
    }
  };
  const available = () => s.preview || s.advanced;
  const filterKey = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  const matchesStageFilter = (chat) => {
    const status = filterKey(chat.status),
      callStatus = filterKey(chat.callStatus);
    if (x.stageFilter === "quotation")
      return ["quotation", "quotation_sent"].includes(status);
    if (x.stageFilter === "follow_up")
      return ["follow_up", "interested"].includes(status) ||
        callStatus === "interested";
    return true;
  };
  function requireAdvanced() {
    if (available()) return true;
    notify(
      "This tool needs the new chat backend. You can try it in the sample preview.",
    );
    return false;
  }
  const button = (id, label, css = "wa-tool-button") =>
    `<button type="button" id="${id}" class="${css}">${label}</button>`;
  function bind(id, fn) {
    const element = $(id);
    if (!element) return;
    element.onclick = async (event) => {
      if (element.disabled) return;
      element.disabled = true;
      try {
        await fn(event);
      } catch (error) {
        notify(error.message);
      } finally {
        element.disabled = false;
      }
    };
  }
  function form(title, html) {
    drawer(title, `<div class="wa-tools-form">${html}</div>`);
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const dateTime = (value) =>
    Number.isFinite(Date.parse(value))
      ? new Date(value).toLocaleString()
      : "Not recorded";
  function applyTheme() {
    const dark =
      x.prefs.theme === "dark" ||
      (x.prefs.theme === "system" &&
        matchMedia("(prefers-color-scheme: dark)").matches);
    $("whatsappWorkspace").dataset.theme = dark ? "dark" : "light";
    $("whatsappWorkspace").dataset.wallpaper = x.prefs.wallpaper;
    $("whatsappWorkspace").style.setProperty(
      "--wa-message-size",
      `${x.prefs.fontSize}px`,
    );
    document.documentElement.dataset.waTheme = dark ? "dark" : "light";
  }
  async function savePrefs(patch) {
    Object.assign(x.prefs, patch);
    applyTheme();
    saveCache("preferences", x.prefs);
    if (s.preview) return;
    if (!requireAdvanced()) return;
    await post("/api/chats/preferences", patch);
  }
  function settings() {
    form(
      "Chat settings",
      `<label>Theme<select id="wxTheme"><option value="light">Light</option><option value="dark">Dark</option><option value="system">Use device theme</option></select></label><label>Wallpaper<select id="wxWallpaper"><option value="default">WhatsApp style</option><option value="plain">Plain</option><option value="mint">Mint</option><option value="blue">Blue</option></select></label><label>Message size<input id="wxSize" type="range" min="14" max="22" value="${x.prefs.fontSize}"><span id="wxSizeLabel">${x.prefs.fontSize}px</span></label><label class="wa-check"><input id="wxSound" type="checkbox" ${x.prefs.sound ? "checked" : ""}>New-message sound</label><label class="wa-check"><input id="wxNotifications" type="checkbox" ${x.prefs.notifications ? "checked" : ""}>Desktop notifications</label><p class="wa-muted">Notifications work while this CRM is open. Your browser may ask for permission.</p><label class="wa-check"><input id="wxTyping" type="checkbox" ${x.prefs.typing ? "checked" : ""}>Show customers when I am typing</label>${button("wxSavePrefs", "Save settings")}${button("wxTestSound", "Test message sound")}${button("wxShortcutHelp", "Keyboard shortcuts")}${button("wxIntegrations", "WhatsApp feature availability")}<p id="wxPrefsStatus" role="status"></p>`,
    );
    $("wxTheme").value = x.prefs.theme;
    $("wxWallpaper").value = x.prefs.wallpaper;
    $("wxSize").oninput = () => {
      $("wxSizeLabel").textContent = $("wxSize").value + "px";
    };
    bind("wxSavePrefs", async () => {
      let notifications = $("wxNotifications").checked;
      if (notifications) {
        if (!("Notification" in window)) {
          notifications = false;
          notify("Desktop notifications are unavailable in this browser.");
        } else if ((await Notification.requestPermission()) !== "granted") {
          notifications = false;
          notify("Notification permission was not granted.");
        }
      }
      await savePrefs({
        theme: $("wxTheme").value,
        wallpaper: $("wxWallpaper").value,
        fontSize: Number($("wxSize").value),
        sound: $("wxSound").checked,
        notifications,
        typing: $("wxTyping").checked,
      });
      $("wxNotifications").checked = notifications;
      $("wxPrefsStatus").textContent = s.preview
        ? "Saved for this preview on this device."
        : "Settings saved.";
    });
    bind("wxTestSound", () => playSound());
    bind("wxShortcutHelp", shortcuts);
    bind("wxIntegrations", () => messaging.capabilities());
  }
  let audio;
  async function playSound() {
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      await audio.resume();
      const oscillator = audio.createOscillator(),
        gain = audio.createGain();
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.frequency.setValueAtTime(740, audio.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(
        1040,
        audio.currentTime + 0.11,
      );
      gain.gain.setValueAtTime(0.06, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.26);
    } catch {
      /* Browsers may block audio before a user gesture. */
    }
  }
  function inboxReceived(chats) {
    for (const chat of chats) {
      const previous = x.seen.get(chat.id),
        count = Number(chat.inboundCount) || 0;
      if (
        previous !== undefined &&
        count > previous &&
        !chat.view?.muted &&
        (document.hidden || s.active !== chat.id || s.view !== "whatsapp")
      ) {
        if (x.prefs.sound) playSound();
        if (
          x.prefs.notifications &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            const n = new Notification(chat.name || chat.phone, {
              body: "New WhatsApp message",
              tag: "rx-chat-" + chat.id,
            });
            n.onclick = () => {
              window.focus();
              openChat(chat.id);
              n.close();
            };
          } catch {
            /* Mobile browsers may require service-worker notifications. */
          }
        }
      }
      x.seen.set(chat.id, count);
      if (s.preview) chat.view = x.views[chat.id] || chat.view || {};
    }
  }
  function status(text, kind = "") {
    $("waConnection").textContent = text;
    $("waConnection").dataset.state = kind;
  }
  const liveStatus = () =>
    s.cacheHydrated || s.cacheComplete
      ? `Live · ${s.chats.length.toLocaleString()} chats cached`
      : "Live · Connected";
  function stopStream() {
    x.stream?.abort();
    x.stream = null;
    x.streamKey = "";
    x.live = false;
    clearTimeout(x.reconnect);
    clearTimeout(x.watchdog);
  }
  async function stream() {
    if (s.preview || !s.advanced || !crm.snapshot().connected) return;
    const key = `${namespace()}:${s.active || ""}`;
    if (x.stream && x.streamKey === key) return;
    stopStream();
    const controller = new AbortController();
    x.stream = controller;
    x.streamKey = key;
    if (navigator.onLine === false) {
      status("Offline · Waiting for connection", "offline");
      return;
    }
    status("Connecting live updates…", "connecting");
    try {
      const response = await crm.request(
        `/api/chats/events${s.active ? "?leadId=" + encodeURIComponent(s.active) : ""}`,
        { responseType: "stream", signal: controller.signal },
      );
      if (!response.body?.getReader)
        throw new Error("Live updates are unavailable.");
      const reader = response.body.getReader(),
        decoder = new TextDecoder();
      let buffer = "";
      const keepAlive = () => {
        clearTimeout(x.watchdog);
        x.watchdog = setTimeout(
          () => controller.abort("heartbeat-timeout"),
          45000,
        );
      };
      keepAlive();
      while (!controller.signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        keepAlive();
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 65536)
          throw new Error("Invalid live-update response.");
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (event.includes("event: revoked")) {
            s.messages = [];
            s.chats = [];
            s.active = null;
            renderChats();
            renderMessages(true);
            renderHeader();
            throw new Error("Chat access changed.");
          }
          if (event.includes("event: error"))
            throw new Error("Live connection interrupted.");
          if (
            event.includes("event: ready") ||
            event.includes("event: heartbeat")
          ) {
            x.live = true;
            x.retry = 1000;
            status(liveStatus(), "live");
          }
          if (event.includes("event: change")) {
            const dataLine = event
              .split("\n")
              .find((line) => line.startsWith("data:"));
            try {
              const payload = JSON.parse(dataLine?.slice(5).trim() || "{}");
              x.refreshThread ||= payload.scopes?.includes("thread") === true;
            } catch {
              x.refreshThread = true;
            }
            clearTimeout(x.refreshTimer);
            x.refreshTimer = setTimeout(() => {
              const refreshThread = x.refreshThread;
              x.refreshThread = false;
              c.refresh(false, false, refreshThread);
            }, 250);
          }
        }
      }
      if (!controller.signal.aborted)
        throw new Error("Live connection closed.");
    } catch (error) {
      if (x.stream !== controller) return;
      x.live = false;
      if (error.status === 401 || error.status === 403) {
        status("Session ended · Sign in again", "offline");
        return;
      }
      status(
        navigator.onLine === false
          ? "Offline · Waiting for connection"
          : "Reconnecting live updates…",
        "connecting",
      );
    } finally {
      if (x.stream === controller) {
        x.stream = null;
        x.live = false;
        clearTimeout(x.watchdog);
        if (crm.snapshot().connected && !s.preview) {
          x.reconnect = setTimeout(stream, x.retry);
          x.retry = Math.min(x.retry * 2, 30000);
        }
      }
    }
  }
  window.addEventListener("online", () => {
    stopStream();
    stream();
    c.refresh();
  });
  window.addEventListener("offline", () => {
    stopStream();
    status("Offline · Drafts are kept on this device", "offline");
  });
  async function connected() {
    if (s.preview || !s.advanced) return;
    const key = namespace();
    if (x.loaded !== key) {
      x.loaded = key;
      try {
        const data = await request("/api/chats/preferences");
        if (key !== namespace()) return;
        Object.assign(x.prefs, data.preferences);
        x.quickReplies = withRxQuickReplies(data.quickReplies);
        x.team = data.team || [];
        x.role = data.role || "";
        x.capabilities = data.capabilities;
        applyTheme();
      } catch (error) {
        x.loaded = "";
        notify(error.message);
      }
    }
    stream();
    if (x.live) status(liveStatus(), "live");
  }
  function saveDraft(id, text) {
    const key = namespace();
    saveCache("draft:" + id, text);
    clearTimeout(x.draftTimers.get(id));
    if (s.preview || !s.advanced) return;
    const send = () => {
      const previous = x.draftWrites.get(id) || Promise.resolve();
      const next = previous
        .catch(() => {})
        .then(() =>
          key === namespace() && !s.preview
            ? post(`${chatPath(id)}/draft`, { text })
            : null,
        )
        .catch(() => {
          if (s.active === id)
            $("wxDraftStatus").textContent =
              "Draft kept on this device · sync pending";
        });
      x.draftWrites.set(id, next);
    };
    x.draftTimers.set(id, setTimeout(send, text ? 500 : 0));
    if ($("wxDraftStatus"))
      $("wxDraftStatus").textContent = text ? "Draft saved on this device" : "";
  }
  function opening(id) {
    attachments.closeModal();
    x.searchToken++;
    x.search = null;
    x.selected.clear();
    x.suppress = "";
    const saved = cache("draft:" + id, null);
    if (saved !== null) s.drafts.set(id, saved);
    $("wxType").value = "all";
    $("wxFrom").value = "";
    $("wxTo").value = "";
    $("wxSearchMore").hidden = true;
    stopStream();
  }
  async function opened(id) {
    if (s.preview) {
      current().view = x.views[id] || {};
      return;
    }
    if (!s.advanced) return;
    stream();
    const epoch = s.epoch,
      before = $("waDraft").value;
    try {
      if (cache("draft:" + id, null) === null) {
        const result = await request(`${chatPath(id)}/draft`);
        if (
          s.active === id &&
          s.epoch === epoch &&
          $("waDraft").value === before &&
          !before
        ) {
          $("waDraft").value = result.text;
          s.drafts.set(id, result.text);
          saveCache("draft:" + id, result.text);
          c.resizeDraft();
          renderChats();
        }
      } else if (before) saveDraft(id, before);
      await teamPresence();
    } catch (error) {
      if (s.active === id) notify(error.message);
    }
  }
  async function updateView(patch) {
    if (!current() || !requireAdvanced()) return;
    const id = s.active,
      view = s.preview
        ? { ...(current().view || {}), ...patch }
        : (await post(`${chatPath(id)}/view`, patch)).view;
    const lead = s.chats.find((c) => c.id === id);
    if (lead) lead.view = view;
    if (s.preview) {
      x.views[id] = view;
      saveCache("views", x.views);
    }
    renderChats();
    c.cacheInbox?.();
  }
  const quickStatusActions = {
    interested: {
      short: "I",
      label: "Follow Up / Interested",
      status: "follow_up",
      callStatus: "interested",
      className: "wa-status-action--interested",
    },
    quotation: {
      short: "Q",
      label: "Quotation",
      status: "quotation_sent",
      className: "wa-status-action--quotation",
    },
    lost: {
      short: "L",
      label: "Lost",
      status: "lost",
      className: "wa-status-action--lost",
    },
  };
  function statusActionActive(lead, key) {
    const action = quickStatusActions[key];
    if (!lead || !action) return false;
    if (key === "interested")
      return (
        ["follow_up", "interested"].includes(filterKey(lead.status)) ||
        filterKey(lead.callStatus) === "interested" &&
        !["quotation_sent", "converted", "lost"].includes(
          filterKey(lead.status),
        )
      );
    return filterKey(lead.status) === action.status;
  }
  function syncStatusActions() {
    const lead = current();
    document.querySelectorAll("[data-wa-status]").forEach((candidate) => {
      const key = candidate.dataset.waStatus;
      candidate.setAttribute(
        "aria-pressed",
        String(statusActionActive(lead, key)),
      );
      candidate.disabled = !lead;
    });
    const quoteButton = $("wxPrepQuote");
    if (quoteButton) quoteButton.disabled = !lead;
  }
  async function quickStatus(key) {
    const action = quickStatusActions[key],
      lead = current();
    if (!action || !lead) return;
    if (!requireAdvanced()) return;
    const button = document.querySelector(`[data-wa-status="${key}"]`);
    if (button) button.disabled = true;
    try {
      const patch = { status: action.status };
      if (action.callStatus) patch.callStatus = action.callStatus;
      if (!s.preview)
        await post(`/api/leads/${encodeURIComponent(lead.id)}/update`, patch);
      Object.assign(lead, patch);
      renderChats();
      renderHeader();
      c.cacheInbox?.();
      notify(`${action.label} status saved`);
    } finally {
      syncStatusActions();
    }
  }
  function prepareQuotation() {
    quotation.open();
  }
  function contactTools() {
    const lead = current();
    if (!lead) return;
    $("waDrawerBody").insertAdjacentHTML(
      "afterbegin",
      `<div class="wa-contact-tools">${button("wxUnread", "Mark unread")}${button("wxFavourite", lead.view?.favourite ? "★ Favourite" : "☆ Add favourite")}${button("wxGallery", "Media, links & docs")}${button("wxTeam", "Team & notes")}${button("wxSequence", "Sequence")}${button("wxExport", "Export chat")}${button("wxAI", lead.aiEnabled === false ? "Enable AI replies" : "Switch to manual")}${button("wxBlock", lead.whatsappBlocked ? "Unblock on WhatsApp" : "Block on WhatsApp")}<label>Labels, separated by commas<input id="wxLabels" maxlength="500" value="${esc((lead.view?.labels || []).join(", "))}" placeholder="VIP, Awaiting payment"></label>${button("wxSaveLabels", "Save labels")}</div>`,
    );
    bind("wxUnread", async () => {
      if (!requireAdvanced()) return;
      const id = s.active;
      if (!s.preview) await post(`${chatPath(id)}/unread`, {});
      x.suppress = id;
      lead.unreadCount = Math.max(1, lead.unreadCount || 0);
      lead.manualUnread = true;
      renderChats();
      c.cacheInbox?.();
      closeDrawer();
      notify("Marked unread. It will clear when you reopen this conversation.");
    });
    bind("wxFavourite", async () => {
      await updateView({ favourite: !lead.view?.favourite });
      c.showDetails();
    });
    bind("wxSaveLabels", async () => {
      await updateView({
        labels: $("wxLabels")
          .value.split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      });
      notify("Labels saved");
    });
    bind("wxGallery", () => gallery());
    bind("wxTeam", () => messaging.team());
    bind("wxSequence", () => messaging.sequence());
    bind("wxExport", exportChat);
    bind("wxAI", () => messaging.toggleAI());
    bind("wxBlock", () => messaging.block());
  }
  function afterChats() {
    const labels = [
      ...new Set(s.chats.flatMap((chat) => chat.view?.labels || [])),
    ].sort();
    $("wxLabelFilter").innerHTML =
      '<option value="">All labels</option>' +
      labels
        .map((v) => `<option value="${esc(v)}">${esc(v)}</option>`)
        .join("");
    $("wxLabelFilter").value = x.label;
    document.querySelectorAll("#waChatList [data-chat]").forEach((row) => {
      const lead = s.chats.find((c) => c.id === row.dataset.chat);
      if (lead?.view?.favourite)
        row
          .querySelector("strong")
          .insertAdjacentHTML(
            "beforeend",
            '<span class="wa-favourite-star" aria-label="Favourite"> ★</span>',
          );
      if (lead?.view?.labels?.length) row.title = lead.view.labels.join(", ");
    });
  }
  function filters() {
    const from = $("wxFrom").value,
      to = $("wxTo").value;
    return {
      q: $("waMessageSearch").value.trim(),
      type: $("wxType").value,
      ...(from ? { from: new Date(from + "T00:00:00").toISOString() } : {}),
      ...(to ? { to: new Date(to + "T23:59:59.999").toISOString() } : {}),
    };
  }
  function matches(m, f) {
    return (
      (!f.q ||
        [m.text, m.media?.filename]
          .join(" ")
          .toLowerCase()
          .includes(f.q.toLowerCase())) &&
      (f.type === "all" ||
        f.type === m.type ||
        (f.type === "media" &&
          ["image", "video", "audio", "sticker"].includes(m.type)) ||
        (f.type === "links" && /https?:\/\//.test(m.text || ""))) &&
      (!f.from || m.timestamp >= f.from) &&
      (!f.to || m.timestamp <= f.to)
    );
  }
  async function search(more = false) {
    if (!s.active) return;
    const id = s.active,
      token = ++x.searchToken,
      f = filters();
    if (!more)
      x.search = { messages: [], cursor: null, scanned: 0, filters: f };
    const state = x.search;
    if (!state) return;
    if (!f.q && f.type === "all" && !f.from && !f.to) {
      x.search = null;
      renderMessages(true);
      $("wxSearchMore").hidden = true;
      return;
    }
    $("waSearchCount").textContent = "Searching stored history…";
    try {
      const result = s.preview
        ? {
            messages: (s.previewThreads.get(id) || []).filter((m) =>
              matches(m, f),
            ),
            nextCursor: null,
            scanned: s.messages.length,
          }
        : await request(
            `${chatPath(id)}/search?${new URLSearchParams({ ...f, ...(more && state.cursor ? { cursor: state.cursor } : {}) })}`,
          );
      if (token !== x.searchToken || id !== s.active) return;
      state.messages.push(...result.messages);
      state.cursor = result.nextCursor;
      state.scanned += result.scanned;
      renderMessages(true);
      $("waSearchCount").textContent =
        `${state.messages.length} matches · ${state.scanned} messages searched${state.cursor ? " · More history available" : " · Complete"}`;
      $("wxSearchMore").hidden = !state.cursor;
    } catch (error) {
      if (token === x.searchToken) {
        $("waSearchCount").textContent = error.message;
        notify(error.message);
      }
    }
  }
  let searchTimer;
  const scheduleSearch = () => {
    if (!requireAdvanced()) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(), 300);
  };
  async function historyPage(id, filter, cursor) {
    return s.preview
      ? {
          messages: (s.previewThreads.get(id) || s.messages).filter((m) =>
            matches(m, { q: "", type: filter }),
          ),
          nextCursor: null,
        }
      : request(
          `${chatPath(id)}/search?${new URLSearchParams({ type: filter, ...(cursor ? { cursor } : {}) })}`,
        );
  }
  let galleryState;
  async function gallery(type = "media", more = false) {
    if (!current() || !requireAdvanced()) return;
    const id = s.active;
    if (!more) galleryState = { id, type, messages: [], cursor: null };
    const state = galleryState;
    form(
      "Media, links & documents",
      `<div class="wa-gallery-tabs">${["media", "links", "document"].map((t) => `<button type="button" data-gallery-tab="${t}" aria-pressed="${t === type}">${{ media: "Media", links: "Links", document: "Documents" }[t]}</button>`).join("")}</div><p id="wxGalleryStatus">Loading…</p><div id="wxGalleryItems"></div>${button("wxGalleryMore", "Load more history")}`,
    );
    document
      .querySelectorAll("[data-gallery-tab]")
      .forEach((b) => (b.onclick = () => gallery(b.dataset.galleryTab)));
    try {
      const result = await historyPage(id, type, more ? state.cursor : null);
      if (s.active !== id || galleryState !== state || !$("wxGalleryItems"))
        return;
      state.messages.push(...result.messages);
      state.cursor = result.nextCursor;
      $("wxGalleryStatus").textContent =
        `${state.messages.length} items${state.cursor ? " · More history available" : ""}`;
      $("wxGalleryItems").innerHTML =
        state.messages
          .map(
            (m) =>
              `<article class="wa-gallery-item"><strong>${esc(m.media?.filename || m.type)}</strong><p>${esc(c.messagePreview(m))}</p><small>${esc(dateTime(m.timestamp))}</small>${type === "links" ? (String(m.text).match(/https?:\/\/[^\s<>]+/g) || []).map((link) => `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open link ↗</a>`).join("") : `<button data-gallery-open="${esc(m.id)}" type="button">${m.mediaHidden ? "Hidden in CRM" : "Open / download"}</button><button data-gallery-hide="${esc(m.id)}" type="button">${m.mediaHidden ? "Restore attachment" : "Hide from CRM"}</button>`}</article>`,
          )
          .join("") || "<p>No items found in the history searched so far.</p>";
      $("wxGalleryMore").hidden = !state.cursor;
      bind("wxGalleryMore", () => gallery(type, true));
      document.querySelectorAll("[data-gallery-open]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              const m = state.messages.find(
                (m) => m.id === b.dataset.galleryOpen,
              );
              if (m.mediaHidden)
                return notify("Restore this attachment to view it.");
              if (["image", "sticker"].includes(m.type))
                await attachments.lightbox(m, state.messages);
              else
                download(
                  await attachments.mediaBlob(m),
                  m.media?.filename ||
                    `attachment.${m.type === "video" ? "mp4" : m.type === "audio" ? "mp3" : "bin"}`,
                );
            } catch (e) {
              notify(e.message);
            }
          }),
      );
      document.querySelectorAll("[data-gallery-hide]").forEach(
        (b) =>
          (b.onclick = async () => {
            try {
              const m = state.messages.find(
                  (m) => m.id === b.dataset.galleryHide,
                ),
                hidden = !m.mediaHidden;
              if (!s.preview)
                await post(
                  `${chatPath(id)}/messages/${encodeURIComponent(m.id)}/visibility`,
                  { hidden },
                );
              m.mediaHidden = hidden;
              const local = s.messages.find((x) => x.id === m.id);
              if (local) local.mediaHidden = hidden;
              renderMessages(true);
              gallery(type);
            } catch (e) {
              notify(e.message);
            }
          }),
      );
    } catch (error) {
      if ($("wxGalleryStatus"))
        $("wxGalleryStatus").textContent = error.message;
    }
  }
  async function exportChat() {
    if (!requireAdvanced()) return;
    const id = s.active,
      lead = current();
    let cursor,
      messages = [],
      cancelled = false;
    form(
      "Export conversation",
      '<p>Export includes stored messages and attachment metadata. Attachment files stay separate.</p><p id="wxExportProgress">Preparing…</p>' +
        button("wxCancelExport", "Cancel"),
    );
    bind("wxCancelExport", () => {
      cancelled = true;
      closeDrawer();
    });
    do {
      const page = await historyPage(id, "all", cursor);
      if (cancelled || s.active !== id || !$("wxExportProgress")) return;
      messages.push(...page.messages);
      cursor = page.nextCursor;
      $("wxExportProgress").textContent =
        `${messages.length} messages prepared…`;
    } while (cursor);
    const data = {
      exportedAt: new Date().toISOString(),
      contact: { name: lead.name, phone: lead.phone },
      messages: messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    };
    download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      `chat-${String(lead.phone || id).replace(/[^a-zA-Z0-9-]/g, "-")}.json`,
    );
    $("wxExportProgress").textContent =
      `Export ready · ${messages.length} messages.`;
  }
  function messageInfo(m) {
    form(
      "Message info",
      `<p>${esc(c.messagePreview(m) || m.type)}</p><dl>${["accepted", "sent", "delivered", "read", "received"].map((name) => `<div class="wa-detail-row"><dt>${name[0].toUpperCase() + name.slice(1)}</dt><dd>${esc(dateTime(m.statusTimes?.[name]))}</dd></div>`).join("")}</dl><p>Status: ${esc(m.status || "Not recorded")}</p>${m.error ? `<p>${esc(m.error)}</p>` : ""}<p class="wa-muted">Only recorded receipts are shown. Older messages may not have receipt times.</p>`,
    );
  }
  function messageMenu(m) {
    form(
      "Message actions",
      `<blockquote>${esc(c.messagePreview(m).slice(0, 200))}</blockquote>${button("wxReply", "Reply")}${button("wxInfo", "Message info")}${button("wxReact", "React")}${button("wxSelect", x.selected.has(m.id) ? "Unselect message" : "Select for forwarding")}`,
    );
    bind("wxReply", () => {
      s.reply = m;
      c.renderReply();
      closeDrawer();
      $("waDraft").focus();
    });
    bind("wxInfo", () => messageInfo(m));
    bind("wxReact", () => showEmoji((emoji) => messaging.reaction(m, emoji)));
    bind("wxSelect", () => {
      x.selected.has(m.id) ? x.selected.delete(m.id) : x.selected.add(m.id);
      closeDrawer();
      renderMessages(true);
    });
  }
  function afterMessages(messages) {
    if (x.search) {
      $("waOlder").hidden = true;
      $("waSearchCount").textContent =
        `${x.search.messages.length} matches · ${x.search.scanned} messages searched${x.search.cursor ? " · More history available" : " · Complete"}`;
    }
    document
      .querySelectorAll("#waMessageItems [data-message]")
      .forEach((article) => {
        const m = messages.find((m) => m.id === article.dataset.message);
        if (!m) return;
        article.classList.toggle("wa-selected", x.selected.has(m.id));
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "More";
        b.setAttribute("aria-label", "Message actions");
        b.onclick = () => messageMenu(m);
        article.querySelector(".wa-message-tools")?.append(b);
        if (m.order) {
          const orderButton = document.createElement("button");
          orderButton.type = "button";
          orderButton.textContent = "Update order";
          orderButton.onclick = () => messaging.order(m);
          article.querySelector(".wa-message-tools")?.append(orderButton);
        }
        if (quotation.isQuotationMessage(m)) {
          const previewButton = document.createElement("button");
          previewButton.type = "button";
          previewButton.className = "wa-preview-quotation";
          previewButton.textContent = "Preview quotation";
          previewButton.onclick = () =>
            quotation.previewSent(m).catch((error) => notify(error.message));
          article.querySelector(".wa-message-tools")?.append(previewButton);
        }
        if (m.reactions) {
          const tags = Object.values(m.reactions)
            .filter((r) => r.emoji)
            .map((r) => esc(r.emoji));
          if (tags.length)
            article
              .querySelector(".wa-bubble")
              .insertAdjacentHTML(
                "beforeend",
                `<div class="wa-reactions">${tags.join(" ")}</div>`,
              );
        }
        let held, start;
        article.addEventListener("pointerdown", (event) => {
          if (
            event.pointerType !== "touch" ||
            event.target.closest("button,a,input,video,audio")
          )
            return;
          start = { x: event.clientX, y: event.clientY };
          held = setTimeout(() => {
            held = null;
            messageMenu(m);
          }, 550);
        });
        article.addEventListener("pointermove", (event) => {
          if (
            start &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12
          ) {
            clearTimeout(held);
            held = null;
          }
        });
        article.addEventListener("pointerup", (event) => {
          clearTimeout(held);
          if (
            start &&
            event.clientX - start.x > 80 &&
            Math.abs(event.clientY - start.y) < 30
          ) {
            s.reply = m;
            c.renderReply();
          }
          start = null;
        });
        article.addEventListener("pointercancel", () => {
          clearTimeout(held);
          start = null;
        });
      });
    document.querySelectorAll("[data-view-image]").forEach(
      (b) =>
        (b.onclick = () => {
          const m = messages.find((m) => m.id === b.dataset.viewImage);
          attachments.lightbox(m, messages).catch((e) => notify(e.message));
        }),
    );
    document.querySelectorAll(".wa-speed").forEach(
      (b) =>
        (b.onclick = () => {
          const a = b.previousElementSibling;
          a.playbackRate = a.playbackRate >= 2 ? 1 : a.playbackRate + 0.5;
          b.textContent = a.playbackRate + "×";
        }),
    );
    $("wxSelection").hidden = !x.selected.size;
    $("wxSelectionCount").textContent = `${x.selected.size} selected`;
  }
  async function showEmoji(onSelect) {
    form(
      onSelect ? "Choose reaction" : "Emoji",
      `<label>Search emoji<input id="wxEmojiSearch" type="search" placeholder="Smile, heart, celebration…"></label><div id="wxEmojiGrid" class="wa-emoji-grid">Loading emojis…</div>`,
    );
    try {
      const response = await fetch("assets/emoji-data.json");
      if (!response.ok) throw new Error("Emoji list is unavailable.");
      const data = await response.json();
      if (!$("wxEmojiSearch")) return;
      const render = () => {
        const q = $("wxEmojiSearch").value.toLowerCase(),
          recent = x.prefs.recentEmoji || [];
        const list = data.filter(
          (e) =>
            !q || (e.name + " " + (e.keywords || "")).toLowerCase().includes(q),
        );
        $("wxEmojiGrid").innerHTML =
          (!q
            ? recent
                .map(
                  (e) =>
                    `<button type="button" data-emoji="${esc(e)}" aria-label="Recent ${esc(e)}">${esc(e)}</button>`,
                )
                .join("")
            : "") +
          list
            .map(
              (e) =>
                `<button type="button" data-emoji="${esc(e.emoji)}" title="${esc(e.name)}" aria-label="${esc(e.name)}">${e.emoji}</button>`,
            )
            .join("");
        $("wxEmojiGrid")
          .querySelectorAll("[data-emoji]")
          .forEach(
            (b) =>
              (b.onclick = async () => {
                const emoji = b.dataset.emoji;
                try {
                  x.prefs.recentEmoji = [
                    emoji,
                    ...recent.filter((e) => e !== emoji),
                  ].slice(0, 32);
                  savePrefs({ recentEmoji: x.prefs.recentEmoji }).catch(
                    () => {},
                  );
                  if (onSelect) await onSelect(emoji);
                  else insertDraft(emoji);
                } catch (e) {
                  notify(e.message);
                }
              }),
          );
      };
      $("wxEmojiSearch").oninput = render;
      render();
      $("wxEmojiSearch").focus();
    } catch (error) {
      if ($("wxEmojiGrid")) $("wxEmojiGrid").textContent = error.message;
    }
  }
  async function teamPresence() {
    if (!s.active || s.preview || !s.advanced) return;
    const id = s.active,
      data = await request(`${chatPath(id)}/team`);
    if (s.active !== id) return;
    $("wxPresence").textContent = data.presence?.length
      ? data.presence.map((p) => p.agent).join(", ") + " is replying…"
      : "";
  }
  let lastPresence = 0,
    lastTyping = 0;
  $("waDraft").addEventListener("input", () => {
    if (!s.active || s.preview || !s.advanced) return;
    if (Date.now() - lastPresence > 10000) {
      lastPresence = Date.now();
      post(`${chatPath(s.active)}/presence`, {
        active: Boolean($("waDraft").value),
      }).catch(() => {});
    }
    const m = s.messages
      .filter((m) => m.role === "user" && m.whatsappMessageId)
      .at(-1);
    if (m && x.prefs.typing && Date.now() - lastTyping > 20000) {
      lastTyping = Date.now();
      post(`${chatPath(s.active)}/typing`, { messageId: m.id }).catch(() => {});
    }
  });
  function shortcuts() {
    form(
      "Keyboard shortcuts",
      "<dl><dt>Ctrl / ⌘ + K</dt><dd>Find a conversation</dd><dt>Ctrl / ⌘ + Shift + F</dt><dd>Search conversation history</dd><dt>Ctrl / ⌘ + Shift + N</dt><dd>New conversation</dd><dt>Alt + ↑ / ↓</dt><dd>Previous / next chat</dd><dt>Enter</dt><dd>Send on desktop</dd><dt>Shift + Enter</dt><dd>New line</dd><dt>Escape</dt><dd>Close panel / cancel selection</dd></dl><p>On mobile, hold a message for actions or swipe it right to reply.</p>",
    );
  }
  const shared = {
    ...c,
    x,
    available,
    requireAdvanced,
    form,
    button,
    bind,
    download,
    dateTime,
    showEmoji,
    saveCache,
    cache,
    saveDraft,
    withRxQuickReplies,
    messaging: () => messaging,
  };
  const attachments = createAttachmentTools(shared),
    messaging = createMessagingTools({ ...shared, attachments }),
    quotation = createQuotationTools({ ...shared, attachments });
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "assets/chat-tools.css?v=22-marketing-answered";
  document.head.append(stylesheet);
  $("waRefresh").insertAdjacentHTML(
    "afterend",
    button("wxSettings", "⚙", "wa-icon-btn"),
  );
  $("wxSettings").setAttribute("aria-label", "Chat settings");
  bind("wxSettings", settings);
  document
    .querySelector(".wa-filters")
    .insertAdjacentHTML(
      "beforeend",
      '<button type="button" id="wxFavourites" aria-pressed="false">Favourites</button><div class="wa-compact-filters"><select id="wxLabelFilter" aria-label="Filter by label"><option value="">All labels</option></select><div class="wa-mini-filters" aria-label="Quick owner and stage filters"><button type="button" class="wa-mini-filter" data-wx-owner="ankit" aria-label="Filter by Ankit" aria-pressed="false" title="Ankit">A</button><button type="button" class="wa-mini-filter" data-wx-owner="reshu" aria-label="Filter by Reshu" aria-pressed="false" title="Reshu">R</button><button type="button" class="wa-mini-filter" data-wx-owner="shubham" aria-label="Filter by Shubham" aria-pressed="false" title="Shubham">S</button><button type="button" class="wa-mini-filter" data-wx-stage="quotation" aria-label="Filter quotation leads" aria-pressed="false" title="Quotation">Q</button><button type="button" class="wa-mini-filter" data-wx-stage="follow_up" aria-label="Filter follow up or interested leads" aria-pressed="false" title="Follow Up / Interested">F</button></div></div>',
    );
  $("wxFavourites").onclick = () => {
    x.favourites = !x.favourites;
    $("wxFavourites").setAttribute("aria-pressed", String(x.favourites));
    renderChats();
  };
  $("wxLabelFilter").onchange = () => {
    x.label = $("wxLabelFilter").value;
    renderChats();
  };
  document.querySelectorAll("[data-wx-owner]").forEach((button) => {
    button.onclick = () => {
      x.ownerFilter =
        x.ownerFilter === button.dataset.wxOwner
          ? ""
          : button.dataset.wxOwner;
      document.querySelectorAll("[data-wx-owner]").forEach((candidate) =>
        candidate.setAttribute(
          "aria-pressed",
          String(candidate.dataset.wxOwner === x.ownerFilter),
        ),
      );
      renderChats();
    };
  });
  document.querySelectorAll("[data-wx-stage]").forEach((button) => {
    button.onclick = () => {
      x.stageFilter =
        x.stageFilter === button.dataset.wxStage
          ? ""
          : button.dataset.wxStage;
      document.querySelectorAll("[data-wx-stage]").forEach((candidate) =>
        candidate.setAttribute(
          "aria-pressed",
          String(candidate.dataset.wxStage === x.stageFilter),
        ),
      );
      renderChats();
    };
  });
  $("waThreadSearch").insertAdjacentHTML(
    "beforeend",
    '<select id="wxType" aria-label="Message type"><option value="all">All messages</option><option value="image">Photos</option><option value="video">Videos</option><option value="audio">Audio</option><option value="document">Documents</option><option value="links">Links</option></select><label>From<input id="wxFrom" type="date"></label><label>To<input id="wxTo" type="date"></label><button id="wxSearchMore" type="button" hidden>Search more history</button>',
  );
  $("waMessageSearch").oninput = scheduleSearch;
  ["wxType", "wxFrom", "wxTo"].forEach(
    (id) => ($(id).onchange = scheduleSearch),
  );
  bind("wxSearchMore", () => search(true));
  $("waSearchThread").onclick = () => {
    if (!requireAdvanced()) return;
    const hidden = !$("waThreadSearch").hidden;
    $("waThreadSearch").hidden = hidden;
    if (!hidden) $("waMessageSearch").focus();
    else {
      x.searchToken++;
      x.search = null;
      $("waMessageSearch").value = "";
      renderMessages(true);
    }
  };
  $("waReplyPreview").insertAdjacentHTML(
    "beforebegin",
    '<div id="wxSelection" class="wa-selection" hidden><span id="wxSelectionCount"></span><button type="button" id="wxForward">Forward</button><button type="button" id="wxCancelSelection">Cancel</button></div><div id="wxPresence" class="wa-presence" role="status"></div>',
  );
  $("waComposer").insertAdjacentHTML(
    "afterend",
    '<div class="wa-compose-status"><div class="wa-status-actions" role="group" aria-label="Lead actions"><button type="button" class="wa-status-action wa-status-action--interested" data-wa-status="interested" aria-label="Follow Up / Interested" title="Follow Up / Interested">I</button><button type="button" class="wa-status-action wa-status-action--quotation" data-wa-status="quotation" aria-label="Quotation" title="Quotation">Q</button><button type="button" class="wa-status-action wa-status-action--lost" data-wa-status="lost" aria-label="Lost" title="Lost">L</button><button type="button" id="wxPrepQuote" class="wa-prep-quote" aria-label="Prepare quotation for this customer" title="Open quotation desk for this customer">Prep Quote</button></div><span id="wxDraftStatus"></span><button type="button" id="wxQuick">Quick replies</button><button type="button" id="wxTemplates">Templates</button><button type="button" id="wxSuggest">Suggest reply</button></div>',
  );
  document.querySelectorAll("[data-wa-status]").forEach((candidate) => {
    candidate.onclick = async () => {
      if (candidate.disabled) return;
      try {
        await quickStatus(candidate.dataset.waStatus);
      } catch (error) {
        notify(error.message);
      }
    };
  });
  syncStatusActions();
  bind("wxPrepQuote", prepareQuotation);
  bind("wxQuick", () => messaging.quickReplies());
  bind("wxTemplates", () => messaging.templates());
  bind("wxSuggest", () => messaging.suggest());
  bind("wxForward", () => messaging.forward());
  bind("wxCancelSelection", () => {
    x.selected.clear();
    renderMessages(true);
  });
  $("waFindChat").setAttribute("aria-label", "New conversation");
  $("waFindChat").title = "New conversation";
  bind("waFindChat", () => messaging.newChat());
  document.addEventListener("keydown", (event) => {
    if (s.view !== "whatsapp") return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("waSearch").focus();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "f"
    ) {
      event.preventDefault();
      $("waSearchThread").click();
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === "n"
    ) {
      event.preventDefault();
      messaging.newChat();
    }
    if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const rows = [...document.querySelectorAll("[data-chat]")],
        index = rows.findIndex((r) => r.dataset.chat === s.active);
      rows[index + (event.key === "ArrowDown" ? 1 : -1)]?.click();
    }
    if (event.key === "Escape") {
      x.selected.clear();
      attachments.closeModal();
      quotation.close();
      renderMessages();
    }
  });
  Object.assign(x.prefs, cache("preferences", {}));
  applyTheme();
  window.addEventListener("beforeunload", () => {
    stopStream();
    attachments.stopWave();
    attachments.closeModal();
    quotation.close();
  });
  return {
    connected,
    inboxReceived,
    saveDraft,
    opening,
    opened,
    contactTools,
    afterChats,
    afterMessages,
    showEmoji,
    chatMatches: (chat) =>
      (!x.favourites || chat.view?.favourite) &&
      (!x.label || chat.view?.labels?.includes(x.label)) &&
      (!x.ownerFilter || filterKey(chat.assignedTo) === x.ownerFilter) &&
      matchesStageFilter(chat),
    suppressRead: () => x.suppress === s.active || Boolean(x.search),
    streaming: () => x.live,
    reopen: () => {
      x.suppress = "";
      s.readCount = -1;
      if (s.preview && current()) {
        markInboxRead(current());
        renderChats();
      }
    },
    signature: () =>
      JSON.stringify({ search: x.search, selected: [...x.selected] }),
    visibleMessages: () => x.search?.messages || null,
    searchActive: () => Boolean(x.search),
    threadReceived: () => {
      teamPresence().catch(() => {});
    },
    afterHeader: () => {
      syncStatusActions();
      if ($("wxDraftStatus") && !$("waDraft").value)
        $("wxDraftStatus").textContent = "";
    },
    expandQuickReply: () => messaging.expandQuickReply(),
    messageContent: (m) => messaging.messageContent(m),
    previewStarted: () => {
      x.views = cache("views", {});
      Object.assign(x.prefs, cache("preferences", {}));
      x.quickReplies = withRxQuickReplies(cache("quickReplies", []));
      x.role = "admin";
      x.team = ["ankit", "reshu", "shubham"];
      s.chats.forEach((c) => (c.view = x.views[c.id] || {}));
      applyTheme();
      renderChats();
    },
    reset: () => {
      stopStream();
      attachments.clearFiles();
      attachments.closeModal();
      attachments.resetMedia();
      clearTimeout(x.refreshTimer);
      clearTimeout(searchTimer);
      x.searchToken++;
      x.search = null;
      x.loaded = "";
      x.selected.clear();
      x.seen.clear();
      x.draftTimers.forEach(clearTimeout);
      x.draftTimers.clear();
      x.quickReplies = withRxQuickReplies();
      x.views = {};
      s.advanced = false;
      quotation.close();
    },
    ...attachments,
  };
}
