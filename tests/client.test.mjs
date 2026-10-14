import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const html=readFileSync('public/index.html','utf8');
const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('complete inline client parses',()=>{assert.doesNotThrow(()=>new Function(script));});
test('participant identity works on LAN HTTP without randomUUID',()=>{const start=script.indexOf('if(!participant){'),end=script.indexOf('const statuses=',start);const create=new Function('crypto','localStorage','let participant=null;'+script.slice(start,end)+'return participant;');let stored;const id=create({getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},{setItem(key,value){stored=value;}});assert.match(id,/^[a-f0-9]{32}$/);assert.equal(id,stored);});
test('timer uses server time plus monotonic elapsed time',()=>{const start=script.indexOf('function tick(){'),end=script.indexOf('function updateSend',start);const run=new Function('state','performance','$',script.slice(start,end)+'tick();');const label={textContent:''};run({status:'open',deadline:90000,now:60000,receivedAt:1000,duration:30},{now:()=>2500},()=>label);assert.equal(label.textContent,'29 сек.');});

test('late AI analysis is saved against original round without changing the new broadcast',async()=>{
 const start=script.indexOf('async function triggerAiAnalysis('),end=script.indexOf('function renderAnalysis',start);
 const run=new Function('context',`
 let state=context.initial,analyzing=false,lastAnalyzedRound=0;const secret='host',code='123456';
 const $=()=>({textContent:''}),buildAiPrompt=()=> 'prompt',getAiConfig=()=>({key:'key'}),toast=()=>{};
 const saveHistoryItem=item=>context.saved.push(item),renderAnalysis=()=>context.rendered++,control=()=>context.switched++;
 const api=async(path,data)=>{if(path.endsWith('/ai-analyze')){state=context.next;return {choices:[{message:{content:'{"summary":"старый результат"}'}}]};}context.requests.push(data);return {};};
 ${script.slice(start,end)}
 return triggerAiAnalysis(true);
 `);
 const context={initial:{round:1,question:'Первый',view:'results',words:[{word:'идея',count:1}]},next:{round:2,question:'Второй',view:'question'},requests:[],saved:[],rendered:0,switched:0};
 await run(context);assert.equal(context.requests[0].round,1);assert.equal(context.saved[0].question,'Первый');assert.equal(context.rendered,0);assert.equal(context.switched,0);
});

test('out-of-order snapshots with older revisions cannot revert broadcast state',()=>{
 const start=script.indexOf('function render(s){'),end=script.indexOf('const changed=',start);
 const render=new Function('state','s',script.slice(start,end)+'return false;}return render(s);');
 assert.equal(render({revision:3,now:100},{revision:2,now:200}),undefined);
 assert.equal(render({revision:3,now:100},{revision:3,now:90}),undefined);
 assert.equal(render({revision:3,now:100},{revision:4,now:90}),false);
});

test('reset clears only this room browser history and preserves legacy history until a reset',()=>{
 const start=script.indexOf('function syncHistoryToken('),end=script.indexOf('function getHistoryStore',start);
 const entries=new Map([['slovopotok-history-123456','old results'],['slovopotok-history-999999','other room']]);
 const localStorage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value),removeItem:key=>entries.delete(key)};
 const sync=new Function('localStorage','code',script.slice(start,end)+'return syncHistoryToken;')(localStorage,'123456');
 sync(null);assert.equal(entries.get('slovopotok-history-123456'),'old results');
 sync('new-meeting');assert.equal(entries.has('slovopotok-history-123456'),false);assert.equal(entries.get('slovopotok-history-999999'),'other room');
 entries.set('slovopotok-history-123456','new results');sync('new-meeting');assert.equal(entries.get('slovopotok-history-123456'),'new results');
});

test('waiting screen hides top-right present-join on presentation screen',()=>{
 const elements={
  '#broadcast-wait':{hidden:true},
  '#waiting-theme':{textContent:''},
  '#waiting-title':{textContent:''},
  '#waiting-text':{textContent:''},
  '#question':{textContent:'',hidden:false},
  '#status':{textContent:''},
  '#timer':{hidden:false},
  '.present-join':{hidden:false}
 };
 const querySelector=sel=>elements[sel]||null;
 const querySelectorAll=()=>[];
 const mockDocument={querySelectorAll:()=>[]};
 const start=script.indexOf('const waiting=s.view===\'waiting\';'),end=script.indexOf('if(cloud){',start);
 const fn=new Function('s','state','secret','queueState','$','document',script.slice(start,end));

 fn({view:'waiting',theme:'Тема',waitingTitle:'Скоро начнём',waitingText:'Ждём'},null,false,null,querySelector,mockDocument);
 assert.equal(elements['.present-join'].hidden,true);
 assert.equal(elements['#broadcast-wait'].hidden,false);

 fn({view:'question',theme:'Тема',waitingTitle:'Скоро начнём',waitingText:'Ждём'},null,false,null,querySelector,mockDocument);
 assert.equal(elements['.present-join'].hidden,false);
 assert.equal(elements['#broadcast-wait'].hidden,true);

 assert.ok(html.includes('.present .present-join[hidden],.present:has(#broadcast-wait:not([hidden])) .present-join{display:none!important}'));
});

test('waiting screen configuration is located in host settings panel and not in live controls',()=>{
 assert.equal(html.includes('id="waiting-settings"'),false);
 assert.ok(html.includes('id="waiting-screen-settings"'));
 assert.ok(html.includes('id="waiting-editor"'));
 assert.ok(html.includes('name="theme"'));
 assert.ok(html.includes('name="title"'));
 assert.ok(html.includes('name="text"'));
});

test('completion notice only appears for a live round ending; badge persists until waiting or another question',()=>{
 const start=script.indexOf('function updateCompletion('),end=script.indexOf('function toast(',start);
 const badge={hidden:true},notice={hidden:true};let expire;
 const update=new Function('$','setTimeout','clearTimeout',script.slice(start,end)+'return updateCompletion;')(selector=>selector==='#completion-badge'?badge:notice,fn=>{expire=fn;return 1;},()=>{});
 const open={round:1,status:'open',view:'question'},stopped={round:1,status:'stopped',view:'results'};
 update(null,stopped);assert.equal(notice.hidden,true);assert.equal(badge.hidden,false);
 for(const status of ['open','paused']){
  update({...open,status},stopped);assert.equal(notice.hidden,false);assert.equal(badge.hidden,false);
  expire();assert.equal(notice.hidden,true);
  update(stopped,{...stopped,revision:10});assert.equal(notice.hidden,true);assert.equal(badge.hidden,false);
 }
 update(open,stopped);update(stopped,{...stopped,view:'waiting'});assert.equal(notice.hidden,true);assert.equal(badge.hidden,true);
 update(open,stopped);update(stopped,{round:2,status:'ready',view:'question'});assert.equal(notice.hidden,true);assert.equal(badge.hidden,true);
 update(open,{round:2,status:'stopped',view:'results'});assert.equal(notice.hidden,true);assert.equal(badge.hidden,false);
});
