import {DatabaseSync} from "node:sqlite";
import {channelContent,type ChannelContent,type ChannelDerivation,type ChannelVariant} from "../types/channel-derivation";
import {readArticles,ArticleUnavailable} from "./article-store";

export const channelRulesVersion="channel-derivation-v1";
export class DerivationConflict extends Error {}

function database(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS channel_derivations(
      task_id TEXT NOT NULL, article_version INTEGER NOT NULL, variant TEXT NOT NULL,
      revision INTEGER NOT NULL, rules_version TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(task_id,article_version,variant,revision)
    )`);
  return db;
}

export function channelSource(taskId:string,articleVersion:number){
  const result=readArticles(taskId);
  const article=result.versions.find(row=>row.version===articleVersion);
  if(!article)throw new ArticleUnavailable("母稿版本不存在。");
  return article;
}

function latest(db:DatabaseSync,taskId:string,articleVersion:number,variant:ChannelVariant){
  const row=db.prepare(`SELECT revision,rules_version,updated_at,payload FROM channel_derivations
    WHERE task_id=? AND article_version=? AND variant=? ORDER BY revision DESC LIMIT 1`).get(taskId,articleVersion,variant);
  return row?{taskId,articleVersion,revision:Number(row.revision),rulesVersion:String(row.rules_version),
    updatedAt:String(row.updated_at),content:channelContent.parse(JSON.parse(String(row.payload)))}:null;
}

export function readDerivation(taskId:string,articleVersion:number,variant:ChannelVariant){
  channelSource(taskId,articleVersion);
  const db=database();
  try{return latest(db,taskId,articleVersion,variant);}finally{db.close();}
}

export function writeDerivation(taskId:string,articleVersion:number,revision:number,raw:ChannelContent):ChannelDerivation{
  channelSource(taskId,articleVersion);
  const content=channelContent.parse(raw);
  const db=database();
  try{
    db.exec("BEGIN IMMEDIATE");
    if((latest(db,taskId,articleVersion,content.variant)?.revision??0)!==revision)
      throw new DerivationConflict("渠道稿已在其他窗口更新。当前输入仍保留，请复制或核对后重新载入。");
    const updatedAt=new Date().toISOString(),next=revision+1;
    db.prepare("INSERT INTO channel_derivations VALUES(?,?,?,?,?,?,?)")
      .run(taskId,articleVersion,content.variant,next,channelRulesVersion,updatedAt,JSON.stringify(content));
    db.exec("COMMIT");
    return {taskId,articleVersion,revision:next,rulesVersion:channelRulesVersion,updatedAt,content};
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}finally{db.close();}
}
