import type {DatabaseSync} from "node:sqlite";
import type {ProductionDraft} from "./production";
import type {MatrixMatch} from "../types/sprint5";
import {seriesSources} from "./production-series";

type Topic={title:string;argument?:string;hook?:string};
export const topicKey=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu,"");
function overlap(left:string,right:string){
  const a=topicKey(left),b=topicKey(right);
  if(a.length<5||b.length<5)return false;
  if(a===b)return true;
  const grams=(s:string)=>new Set(Array.from({length:s.length-2},(_,i)=>s.slice(i,i+3)));
  const x=grams(a),y=grams(b),shared=[...x].filter(word=>y.has(word)).length;
  return shared/(x.size+y.size-shared)>=.68;
}
const opening=(body:string)=>body.split("\n").find(line=>line.trim()&&!line.startsWith("#"))?.slice(0,280)??"";
export function matrixSignals(left:Topic,right:Topic){
  return [["标题",left.title,right.title],["核心论点",left.argument,right.argument],["开头钩子",left.hook,right.hook]]
    .flatMap(([label,a,b])=>{
      if(!a||!b)return [];
      const first=topicKey(a),second=topicKey(b);
      if(label==="标题"){
        const numbers=(text:string)=>JSON.stringify(text.match(/\d+/g)??[]);
        if(numbers(first)!==numbers(second))return [];
        if(first===second&&first.length>=3)return [label];
      }
      return overlap(a,b)?[label!]:[];
    });
}
const draftTopic=(draft:ProductionDraft):Topic=>({title:draft.topic,argument:draft.outline,hook:draft.brief?.note});
export function matrixMatches(db:DatabaseSync,draft:ProductionDraft,batch:ProductionDraft[]=[]):MatrixMatch[]{
  if(!draft.account||!draft.topic.trim())return [];
  const probe=draftTopic(draft),matches:MatrixMatch[]=[];
  const predecessorIds=new Set(seriesSources(db,draft.account,draft.series).map(row=>row.task));
  const append=(id:string,account:string,state:string,topic:Topic,href:string,alternate?:Topic)=>{
    const signals=[...new Set([...matrixSignals(probe,topic),...(alternate?matrixSignals(probe,alternate):[])])]
      .filter(signal=>signal!=="标题"||!predecessorIds.has(id));
    if(signals.length)matches.push({id,account,state,title:topic.title,signals,href});
  };
  for(const other of batch)if(other.id!==draft.id)append(other.id,other.account,"同批次",draftTopic(other),"/production/create?draft="+other.id);
  const batchIds=new Set([draft.id,...batch.map(row=>row.id)]);
  for(const row of db.prepare("SELECT payload FROM production_drafts WHERE json_extract(payload,'$.plannedDay') IS NOT NULL").all()){
    const other=JSON.parse(String(row.payload)) as ProductionDraft;
    if(!batchIds.has(other.id)&&other.account&&(!draft.plannedDay||other.plannedDay===draft.plannedDay))
      append(other.id,other.account,"待发布排期草稿",draftTopic(other),"/production/create?draft="+other.id);
  }
  const snapshots=!!db.prepare("SELECT 1 FROM sqlite_master WHERE name='article_snapshots'").get();
  for(const row of db.prepare(`SELECT q.task,q.status,v.payload${snapshots?",(SELECT a.payload FROM article_snapshots a WHERE task_id=q.task ORDER BY version DESC LIMIT 1) AS article":""}
      FROM production_queue q JOIN versions v ON v.id=q.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=q.task)
      WHERE q.status NOT IN ('已停止','失败') OR json_extract(v.payload,'$.article.version') IS NOT NULL`).all()){
    const task=JSON.parse(String(row.payload)),input=task.input,article=row.article?JSON.parse(String(row.article)):task.article;
    if(!input.production?.account)continue;
    const id=String(row.task),state=article?.confirmed?"历史成稿":article?"已有稿件":String(row.status);
    const topic={title:input.topic,argument:input.production.outline,hook:input.production.authorBrief||opening(article?.body??"")};
    append(id,input.production.accountName,state,topic,article?"/studio/editor?taskId="+id:"/production/queue#queue-"+id,
      article?{title:article.title,hook:opening(article.body),argument:article.body.split("\n").filter((line:string)=>/^### /.test(line)).join(" ")}:undefined);
  }
  const statusTable=db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_destinations'").get();
  const ledgerTable=db.prepare("SELECT 1 FROM sqlite_master WHERE name='ledger_articles'").get();
  if(statusTable||ledgerTable){
    const sources=[statusTable?"SELECT id,version FROM content_destinations WHERE status='待发布'":"",ledgerTable?"SELECT task AS id,version FROM ledger_articles WHERE scheduled IS NOT NULL":""].filter(Boolean).join(" UNION ");
    for(const row of db.prepare(sources).all()){
      const id=String(row.id);
      const hit=matches.find(item=>item.id===id);
      if(hit)hit.state="待发布排期";
    }
  }
  return matches;
}
