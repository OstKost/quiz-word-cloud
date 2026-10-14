import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import worker from '../worker/index.js';
import {database} from '../scripts/db.mjs';

async function fixture(DB=database()){
 async function call(path,data,secret){
  const res=await worker.fetch(new Request('http://localhost/api/'+path,{method:data?'POST':'GET',headers:{...(data?{'content-type':'application/json'}:{}),...(secret?{authorization:'Bearer '+secret}:{})},body:data?JSON.stringify(data):undefined}),{DB});
  return {status:res.status,data:await res.json()};
 }
 const {data:{code,secret}}=await call('rooms',{question:'Первый секретный вопрос',duration:60,maxAnswers:1});
 const path='rooms/'+code;
 return {DB,code,secret,call,get:async()=>(await call(path)).data,queue:async()=>(await call(path+'/questions',undefined,secret)).data,control:async(action,data={})=>call(path+'/control',{action,...data},secret),answer:async(round,word='идея',participant=randomUUID())=>call(path+'/answer',{round,word,participant})};
}

test('waiting conceals questions, reveal does not start timer, waiting pauses and return needs explicit start',async()=>{
 const f=await fixture();try{
  let s=await f.get();assert.equal(s.view,'waiting');assert.equal(s.question,'');assert.equal(s.deadline,null);
  assert.equal((await f.call('rooms/'+f.code+'/questions')).status,403);
  assert.equal(JSON.stringify((await f.call('rooms/'+f.code+'/history')).data).includes('секретный'),false);
  assert.equal((await f.control('start')).status,409);assert.equal((await f.answer(1)).status,409);
  const id=(await f.queue()).questions[0].id;
  s=(await f.control('show',{id})).data;assert.equal(s.status,'ready');assert.equal(s.remaining,60000);assert.equal(s.deadline,null);assert.equal(s.view,'question');
  assert.equal((await f.answer(1)).status,409);
  s=(await f.control('start')).data;assert.equal(s.status,'open');assert.ok(s.deadline>Date.now());
  assert.equal((await f.answer(1)).status,200);
  s=(await f.control('waiting')).data;assert.equal(s.status,'paused');assert.equal(s.deadline,null);assert.equal(s.question,'');assert.equal(s.words.length,0);assert.equal((await f.answer(1)).status,409);
  const remaining=s.remaining;
  s=(await f.control('show',{id})).data;assert.equal(s.status,'paused');assert.equal(s.remaining,remaining);assert.equal(s.answers,1);
  assert.equal((await f.control('start')).status,200);
  s=(await f.control('stop')).data;assert.equal(s.view,'results');assert.equal(s.answers,1);assert.equal((await f.control('start')).status,409);
 }finally{f.DB.close();}
});

test('editable ordered queue, separate settings and results, stale answer rejection, replay and late analysis',async()=>{
 const f=await fixture();try{
  const first=(await f.queue()).questions[0];
  assert.equal((await f.control('add',{question:'Второй',duration:30,maxAnswers:2})).status,200);
  await f.control('add',{question:'Третий',duration:0,maxAnswers:5});
  let queue=await f.queue();const second=queue.questions[1],third=queue.questions[2];
  await f.control('move',{id:third.id,direction:-1});assert.equal((await f.queue()).questions[1].id,third.id);
  await f.control('edit',{id:third.id,question:'Третий изменённый',duration:10,maxAnswers:4});
  await f.control('show',{id:first.id});assert.equal((await f.control('edit',{id:first.id,question:'Нельзя'})).status,409);assert.equal((await f.control('delete',{id:first.id})).status,409);
  await f.control('start');assert.equal((await f.control('show',{id:second.id})).status,409);
  const participant=randomUUID();await f.answer(1,'космос',participant);await f.control('hide',{word:'космос'});await f.control('stop');
  let s=(await f.control('next')).data;assert.equal(s.round,third.round);assert.equal(s.duration,10);assert.equal(s.maxAnswers,4);assert.equal(s.answers,0);assert.equal(s.analysis,null);
  await f.control('start');assert.equal((await f.answer(1,'прошлый')).status,409);assert.equal((await f.answer(third.round,'космос',participant)).status,200);
  await f.call('rooms/'+f.code+'/analysis',{round:1,analysis:{summary:'Поздний анализ'}},f.secret);assert.equal((await f.get()).analysis,null);
  await f.control('tab',{tab:'themes'});assert.equal((await f.get()).tab,'themes');assert.equal((await f.control('tab',{tab:'bad'})).status,400);
  await f.control('stop');s=(await f.control('show',{id:first.id})).data;assert.equal(s.answers,1);assert.equal(s.words.length,0);assert.equal(s.analysis.summary,'Поздний анализ');assert.equal(s.status,'stopped');assert.equal((await f.control('start')).status,409);
  await f.control('delete',{id:second.id});assert.equal((await f.control('next')).status,409);
  const hist=(await f.call('rooms/'+f.code+'/history')).data;assert.equal(hist.rounds.find(x=>x.round===1).question,first.question);
 }finally{f.DB.close();}
});

