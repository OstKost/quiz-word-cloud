import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {database} from '../scripts/db.mjs';
import worker,{holdRoom,touchRoom} from '../worker/index.js';
import {cleanupConfig,initializeCleanup,createCleanup} from '../scripts/cleanup.mjs';
const DAY=86400000;
const logger={info(){},error(){}};
async function create(DB){const r=await worker.fetch(new Request('http://localhost/api/rooms',{method:'POST',body:JSON.stringify({question:'Вопрос'})}),{DB});assert.equal(r.status,201);return r.json();}
async function setup(DB){await initializeCleanup(DB,0);return createCleanup(DB,{interval:7*DAY,inactivity:14*DAY,now:()=>30*DAY,logger});}
test('cleanup removes whole sessions in multiple batches and preserves boundary and held rooms',async()=>{
 const DB=database();let release;
 try{
  const check=await setup(DB),old=[];
  for(let i=0;i<103;i++)old.push((await create(DB)).code);
  const boundary=(await create(DB)).code,active=(await create(DB)).code;
  await DB.prepare('UPDATE rooms SET last_accessed=?').bind(16*DAY-1).run();
  await touchRoom(DB,boundary,16*DAY);release=holdRoom(DB,active);
  const code=old[0];
  await DB.batch([
   DB.prepare('INSERT INTO answers(room,round,participant,word,created) VALUES(?,1,?,?,0)').bind(code,'participant','word'),
   DB.prepare('INSERT INTO hidden VALUES(?,1,?)').bind(code,'word'),
   DB.prepare('INSERT INTO analyses VALUES(?,1,?,0)').bind(code,'{}')
  ]);
  await check();
  assert.deepEqual((await DB.prepare('SELECT code FROM rooms ORDER BY code').all()).results.map(r=>r.code),[boundary,active].sort());
  for(const table of ['answers','hidden','analyses'])assert.equal((await DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM room_series').first()).n,2);
  assert.equal((await DB.prepare('SELECT last_success FROM cleanup_state').first()).last_success,30*DAY);
  assert.equal((await worker.fetch(new Request('http://localhost/api/rooms/'+code),{DB})).status,404);
 }finally{release?.();DB.close();}
});
test('only successful external requests touch rooms; broadcast snapshots and unauthorized requests do not',async()=>{
 const DB=database();try{
  const {code}=await create(DB),url='http://localhost/api/rooms/'+code;
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();
  await worker.fetch(new Request(url),{DB,trackActivity:false});
  await worker.fetch(new Request(url+'/questions'),{DB});
  await worker.fetch(new Request(url+'/control',{method:'POST',body:'{}'}),{DB});
  assert.equal((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed,1);
  await worker.fetch(new Request(url),{DB});
  assert.ok((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed>1);
 }finally{DB.close();}
});
test('failed batch rolls back dependent deletes and retries without advancing schedule',async()=>{
 const DB=database();try{
  const check=await setup(DB),{code}=await create(DB);
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();
  await DB.prepare("CREATE TRIGGER fail_cleanup BEFORE DELETE ON rooms BEGIN SELECT RAISE(ABORT,'test failure'); END").run();
  await check();
  assert.equal((await DB.prepare('SELECT COUNT(*) n FROM room_series').first()).n,1);
  assert.equal((await DB.prepare('SELECT last_success FROM cleanup_state').first()).last_success,0);
  await DB.prepare('DROP TRIGGER fail_cleanup').run();await check();
  assert.equal(await DB.prepare('SELECT code FROM rooms WHERE code=?').bind(code).first(),null);
 }finally{DB.close();}
});
test('interval, restart, legacy null activity and concurrent scheduler checks',async()=>{
 const DB=database();try{
  await initializeCleanup(DB,10*DAY);const {code}=await create(DB);
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();
  let time=16*DAY,passes=0;
  const check=createCleanup(DB,{interval:7*DAY,inactivity:14*DAY,now:()=>time,logger:{info(){passes++},error(){}}});
  await check();assert.ok(await DB.prepare('SELECT code FROM rooms WHERE code=?').bind(code).first());
  await initializeCleanup(DB,16*DAY);time=17*DAY;
  await Promise.all([check(),check()]);assert.equal(passes,1);
  const legacy=await create(DB);await DB.prepare('UPDATE rooms SET last_accessed=NULL WHERE code=?').bind(legacy.code).run();
  await initializeCleanup(DB,18*DAY);
  assert.equal((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed,18*DAY);
 }finally{DB.close();}
});
test('migration gives existing data a grace period and scheduler state survives database reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cleanup-')),path=join(dir,'db.sqlite');let DB;
 try{
  const sql=new DatabaseSync(path);
  sql.exec(readFileSync('drizzle/0000_rooms.sql','utf8'));sql.exec(readFileSync('drizzle/0001_series.sql','utf8'));
  sql.exec("INSERT INTO rooms VALUES('123456','secret','question',3,0,1,'ready',NULL,0,1)");sql.close();
  const before=Date.now()-1000;DB=database(path);
  assert.ok((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed>=before);
  await initializeCleanup(DB,100);DB.close();DB=database(path);await initializeCleanup(DB,200);
  assert.equal((await DB.prepare('SELECT last_success FROM cleanup_state').first()).last_success,100);
 }finally{DB?.close();rmSync(dir,{recursive:true,force:true});}
});
test('cleanup configuration validates day values',()=>{
 assert.deepEqual(cleanupConfig({}),{interval:7*DAY,inactivity:14*DAY});
 assert.deepEqual(cleanupConfig({ROOM_CLEANUP_INTERVAL_DAYS:'2',ROOM_INACTIVITY_DAYS:'30'}),{interval:2*DAY,inactivity:30*DAY});
 for(const value of ['0','-1','1.5','abc','','Infinity','999999999999999999'])assert.throws(()=>cleanupConfig({ROOM_CLEANUP_INTERVAL_DAYS:value}),/positive integer/);
});

test('SSE refreshes activity each minute, protects open streams and releases protection on close',async(t)=>{
 const {EventEmitter}=await import('node:events');
 const {createHandler}=await import('../scripts/local-app.mjs');
 const {roomIsActive}=await import('../worker/index.js');
 t.mock.timers.enable({apis:['setInterval']});
 const DB=database();const res=new EventEmitter();res.destroyed=false;res.writeHead=()=>{};res.write=()=>{};res.end=()=>{};
 try{
  const {code}=await create(DB),handler=createHandler(DB);
  const req={url:'/api/rooms/'+code+'/events',method:'GET',headers:{host:'localhost'}};
  await handler(req,res);assert.equal(roomIsActive(DB,code),true);
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();
  t.mock.timers.tick(60000);
  assert.ok((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed>1);
  res.emit('close');assert.equal(roomIsActive(DB,code),false);
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();t.mock.timers.tick(60000);
  assert.equal((await DB.prepare('SELECT last_accessed FROM rooms').first()).last_accessed,1);
 }finally{res.emit('close');DB.close();}
});
test('cleanup skips requests still receiving a body and rechecks newly touched candidates',async()=>{
 const {createHandler}=await import('../scripts/local-app.mjs');
 const DB=database();try{
  const check=await setup(DB),{code}=await create(DB);
  await DB.prepare('UPDATE rooms SET last_accessed=1').run();
  let resume,entered;
  const started=new Promise(r=>entered=r),waiting=new Promise(r=>resume=r);
  const req={url:'/api/rooms/'+code+'/control',method:'POST',headers:{host:'localhost'},async *[Symbol.asyncIterator](){entered();await waiting;yield Buffer.from('{}');}};
  const res={writeHead(){},end(){}};
  const request=createHandler(DB)(req,res);await started;await check();
  assert.ok(await DB.prepare('SELECT code FROM rooms').first());resume();await request;
  await DB.prepare('UPDATE cleanup_state SET last_success=0').run();
  const wrapped={prepare:DB.prepare,batch(statements){return DB.batch(statements);}};
  const prepare=wrapped.prepare;
  wrapped.prepare=sql=>{
   const stmt=prepare(sql);
   if(sql.startsWith('SELECT code FROM rooms WHERE last_accessed')){
    const all=stmt.all;stmt.all=async()=>{const rows=await all();await touchRoom(DB,code,30*DAY);return rows;};
   }
   return stmt;
  };
  await createCleanup(wrapped,{interval:7*DAY,inactivity:14*DAY,now:()=>30*DAY,logger})();
  assert.ok(await DB.prepare('SELECT code FROM rooms').first());
 }finally{DB.close();}
});
