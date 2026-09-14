import test from 'node:test';
import assert from 'node:assert/strict';
import {createQuotationSession,quotationPayload} from '../src/quotation-client.mjs';
const quote = {quotationId:'RX260914-120000',companyName:'Demo',phone:'910000000000',city:'Delhi',preparedBy:'Admin',items:[{product:'Visual Aid',variety:'Gloss 5 pages',quantity:10,rate:400}]};
function setup() {
  let saved,uploads=0,sends=0,creates=0;
  const api = async (path,{method='GET',body}={}) => {
    if(path.endsWith('/send')) {sends++;return {data:{message:{status:'QUEUED'}}};}
    if(path.endsWith('/pdf')) {saved={...saved,pdfAttachmentId:body.attachmentId,pdfRevision:body.expectedRevision};}
    else if(method==='POST') {creates++;saved ||= {...body,quotationId:'QUO_TEST',revision:1,status:'DRAFT'};}
    else if(method==='PATCH') saved={...saved,...body,revision:saved.revision+1,pdfAttachmentId:null};
    return {data:structuredClone(saved)};
  };
  const session=createQuotationSession({api,upload:async () => {uploads++;return {attachmentId:'ATT_1'};},contactId:'CLIENT_A',conversationId:'CHAT_A',checkSession:()=>{}});
  return {session,stats:()=>({uploads,sends,creates}),get:()=>saved};
}
test('quote payload pins recipient to CRM client and conversation',()=>{
  const payload=quotationPayload({...quote,phone:'OTHER'},'CLIENT_A','CHAT_A');
  assert.equal(payload.contactId,'CLIENT_A');assert.equal(payload.conversationId,'CHAT_A');
  assert.equal(payload.items[0].unitPrice,400);
});
test('save draft persists PDF once and never sends; explicit send is separate',async()=>{
  const t=setup();const blob=new Blob(['%PDF-demo'],{type:'application/pdf'});
  const saved=await t.session.save(quote,blob);
  await t.session.save(quote,blob);
  assert.deepEqual(t.stats(),{uploads:1,sends:0,creates:1});
  await t.session.send(saved);assert.equal(t.stats().sends,1);
});
test('editing saved data creates a new PDF revision',async()=>{
  const t=setup();const blob=new Blob(['%PDF-demo']);
  await t.session.save(quote,blob);
  await t.session.save({...quote,items:[{...quote.items[0],quantity:20}]},blob);
  assert.equal(t.get().revision,2);assert.equal(t.get().pdfRevision,2);assert.equal(t.stats().uploads,2);
});
test('expired or changed session prevents any save request',async()=>{
  let called=false;const session=createQuotationSession({api:async()=>{called=true;},checkSession:()=>{throw new Error('Session changed');}});
  await assert.rejects(session.save(quote,new Blob()),/Session changed/);assert.equal(called,false);
});
