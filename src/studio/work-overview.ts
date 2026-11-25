import {DatabaseSync} from "node:sqlite";
import {existsSync} from "node:fs";
import type {ProductionView} from "./production";

export const activeStates=["排队","整理资料","生成","审核","修订"];
const todoStates=["受阻","失败","待人工审核","已停止"];
type RecentWork={id:string;title:string;kind:string;updated:string;isDraft:boolean};
export type WorkTask=ProductionView["queue"][number];
export function workOverview(options:{q?:string;status?:string;account?:string;batch?:string;page?:number;list?:boolean}={}){
  const page=Math.max(1,Math.floor(Number.isFinite(options.page)?options.page||1:1)),size=25;
  const empty={counts:{} as Record<string,number>,total:0,todoCount:0,activeCount:0,recent:[] as RecentWork[],workerOnline:false,todos:[] as WorkTask[],active:[] as WorkTask[],groups:[] as {batch:string;name:string;count:number;running:number}[],rows:[] as WorkTask[],matched:0,page,size};
  const path=process.env.STUDIO_DB||"data/studio.sqlite";
  if(!existsSync(/*turbopackIgnore: true*/ path))return empty;
  const db=new DatabaseSync(path,{readOnly:true});
  try{
    // Keep the task and content indexes in the connection's cache while summarizing a large queue.
    db.exec("PRAGMA cache_size=-16384; BEGIN");
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
    function readRecent():RecentWork[]{
      if(options.list)return [];
      const recentDrafts=tables.has("production_drafts")?db.prepare(`SELECT id,updated,json_extract(payload,'$.topic') title,
      json_extract(payload,'$.kind') kind FROM production_drafts ORDER BY updated DESC,id LIMIT 3`).all().map(r=>({
        id:String(r.id),updated:String(r.updated),title:String(r.title||"未命名需求"),kind:String(r.kind),isDraft:true
      })):[];
      const recentArticles=tables.has("article_drafts")?db.prepare(`SELECT d.task_id id,
      json_extract(d.payload,'$.updatedAt') updated,json_extract(d.payload,'$.title') title,${tables.has("content_heads")?"h.kind":"NULL kind"}
      FROM article_drafts d ${tables.has("content_heads")?"LEFT JOIN content_heads h ON h.id=d.task_id":""} ORDER BY updated DESC,id LIMIT 3`).all().map(r=>({
        id:String(r.id),updated:String(r.updated||""),title:String(r.title||"未命名文章"),kind:String(r.kind||"文章"),isDraft:false
      })):[];
      const recentSnapshots=tables.has("article_snapshots")?db.prepare(`SELECT s.task_id id,
        json_extract(s.payload,'$.createdAt') updated,json_extract(s.payload,'$.title') title
        FROM article_snapshots s WHERE s.version=(SELECT max(version) FROM article_snapshots WHERE task_id=s.task_id)
        ORDER BY updated DESC,id LIMIT 3`).all().map(r=>({
        id:String(r.id),updated:String(r.updated||""),title:String(r.title||"未命名文章"),kind:"文章",isDraft:false
      })):[];
      const recent=[...recentDrafts,...recentArticles,...recentSnapshots].sort((a,b)=>b.updated.localeCompare(a.updated));
      return recent.filter((row,index)=>recent.findIndex(candidate=>candidate.id===row.id)===index).slice(0,3);
    }
    if(!tables.has("production_queue")||!tables.has("versions"))return {...empty,recent:readRecent()};
    const snapshot=tables.has("article_snapshots")?
      "(SELECT payload FROM article_snapshots a WHERE a.task_id=q.task ORDER BY version DESC LIMIT 1)":"NULL";
    const indexed=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_task_summary'").get()&&tables.has("content_heads")&&tables.has("content_dirty")&&!db.prepare("SELECT 1 FROM content_dirty LIMIT 1").get();
    const cte=indexed?`WITH items AS (SELECT q.task id,q.batch,q.position,
      (SELECT max(rev) FROM versions WHERE id=q.task) rev,h.topic,
      (SELECT json_extract(payload,\'$.input.production\') FROM versions WHERE id=q.task ORDER BY rev DESC LIMIT 1) production,
      h.accountName accountName,q.reason,q.updated,nullif(h.version,0) version,CASE WHEN h.version>0 THEN h.title END title,
      h.status=\'已定稿\' confirmed,CASE WHEN h.status=\'已定稿\' THEN h.status ELSE q.status END status
      FROM production_queue q JOIN content_heads h INDEXED BY content_task_summary ON h.id=q.task) `:"WITH heads AS (SELECT q.*,v.rev,json_extract(v.payload,'$.input.topic') topic,json_extract(v.payload,'$.input.production') production,json_extract(v.payload,'$.article') original,"+snapshot+" saved FROM production_queue q JOIN versions v ON v.id=q.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=q.task)), articles AS (SELECT *,CASE WHEN coalesce(json_extract(saved,'$.version'),-1)>=coalesce(json_extract(original,'$.version'),-1) THEN saved ELSE original END article FROM heads), items AS (SELECT task id,batch,position,rev,topic,production,reason,updated,json_extract(article,'$.version') version,json_extract(article,'$.title') title,coalesce(json_extract(article,'$.confirmed'),0) confirmed,CASE WHEN json_extract(article,'$.confirmed')=1 THEN '已定稿' ELSE status END status FROM articles) ";
    const counts=Object.fromEntries(db.prepare(cte+"SELECT status,count(*) count FROM items GROUP BY status").all().map(r=>[String(r.status),Number(r.count)]));
    const total=Object.values(counts).reduce((a,b)=>a+b,0);
    const map=(rows:Record<string,unknown>[]):WorkTask[]=>rows.map(r=>({
      id:String(r.id),batch:String(r.batch),position:Number(r.position),started:Number(r.rev)>0,
      topic:String(r.topic),status:String(r.status),reason:String(r.reason??""),updated:String(r.updated),
      version:r.version==null?undefined:Number(r.version),confirmed:!!r.confirmed,title:r.title==null?undefined:String(r.title),
      production:r.production?JSON.parse(String(r.production)):undefined,manual:false,excerpt:undefined
    }));
    const read=(where:string,limit:number)=>map(db.prepare(cte+"SELECT * FROM items WHERE "+where+
      " ORDER BY CASE status WHEN '受阻' THEN 0 WHEN '失败' THEN 1 WHEN '待人工审核' THEN 2 WHEN '已停止' THEN 3 ELSE 4 END,updated ASC,id ASC LIMIT ?").all(limit));
    const todoCount=todoStates.reduce((n,s)=>n+(counts[s]||0),0),activeCount=activeStates.reduce((n,s)=>n+(counts[s]||0),0);
    const groupName=indexed?"coalesce(nullif(accountName,''),'自由创作')":"coalesce(json_extract(production,'$.accountName'),'自由创作')";
    const groups=options.list?[]:db.prepare(cte+"SELECT batch,CASE WHEN count(DISTINCT "+groupName+")>1 THEN '多账号批次' ELSE "+groupName+" END name,count(*) count,sum(status!='排队') running FROM items WHERE status IN ('排队','整理资料','生成','审核','修订') GROUP BY batch ORDER BY running DESC,min(updated),batch LIMIT 1").all().map(r=>({batch:String(r.batch),name:String(r.name),count:Number(r.count),running:Number(r.running)}));
    const query=options.q??"";
    const conditions=["(instr(topic,?)>0 OR instr(coalesce(title,''),?)>0)"],values:string[]=[query,query];
    if(options.status==="todo")conditions.push("status IN ('受阻','失败','待人工审核','已停止')");
    else if(options.status==="active")conditions.push("status IN ('排队','整理资料','生成','审核','修订')");
    else if(options.status){conditions.push("status=?");values.push(options.status);}
    if(options.account){conditions.push("instr(coalesce(json_extract(production,'$.accountName'),''),?)>0");values.push(options.account);}
    if(options.batch){conditions.push("batch=?");values.push(options.batch);}
    const where=conditions.join(" AND ");
    const matched=options.list?Number(db.prepare(cte+"SELECT count(*) count FROM items WHERE "+where).get(...values)?.count):0;
    const rows=options.list?map(db.prepare(cte+"SELECT * FROM items WHERE "+where+" ORDER BY updated DESC,id LIMIT ? OFFSET ?").all(...values,size,(page-1)*size)):[];
    const todos=!options.list&&todoCount?map(db.prepare(cte+`, pending AS (
      SELECT *,row_number() OVER (PARTITION BY status ORDER BY (version IS NOT NULL) DESC,updated DESC,id) status_rank FROM items
      WHERE status IN ('受阻','待人工审核','失败','已停止')
    ) SELECT * FROM pending
      ORDER BY CASE WHEN status IN ('受阻','待人工审核') THEN min(status_rank,2) ELSE 3 END,
        CASE status WHEN '受阻' THEN 0 WHEN '待人工审核' THEN 1 WHEN '失败' THEN 2 ELSE 3 END,
        status_rank LIMIT 3`).all()):[];
    return {counts,total,todoCount,activeCount,recent:readRecent(),groups,rows,matched,page,size,
      workerOnline:tables.has("production_workers")&&!!db.prepare("SELECT 1 FROM production_workers WHERE seen>? LIMIT 1").get(Date.now()-12000),
      todos,
      active:options.list?[]:read("status IN ('整理资料','生成','审核','修订')",1)};
  }finally{db.close();}
}
export type WorkOverview=ReturnType<typeof workOverview>;


// The visual progress reader never runs recovery or initialization writes.
export function workTaskSnapshot(id:string){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite",{readOnly:true});
  try{
    db.exec("BEGIN");
    const row=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(id);
    if(!row)return null;
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE name='collaboration'").get();
    const collaboration=exists?db.prepare("SELECT payload FROM collaboration WHERE task=?").get(id):null;
    return {task:JSON.parse(String(row.payload)),flow:collaboration?JSON.parse(String(collaboration.payload)):null};
  }finally{db.close();}
}
