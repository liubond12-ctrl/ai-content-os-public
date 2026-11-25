import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
// Offline maintenance. First list the affected task IDs. Deletion requires their exact set digest.
const [source,confirmation]=process.argv.slice(2);
if(!/^[0-9a-f]{64}$/.test(source??""))throw Error("请指定资料库出处中显示的来源标识（64 位摘要）");
const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
try{
 db.exec("PRAGMA secure_delete=ON;BEGIN IMMEDIATE");
 const ids=db.prepare("SELECT DISTINCT id FROM versions WHERE instr(payload,?)>0 ORDER BY id").all("飞书/"+source+"/").map(r=>String(r.id));
 const digest=createHash("sha256").update(JSON.stringify([source,ids])).digest("hex");
 if(!confirmation){console.log(JSON.stringify({affectedTasks:ids,confirmation:digest,scope:"删除这些任务的整篇文章、历史、草稿、审核、收藏与回执。另行核查已人工导出的副本和备份。"},null,2));}
 else{
  if(confirmation!==digest)throw Error("清单已变化，需重新预览");
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const guard=db.prepare("SELECT sql FROM sqlite_master WHERE name='immutable_article_delete'").get();
  if(guard)db.exec("DROP TRIGGER immutable_article_delete");
  for(const [table,col] of [["versions","id"],["article_snapshots","task_id"],["article_drafts","task_id"],["reviews","task"],["review_responses","task"],["collaboration","task"],["model_calls","task_id"],["article_candidates","task"],["candidate_purposes","task"],["archived_tasks","id"]]){
   if(tables.has(table))for(const id of ids)db.prepare("DELETE FROM "+table+" WHERE "+col+"=?").run(id);
  }
  if(guard)db.exec(String(guard.sql));
  db.exec("COMMIT;PRAGMA wal_checkpoint(TRUNCATE)");console.log("已清理 "+ids.length+" 个关联任务");
 }
}finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}

