import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {bindLiveEvent} from '../src/dom-patch.mjs';
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
    bindLiveEvent, patchMarkup: (node,markup) => {node.innerHTML=markup;}, uiIcon, avatarStyle, inboxMatches, inboxCounts, inboxOwners, URL, URLSearchParams, Date, Intl, console, setTimeout, clearTimeout,
    window: { matchMedia: () => ({ matches: mobile }) },
    config:{apiBaseUrl:'https://example.test/api'},pageTitle:{textContent:''},location:{hash:'#whatsapp'},WHATSAPP_SYNC_OVERLAP_MS:2000,
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

test('background patches preserve editors even after focus leaves the composer', () => {
  const {context,wa}=createHarness();
  wa.selectedId='a';wa.conversations=structuredClone(conversations);
  const editor={value:'Hello client',selectionStart:3,selectionEnd:7};
  const panel={dataset:{chatConversationId:'a'}};
  context.document.activeElement=editor;
  context.document.querySelector=selector=>selector==='[data-chat-conversation-id]'?panel:selector==='#wa-message-input'?editor:null;
  context.document.createElement=()=>({content:{querySelector:()=>({})}});
  vm.runInContext(`fullPaints=0; patches=0; patchNode=()=>patches++;
    renderWhatsappPage=()=>fullPaints++; bindReferenceWhatsapp=()=>{};
    restoreWhatsappViewport=()=>{}; installWhatsappMediaScrollStability=()=>{};
    for(let i=0;i<5;i++) renderWhatsappBackground();`,context);
  assert.equal(context.fullPaints,0);assert.equal(context.patches,5);
  assert.equal(context.document.activeElement,editor);assert.equal(editor.value,'Hello client');
  assert.equal(editor.selectionStart,3);assert.equal(editor.selectionEnd,7);
  context.document.activeElement=null;
  vm.runInContext('renderWhatsappBackground()',context);
  assert.equal(context.fullPaints,0,'no deferred whole-page repaint after blur');
});

test('background refresh renders a changed conversation and ignores another route', () => {
  const {context,wa}=createHarness();
  wa.selectedId='b';
  context.document.activeElement={matches:()=>true};
  context.document.querySelector=()=>({dataset:{chatConversationId:'a'}});
  vm.runInContext('fullPaints=0; renderWhatsappPage=()=>fullPaints++; renderWhatsappBackground();',context);
  assert.equal(context.fullPaints,1);
  context.location.hash='#marketing';
  vm.runInContext('renderWhatsappBackground()',context);
  assert.equal(context.fullPaints,1);
});

test('message-only refresh patches history without replacing or binding the composer', () => {
  const {context,wa}=createHarness();
  wa.messages=[{messageId:'m',text:'New reply'}];wa.selectedId='a';
  const history={innerHTML:''};
  const editor={value:'Unfinished draft',selectionStart:4,selectionEnd:4};
  context.document.activeElement=editor;
  context.document.querySelector=selector=>selector==='#wa-message-list'?history:null;
  vm.runInContext(`messageBinds=0; whatsappMessagesMarkup=()=>state.whatsapp.messages.map(m=>m.text).join('');
    bindWhatsappMessageEvents=()=>messageBinds++; restoreWhatsappViewport=()=>{};
    installWhatsappMediaScrollStability=()=>{}; refreshWhatsappMessagesDom();`,context);
  assert.equal(history.innerHTML,'New reply');
  assert.equal(context.messageBinds,1);
  assert.equal(context.document.activeElement,editor);
  assert.equal(editor.value,'Unfinished draft');
  assert.equal(editor.selectionStart,4);
  assert.equal(context.page.innerHTML,'');
});

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

test('marketing replies filter uses reply records and combines with owner filters', () => {
  const items = [
    {conversationId:'reply',lastMarketingReplyAt:new Date(),assignedTo:'ankit',unreadCount:0},
    {conversationId:'unread',assignedTo:'ankit',unreadCount:3},
    {conversationId:'other',lastMarketingReplyAt:new Date(),assignedTo:'reshu',unreadCount:1}
  ];
  assert.deepEqual(items.filter(item=>inboxMatches(item,{filter:'MARKETING',ownerFilter:'ankit'})).map(item=>item.conversationId),['reply']);
  assert.equal(inboxCounts(items).MARKETING,2);
});

test('selecting attachments opens a review without uploading or sending', async () => {
  const {context,calls}=createHarness();
  const files=[{name:'sample.pdf',type:'application/pdf'},{name:'photo.jpg',type:'image/jpeg'}];
  context.files=files;
  vm.runInContext('previewReferenceAttachments = files => { previewedFiles = files; };',context);
  await vm.runInContext('sendSelectedAttachment({target:{files,value:"chosen"}})',context);
  assert.deepEqual(Array.from(context.previewedFiles),files);
  assert.equal(calls.length,0);
});

