import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { inboxMatches, inboxCounts, inboxOwners, avatarStyle, uiIcon } from '../src/inbox-style.js';

const conversations = [
  { conversationId: 'a', status: 'OPEN', assignedTo: 'ankit', unreadCount: 3, lastMessagePreview: 'Artwork ready', contact: { companyName: 'North Studio', primaryPhone: '910000000001', tags: ['IMPORTANT', 'DESIGN'] } },
  { conversationId: 'b', status: 'CLOSED', unreadCount: 1, contact: { companyName: 'East Prints', assignedTo: 'reshu', tags: ['DESIGN'] } },
  { conversationId: 'c', status: 'OPEN', assignedTo: 'ankit', unreadCount: 0, contact: { companyName: 'West Packaging', tags: [] } },
  { conversationId: 'd', status: 'OPEN' }
];

test('status, owner, tag and search combine without changing records', () => {
  const before = structuredClone(conversations);
  const options = { search: ' ARTWORK ', filter: 'UNREAD', ownerFilter: 'ankit', tagFilter: 'DESIGN' };
  assert.deepEqual(conversations.filter(item => inboxMatches(item, options)).map(item => item.conversationId), ['a']);
  assert.equal(inboxMatches(conversations[0], { ownerFilter: 'reshu' }), false);
  assert.equal(inboxMatches(conversations[1], { ownerFilter: 'reshu' }), true);
  assert.equal(inboxMatches(conversations[1], { filter: 'OPEN' }), false);
  assert.equal(inboxMatches(conversations[3], { filter: 'IMPORTANT' }), false);
  assert.equal(inboxMatches(conversations[0], { search: '000000001' }), true);
  assert.deepEqual(conversations, before);
});

test('unread chat counts and unread message counts remain distinct', () => {
  const legacyCounts = (...args) => Object.fromEntries(Object.entries(inboxCounts(...args)).filter(([key]) => ['ALL','UNREAD','OPEN','IMPORTANT','messages'].includes(key)));
  assert.deepEqual(legacyCounts(conversations), { ALL: 4, UNREAD: 2, OPEN: 3, IMPORTANT: 1, messages: 4 });
  assert.deepEqual(legacyCounts(conversations, { ownerFilter: 'ankit', filter: 'UNREAD' }), { ALL: 2, UNREAD: 1, OPEN: 2, IMPORTANT: 1, messages: 3 });
  assert.deepEqual(legacyCounts(conversations, { tagFilter: 'missing' }), { ALL: 0, UNREAD: 0, OPEN: 0, IMPORTANT: 0, messages: 0 });
});

test('owner shortcuts use actual active users, deduplicated by ID', () => {
  assert.deepEqual(inboxOwners([
    { userId: 'a', name: 'Ankit' }, { userId: 'r', email: 'reshu@example.test' },
    { userId: 'a', name: 'Ankit' }, { userId: 'x', name: 'Inactive', active: false }, { name: 'No ID' }
  ]), [{ id: 'a', name: 'Ankit', initial: 'A' }, { id: 'r', name: 'reshu@example.test', initial: 'R' }]);
});

test('avatar colours stay deterministic and do not interpolate client text into CSS', () => {
  assert.equal(avatarStyle('North Studio'), avatarStyle('North Studio'));
  assert.match(avatarStyle('" onmouseover="alert(1)'), /^--avatar-bg:#[a-f0-9]{6};--avatar-ink:#[a-f0-9]{6}$/);
});

function createHarness({ mobile = false } = {}) {
  const app = fs.readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  const source = app.slice(app.indexOf('async function login(event)'));
  const calls = [];
  const context = vm.createContext({
    uiIcon, avatarStyle, inboxMatches, inboxCounts, inboxOwners, URL, URLSearchParams, Date, Intl, console, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: mobile }) },
    document: { querySelector: () => null, querySelectorAll: () => [] },
    requestAnimationFrame: () => {},
    page: { innerHTML: '' },
    state: { session: { role: 'OWNER' }, whatsapp: {} },
    api: async (path, options) => { calls.push({ path, options }); return { data: {} }; }
  });
  vm.runInContext(source + `
    state.whatsapp = freshWhatsappState();
    captureWhatsappViewport = () => null;
    bindWhatsappEvents = () => {};
    api = async (path, options) => { recordCall(path, options); return { data: {} }; };
  `, context);
  context.recordCall = (path, options) => calls.push({ path, options });
  return { context, calls, wa: context.state.whatsapp };
}

test('generated inbox escapes client/user/tag content and retains existing CRM controls', () => {
  const { context, wa, calls } = createHarness();
  wa.conversations = structuredClone(conversations);
  wa.conversations[0].contact.companyName = '<img src=x onerror=alert(1)>';
  wa.conversations[0].contact.tags.push('<script>bad</script>');
  wa.users = [{ userId: 'x" onclick="bad', name: '<Test>' }];
  wa.selectedId = 'a';
  wa.overview = { contact: wa.conversations[0].contact, orders: [] };
  vm.runInContext('renderWhatsappPage()', context);
  const html = context.page.innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));
  assert.ok(!html.includes('<script>bad'));
  assert.ok(html.includes('x&quot; onclick=&quot;bad'));
  for (const id of ['wa-search', 'wa-enable-alerts', 'wa-menu-button', 'wa-label-filter', 'wa-sync-templates', 'wa-template-order', 'wa-assignee', 'wa-customer-notes', 'wa-create-followup', 'wa-toggle-status', 'wa-toggle-important']) {
    assert.ok(html.includes(`id="${id}"`), `${id} remains available`);
  }
  assert.ok(html.includes('data-wa-mode="TEXT" disabled'));
  assert.equal(calls.length, 0);
});