test('revision conflicts return current snapshot and concurrent commands do not overwrite queue',async()=>{
 const f=await fixture();try{
  const revision=(await f.get()).revision;
  const results=await Promise.all(['A','B'].map(question=>f.control('add',{question,revision})));
  assert.equal(results.filter(r=>r.status===200).length,1);const conflict=results.find(r=>r.status===409);assert.ok(conflict.data.state.revision>revision);
  assert.equal((await f.queue()).questions.length,2);
  await f.control('waiting-settings',{title:'Ждём гостей',text:'Начнём через минуту'});assert.equal((await f.get()).waitingTitle,'Ждём гостей');
 }finally{f.DB.close();}
});

test('expired timer cannot restart and switching preserves completed results',async()=>{
 const f=await fixture();try{
  const id=(await f.queue()).questions[0].id;await f.control('next');await f.control('start');await f.answer(1);
  await f.DB.prepare('UPDATE rooms SET deadline=? WHERE code=?').bind(Date.now()-10,f.code).run();
  assert.equal((await f.answer(1)).status,409);const s=await f.get();assert.equal(s.status,'stopped');assert.equal(s.view,'results');assert.equal(s.remaining,0);
  await f.control('waiting');assert.equal((await f.control('show',{id})).data.answers,1);assert.equal((await f.control('start')).status,409);
 }finally{f.DB.close();}
});

test('legacy SQLite and D1 SQL migration retain live room, old results and metadata across reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quiz-migrate-'));const path=join(dir,'db.sqlite');let DB;
 try{
  const old=new DatabaseSync(path);old.exec(readFileSync('drizzle/0000_rooms.sql','utf8'));
  old.prepare("INSERT INTO rooms VALUES(?,?,?,?,?,?,'paused',NULL,?,?)").run('123456','secret','Текущий вопрос',3,60,1,45000,2);
  old.prepare('INSERT INTO answers(room,round,participant,word,created) VALUES(?,?,?,?,?)').run('123456',1,randomUUID(),'старый ответ',Date.now());old.close();
  DB=database(path);
  const response=await worker.fetch(new Request('http://localhost/api/rooms/123456'),{DB});const state=await response.json();assert.equal(state.question,'Текущий вопрос');assert.equal(state.status,'paused');assert.equal(state.remaining,45000);
  const qres=await worker.fetch(new Request('http://localhost/api/rooms/123456/questions',{headers:{authorization:'Bearer secret'}}),{DB});const queue=await qres.json();assert.equal(queue.questions.find(q=>q.round===1).question,'Раунд 1');
  DB.close();DB=database(path);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM app_migrations').first()).n,2);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM answers').first()).n,1);
  // D1 applies the same SQL files without the local migration runner.
  const d1=new DatabaseSync(':memory:');d1.exec(readFileSync('drizzle/0000_rooms.sql','utf8'));d1.exec(readFileSync('drizzle/0001_series.sql','utf8'));assert.ok(d1.prepare("SELECT name FROM sqlite_master WHERE name='room_series'").get());d1.close();
 }finally{DB?.close();rmSync(dir,{recursive:true,force:true});}
});

test('prepared series, custom waiting screen, tab and results survive server restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'quiz-persist-')),path=join(dir,'db.sqlite');let DB;
 try{
  DB=database(path);const f=await fixture(DB);
  await f.control('waiting-settings',{title:'Добро пожаловать',text:'Начинаем в 10:00'});
  await f.control('add',{question:'Следующий сохранённый вопрос',duration:30,maxAnswers:4});
  const first=(await f.queue()).questions[0];await f.control('next');await f.control('start');await f.answer(1,'команда');await f.control('stop');await f.control('tab',{tab:'themes'});
  DB.close();DB=database(path);
  const response=await worker.fetch(new Request('http://localhost/api/rooms/'+f.code),{DB});const state=await response.json();assert.equal(state.view,'results');assert.equal(state.tab,'themes');assert.equal(state.answers,1);assert.equal(state.waitingTitle,'Добро пожаловать');
  const res=await worker.fetch(new Request('http://localhost/api/rooms/'+f.code+'/questions',{headers:{authorization:'Bearer '+f.secret}}),{DB});const queue=await res.json();assert.equal(queue.questions[0].id,first.id);assert.equal(queue.questions[1].question,'Следующий сохранённый вопрос');assert.equal(queue.questions[1].maxAnswers,4);
 }finally{DB?.close();rmSync(dir,{recursive:true,force:true});}
});

