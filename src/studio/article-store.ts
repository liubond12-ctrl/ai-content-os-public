import {validateBody} from "./production-schema";
import {event} from "./production-db";
import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import type {Task} from "./tasks";
import {documentSchema,fromText,quoteRange,plainText,type ArticleDocument} from "./article-document";
import {endingEditId} from "../types/multi-agent-review";

export interface ArticleSnapshot {
  taskId:string;version:number;sourceTaskRevision:number;researchVersion:number;
  title:string;body:string;document:ArticleDocument;formatVersion:1;
  citations:string[];origin:"model"|"human"|"restore"|"ai-revision";model?:string;
  confirmed?:boolean; decision?:{review:string;issue:number;reason:string;choice:string;opinionId?:string};
  revisionReviewId?:string;parentVersion?:number;restoredFrom?:number;createdAt:string;reviewLabel:string;
  endingInserted?:boolean;
}
export interface ArticleDraft {revision:number;baseVersion:number;title:string;document:ArticleDocument;updatedAt:string;reviewEdits?:string[]}
export interface ArticleState {kind?:import("zod").infer<typeof import("./production-schema").contentKind>;versions:ArticleSnapshot[];head:ArticleSnapshot;draft:ArticleDraft|null}
export class ArticleUnavailable extends Error{}
export class ArticleConflict extends Error{}
function database(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  ensureArticleTables(db);return db;
}
export function ensureArticleTables(db:DatabaseSync){
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS article_snapshots(task_id TEXT,version INTEGER,payload TEXT NOT NULL,PRIMARY KEY(task_id,version));
    CREATE TABLE IF NOT EXISTS article_drafts(task_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS immutable_article_update BEFORE UPDATE ON article_snapshots BEGIN SELECT RAISE(ABORT,'immutable article'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_article_delete BEFORE DELETE ON article_snapshots BEGIN SELECT RAISE(ABORT,'immutable article'); END;`);
}
function versions(db:DatabaseSync,id:string):ArticleSnapshot[]{
  const legacy=db.prepare("SELECT rev,payload FROM versions WHERE id=? ORDER BY rev").all(id).flatMap(row=>{
    const task:Task=JSON.parse(String(row.payload)),a=task.article;
    if(!a||a.version!==Number(row.rev)||a.researchVersion!==task.research?.version)return [];
    return [{taskId:id,version:a.version,sourceTaskRevision:Number(row.rev),researchVersion:a.researchVersion,
      title:a.title,body:a.body,document:fromText(a.body),formatVersion:1 as const,citations:a.citations,
      origin:"model" as const,model:a.model,createdAt:task.records.at(-1)?.ended??"",reviewLabel:a.reviewLabel??"待人工审核"}];
  });
  const edited:ArticleSnapshot[]=db.prepare("SELECT payload FROM article_snapshots WHERE task_id=?").all(id).map(r=>JSON.parse(String(r.payload)));
  return [...legacy,...edited].sort((a,b)=>b.version-a.version);
}
export function articleStateInTransaction(db:DatabaseSync,id:string):ArticleState{
  const all=versions(db,id);if(!all.length){
    const task=db.prepare("SELECT 1 FROM versions WHERE id=? LIMIT 1").get(id);
    throw new ArticleUnavailable(task?"此任务尚无可编辑的正式文章。":"当前工作台没有这条任务记录。");
  }
  const row=db.prepare("SELECT payload FROM article_drafts WHERE task_id=?").get(id);
  const taskRow=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(id);
  const task=taskRow?JSON.parse(String(taskRow.payload)):null;
  return {kind:task?.input?.production?.kind,versions:all,head:all[0],draft:row?JSON.parse(String(row.payload)):null};
}
export function readArticles(id:string){const db=database();try{return articleStateInTransaction(db,id);}finally{db.close();}}
export function articleForReview(id:string,version:number){
  const db=database();try{
    const article=versions(db,id).find(a=>a.version===version);if(!article)throw Error("文章版本不存在");
    const row=db.prepare("SELECT payload FROM versions WHERE id=? AND rev=?").get(id,article.sourceTaskRevision);
    const task:Task=JSON.parse(String(row?.payload));
    if(task.research?.version!==article.researchVersion)throw Error("文章研究依赖不一致");
    // Retain original task and evidence for existing provider permission/budget checks.
    task.article={title:article.title,body:article.body,citations:article.citations,version:article.version,
      researchVersion:article.researchVersion,model:article.origin==="model"?article.model??"unknown":"human-edit"};
    return task;
  }finally{db.close();}
}
const common={taskId:z.uuid(),revision:z.number().int().nonnegative(),baseVersion:z.number().int().positive()};
const content={title:z.string().min(1).max(1000),document:documentSchema.refine(d=>plainText(d).length<=200000,"文章最多 200000 字符")};
export const articleMutation=z.discriminatedUnion("action",[
  z.object({...common,...content,action:z.literal("draft"),reviewEdit:z.string().min(1).max(500).optional()}).strict(),
  z.object({...common,...content,action:z.literal("publish")}).strict(),
  z.object({...common,action:z.literal("decide"),review:z.string(),issue:z.number().int().nonnegative(),reason:z.string().trim().min(1).max(1000),choice:z.enum(["accept","retain"]),replacement:z.string().max(4000)}).strict(),
  z.object({...common,action:z.literal("restore"),version:z.number().int().positive()}).strict()
]);
export function changeArticle(raw:unknown){
  const db=database();
  try{
    db.exec("BEGIN IMMEDIATE");
    const result=changeArticleInTransaction(db,raw);db.exec("COMMIT");return result;
  }catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}finally{db.close();}
}
export function changeArticleInTransaction(db:DatabaseSync,raw:unknown,opinion?:import("./professional-review").Opinion){
    if(!db.isTransaction)throw Error("文章写入需要事务");
    const input=articleMutation.parse(raw),current=articleStateInTransaction(db,input.taskId);
    const previous=current.draft?.baseVersion===current.head.version?current.draft.reviewEdits??[]:[];
    if(input.action==="draft"&&input.reviewEdit&&current.head.version===input.baseVersion&&previous.includes(input.reviewEdit)){
      if(current.draft?.title===input.title&&JSON.stringify(current.draft.document)===JSON.stringify(input.document))return current;
      throw new ArticleConflict("此建议已处理。当前输入仍保留，请重新载入最新草稿。");
    }
    if((current.draft?.revision??0)!==input.revision || current.head.version!==input.baseVersion)
      throw new ArticleConflict("内容已由其他窗口更新。当前输入仍保留，请复制后重新载入最新草稿。");
    if(input.action==="draft"&&input.reviewEdit===endingEditId){
      const updated=db.prepare("UPDATE production_supplements SET state='added' WHERE task=? AND key='ending' AND state IN ('pending','added')").run(input.taskId);
      if(!updated.changes)throw new ArticleConflict("结尾补充已被跳过或不再适用于这篇稿件。");
    }
    let title:string,document:ArticleDocument,baseVersion=current.head.version;
    if(input.action==="restore"){
      const old=current.versions.find(v=>v.version===input.version);if(!old)throw Error("历史版本不存在");
      title=old.title;document=old.document;
    }else if(input.action==="decide"){
      const head=current.head;
      if(current.draft&&(current.draft.title!==head.title||JSON.stringify(current.draft.document)!==JSON.stringify(head.document)))throw new ArticleConflict("草稿已变化，请先保存新版并重新审核。");
      const record=db.prepare("SELECT payload FROM reviews WHERE id=? AND task=? AND article=?").get(input.review,input.taskId,head.version);
      const item=record&&(opinion?.issue??JSON.parse(String(record.payload)).result?.issues[input.issue]);
      if(!item)throw new ArticleConflict("此意见不属于当前文章版本。");
      const field=item.field as "body"|"title", value=head[field];
      if(value.slice(item.offset,item.offset+item.quote.length)!==item.quote)throw new ArticleConflict("原句定位失效，请重新审核。");
      const edited=value.slice(0,item.offset)+input.replacement+value.slice(item.offset+item.quote.length);
      title=input.choice==="accept"&&field==="title"?edited:head.title;
      document=head.document;
      if(input.choice==="accept"&&field==="body"){
        const range=quoteRange(document,item.quote,item.offset);
        if(!range||range.anchor.path.join()!==range.focus.path.join()||input.replacement.includes("\n"))throw new ArticleConflict("跨段或跨格式修改请在正文编辑器中完成。");
        document=structuredClone(document);
        const leaf=document[range.anchor.path[0]].children[range.anchor.path[1]];
        leaf.text=leaf.text.slice(0,range.anchor.offset)+input.replacement+leaf.text.slice(range.focus.offset);
      }
    }else{title=input.title;document=input.document;}
    if(input.action!=="draft"){
      const taskRow=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(input.taskId);
      const task:Task=JSON.parse(String(taskRow?.payload));
      if(task.input.production)validateBody(task.input.production.kind,plainText(document));
    }
    if(input.action==="publish"&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reviews'").get()){
      const reviewed=db.prepare("SELECT payload FROM reviews WHERE task=? AND article<=? ORDER BY article DESC,version DESC").all(input.taskId,current.head.version);
      const proposed=title+"\n"+plainText(document);
      const verified=new Set<string>();
      for(const row of reviewed){
        const record:import("./eval").Review=JSON.parse(String(row.payload));
        for(const claim of record.result?.facts.checks??[]){
          if(claim.status==="来源原文匹配"&&record.articleVersion===current.head.version)verified.add(claim.quote);
          if(claim.critical&&claim.status!=="来源原文匹配"&&proposed.includes(claim.quote)&&!verified.has(claim.quote))
            throw new ArticleConflict("关键事实仍待核验。请补充来源并重新审核，或删除缺乏依据的断言，再确认定稿。");
        }
      }
    }
    if(input.action!=="draft"){
      const maxTask=Number(db.prepare("SELECT MAX(rev) AS v FROM versions WHERE id=?").get(input.taskId)?.v??0);
      baseVersion=Math.max(maxTask,current.head.version)+1;
      const source=input.action==="restore"?current.versions.find(v=>v.version===input.version)!:current.head;
      const snapshot:ArticleSnapshot={...source,title,document,body:plainText(document),version:baseVersion,
        confirmed:input.action==="publish",revisionReviewId:undefined,decision:input.action==="decide"?{review:input.review,issue:input.issue,reason:input.reason,choice:input.choice,opinionId:opinion?.id}:undefined,origin:input.action==="restore"?"restore":"human",model:undefined,parentVersion:current.head.version,
        restoredFrom:input.action==="restore"?input.version:undefined,createdAt:new Date().toISOString(),
        endingInserted:input.action==="restore"||input.action==="decide"?source.endingInserted:previous.includes(endingEditId)||source.endingInserted,
        reviewLabel:source.reviewLabel.includes("限定范围")?"限定范围草稿，待人工审核（人工编辑）":"人工编辑，待人工审核"};
      db.prepare("INSERT INTO article_snapshots VALUES(?,?,?)").run(input.taskId,baseVersion,JSON.stringify(snapshot));
    }
    const reviewEdits=input.action==="draft"
      ? [...previous,...(input.reviewEdit?[input.reviewEdit]:[])]
      : input.action==="restore"
        ? (current.versions.find(v=>v.version===input.version)?.endingInserted?[endingEditId]:[])
        : (previous.includes(endingEditId)||current.head.endingInserted?[endingEditId]:[]);
    const draft:ArticleDraft={revision:input.revision+1,baseVersion,title,document,updatedAt:new Date().toISOString(),reviewEdits};
    db.prepare("INSERT INTO article_drafts VALUES(?,?,?) ON CONFLICT(task_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload")
      .run(input.taskId,draft.revision,JSON.stringify(draft));
    const result=articleStateInTransaction(db,input.taskId);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='production_events'").get())event(db,input.taskId,result.head.version,result.head.confirmed?"已定稿":"草稿已保存",result.head.title);
    return result;
}

/** Called inside the controller's transaction; never overwrites the human draft. */
export function appendRevision(db:DatabaseSync,id:string,a:import("./agents").Article,parent:number,revisionReviewId?:string){
  const current=articleStateInTransaction(db,id);if(current.kind)validateBody(current.kind,a.body);if(current.head.version!==parent)throw new ArticleConflict("正式版本已变化");
  const max=Number(db.prepare("SELECT MAX(rev) AS v FROM versions WHERE id=?").get(id)?.v??0);
  const version=Math.max(max,current.head.version)+1;
  const snapshot:ArticleSnapshot={...current.head,title:a.title,body:a.body,document:fromText(a.body),citations:a.citations,
    version,confirmed:false,decision:undefined,revisionReviewId,origin:"ai-revision",model:a.model,parentVersion:parent,createdAt:new Date().toISOString(),reviewLabel:"AI 修订，待审核"};
  db.prepare("INSERT INTO article_snapshots VALUES(?,?,?)").run(id,version,JSON.stringify(snapshot));return version;
}



export function articleCandidates(add?:{taskId:string;version:number;kind?:"case"|"method"|"eval"}){
  const db=database();
  try{
    db.exec("CREATE TABLE IF NOT EXISTS article_candidates(task TEXT,version INTEGER,created TEXT,PRIMARY KEY(task,version))");
    db.exec("CREATE TABLE IF NOT EXISTS candidate_purposes(task TEXT,version INTEGER,kind TEXT,PRIMARY KEY(task,version,kind))");
    if(add){
      if(!versions(db,add.taskId).some(v=>v.version===add.version))throw Error("文章版本不存在");
      db.prepare("INSERT OR IGNORE INTO candidate_purposes VALUES(?,?,?)").run(add.taskId,add.version,add.kind??"case");
      db.prepare("INSERT OR IGNORE INTO article_candidates VALUES(?,?,?)").run(add.taskId,add.version,new Date().toISOString());
    }
    return db.prepare("SELECT c.task,c.version,coalesce(p.kind,'case') AS kind FROM article_candidates c LEFT JOIN candidate_purposes p USING(task,version) ORDER BY c.created DESC").all().flatMap(row=>{
      const a=versions(db,String(row.task)).find(v=>v.version===row.version);
      return a?[{kind:row.kind,task:a.taskId,version:a.version,title:a.title,body:a.body,reason:a.decision?.reason}]:[];
    });
  }finally{db.close();}
}