test('quick filters separate unread chats, reply windows, due work and private archives', () => {
  const now = Date.now();
  const items = [
    {conversationId:'1', lastInboundAt:new Date(now-23.5*3600000), nextFollowUpAt:new Date(now-60000), preferences:{manualUnread:true}, lead:{leadStatus:'QUOTATION_SENT',interestLevel:'HIGH'}},
    {conversationId:'2', lastInboundAt:new Date(now-25*3600000), preferences:{archived:true}, unreadCount:2},
    {conversationId:'3', status:'OPEN',unreadCount:0}
  ];
  const counts=inboxCounts(items);
  assert.equal(counts.ALL,2);assert.equal(counts.UNREAD,1);assert.equal(counts.READ,1);
  assert.equal(counts.WINDOW,1);assert.equal(counts.CLOSING,1);assert.equal(counts.DUE,1);
  assert.equal(counts.HOT,1);assert.equal(counts.QUOTATION,1);assert.equal(counts.ARCHIVED,1);
  assert.equal(inboxMatches(items[2],{filter:'WINDOW'}),false);
});

test('complete inbox sync drains every cursor and carries the server cutoff', async () => {
  const {context}=createHarness();const requests=[];const cutoff='2026-09-08T10:00:00.000Z';
  context.pageRequest=async path=>{
    requests.push(path);
    const second=path.includes('cursor=next');
    return {data:Array.from({length:second?35:100},(_,i)=>({conversationId:`c${second?i+100:i}`})),pagination:{hasMore:!second,nextCursor:second?null:'next'},meta:{syncStartedAt:cutoff}};
  };
  vm.runInContext('api = pageRequest',context);
  const result=await vm.runInContext('inboxAllPages("/conversations?limit=100")',context);
  assert.equal(result.data.length,135);assert.equal(requests.length,2);assert.ok(requests[1].includes(encodeURIComponent(cutoff)));assert.equal(result.meta.syncStartedAt,cutoff);
});

test('failed or repeated pages reject the sync so a checkpoint cannot advance', async () => {
  const {context}=createHarness();context.brokenPage=async()=>({data:[],pagination:{hasMore:true,nextCursor:'same'}});
  vm.runInContext('api=brokenPage',context);
  await assert.rejects(vm.runInContext('inboxAllPages("/conversations?limit=100")',context),/invalid cursor/);
});

test('each conversation retains its draft, including a deliberately cleared draft', () => {
  const {context,wa}=createHarness();wa.conversations=structuredClone(conversations);wa.selectedId='a';wa.mode='TEXT';wa.conversations[0].lastInboundAt=new Date();wa.conversations[0].preferences={draft:'Server saved draft'};
  wa.overview={contact:wa.conversations[0].contact,orders:[]};wa.drafts.a='';
  vm.runInContext('renderWhatsappPage()',context);assert.ok(!context.page.innerHTML.includes('Server saved draft</textarea>'));
  wa.drafts.a='Draft for North';vm.runInContext('renderWhatsappPage()',context);assert.ok(context.page.innerHTML.includes('Draft for North'));
  wa.selectedId='c';wa.overview={contact:wa.conversations[2].contact,orders:[]};vm.runInContext('renderWhatsappPage()',context);assert.ok(!context.page.innerHTML.includes('Draft for North'));
});

test('reply composer trusts the server window instead of the local message arrival time', () => {
  const {context,wa}=createHarness();
  wa.conversations=[{conversationId:'a',lastInboundAt:new Date(Date.now()-25*3600000)}];wa.selectedId='a';
  wa.messages=[{direction:'INBOUND',createdAt:new Date()}];
  assert.equal(vm.runInContext('whatsappWindow().open',context),false);
});

test('retrying the same unsatisfied send preserves its idempotency key', () => {
  const {context}=createHarness();
  const first=vm.runInContext('smartSendKey("a",{type:"TEXT",text:"Hello"})',context);
  assert.equal(vm.runInContext('smartSendKey("a",{type:"TEXT",text:"Hello"})',context),first);
  assert.notEqual(vm.runInContext('smartSendKey("a",{type:"TEXT",text:"Changed"})',context),first);
});

test('reply composer preserves drafts, attachment input and labelled icon controls', () => {
  const { context, wa } = createHarness();
  wa.mode = 'TEXT';
  const markup = vm.runInContext('waComposer({ open: true }, "Draft <keep>")', context);
  assert.ok(markup.includes('Draft &lt;keep&gt;'));
  assert.ok(markup.includes('aria-label="Send message"'));
  assert.ok(markup.includes('id="wa-attachment-input"'));
  assert.ok(markup.includes('id="wa-record-audio"'));
  assert.ok(markup.includes('id="wa-share-location"'));
});

test('mobile conversation list never marks the hidden selected chat read', async () => {
  const { context, wa, calls } = createHarness({ mobile: true });
  wa.conversations = structuredClone(conversations);
  wa.selectedId = 'a';
  wa.messages = [{ messageId: 'm1', direction: 'INBOUND', status: 'DELIVERED' }];
  await vm.runInContext('markSelectedConversationRead()', context);
  assert.equal(calls.length, 0);
  assert.equal(wa.conversations[0].unreadCount, 3);
  wa.mobileChatOpen = true;
  await vm.runInContext('markSelectedConversationRead()', context);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/messages/m1/mark-read');
  assert.equal(wa.conversations[0].unreadCount, 0);
});

test('empty inbox produces a complete render with the existing start-chat link', () => {
  const { context } = createHarness();
  vm.runInContext('renderWhatsappPage()', context);
  assert.ok(context.page.innerHTML.includes('No WhatsApp conversation yet'));
  assert.ok(context.page.innerHTML.includes('href="#clients"'));
  assert.ok(context.page.innerHTML.includes('0 of 0 loaded chats'));
});
