import type {DatabaseSync} from "node:sqlite";
import {productionDb} from "./production-db";
import {readArticles} from "./article-store";
import {readDerivation} from "./channel-derivations";
import {generateChannel} from "./generate-channel";
import {channelRadar} from "./channel-delivery";
import {BudgetError,callsFor} from "./usage";
import type {ChannelVariant} from "../types/channel-derivation";

const lanes=["xiaohongshu","douyin-script","douyin-post","wechat"] as const;
export function fastlaneTables(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS distribution_outbox(task TEXT,version INTEGER,channel TEXT,state TEXT,
    touched INTEGER,detail TEXT,radar TEXT,PRIMARY KEY(task,version,channel));`);
}
export function enqueueFastlane(db:DatabaseSync,task:string,version:number){
  if(!db.isTransaction)throw Error("派生意图须与审批一起提交");
  fastlaneTables(db);
  for(const lane of lanes)db.prepare("INSERT OR IGNORE INTO distribution_outbox VALUES(?,?,?,'pending',?,'',NULL)").run(task,version,lane,Date.now());
}
export async function dispatchFastlane(){
  const db=productionDb();
  try{
    fastlaneTables(db);db.exec("BEGIN IMMEDIATE");
    const now=Date.now();
    db.prepare("UPDATE distribution_outbox SET state='verify',detail='执行中断，请先核对生成回执' WHERE state='running' AND touched<?").run(now-120000);
    const job=db.prepare(`SELECT task,version,channel FROM distribution_outbox o
      WHERE state IN ('pending','paused') AND touched<=?
      AND NOT EXISTS(SELECT 1 FROM distribution_outbox e WHERE e.task=o.task AND e.version=o.version AND e.state IN ('running','verify'))
      ORDER BY o.rowid LIMIT 1`).get(now);
    if(!job){db.exec("COMMIT");return;}
    const task=String(job.task),version=Number(job.version),channel=String(job.channel) as ChannelVariant;
    db.prepare("UPDATE distribution_outbox SET state='running',touched=? WHERE task=? AND version=? AND channel=?").run(now,task,version,channel);
    db.exec("COMMIT");
    const finish=(state:string,detail="",radar?:unknown)=>db.prepare("UPDATE distribution_outbox SET state=?,detail=?,radar=?,touched=? WHERE task=? AND version=? AND channel=? AND state='running'")
      .run(state,detail,radar?JSON.stringify(radar):null,Date.now()+(state==="paused"?60000:0),task,version,channel);
    const before=callsFor(task).length;
    try{
      if(readArticles(task).head.version!==version){finish("cancelled","母稿版本已变化");return;}
      const current=readDerivation(task,version,channel);
      const result=current??await generateChannel(task,version,channel,0,false,true);
      finish("ready","已生成，等待作者处理",channelRadar(result.content));
    }catch(error){
      const detail=error instanceof Error?error.message:"生成失败";
      finish(error instanceof BudgetError&&callsFor(task).length===before?"paused":"verify",detail);
    }
  }finally{db.close();}
}