test('bundled voice worker encodes microphone samples into an MP3 attachment', async () => {
  let result;
  const context=vm.createContext({Blob,Int16Array,Uint8Array,console,self:{postMessage:value=>{result=value;}}});
  context.importScripts=name=>vm.runInContext(fs.readFileSync(new URL('../src/'+name,import.meta.url),'utf8'),context);
  vm.runInContext(fs.readFileSync(new URL('../src/audio-encoder.js',import.meta.url),'utf8'),context);
  const samples=Float32Array.from({length:44100},(_,i)=>Math.sin(2*Math.PI*440*i/44100)*0.2);
  context.self.onmessage({data:{samples,sampleRate:44100}});
  assert.equal(result.error,undefined);
  assert.equal(result.blob.type,'audio/mpeg');
  const bytes=new Uint8Array(await result.blob.arrayBuffer());
  assert.ok(bytes.length>1000);
  assert.equal(bytes[0],0xff);
  assert.equal(bytes[1]&0xe0,0xe0);
});

test('large inbox renders 100 rows while search still finds clients beyond that page',()=>{
  const {context,wa}=createHarness();
  wa.conversations=Array.from({length:2000},(_,i)=>({conversationId:String(i),contact:{companyName:'Client '+i}}));
  let html=vm.runInContext('waConversationList()',context);
  assert.equal((html.match(/data-conversation-id=/g)||[]).length,100);
  assert.ok(html.includes('1,900 remaining'));
  wa.search='Client 1999';html=vm.runInContext('waConversationList()',context);
  assert.ok(html.includes('data-conversation-id="1999"'));
});

