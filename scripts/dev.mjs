import http from 'node:http';
import {database} from './db.mjs';
import {createHandler} from './local-app.mjs';
const DB=database(process.env.DB_PATH||'/tmp/slovopotok.sqlite');
const port=Number(process.env.PORT||3000);
http.createServer(createHandler(DB,{publicOrigin:process.env.APP_ORIGIN})).listen(port,'0.0.0.0',()=>console.log('Local: http://localhost:'+port+' (phones: use this computer’s LAN IP)'));
