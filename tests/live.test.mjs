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
test('local server pushes accepted answers to presenter immediately',async()=>{
  const DB=database(),handler=createHandler(DB);let events;
  try{
    const created=await worker.fetch(new Request('http://localhost:3000/api/rooms',{method:'POST',body:JSON.stringify({question:'Живой эфир'})}),{DB});
    const {code,secret}=await created.json();
    await worker.fetch(new Request('http://localhost:3000/api/rooms/'+code+'/control',{method:'POST',headers:{authorization:'Bearer '+secret},body:JSON.stringify({action:'start'})}),{DB});
    events=new Response();await handler(request('/api/rooms/'+code+'/events'),events);
    assert.equal(events.headers['content-type'],'text/event-stream');assert.equal(events.chunks.length,1);
    const response=new Response();await handler(request('/api/rooms/'+code+'/answer',{participant:randomUUID(),word:'Мгновенно'}),response);
    assert.equal(response.status,200);assert.equal(events.chunks.length,2);
    const pushed=JSON.parse(events.chunks[1].slice(6).trim());assert.equal(pushed.words[0].word,'мгновенно');assert.equal(pushed.answers,1);
  }finally{events?.emit('close');DB.close();}
});
