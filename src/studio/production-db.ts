import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";

export function productionDb(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS production_cloud_grants(task TEXT PRIMARY KEY,hash TEXT,model TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS collaboration(task TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS production_migrations(version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS production_entities(kind TEXT,id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(kind,id,version));
    CREATE TABLE IF NOT EXISTS production_drafts(id TEXT PRIMARY KEY,version INTEGER,payload TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS production_draft_order(id TEXT PRIMARY KEY,position INTEGER);
    INSERT OR IGNORE INTO production_draft_order SELECT id,rowid FROM production_drafts;
    CREATE TABLE IF NOT EXISTS production_batches(id TEXT PRIMARY KEY,created TEXT,version INTEGER,stopped INTEGER DEFAULT 0,token_limit INTEGER,request_limit INTEGER,mode TEXT);
    CREATE TABLE IF NOT EXISTS production_queue(task TEXT PRIMARY KEY,batch TEXT,position INTEGER,status TEXT,reason TEXT,owner TEXT,lease INTEGER,updated TEXT);
    CREATE TABLE IF NOT EXISTS production_workers(id TEXT PRIMARY KEY,seen INTEGER,state TEXT);
    CREATE TABLE IF NOT EXISTS production_assets(id TEXT PRIMARY KEY,brand TEXT,name TEXT,mime TEXT,bytes BLOB,description TEXT,source TEXT,allowed INTEGER,created TEXT);
    CREATE TABLE IF NOT EXISTS production_material_owners(asset TEXT PRIMARY KEY,draft TEXT NOT NULL,account TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS production_supplements(task TEXT,key TEXT,label TEXT,state TEXT,PRIMARY KEY(task,key));
    CREATE TABLE IF NOT EXISTS production_brief_records(task TEXT PRIMARY KEY,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS production_task_notes(task TEXT,id TEXT,body TEXT,created TEXT,PRIMARY KEY(task,id));
    CREATE TABLE IF NOT EXISTS production_images(id TEXT PRIMARY KEY,task TEXT,page INTEGER,version INTEGER,article INTEGER,asset TEXT,confirmed INTEGER);
    CREATE TABLE IF NOT EXISTS production_events(id TEXT PRIMARY KEY,task TEXT,version INTEGER,status TEXT,summary TEXT,created TEXT,UNIQUE(task,version,status));
    CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY,task_id TEXT NOT NULL,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS versions(id TEXT,rev INTEGER,payload TEXT,PRIMARY KEY(id,rev));
    INSERT OR IGNORE INTO production_migrations VALUES(1);`);
  return db;
}
export function event(db:DatabaseSync,task:string,version:number,status:string,summary:string){
  db.prepare("INSERT OR IGNORE INTO production_events VALUES(?,?,?,?,?,?)").run(randomUUID(),task,version,status,summary,new Date().toISOString());
}
export function entities(db:DatabaseSync,kind:string){
  return db.prepare("SELECT payload FROM production_entities e WHERE kind=? AND version=(SELECT max(version) FROM production_entities WHERE kind=e.kind AND id=e.id) ORDER BY rowid").all(kind).map(r=>JSON.parse(String(r.payload)));
}
