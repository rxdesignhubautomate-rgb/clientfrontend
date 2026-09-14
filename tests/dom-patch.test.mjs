import test from 'node:test';
import assert from 'node:assert/strict';
import {bindLiveEvent} from '../src/dom-patch.mjs';

test('repeated live binding fires one action per click',()=>{
  const target=new EventTarget();let clicks=0;
  for(let i=0;i<20;i++) bindLiveEvent(target,'send','click',()=>clicks++);
  target.dispatchEvent(new Event('click'));
  assert.equal(clicks,1);
});

test('input and keyboard handlers from the same binding helper remain independent',()=>{
  const target=new EventTarget();let inputs=0,keys=0;
  for(let i=0;i<5;i++){
    bindLiveEvent(target,'composer','input',()=>inputs++);
    bindLiveEvent(target,'composer','keydown',()=>keys++);
  }
  target.dispatchEvent(new Event('input'));target.dispatchEvent(new Event('keydown'));
  assert.equal(inputs,1);assert.equal(keys,1);
});

test('distinct actions sharing the same event keep both listeners',()=>{
  const target=new EventTarget();let save=0,preview=0;
  bindLiveEvent(target,'draft','input',()=>save++);
  bindLiveEvent(target,'preview','input',()=>preview++);
  target.dispatchEvent(new Event('input'));
  assert.equal(save,1);assert.equal(preview,1);
});