test('room reset clears all rounds atomically, preserves configuration and allows same participants to answer again',async()=>{
 const f=await fixture();try{
  await f.control('waiting-settings',{title:'Наша встреча',text:'Подключайтесь'});
  await f.control('add',{question:'Второй вопрос',duration:30,maxAnswers:4});
  const configured=await f.queue(),ids=configured.questions.map(q=>q.id);
  await f.control('next');await f.control('start');const participant=randomUUID();await f.answer(1,'космос',participant);await f.control('hide',{word:'космос'});
  await f.call('rooms/'+f.code+'/analysis',{round:1,analysis:{summary:'Результаты прошлой встречи'}},f.secret);
  await f.control('stop');await f.control('next');await f.control('start');await f.answer(2,'идея');
  // An unrelated room must remain intact.
  const other=await fixture(f.DB);await other.control('next');await other.control('start');await other.answer(1);
  const old=await f.get();
  assert.equal((await f.call('rooms/'+f.code+'/control',{action:'reset-room',confirm:true,revision:old.revision})).status,403);
  assert.equal((await f.control('reset-room',{revision:old.revision})).status,400);
  assert.equal((await f.control('reset-room',{confirm:true,revision:old.revision-1})).status,409);
  assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM answers WHERE room=?').bind(f.code).first()).n,2);
  const reset=await f.control('reset-room',{confirm:true,revision:old.revision});assert.equal(reset.status,200);
  let s=reset.data;assert.equal(s.view,'waiting');assert.equal(s.tab,'cloud');assert.equal(s.deadline,null);assert.equal(s.answers,0);assert.equal(s.analysis,null);assert.equal(s.waitingTitle,'Наша встреча');assert.equal(s.filter,true);assert.ok(s.resetToken);
  const q=await f.queue();assert.deepEqual(q.questions.map(q=>q.id),ids);assert.deepEqual(q.defaults,configured.defaults);assert.equal(q.questions[1].duration,30);assert.equal(q.questions[1].maxAnswers,4);assert.ok(q.questions.every(q=>!q.shown&&q.round>2));
  for(const table of ['answers','hidden','analyses'])assert.equal((await f.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE room=?`).bind(f.code).first()).n,0);
  assert.equal((await other.get()).answers,1);
  assert.equal((await f.answer(1,'старый ответ')).status,409);
  assert.equal((await f.call('rooms/'+f.code+'/analysis',{round:1,analysis:{summary:'Запоздавший анализ'}},f.secret)).status,404);
  const history=(await f.call('rooms/'+f.code+'/history')).data;assert.deepEqual(history.history,[]);assert.deepEqual(history.analyses,[]);assert.deepEqual(history.rounds,[]);assert.equal(history.resetToken,s.resetToken);
  await f.control('edit',{id:ids[0],question:'Снова можно редактировать'});
  await f.control('next');await f.control('start');s=await f.get();assert.equal((await f.answer(s.round,'космос',participant)).status,200);
  assert.equal((await f.control('reset-room',{confirm:true,revision:(await f.get()).revision})).status,200);
 }finally{f.DB.close();}
});

test('competing reset commands only commit once and return a consistent new state',async()=>{
 const f=await fixture();try{
  await f.control('next');await f.control('start');await f.answer(1);
  const revision=(await f.get()).revision;
  const result=await Promise.all([f.control('reset-room',{confirm:true,revision}),f.control('reset-room',{confirm:true,revision})]);
  assert.equal(result.filter(r=>r.status===200).length,1);assert.equal(result.filter(r=>r.status===409).length,1);
  assert.equal((await f.queue()).questions.length,1);assert.equal((await f.get()).round,2);
 }finally{f.DB.close();}
});

test('room theme is public, editable, validated and preserved across reset',async()=>{
 const f=await fixture();try{
  const created=await f.call('rooms',{theme:'  Командная встреча  ',question:'Вопрос'});
  assert.equal((await f.call('rooms/'+created.data.code)).data.theme,'Командная встреча');
  assert.equal((await f.call('rooms',{theme:'x'.repeat(181),question:'Вопрос'})).status,400);
  let s=await f.get();assert.equal(s.theme,'');
  s=(await f.control('waiting-settings',{theme:'Идеи команды',title:s.waitingTitle,text:s.waitingText})).data;
  assert.equal(s.theme,'Идеи команды');
  assert.equal((await f.control('waiting-settings',{theme:123,title:s.waitingTitle,text:s.waitingText})).status,400);
  s=(await f.control('reset-room',{confirm:true,revision:s.revision})).data;
  assert.equal(s.theme,'Идеи команды');assert.equal(s.view,'waiting');
 }finally{f.DB.close();}
});
