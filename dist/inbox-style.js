// Presentation helpers only. All data continues to come from the client CRM.
const paths = {
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H5l-3 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h10M7 13h7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  people: '<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/>',
  campaign: '<path d="m3 10 14-6v16L3 14Zm14-2h3v8h-3M5 15l2 6h3l-2-5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  logout: '<path d="M9 3H3v18h6M9 12h12m-4-4 4 4-4 4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  plus: '<path d="M12 4v16M4 12h16"/>',
  phone: '<path d="m5 3 4 4-2 3c1.4 3.2 3.8 5.6 7 7l3-2 4 4-2 2C10 22 2 14 3 5Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7A9 9 0 0 0 4 6M4 17a9 9 0 0 0 16 1M20 2v5h-5M4 22v-5h5"/>',
  back: '<path d="m12 5-7 7 7 7M5 12h15"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  send: '<path d="m3 3 19 9-19 9 4-9Zm4 9h15"/>',
  clip: '<path d="m8 12 7-7a4 4 0 0 1 6 6L10 22a6 6 0 0 1-8-8L13 3m-7 13 9-9a1.5 1.5 0 0 1 2 2l-9 9a1.5 1.5 0 0 1-2-2Z"/>',
  mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  bolt: '<path d="m13 2-9 12h7l-1 8 10-13h-7Z"/>',
  note: '<path d="M13 3H4v18h16V10M9 15l1-5 9-9 4 4-9 9Z"/>'
};

export function uiIcon(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.chat}</svg>`;
}

export function avatarStyle(name = "") {
  const palette = [["#dce9e5", "#39685b"], ["#dce8f5", "#39617c"], ["#efe2f4", "#795686"], ["#fae7d4", "#886239"], ["#d8eeee", "#2a7174"]];
  let hash = 0;
  for (const char of String(name)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const [background, ink] = palette[hash % palette.length];
  return `--avatar-bg:${background};--avatar-ink:${ink}`;
}

export function inboxMatches(item, { search = "", filter = "ALL", ownerFilter = "", tagFilter = "" } = {}) {
  const contact = item.contact || {};
  const needle = search.trim().toLowerCase();
  const haystack = [contact.companyName, contact.contactPerson, contact.primaryPhone, contact.city, item.lastMessagePreview, item.lead?.leadStatus, ...(item.lead?.productRequired || [])].join(" ").toLowerCase();
  if (needle && !haystack.includes(needle)) return false;
  if (ownerFilter && (item.assignedTo || contact.assignedTo || "") !== ownerFilter) return false;
  if (tagFilter && !(contact.tags || []).includes(tagFilter)) return false;
  if (filter === "ARCHIVED") return Boolean(item.preferences?.archived);
  if (item.preferences?.archived) return false;
  if (filter === "UNREAD") return Number(item.unreadCount || 0) > 0 || item.preferences?.manualUnread === true;
  if (filter === "READ") return !(Number(item.unreadCount || 0) > 0 || item.preferences?.manualUnread);
  const remaining = inboxTime(item.lastInboundAt) + 86400000 - Date.now();
  if (filter === "WINDOW") return remaining > 0;
  if (filter === "CLOSING") return remaining > 0 && remaining <= 3600000;
  if (filter === "HOT") return ['HIGH','VERY_HIGH'].includes(item.lead?.interestLevel) || item.lead?.priority === 'HIGH' || (contact.tags || []).includes('HOT');
  if (filter === "QUOTATION") return item.lead?.leadStatus === 'QUOTATION_SENT';
  if (filter === "FOLLOWUP") return Boolean(item.nextFollowUpAt || item.lead?.nextFollowupDate || item.lead?.leadStatus?.startsWith('FOLLOW_UP'));
  if (filter === "DUE") {
    const due = inboxTime(item.nextFollowUpAt || item.lead?.nextFollowupDate);
    const end = new Date(); end.setHours(23,59,59,999);
    return due > 0 && due <= end.getTime();
  }
  if (filter === "OPEN") return item.status !== "CLOSED";
  if (filter === "IMPORTANT") return (contact.tags || []).includes("IMPORTANT");
  return true;
}

export function inboxCounts(conversations, options = {}) {
  // Counts reflect the selected search, owner and tag, before the status filter.
  const scoped = conversations.filter(item => inboxMatches(item, { ...options, filter: "ALL" }));
  return {
    ALL: scoped.length,
    UNREAD: scoped.filter(item => Number(item.unreadCount || 0) > 0 || item.preferences?.manualUnread).length,
    OPEN: scoped.filter(item => item.status !== "CLOSED").length,
    IMPORTANT: scoped.filter(item => (item.contact?.tags || []).includes("IMPORTANT")).length,
    messages: scoped.reduce((total, item) => total + Math.max(0, Number(item.unreadCount) || 0), 0),
    ...Object.fromEntries(['READ','WINDOW','CLOSING','HOT','QUOTATION','FOLLOWUP','DUE','ARCHIVED'].map(filter => [filter, conversations.filter(item => inboxMatches(item, {...options,filter})).length]))
  };
}

function inboxTime(value) {
  if (value?._seconds) return value._seconds * 1000;
  return new Date(value || 0).getTime() || 0;
}

export function inboxOwners(users) {
  const unique = new Map();
  for (const user of users) {
    if (!user.userId || user.active === false) continue;
    const name = user.name || user.email || user.userId;
    unique.set(user.userId, { id: user.userId, name, initial: Array.from(name)[0]?.toUpperCase() || "?" });
  }
  return [...unique.values()];
}
