import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function database(path=':memory:'){
 const sqlite=new DatabaseSync(path);sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY)');
 for(const name of readdirSync('drizzle').filter(x=>x.endsWith('.sql')).sort()){
  if(sqlite.prepare('SELECT name FROM app_migrations WHERE name=?').get(name))continue;
  sqlite.exec('BEGIN IMMEDIATE');
  try{
   if(name!=='0000_rooms.sql'||!sqlite.prepare("SELECT name FROM sqlite_master WHERE name='rooms'").get())sqlite.exec(readFileSync('drizzle/'+name,'utf8'));
   sqlite.prepare('INSERT INTO app_migrations VALUES(?)').run(name);sqlite.exec('COMMIT');
  }catch(e){sqlite.exec('ROLLBACK');sqlite.close();throw e;}
 }
 function prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return {bind(...values){args=values;return this},async first(){return stmt.get(...args)||null},async all(){return {results:stmt.all(...args)}},execute(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}},async run(){return this.execute()}};}
 return {prepare,async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const out=statements.map(s=>s.execute());sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},close(){sqlite.close()}};
}
