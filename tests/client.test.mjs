import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const html=readFileSync('public/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('complete inline client parses',()=>{assert.doesNotThrow(()=>new Function(script));});
test('participant identity works on LAN HTTP without randomUUID',()=>{const start=script.indexOf('if(!participant){'),end=script.indexOf('const statuses=',start);const create=new Function('crypto','localStorage','let participant=null;'+script.slice(start,end)+'return participant;');let stored;const id=create({getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},{setItem(key,value){stored=value;}});assert.match(id,/^[a-f0-9]{32}$/);assert.equal(id,stored);});
test('timer uses server time plus monotonic elapsed time',()=>{const start=script.indexOf('function tick(){'),end=script.indexOf('function updateSend',start);const run=new Function('state','performance','$',script.slice(start,end)+'tick();');const label={textContent:''};run({status:'open',deadline:90000,now:60000,receivedAt:1000,duration:30},{now:()=>2500},()=>label);assert.equal(label.textContent,'29 сек.');});
