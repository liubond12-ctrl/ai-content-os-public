import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import type {LedgerRecord} from "../types/autopilot";

type Mode="mock"|"live";
export interface LedgerTransport {
  scope:string;
  find(articleId:string):Promise<{id:string;fingerprint:string}|null>;
  write(record:LedgerRecord,fingerprint:string,id?:string):Promise<string>;
}
export class LedgerRejected extends Error {}

export function ensureLedger(db:DatabaseSync){
  db.exec("CREATE TABLE IF NOT EXISTS ledger_articles(task TEXT PRIMARY KEY,version INTEGER NOT NULL,scheduled TEXT,payload TEXT NOT NULL);"
    +"CREATE TABLE IF NOT EXISTS ledger_outbox(id TEXT PRIMARY KEY,task TEXT,mode TEXT,payload TEXT,fingerprint TEXT,state TEXT,scope TEXT DEFAULT '',"
    +" detail TEXT DEFAULT '',attempts INTEGER DEFAULT 0,next INTEGER DEFAULT 0,updated INTEGER);"
    +"CREATE INDEX IF NOT EXISTS ledger_pending ON ledger_outbox(mode,state,next);"
    +"CREATE TABLE IF NOT EXISTS ledger_mapping(scope TEXT,task TEXT,record TEXT,PRIMARY KEY(scope,task),UNIQUE(scope,record));"
    +"CREATE TABLE IF NOT EXISTS ledger_mock_records(task TEXT PRIMARY KEY,id TEXT UNIQUE,fingerprint TEXT,payload TEXT);");
}
function latestSource(db:DatabaseSync,id:string,version:number){
  const snapshot=db.prepare("SELECT payload FROM article_snapshots WHERE task_id=? AND version=?").get(id,version);
  const raw=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(id);
  const task=raw?JSON.parse(String(raw.payload)):null;
  const legacy=db.prepare("SELECT payload FROM versions WHERE id=? AND rev=?").get(id,version);
  const article=snapshot?JSON.parse(String(snapshot.payload)):legacy?JSON.parse(String(legacy.payload)).article:null;
  if(!article||article.version!==version)throw Error("台账母稿版本不存在");
  return {title:String(article.title),account:String(task?.input.production?.accountName??"未归属")};
}
export function enqueueLedger(db:DatabaseSync,taskId:string,version:number,scheduledAt?:string|null){
  if(!db.isTransaction)throw Error("台账与母稿必须在同一事务保存");
  ensureLedger(db);
  const tracked=db.prepare("SELECT * FROM ledger_articles WHERE task=?").get(taskId);
  if(tracked&&Number(tracked.version)>version)return;
  const {title,account}=latestSource(db,taskId,version);
  const channels={xiaohongshu:0,douyinScript:0,douyinPost:0,wechat:0};
  if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='channel_derivations'").get()){
    const rows=db.prepare("SELECT variant,max(revision) AS rev FROM channel_derivations WHERE task_id=? AND article_version=? GROUP BY variant").all(taskId,version);
    const keys={xiaohongshu:"xiaohongshu","douyin-script":"douyinScript","douyin-post":"douyinPost",wechat:"wechat"} as const;
    for(const {variant,rev} of rows){
      if(typeof variant==="string"&&Object.hasOwn(keys,variant))channels[keys[variant as keyof typeof keys]]=Number(rev);
    }
  }
  const record:LedgerRecord={articleId:taskId,articleVersion:version,title,account,channels,scheduledAt:scheduledAt===undefined?tracked?.scheduled?String(tracked.scheduled):null:scheduledAt};
  const payload=JSON.stringify(record);
  if(tracked?.payload===payload)return;
  const id=randomUUID(),mode=process.env.STUDIO_DEMO_INSTANCE==="1"?"mock":"live";
  const fingerprint=createHash("sha256").update(id).update(payload).digest("hex");
  db.prepare("INSERT INTO ledger_articles VALUES(?,?,?,?) ON CONFLICT(task) DO UPDATE SET version=excluded.version,scheduled=excluded.scheduled,payload=excluded.payload")
    .run(taskId,version,record.scheduledAt,payload);
  db.prepare("INSERT INTO ledger_outbox(id,task,mode,payload,fingerprint,state,updated) VALUES(?,?,?,?,?,'pending',?)").run(id,taskId,mode,payload,fingerprint,Date.now());
}
export function recordLedgerChannel(db:DatabaseSync,taskId:string,version:number){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='ledger_articles'").get())return;
  if(db.prepare("SELECT 1 FROM ledger_articles WHERE task=? AND version=?").get(taskId,version))enqueueLedger(db,taskId,version);
}
export function ledgerRows(db:DatabaseSync){
  ensureLedger(db);
  return db.prepare(`SELECT a.payload,o.state,o.detail,o.mode,o.updated
    FROM ledger_articles a JOIN ledger_outbox o ON o.rowid=COALESCE(
      (SELECT min(rowid) FROM ledger_outbox WHERE task=a.task AND state<>'sent'),
      (SELECT max(rowid) FROM ledger_outbox WHERE task=a.task))
    ORDER BY o.rowid DESC LIMIT 30`).all()
    .map(row=>({record:JSON.parse(String(row.payload)) as LedgerRecord,state:String(row.state),detail:String(row.detail),mode:String(row.mode),updated:Number(row.updated)}));
}
export function setLedgerSchedule(db:DatabaseSync,taskId:string,version:number,scheduledAt:string|null){
  ensureLedger(db);
  db.exec("BEGIN IMMEDIATE");
  try{
    if(!db.prepare("SELECT 1 FROM ledger_articles WHERE task=? AND version=?").get(taskId,version))throw Error("台账版本已改变");
    enqueueLedger(db,taskId,version,scheduledAt);
    db.exec("COMMIT");
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
}

function database(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec("PRAGMA busy_timeout=5000");ensureLedger(db);return db;
}
const pendingModes=new Set<Mode>();
export async function flushLedger(mode:Mode,transport:LedgerTransport,now=Date.now()){
  if(pendingModes.has(mode))return;
  pendingModes.add(mode);
  let db:DatabaseSync|undefined;
  try{
    const conn=database();db=conn;
    const rows=conn.prepare("SELECT o.* FROM ledger_outbox o WHERE o.mode=? AND o.state<>'sent' AND o.next<=? AND NOT EXISTS(SELECT 1 FROM ledger_outbox older WHERE older.task=o.task AND older.mode=o.mode AND older.rowid<o.rowid AND older.state<>'sent') ORDER BY o.rowid LIMIT 10").all(mode,now);
    for(const row of rows){
      const id=String(row.id),record=JSON.parse(String(row.payload)) as LedgerRecord;
      const fingerprint=String(row.fingerprint);
      if(row.scope&&row.scope!==transport.scope){
        conn.prepare("UPDATE ledger_outbox SET detail='目标表已变化，请管理员核对原表和记录映射。',next=? WHERE id=?").run(now+60000,id);
        continue;
      }
      const finish=(recordId:string)=>{
        conn.exec("BEGIN IMMEDIATE");
        try{
          conn.prepare("INSERT INTO ledger_mapping VALUES(?,?,?) ON CONFLICT(scope,task) DO UPDATE SET record=excluded.record").run(transport.scope,record.articleId,recordId);
          conn.prepare("UPDATE ledger_outbox SET state='sent',detail='已核对台账记录',updated=? WHERE id=?").run(now,id);
          conn.exec("COMMIT");
        }catch(error){conn.exec("ROLLBACK");throw error;}
      };
      const mapped=conn.prepare("SELECT record FROM ledger_mapping WHERE scope=? AND task=?").get(transport.scope,record.articleId)?.record;
      try{
        const remote=await transport.find(record.articleId);
        if(remote&&mapped&&remote.id!==mapped)throw Error("远端记录与本机映射不一致");
        if(remote?.fingerprint===fingerprint){finish(remote.id);continue;}
        if(row.state==="unknown"){
          conn.prepare("UPDATE ledger_outbox SET next=?,detail='回执未知，尚未找到匹配的写入指纹。等待核对。' WHERE id=?").run(now+60000,id);
          continue;
        }
        if(mapped&&!remote)throw Error("原有远端记录未查到，暂停写入");
        const claim=conn.prepare("UPDATE ledger_outbox SET state='unknown',scope=?,attempts=attempts+1,next=?,updated=? WHERE id=? AND state=?")
          .run(transport.scope,now+60000,now,id,row.state);
        if(!claim.changes)continue;
        try{finish(await transport.write(record,fingerprint,remote?.id));}
        catch(error){
          const state=error instanceof LedgerRejected?"retry":"unknown";
          conn.prepare("UPDATE ledger_outbox SET state=?,detail=?,next=?,updated=? WHERE id=?")
            .run(state,state==="retry"?"写入被明确拒绝，已安排退避重试。":"写入回执未知，先核对远端记录。",now+Math.min(900000,60000*2**Math.min(4,Number(row.attempts))),now,id);
        }
      }catch{
        conn.prepare("UPDATE ledger_outbox SET detail='无法核对远端或记录映射，请检查授权与记录。',next=? WHERE id=?").run(now+60000,id);
      }
    }
  }finally{db?.close();pendingModes.delete(mode);}
}
export function mockLedger():LedgerTransport{
  return {scope:"local-preview",
    async find(id){
      const db=database();try{const row=db.prepare("SELECT id,fingerprint FROM ledger_mock_records WHERE task=?").get(id);
        return row?{id:String(row.id),fingerprint:String(row.fingerprint)}:null;
      }finally{db.close();}
    },
    async write(record,fingerprint,existing){
      const db=database();
      try{
        const id=existing??"mock-rec-"+randomUUID();
        if(existing){
          if(!db.prepare("UPDATE ledger_mock_records SET fingerprint=?,payload=? WHERE task=? AND id=?").run(fingerprint,JSON.stringify(record),record.articleId,id).changes)
            throw new LedgerRejected("记录不存在");
        }else db.prepare("INSERT INTO ledger_mock_records VALUES(?,?,?,?)").run(record.articleId,id,fingerprint,JSON.stringify(record));
        return id;
      }finally{db.close();}
    }
  };
}