test('cached chat paints before network and never reloads the inbox on chat switch',async()=>{
  const {context,wa,calls}=createHarness();
  wa.conversations=[{conversationId:'b',contactId:'cb',lastInboundAt:new Date(),contact:{contactId:'cb',companyName:'Client B'}}];
  wa.cacheHydrated=true;wa.fullSyncedAt=Date.now();wa.metadataAt=Date.now();wa.cache={putMessages:()=>new Promise(()=>{})};
  wa.recentChats.set('b',{messages:[{messageId:'old',conversationId:'b',text:'Cached reply',createdAt:new Date()}],overview:{contact:wa.conversations[0].contact,orders:[]},overviewCachedAt:Date.now()});
  let release;
  context.network=()=>new Promise(resolve=>{release=resolve;});context.paints=[];
  vm.runInContext(`renderWhatsappPage=()=>paints.push(state.whatsapp.messages.map(m=>m.text));startWhatsappPolling=()=>{};api=async path=>{recordCall(path);return network();};`,context);
  const loading=vm.runInContext("renderWhatsapp('b')",context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(Array.from(context.paints[0]),['Cached reply']);
  assert.equal(calls.length,1);assert.ok(calls[0].path.startsWith('/conversations/b/messages?'));
  release({data:[{messageId:'new',conversationId:'b',text:'Fresh reply',createdAt:new Date()}]});
  await loading;
  assert.ok(context.paints.at(-1).includes('Fresh reply'));
});

test('late message response cannot overwrite a newer chat selection',async()=>{
  const {context,wa}=createHarness();
  wa.conversations=[{conversationId:'a',contactId:'ca'},{conversationId:'b',contactId:'cb'}];
  wa.selectedId='a';wa.messagesConversationId='a';wa.overview={contact:{contactId:'ca'},orders:[]};wa.overviewCachedAt=Date.now();
  let release;context.network=()=>new Promise(resolve=>{release=resolve;});
  vm.runInContext('api=()=>network()',context);
  const request=vm.runInContext("loadWhatsappConversation('a')",context);
  wa.selectedId='b';wa.navigationVersion++;wa.messages=[{messageId:'b-message',text:'B stays visible'}];
  release({data:[{messageId:'a-message',text:'Late A'}]});await request;
  assert.equal(wa.messages[0].messageId,'b-message');
});

test('media previews reuse one fetch, expire and reset with the user session',async()=>{
  const {context,wa}=createHarness();let downloads=0;
  context.download=async()=>{downloads++;return {size:100};};
  vm.runInContext('fetchAttachmentBlobUncached=()=>download()',context);
  await Promise.all([vm.runInContext("fetchAttachmentBlob('file')",context),vm.runInContext("fetchAttachmentBlob('file')",context)]);
  await vm.runInContext("fetchAttachmentBlob('file')",context);assert.equal(downloads,1);
  wa.mediaCache.get('file').expiresAt=0;await vm.runInContext("fetchAttachmentBlob('file')",context);assert.equal(downloads,2);
  vm.runInContext('state.whatsapp=freshWhatsappState()',context);
  await vm.runInContext("fetchAttachmentBlob('file')",context);assert.equal(downloads,3);
});

test('a first inbox page becomes available while later pages are still pending',async()=>{
  const {context}=createHarness();let release;let reads=0;
  context.requestPage=()=>++reads===1?Promise.resolve({data:[{id:'first'}],pagination:{hasMore:true,nextCursor:'next'}}):new Promise(resolve=>{release=resolve;});
  context.pages=[];vm.runInContext('api=()=>requestPage()',context);
  const request=vm.runInContext("inboxAllPages('/conversations?limit=100',page=>pages.push(page.data[0].id))",context);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(Array.from(context.pages),['first']);
  release({data:[{id:'last'}],pagination:{hasMore:false}});
  const result=await request;assert.equal(result.data.length,2);
});

test('metadata revalidates on a cached inbox and concurrent refreshes share one request',async()=>{
  const {context,wa,calls}=createHarness();wa.fullSyncedAt=Date.now();
  vm.runInContext('renderWhatsappPage=()=>{};api=async path=>{recordCall(path);return {data:[]};}',context);
  await Promise.all([vm.runInContext('ensureWhatsappMetadata()',context),vm.runInContext('ensureWhatsappMetadata()',context)]);
  assert.equal(calls.length,4);assert.ok(wa.metadataAt>0);
  await vm.runInContext('ensureWhatsappMetadata()',context);assert.equal(calls.length,4);
});

test('all filter badges agree with their matching lists including archived conversations',()=>{
  const items=Array.from({length:80},(_,i)=>({conversationId:String(i),lastInboundAt:new Date(Date.now()-i*3600000),unreadCount:i%4,preferences:{archived:i%7===0,manualUnread:i%9===0},assignedTo:i%2?'a':'b',nextFollowUpAt:i%3?new Date():null,contact:{companyName:'Client '+i,tags:i%2?['IMPORTANT']:[]},lead:{interestLevel:i%2?'HIGH':'LOW',leadStatus:i%3?'FOLLOW_UP':'QUOTATION_SENT'}}));
  for(const options of [{},{ownerFilter:'a'},{search:'Client 1'},{tagFilter:'IMPORTANT'}]){
    for(const [filter,count] of Object.entries(inboxCounts(items,options))){
      if(filter!=='messages')assert.equal(count,items.filter(item=>inboxMatches(item,{...options,filter})).length,filter);
    }
  }
});

test('marketing pagination still drains all saved batches independently of inbox progress',async()=>{
  const {context}=createHarness();let page=0;
  context.batchPage=()=>({data:[{campaignId:'batch'+(++page)}],pagination:{hasMore:page<2,nextCursor:page<2?'next':null}});
  vm.runInContext('api=async()=>batchPage()',context);
  const result=await vm.runInContext("loadAllBatchPages('/campaigns?limit=100')",context);
  assert.equal(result.error,null);assert.equal(result.data.length,2);
});

test('batch progress handles drafts, partial last batches and overlapping provider failures', () => {
  const {context}=createHarness();
  const get=(campaign,count)=>{context.campaign=campaign;context.count=count;return vm.runInContext('batchProgress(campaign,count)',context);};
  assert.equal(get({status:'DRAFT',stats:{total:0}},500).percent,0);
  let progress=get({status:'ACTIVE',stats:{total:500,active:477,waiting:0,sent:23,failed:4}},500);
  assert.equal(progress.processed,23);assert.equal(progress.percent,5);assert.equal(progress.failed,4);
  progress=get({status:'ACTIVE',stats:{total:500,active:1,sent:499}},500);assert.equal(progress.percent,99);
  progress=get({status:'COMPLETED',stats:{total:404,active:0,waiting:0,sent:400,skipped:4,failed:20}},404);
  assert.equal(progress.processed,404);assert.equal(progress.percent,100);assert.equal(progress.total,404);
  progress=get({status:'ACTIVE',stats:{total:500,active:0,waiting:500}},500);assert.equal(progress.percent,0);assert.equal(progress.label,'Waiting for replies…');
  progress=get({status:'CANCELLED',stats:{total:0}},500);assert.equal(progress.percent,0);assert.equal(progress.label,'Cancelled');
});

test('batch polling updates progress using reads and ignores an obsolete page response', async () => {
  const {context,calls}=createHarness();context.location.hash='#marketing';
  context.state.marketing={audiences:[],campaigns:[]};
  let callback,release;context.setTimeout=fn=>{callback=fn;return 1;};context.clearTimeout=()=>{};
  context.network=()=>new Promise(resolve=>{release=resolve;});
  vm.runInContext('api=async path=>{recordCall(path);return network();};startMarketingProgress();',context);
  const polling=callback();
  vm.runInContext('stopMarketingProgress()',context);context.location.hash='#whatsapp';
  release({data:[{campaignId:'new'}],pagination:{hasMore:false}});await polling;
  assert.equal(context.state.marketing.campaigns.length,0);
  assert.equal(calls.length,1);assert.equal(calls[0].path,'/campaigns?limit=100');assert.equal(calls[0].options,undefined);
});

test('chat messages render without waiting for a slow or failed customer overview', async () => {
  const {context,wa}=createHarness();
  wa.selectedId='a';wa.conversations=[{conversationId:'a',contactId:'ca'}];
  let rejectOverview;
  context.network=path=>path.includes('/overview')?new Promise((_resolve,reject)=>{rejectOverview=reject;}):Promise.resolve({data:[{messageId:'new',text:'Fast reply',createdAt:'2026-09-14T00:00:00Z'}]});
  vm.runInContext('api=path=>network(path);renderWhatsappBackground=()=>{};',context);
  const loaded=await vm.runInContext("loadWhatsappConversation('a')",context);
  assert.equal(loaded[0].messageId,'new');assert.equal(wa.messages[0].text,'Fast reply');assert.equal(wa.overview,null);
  rejectOverview(new Error('slow optional overview failed'));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(wa.messages[0].text,'Fast reply');
});

test('overlapping message loads share one request and unchanged overlap does not repaint', async () => {
  const {context,wa}=createHarness();wa.selectedId='a';wa.messagesConversationId='a';
  wa.conversations=[{conversationId:'a',contactId:'ca'}];wa.overview={contact:{contactId:'ca'},orders:[]};wa.overviewCachedAt=Date.now();
  wa.messages=[{messageId:'existing',text:'Same',createdAt:'2026-09-14T00:00:00Z'}];
  let release,reads=0;context.network=()=>{reads++;return new Promise(resolve=>{release=resolve;});};
  vm.runInContext('api=()=>network()',context);
  const first=vm.runInContext("loadWhatsappConversation('a',{incremental:true})",context);
  const second=vm.runInContext("loadWhatsappConversation('a',{incremental:true})",context);
  assert.equal(reads,1);release({data:[{...wa.messages[0]}]});
  const results=await Promise.all([first,second]);assert.equal(results[0].length,0);assert.equal(results[1].length,0);
});

test('concurrent mark-read refreshes share one request and cannot clear another chat', async () => {
  const {context,wa}=createHarness();wa.selectedId='a';
  wa.conversations=[{conversationId:'a',unreadCount:1},{conversationId:'b',unreadCount:2}];
  wa.messages=[{messageId:'a1',direction:'INBOUND',status:'RECEIVED'}];
  let release,reads=0;context.network=()=>{reads++;return new Promise(resolve=>{release=resolve;});};
  vm.runInContext('api=()=>network()',context);
  const first=vm.runInContext('markSelectedConversationRead()',context);
  await vm.runInContext('markSelectedConversationRead()',context);assert.equal(reads,1);
  wa.selectedId='b';wa.messages=[{messageId:'b1',direction:'INBOUND',status:'RECEIVED'}];
  release({data:{conversationUnreadCount:0}});await first;
  assert.equal(wa.messages[0].status,'RECEIVED');assert.equal(wa.conversations[1].unreadCount,2);
});

test('send acknowledgement appears before draft persistence and preserves text typed during send', async () => {
  const {context,wa}=createHarness();wa.selectedId='a';wa.mode='TEXT';wa.drafts.a='First reply';
  wa.conversations=[{conversationId:'a',contactId:'ca'}];wa.messages=[];
  const input={value:'First reply',matches:()=>true};
  const button={disabled:false,classList:{contains:()=>false}};
  context.document.querySelector=selector=>selector==='#wa-message-input'?input:null;
  context.document.body={contains:()=>true};
  context.input=input;context.button=button;
  let release;context.network=()=>new Promise(resolve=>{release=resolve;});
  vm.runInContext("api=()=>network();whatsappWindow=()=>({open:true});notify=()=>{};renderWhatsappBackground=()=>{};refreshWhatsappMessage=async()=>null;saveSmartPreference=()=>new Promise(()=>{});",context);
  const sending=vm.runInContext('sendWhatsappMessage({preventDefault(){},submitter:button})',context);
  input.value='My next reply';wa.drafts.a='My next reply';
  release({data:{queued:true,messageId:'queued-real-id'}});await sending;
  assert.equal(input.value,'My next reply');assert.equal(wa.drafts.a,'My next reply');
  assert.equal(wa.messages[0].messageId,'queued-real-id');assert.equal(wa.messages[0].status,'QUEUED');assert.equal(wa.messages[0].text,'First reply');
  assert.equal(button.disabled,false);
});
