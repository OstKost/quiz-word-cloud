import {readFile} from 'node:fs/promises';
import worker from '../worker/index.js';
export function createHandler(DB,{publicOrigin}={}) {
const canonicalOrigin=publicOrigin?new URL(publicOrigin).origin:null;
const listeners=new Map();
async function snapshot(url){return worker.fetch(new Request(url),{DB});}
async function broadcast(code){for(const client of listeners.get(code)||[]){try{const response=await snapshot(client.url);if(response.ok&&!client.res.destroyed)client.res.write('data: '+await response.text()+'\n\n');}catch(e){console.error(e);}}}
return async(req,res)=>{
  try{
    let url=new URL(req.url,'http://'+req.headers.host);
    if(canonicalOrigin)url=new URL(url.pathname+url.search,canonicalOrigin);
    if(req.method==='GET'&&url.pathname==='/healthz'){
      await DB.prepare('SELECT 1 AS ok').first();
      res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
      res.end('{"ok":true}');return;
    }
    const events=req.method==='GET'&&url.pathname.match(/^\/api\/rooms\/(\d{6})\/events$/);
    if(events){
      url.pathname='/api/rooms/'+events[1];const initial=await snapshot(url);
      if(!initial.ok){res.writeHead(initial.status,{'content-type':'application/json'});res.end(await initial.text());return;}
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive','x-accel-buffering':'no'});
      res.write('data: '+await initial.text()+'\n\n');
      const client={res,url};if(!listeners.has(events[1]))listeners.set(events[1],new Set());listeners.get(events[1]).add(client);
      const heartbeat=setInterval(()=>res.write(': keepalive\n\n'),15000);
      res.on('close',()=>{clearInterval(heartbeat);listeners.get(events[1])?.delete(client);if(!listeners.get(events[1])?.size)listeners.delete(events[1]);});return;
    }
    const chunks=[];let length=0;
    for await(const x of req){length+=x.length;if(length>4096){res.writeHead(413);res.end('Request too large');return;}chunks.push(x);}
    const request=new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    let response;
    if(!url.pathname.startsWith('/api/'))response=new Response((await readFile('public/index.html','utf8')).replace('// __QR_CODE__',await readFile('public/qr.js','utf8')).replace('// __CLOUD_CODE__',await readFile('public/cloud.js','utf8')),{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store'}});
    else response=await worker.fetch(request,{DB});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
    const mutation=url.pathname.match(/^\/api\/rooms\/(\d{6})\/(answer|control)$/);
    if(mutation&&req.method==='POST'&&response.ok)await broadcast(mutation[1]);
  }catch(e){console.error(e);if(!res.headersSent)res.writeHead(500);res.end('Server error');}
};
}
