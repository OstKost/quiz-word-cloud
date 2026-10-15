import {roomIsActive} from '../worker/index.js';
const DAY=86400000;
export function cleanupConfig(env=process.env){
 function days(name,fallback){
  const raw=env[name]??String(fallback);
  if(!/^[1-9]\d*$/.test(raw)||!Number.isSafeInteger(Number(raw)*DAY))throw new Error(name+' must be a positive integer number of days');
  return Number(raw)*DAY;
 }
 return {interval:days('ROOM_CLEANUP_INTERVAL_DAYS',7),inactivity:days('ROOM_INACTIVITY_DAYS',14)};
}
export async function initializeCleanup(DB,now=Date.now()){
 await DB.batch([
  DB.prepare('UPDATE rooms SET last_accessed=? WHERE last_accessed IS NULL').bind(now),
  DB.prepare('INSERT OR IGNORE INTO cleanup_state(id,last_success) VALUES(1,?)').bind(now)
 ]);
}
export function createCleanup(DB,{interval,inactivity,now=Date.now,logger=console}){
 let running=false;
 return async function check(){
  if(running)return;running=true;
  const started=now(),counts={rooms:0,room_series:0,answers:0,hidden:0,analyses:0};
  try{
   const state=await DB.prepare('SELECT last_success FROM cleanup_state WHERE id=1').first();
   if(!state)throw new Error('Cleanup scheduler has not been initialized');
   if(started-state.last_success<interval)return;
   const cutoff=started-inactivity;let cursor='';
   while(true){
    const {results}=await DB.prepare('SELECT code FROM rooms WHERE last_accessed<? AND code>? ORDER BY code LIMIT 100').bind(cutoff,cursor).all();
    if(!results.length)break;
    cursor=results.at(-1).code;
    const codes=results.map(r=>r.code).filter(code=>!roomIsActive(DB,code));
    if(!codes.length)continue;
    const selected=`SELECT code FROM rooms WHERE last_accessed<? AND code IN (${codes.map(()=>'?').join(',')})`;
    const tables=['answers','hidden','analyses','room_series','rooms'];
    // batch executes in one write transaction; every statement rechecks the cutoff.
    const out=await DB.batch(tables.map(table=>DB.prepare(`DELETE FROM ${table} WHERE ${table==='rooms'?'code':'room'} IN (${selected})`).bind(cutoff,...codes)));
    tables.forEach((table,i)=>counts[table]+=out[i].meta.changes);
   }
   await DB.prepare('UPDATE cleanup_state SET last_success=? WHERE id=1').bind(now()).run();
   logger.info('Room cleanup completed',{...counts,durationMs:now()-started});
  }catch(error){logger.error('Room cleanup failed; retry on next check',error);}
  finally{running=false;}
 };
}
export async function startCleanup(DB,options={}){
 const config=cleanupConfig(options.env),now=options.now??Date.now;
 await initializeCleanup(DB,now());
 const check=createCleanup(DB,{...config,...options,now});
 await check();
 const timer=setInterval(check,60000);timer.unref();
 return ()=>clearInterval(timer);
}
