import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createHandler} from '../scripts/local-app.mjs';
import {database} from '../scripts/db.mjs';
import worker from '../worker/index.js';
class Response extends EventEmitter {
  chunks=[]; destroyed=false;
  writeHead(status,headers){this.status=status;this.headers=headers;this.headersSent=true;}
  write(value){this.chunks.push(String(value));}
  end(value){if(value)this.write(value);}
}
function request(url,data){return {url,method:data?'POST':'GET',headers:{host:'localhost:3000'},async *[Symbol.asyncIterator](){if(data)yield Buffer.from(JSON.stringify(data));}};}
test('HTTPS proxy requests accept the public origin and reject other origins',async()=>{
  const DB=database(),handler=createHandler(DB,{publicOrigin:'https://quiz.ost.wang'});
  async function call(path,data,origin,extra={}){
    const req=request(path,data);req.headers={host:'quiz.ost.wang',origin,...extra};
    const res=new Response();await handler(req,res);
    return {status:res.status,data:JSON.parse(res.chunks.join(''))};
  }
  try{
    const created=await call('/api/rooms',{question:'За HTTPS-прокси'},'https://quiz.ost.wang');
    assert.equal(created.status,201);
    const {code,secret}=created.data;
    assert.equal((await call('/api/rooms/'+code+'/control',{action:'next'},'https://quiz.ost.wang',{authorization:'Bearer '+secret})).status,200);
    assert.equal((await call('/api/rooms/'+code+'/control',{action:'start'},'https://quiz.ost.wang',{authorization:'Bearer '+secret})).status,200);
    assert.equal((await call('/api/rooms/'+code+'/answer',{round:1,participant:randomUUID(),word:'Работает'},'https://quiz.ost.wang')).status,200);
    for(const origin of ['https://evil.example','http://quiz.ost.wang']){
      assert.equal((await call('/api/rooms',{question:'Отклонить'},origin,{'x-forwarded-proto':'https','x-forwarded-host':'evil.example'})).status,403);
    }
    assert.equal((await call('https://evil.example/api/rooms',{question:'Отклонить'},'https://evil.example')).status,403);
  }finally{DB.close();}
});
test('LAN HTTP requests use the request host when no public origin is configured',async()=>{
  const DB=database(),handler=createHandler(DB);
  try{
    const req=request('/api/rooms',{question:'Локальная сеть'});
    req.headers={host:'192.168.1.10:3000',origin:'http://192.168.1.10:3000'};
    const res=new Response();await handler(req,res);assert.equal(res.status,201);
  }finally{DB.close();}
});
test('local server pushes accepted answers to presenter immediately',async()=>{
  const DB=database(),handler=createHandler(DB);let events;
  try{
    const created=await worker.fetch(new Request('http://localhost:3000/api/rooms',{method:'POST',body:JSON.stringify({question:'Живой эфир'})}),{DB});
    const {code,secret}=await created.json();
    await worker.fetch(new Request('http://localhost:3000/api/rooms/'+code+'/control',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({action:'next'})}),{DB});
    await worker.fetch(new Request('http://localhost:3000/api/rooms/'+code+'/control',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({action:'start'})}),{DB});
    events=new Response();await handler(request('/api/rooms/'+code+'/events'),events);
    assert.equal(events.headers['content-type'],'text/event-stream');assert.equal(events.chunks.length,1);
    const response=new Response();await handler(request('/api/rooms/'+code+'/answer',{round:1,participant:randomUUID(),word:'Мгновенно'}),response);
    assert.equal(response.status,200);assert.equal(events.chunks.length,2);
    const pushed=JSON.parse(events.chunks[1].slice(6).trim());assert.equal(pushed.words[0].word,'мгновенно');assert.equal(pushed.answers,1);
  }finally{events?.emit('close');DB.close();}
});

test('SSE broadcasts waiting, reveal, tab, pause and reset without leaking future questions',async()=>{
 const DB=database(),handler=createHandler(DB);const streams=[];
 async function call(path,data,secret){const req=request(path,data);if(secret)req.headers.authorization='Bearer '+secret;const res=new Response();await handler(req,res);return {status:res.status,data:JSON.parse(res.chunks.join(''))};}
 try{
  const {data:{code,secret}}=await call('/api/rooms',{question:'Первый вопрос'});const path='/api/rooms/'+code;
  for(let i=0;i<2;i++){const res=new Response();await handler(request(path+'/events'),res);streams.push(res);assert.equal(JSON.parse(res.chunks[0].slice(6)).question,'');}
  await call(path+'/control',{action:'add',question:'Секрет следующего вопроса'},secret);
  await call(path+'/control',{action:'next'},secret);
  await call(path+'/control',{action:'start'},secret);
  await call(path+'/control',{action:'tab',tab:'themes'},secret);
  for(const res of streams){let s=JSON.parse(res.chunks.at(-1).slice(6));assert.equal(s.tab,'themes');assert.equal(s.status,'open');assert.equal(res.chunks.join('').includes('Секрет следующего'),false);}
  await call(path+'/control',{action:'waiting'},secret);
  for(const res of streams){const s=JSON.parse(res.chunks.at(-1).slice(6));assert.equal(s.view,'waiting');assert.equal(s.status,'paused');assert.equal(s.question,'');}
  const reconnect=new Response();await handler(request(path+'/events'),reconnect);streams.push(reconnect);assert.equal(JSON.parse(reconnect.chunks[0].slice(6)).view,'waiting');
  const before=JSON.parse(reconnect.chunks[0].slice(6));await call(path+'/control',{action:'reset-room',confirm:true,revision:before.revision},secret);
  for(const res of streams){const state=JSON.parse(res.chunks.at(-1).slice(6));assert.equal(state.view,'waiting');assert.equal(state.status,'ready');assert.ok(state.round>before.round);assert.ok(state.resetToken);}
 }finally{streams.forEach(s=>s.emit('close'));DB.close();}
});
