// UI is embedded by scripts/build.sh; local preview uses the same Worker.
const HTML = '__APP_HTML__';
const ASSETS = /* __PUBLIC_ASSETS__ */ {};
export const publicAssets = {'/logo.svg':'image/svg+xml','/favicon.svg':'image/svg+xml','/favicon.ico':'image/x-icon','/apple-touch-icon.png':'image/png','/og-image.png':'image/png','/robots.txt':'text/plain;charset=utf-8','/sitemap.xml':'application/xml;charset=utf-8'};
export function pageResponse(html,url){
  const headers={'content-type':'text/html;charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin'};
  if(url.searchParams.has('room')||url.searchParams.has('screen')){
    html=html.replace('name="robots" content="index,follow"','name="robots" content="noindex,nofollow"');
    headers['x-robots-tag']='noindex, nofollow';
  }
  return new Response(html,{headers});
}
export function normalize(value) { return value.normalize('NFKC').toLocaleLowerCase('ru').replace(/ё/g,'е').replace(/[^\p{L}\p{N}\s-]/gu,'').replace(/\s+/g,' ').trim(); }
export function validWord(value) { return typeof value === 'string' && value.length<=80 && /^[\p{L}\p{N}\s.!?,:;«»"'()-]+$/u.test(value) && normalize(value).split(' ').length<=3 && normalize(value).length>0; }
export function isProfane(value) { return /(?:х[уy][йеяию]|п[ие]зд|бл[яa][дт]?|еб[аоуы]|ебать|с[уy]к[аи]|fuck|shit|bitch|asshole|нахер)/iu.test(normalize(value).replace(/[\s-]/g,'')); }
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
async function body(req,limit=2048){if(Number(req.headers.get('content-length'))>limit)fail('Слишком большой запрос',413);const raw=await req.text();if(raw.length>limit)fail('Слишком большой запрос',413);try{return JSON.parse(raw);}catch{fail('Некорректный запрос');}}
function roomTheme(value=''){if(typeof value!=='string'||value.length>180)fail('Тема комнаты должна быть не длиннее 180 символов');return value.trim();}
const tabs=['cloud','summary','consensus','themes','unique'];
function settings(b,defaults={}){
 const question=String(b.question??defaults.question??'').trim();
 const maxAnswers=Number(b.maxAnswers??defaults.maxAnswers??3),duration=Number(b.duration??defaults.duration??0);
 if(!question||question.length>180||!Number.isInteger(maxAnswers)||maxAnswers<1||maxAnswers>10||!Number.isInteger(duration)||duration<0||duration>3600)fail('Проверьте вопрос и настройки');
 return {question,maxAnswers,duration};
}
async function room(db,code){
 let r=await db.prepare('SELECT r.*,s.data AS series_data,s.revision FROM rooms r JOIN room_series s ON s.room=r.code WHERE r.code=?').bind(code).first();
 if(!r)fail('Комната не найдена',404);
 if(r.status==='open'&&r.deadline&&r.deadline<=Date.now()){
  const series=JSON.parse(r.series_data),current={...active(r,series),status:'stopped',remaining:0,deadline:null};
  Object.assign(series.questions.find(q=>q.round===r.round),current);if(series.view!=='waiting')series.view='results';
  try{await commit(db,r,series,current);}catch(e){if(e.status!==409)throw e;}
  r=await db.prepare('SELECT r.*,s.data AS series_data,s.revision FROM rooms r JOIN room_series s ON s.room=r.code WHERE r.code=?').bind(code).first();
 }
 return r;
}
async function commit(db,r,series,current,clearResults=false){
 const out=await db.batch([
  db.prepare('UPDATE rooms SET question=?,max_answers=?,duration=?,status=?,deadline=?,remaining=?,round=? WHERE code=? AND status=? AND round=? AND EXISTS(SELECT 1 FROM room_series WHERE room=? AND revision=?)').bind(current.question,current.maxAnswers,current.duration,current.status,current.deadline??null,current.remaining,current.round,r.code,r.status,r.round,r.code,r.revision),
  db.prepare('UPDATE room_series SET data=?,revision=revision+1 WHERE room=? AND revision=? AND changes()=1').bind(JSON.stringify(series),r.code,r.revision),
  ...(clearResults?['answers','hidden','analyses'].map(table=>db.prepare(`DELETE FROM ${table} WHERE room=? AND EXISTS(SELECT 1 FROM room_series WHERE room=? AND revision=? AND json_extract(data,'$.resetToken')=?)`).bind(r.code,r.code,r.revision+1,series.resetToken)):[])
 ]);
 if(!out[0].meta.changes||!out[1].meta.changes)fail('Состояние изменилось. Обновите страницу и повторите действие.',409);
}
function active(r,series){const q=series.questions.find(q=>q.round===r.round);return {...q,status:r.status,remaining:r.remaining,deadline:r.deadline};}
async function controlSeries(db,r,b){
 const series=JSON.parse(r.series_data);let current=active(r,series);
 if(b.revision!==undefined&&b.revision!==r.revision)fail('Состояние изменилось. Повторите действие.',409);
 const saveCurrent=()=>{Object.assign(series.questions.find(q=>q.round===current.round),current)};
 switch(b.action){
 case 'reset-room':{
  if(b.confirm!==true||!Number.isInteger(b.revision))fail('Подтвердите сброс комнаты');
  series.resetToken=crypto.randomUUID();series.view='waiting';series.tab='cloud';
  series.questions=series.questions.map(q=>({...q,round:series.nextRound++,shown:false,status:'draft',deadline:null,remaining:q.duration*1000}));
  current={...series.questions[0],status:'ready'};
  await commit(db,r,series,current,true);return;
 }
 case 'add':case 'reset':{
  const q={...settings(b,{question:r.question,...series.defaults}),id:crypto.randomUUID(),round:series.nextRound++,status:'draft',shown:false};q.remaining=q.duration*1000;series.questions.push(q);break;
 }
 case 'edit':case 'delete':case 'move':{
  const i=series.questions.findIndex(q=>q.id===b.id),q=series.questions[i];if(!q)fail('Вопрос не найден',404);
  if(q.shown)fail('Этот вопрос уже показан',409);
  if(b.action==='edit'){Object.assign(q,settings(b,q));q.remaining=q.duration*1000;}
  if(b.action==='delete'){if(q.round===current.round)fail('Сначала выберите другой вопрос',409);series.questions.splice(i,1);}
  if(b.action==='move'){const j=i+(b.direction===-1?-1:1);if(j>=0&&j<series.questions.length&&!series.questions[j].shown)[series.questions[i],series.questions[j]]=[series.questions[j],q];}
  if(q.round===current.round)current={...q,status:current.status,remaining:q.duration*1000};break;
 }
 case 'show':case 'next':{
  let q=b.action==='next'?series.questions.find(q=>!q.shown):series.questions.find(q=>q.id===b.id);
  if(!q)fail('Нет следующего вопроса',409);
  if(q.round!==current.round&&['open','paused'].includes(current.status))fail('Сначала завершите текущий раунд',409);
  saveCurrent();q.shown=true;if(q.status==='draft')q.status='ready';current={...q};series.view=q.status==='stopped'?'results':'question';series.tab='cloud';break;
 }
 case 'waiting':
  if(current.status==='open'){current.status='paused';current.remaining=current.deadline?Math.max(0,current.deadline-Date.now()):0;current.deadline=null;}
  series.view='waiting';break;
 case 'waiting-settings':
  if(typeof b.title!=='string'||!b.title.trim()||b.title.length>180||typeof b.text!=='string'||b.text.length>1000)fail('Проверьте текст ожидания');const theme=roomTheme(b.theme??series.theme??'');series.title=b.title.trim();series.text=b.text.trim();series.theme=theme;break;
 case 'tab':if(!tabs.includes(b.tab)||series.view==='waiting')fail('Сначала покажите вопрос');series.tab=b.tab;break;
 case 'start':
  if(series.view==='waiting'||!current.shown||!['ready','paused'].includes(current.status))fail('Сначала покажите подготовленный вопрос',409);
  current.status='open';current.deadline=current.duration?Date.now()+current.remaining:null;series.view='question';break;
 case 'pause':if(current.status!=='open')fail('Раунд не запущен',409);current.status='paused';current.remaining=current.deadline?Math.max(0,current.deadline-Date.now()):0;current.deadline=null;break;
 case 'stop':if(!['open','paused'].includes(current.status))fail('Раунд не запущен',409);current.status='stopped';current.deadline=null;series.view='results';break;
 case 'hide':{const out=await db.prepare('INSERT OR IGNORE INTO hidden(room,round,word) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM rooms r JOIN room_series s ON s.room=r.code WHERE r.code=? AND r.round=? AND s.revision=?)').bind(r.code,r.round,normalize(String(b.word)),r.code,r.round,r.revision).run();if(!out.meta.changes)fail('Состояние изменилось или слово уже скрыто',409);return;}
 default:fail('Неизвестное действие');
 }
 saveCurrent();await commit(db,r,series,current);
}
async function snapshot(db,r,p){const words=await db.prepare('SELECT a.word,COUNT(DISTINCT a.participant) AS count FROM answers a WHERE a.room=? AND a.round=? AND NOT EXISTS(SELECT 1 FROM hidden h WHERE h.room=a.room AND h.round=a.round AND h.word=a.word) GROUP BY a.word ORDER BY count DESC,a.word LIMIT 200').bind(r.code,r.round).all();const totals=await db.prepare('SELECT COUNT(*) AS answers,COUNT(DISTINCT participant) AS people FROM answers WHERE room=? AND round=?').bind(r.code,r.round).first();const mine=p?await db.prepare('SELECT COUNT(*) AS n FROM answers WHERE room=? AND round=? AND participant=?').bind(r.code,r.round,p).first():{n:0};let analysis=null;try{const a=await db.prepare('SELECT data FROM analyses WHERE room=? AND round=?').bind(r.code,r.round).first();if(a?.data)analysis=JSON.parse(a.data);}catch{}const series=JSON.parse(r.series_data);const waiting=series.view==='waiting';return {resetToken:series.resetToken||null,view:waiting?'waiting':r.status==='stopped'?'results':series.view,tab:series.tab,theme:series.theme||'',waitingTitle:series.title,waitingText:series.text,revision:r.revision,code:r.code,question:waiting?'':r.question,maxAnswers:r.max_answers,duration:r.duration,filter:!!r.filter,status:r.status,deadline:r.deadline,remaining:r.remaining,round:r.round,words:waiting?[]:words.results,...(waiting?{answers:0,people:0}:totals),used:waiting?0:mine.n,analysis:waiting?null:analysis,now:Date.now()};}
export default {async fetch(req,env){try{const url=new URL(req.url);if(publicAssets[url.pathname]&&ASSETS[url.pathname])return new Response(Uint8Array.from(atob(ASSETS[url.pathname]),c=>c.charCodeAt(0)),{headers:{'content-type':publicAssets[url.pathname],'cache-control':'public,max-age=3600','x-content-type-options':'nosniff'}});if(!url.pathname.startsWith('/api/'))return url.pathname==='/'?pageResponse(HTML,url):new Response('Not found',{status:404});if(req.method==='POST'&&req.headers.get('origin')&&req.headers.get('origin')!==url.origin)fail('Запрос с другого сайта запрещён',403);const db=env.DB;if(!db)fail('База данных недоступна',503);
if(url.pathname==='/api/rooms'&&req.method==='POST'){
 const b=await body(req),{question,maxAnswers,duration}=settings(b),secret=crypto.randomUUID(),theme=roomTheme(b.theme);
 for(let i=0;i<5;i++){
  const code=String(crypto.getRandomValues(new Uint32Array(1))[0]%900000+100000);
  const initial={theme,defaults:{maxAnswers,duration},questions:[{id:crypto.randomUUID(),round:1,question,maxAnswers,duration,status:'draft',shown:false,remaining:duration*1000}],nextRound:2,view:'waiting',tab:'cloud',title:'Скоро начнём',text:'Подключайтесь к комнате — ведущий скоро покажет вопрос'};
  try{
   await db.batch([
    db.prepare("INSERT INTO rooms(code,secret,question,max_answers,duration,filter,status,remaining) VALUES(?,?,?,?,?,?,'ready',?)").bind(code,secret,question,maxAnswers,duration,b.filter===false?0:1,duration*1000),
    db.prepare('INSERT INTO room_series(room,data) VALUES(?,?)').bind(code,JSON.stringify(initial))
   ]);return json({code,secret},201);
  }catch(e){if(i===4||!String(e.message).includes('UNIQUE'))throw e;}
 }
}
const match=url.pathname.match(/^\/api\/rooms\/(\d{6})(?:\/(answer|control|analysis|history|ai-analyze|questions))?$/);if(!match)fail('Не найдено',404);const r=await room(db,match[1]);
if(match[2]==='questions'&&req.method==='GET'){if(req.headers.get('authorization')!==`Bearer ${r.secret}`)fail('Нет доступа к управлению',403);const series=JSON.parse(r.series_data);return json({...series,questions:series.questions.map(q=>q.round===r.round?active(r,series):q),revision:r.revision});}
if(!match[2]&&req.method==='GET')return json(await snapshot(db,r,url.searchParams.get('participant')));
if(match[2]==='history'&&req.method==='GET'){const rows=await db.prepare('SELECT a.round,a.word,COUNT(DISTINCT a.participant) as count FROM answers a WHERE a.room=? GROUP BY a.round,a.word ORDER BY a.round,count DESC').bind(r.code).all();let savedAnalyses=[];try{savedAnalyses=(await db.prepare('SELECT round,data,created FROM analyses WHERE room=? ORDER BY round').bind(r.code).all()).results;}catch{}return json({resetToken:JSON.parse(r.series_data).resetToken||null,code:r.code,currentRound:r.round,question:JSON.parse(r.series_data).view==='waiting'?'':r.question,rounds:JSON.parse(r.series_data).questions.filter(q=>q.shown).map(q=>({round:q.round,question:q.question})),history:rows.results,analyses:savedAnalyses});}
if(match[2]==='ai-analyze'&&req.method==='POST'){if(req.headers.get('authorization')!==`Bearer ${r.secret}`)fail('Нет доступа к управлению',403);const b=await body(req,65536);if(!b.apiKey||!b.prompt)fail('Не указаны параметры анализа');const endpoint=(b.endpoint||'https://api.openai.com/v1').replace(/\/+$/,'')+'/chat/completions';let aiRes;try{aiRes=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','authorization':'Bearer '+b.apiKey},body:JSON.stringify({model:b.model||'gpt-4o-mini',messages:[{role:'system',content:'You are an expert qualitative data analyst. Respond strictly with valid JSON.'},{role:'user',content:String(b.prompt)}],temperature:0.2,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(45000)});}catch(e){fail('Не удалось подключиться к провайдеру: '+e.message,502);}if(!aiRes.ok){const errText=await aiRes.text();fail('Ошибка LLM провайдера ('+aiRes.status+'): '+errText.slice(0,200),502);}return json(await aiRes.json());}
if(match[2]==='analysis'&&req.method==='POST'){if(req.headers.get('authorization')!==`Bearer ${r.secret}`)fail('Нет доступа к управлению',403);const b=await body(req,65536);if(!b.analysis||typeof b.analysis!=='object')fail('Некорректные данные анализа');const targetRound=Number(b.round||r.round);if(!JSON.parse(r.series_data).questions.some(q=>q.round===targetRound&&q.shown))fail('Раунд не найден',404);try{await db.prepare('CREATE TABLE IF NOT EXISTS analyses (room TEXT NOT NULL, round INTEGER NOT NULL, data TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY(room,round))').run();}catch{}const saved=await db.prepare("INSERT INTO analyses(room,round,data,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM room_series s,json_each(s.data,'$.questions') q WHERE s.room=? AND json_extract(q.value,'$.round')=? AND json_extract(q.value,'$.shown')=1) ON CONFLICT(room,round) DO UPDATE SET data=excluded.data,created=excluded.created").bind(r.code,targetRound,JSON.stringify(b.analysis),Date.now(),r.code,targetRound).run();if(!saved.meta.changes)fail('Раунд уже сброшен',409);return json(await snapshot(db,await room(db,r.code)));}
const b=await body(req);if(match[2]==='answer'&&req.method==='POST'){if(!/^[a-zA-Z0-9-]{20,64}$/.test(b.participant||''))fail('Перезагрузите страницу');if(!validWord(b.word))fail('Введите от 1 до 3 слов, максимум 80 символов');const word=normalize(b.word);if(r.filter&&isProfane(word))fail('Этот ответ не прошёл фильтр');if(b.round!==r.round)fail('Вопрос изменился. Обновите страницу.',409);if(r.status!=='open')fail('Приём ответов закрыт',409);
const out=await db.prepare(`INSERT INTO answers(room,round,participant,word,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rooms WHERE code=? AND round=? AND status='open' AND (deadline IS NULL OR deadline>?)) AND (SELECT COUNT(*) FROM answers WHERE room=? AND round=? AND participant=?)<? AND NOT EXISTS(SELECT 1 FROM answers WHERE room=? AND round=? AND participant=? AND word=?) AND NOT EXISTS(SELECT 1 FROM hidden WHERE room=? AND round=? AND word=?) AND (SELECT COALESCE(MAX(created),0) FROM answers WHERE room=? AND round=? AND participant=?)<?`).bind(r.code,r.round,b.participant,word,Date.now(),r.code,r.round,Date.now(),r.code,r.round,b.participant,r.max_answers,r.code,r.round,b.participant,word,r.code,r.round,word,r.code,r.round,b.participant,Date.now()-1000).run();if(!out.meta.changes)fail('Ответ уже отправлен, лимит исчерпан или отправка слишком частая',409);return json(await snapshot(db,r,b.participant));}
if(match[2]==='control'&&req.method==='POST'){if(req.headers.get('authorization')!==`Bearer ${r.secret}`)fail('Нет доступа к управлению',403);try{await controlSeries(db,r,b);}catch(e){if(e.status===409)return json({error:e.message,state:await snapshot(db,await room(db,r.code))},409);throw e;}return json(await snapshot(db,await room(db,r.code)));}fail('Метод не поддерживается',405);
}catch(e){if(!e.status)console.error(e);return json({error:e.status?e.message:'Ошибка сервера. Попробуйте ещё раз.'},e.status||500);}}};
