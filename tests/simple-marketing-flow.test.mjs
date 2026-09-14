import test from 'node:test';
import assert from 'node:assert/strict';
import { approvePreview, previewActions, sendingAvailability } from '../src/simple-marketing-flow.mjs';

test('approving a draft preserves submission then approval and never starts it', async () => {
  const calls=[];
  const api=async(url)=>{calls.push(url);return {data:{campaignId:'batch',status:url.endsWith('/submit')?'PENDING_APPROVAL':url.endsWith('/approve')?'APPROVED':'DRAFT'}};};
  assert.equal((await approvePreview(api,'batch')).status,'APPROVED');
  assert.deepEqual(calls,['/campaigns/batch','/campaigns/batch/submit','/campaigns/batch/approve']);
});
test('retry after approval response loss reads the saved approval without more writes',async()=>{
  const calls=[];await approvePreview(async url=>(calls.push(url),{data:{status:'APPROVED'}}),'batch');
  assert.deepEqual(calls,['/campaigns/batch']);
});
test('failed submission never continues into approval or sending',async()=>{
  const calls=[];await assert.rejects(()=>approvePreview(async url=>{calls.push(url);if(url.endsWith('/submit'))throw Error('offline');return{data:{status:'DRAFT'}};},'batch'),/offline/);
  assert.equal(calls.length,2);
});
test('sales users request approval; only approved batches have Start',()=>{
  assert.deepEqual(previewActions('DRAFT','SALES')[0],['submit','Request approval']);
  assert.deepEqual(previewActions('DRAFT','OWNER')[0],['approve-preview','Approve']);
  assert.deepEqual(previewActions('APPROVED','OWNER')[0],['start','Start']);
  assert.equal(previewActions('PENDING_APPROVAL','SALES').some(([a])=>a==='approve-preview'||a==='start'),false);
});
test('server pause or unavailable status blocks starting while previews remain usable',async()=>{
  for(const data of [{enabled:true,dispatchConfigured:false,settings:{enabled:true}},{enabled:true,dispatchConfigured:true,settings:{enabled:false}}])assert.equal((await sendingAvailability(async()=>({data}))).allowed,false);
  assert.equal((await sendingAvailability(async()=>{throw Error('offline');})).allowed,false);
  assert.equal((await sendingAvailability(async()=>({data:{enabled:true,dispatchConfigured:true,settings:{enabled:true}}}))).allowed,true);
});

test('pause messages distinguish deployment configuration from organization activation', async () => {
  const deployment = await sendingAvailability(async () => ({data:{enabled:true,dispatchConfigured:false,settings:{enabled:false}}}));
  assert.match(deployment.message, /NODE_ENV=production/);
  const organization = await sendingAvailability(async () => ({data:{enabled:true,dispatchConfigured:true,settings:{enabled:false}}}));
  assert.match(organization.message, /Sending settings/);
  assert.doesNotMatch(organization.message, /NODE_ENV/);
});
