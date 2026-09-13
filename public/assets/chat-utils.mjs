export function inboxChatStatus(chat) {
  if (chat.manualUnread === true || Number(chat.unreadCount) > 0)
    return "unread";
  if (chat.readTrackingAvailable === false || chat.unreadCount == null)
    return "unknown";
  return "read";
}
export function inboxReadSummary(chats, available = true) {
  const summary = {
    chats: chats.length,
    unreadChats: 0,
    readChats: 0,
    unknownChats: 0,
    unreadMessages: 0,
    readMessages: 0,
    trackedChats: 0,
    available,
  };
  if (!available) return summary;
  for (const chat of chats) {
    summary[inboxChatStatus(chat) + "Chats"]++;
    if (chat.readTrackingAvailable === false) continue;
    const valid = (value) =>
      value !== undefined &&
      value !== null &&
      Number.isSafeInteger(Number(value)) &&
      Number(value) >= 0;
    let unread = chat.unreadMessageCount,
      read = chat.readMessageCount;
    if (
      (!valid(unread) || !valid(read)) &&
      !chat.manualUnread &&
      valid(chat.inboundCount) &&
      valid(chat.unreadCount)
    ) {
      unread = Math.min(Number(chat.inboundCount), Number(chat.unreadCount));
      read = Number(chat.inboundCount) - unread;
    }
    if (!valid(unread) || !valid(read)) continue;
    summary.trackedChats++;
    summary.unreadMessages += Number(unread);
    summary.readMessages += Number(read);
  }
  return summary;
}

export function markInboxRead(chat, visibleCount = chat?.inboundCount) {
  if (!chat) return;
  chat.manualUnread = false;
  const total = Number(chat.inboundCount),
    seen = Number(visibleCount);
  if (
    chat.inboundCount != null &&
    Number.isSafeInteger(total) &&
    total >= 0 &&
    Number.isSafeInteger(seen)
  ) {
    const unread = Math.max(
      0,
      total - Math.max(0, seen, Number(chat.readMessageCount) || 0),
    );
    chat.unreadCount = unread;
    chat.unreadMessageCount = unread;
    chat.readMessageCount = total - unread;
    chat.readTrackingAvailable = true;
  } else {
    chat.unreadCount = 0;
  }
}

// CTWA's 72-hour free entry point period affects pricing. Free-form replies
// still require a customer message within the rolling 24-hour service window.
export function replyWindow(chat = {}, now = Date.now()) {
  const inbound = Date.parse(chat.lastInboundAt);
  const known = Number.isFinite(inbound) && inbound <= now;
  const expiresAt = known ? inbound + 86400000 : null;
  return {
    known,
    expiresAt,
    open: known && now < expiresAt && !chat.optedOut && !chat.whatsappBlocked,
  };
}

export function replyWindowCountdown(chat = {}, now = Date.now()) {
  const windowState = replyWindow(chat, now);
  if (chat.optedOut)
    return {
      state: "blocked",
      short: "Opted out",
      header: "Free reply unavailable",
      label: "Free reply unavailable because this customer opted out.",
    };
  if (chat.whatsappBlocked)
    return {
      state: "blocked",
      short: "Blocked",
      header: "Free reply unavailable",
      label: "Free reply unavailable because this contact is blocked.",
    };
  if (!windowState.known)
    return {
      state: "unknown",
      short: "No timer",
      header: "Reply window unknown",
      label: "No valid customer message time is recorded.",
    };
  if (!windowState.open)
    return {
      state: "expired",
      short: "Expired",
      header: "Reply window expired",
      label: "The 24-hour free reply window has expired. Use an approved template.",
    };

  const remainingMs = Math.max(0, windowState.expiresAt - now);
  const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const readable = `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return {
    state: remainingMs <= 2 * 60 * 60 * 1000 ? "ending" : "open",
    short: clock,
    header: `Free reply · ${clock}`,
    label: `${readable} remaining in the 24-hour free reply window.`,
  };
}

export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
export function linkify(value) {
  return String(value || "")
    .split(/(https?:\/\/[^\s<>]+)/g)
    .map((part) => {
      if (!/^https?:\/\//i.test(part)) return escape(part);
      try {
        const url = new URL(part);
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${escape(part)}</a>`;
      } catch {
        return escape(part);
      }
    })
    .join("");
}
export const initials = (name) =>
  String(name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
export const time = (value) =>
  Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
export function day(value) {
  if (!Number.isFinite(Date.parse(value))) return "Earlier messages";
  const date = new Date(value),
    now = new Date(),
    yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
export function messagePreview(message = {}) {
  const type = message.type || message.lastMessageType || "text",
    text = message.text ?? message.lastMessageText ?? "";
  const label = {
    image: "Photo",
    video: "Video",
    audio: "Voice / audio",
    document: "Document",
    sticker: "Sticker",
    location: "Location",
    contacts: "Contact",
  }[type];
  return label ? `${label}${text ? " · " + text : ""}` : text;
}
export function statusMarkup(status) {
  if (status === "preview")
    return '<span title="Saved in this preview only">Preview</span>';
  if (status === "read")
    return '<span class="wa-ticks read" title="Read" aria-label="Read">✓✓</span>';
  if (status === "delivered")
    return '<span class="wa-ticks" title="Delivered" aria-label="Delivered">✓✓</span>';
  if (status === "sent")
    return '<span class="wa-ticks" title="Sent" aria-label="Sent">✓</span>';
  if (["sending", "accepted"].includes(status))
    return `<span title="${status === "sending" ? "Sending" : "Submitted to WhatsApp"}" aria-label="${status === "sending" ? "Sending" : "Submitted to WhatsApp"}">◷</span>`;
  return `<span title="${status === "failed" ? "Delivery failed" : "Delivery status unavailable"}">${status === "failed" ? "! Failed" : "Status unavailable"}</span>`;
}
export function mergeMessages(current, incoming) {
  const map = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message.clientMessageId)
      for (const [id, old] of map)
        if (
          old.clientMessageId === message.clientMessageId &&
          id !== message.id
        )
          map.delete(id);
    map.set(message.id, { ...map.get(message.id), ...message });
  }
  return [...map.values()].sort(
    (a, b) =>
      String(a.timestamp || "").localeCompare(String(b.timestamp || "")) ||
      String(a.id).localeCompare(String(b.id)),
  );
}
const SAMPLE_CHANNEL_URL =
  "https://whatsapp.com/channel/0029Vb8Xo52KwqSQbqZeAR0s";
export const SAMPLE_LINKS = [
  ...[
    "Visual Aid",
    "Reminder Card",
    "Chit Pad",
    "Chemist Order Book",
    "Prescription Pad",
    "E-Visual App",
    "Diary",
    "Calendar",
  ].map((name) => ({
    name,
    url:
      name === "E-Visual App"
        ? `${SAMPLE_CHANNEL_URL}/108`
        : SAMPLE_CHANNEL_URL,
  })),
];
export function mediaType(file) {
  const mime = String(file.type || "")
    .split(";")[0]
    .toLowerCase();
  if (["image/jpeg", "image/png"].includes(mime)) return "image";
  if (["video/mp4", "video/3gpp"].includes(mime)) return "video";
  if (
    ["audio/mpeg", "audio/mp4", "audio/ogg", "audio/aac", "audio/amr"].includes(
      mime,
    )
  )
    return "audio";
  if (
    [
      "application/pdf",
      "text/plain",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(mime)
  )
    return "document";
  throw new Error("Use JPG/PNG, MP4, MP3/M4A/OGG, PDF, or an Office document.");
}
