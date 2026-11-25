import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import {AUTOPILOT_HOP_LIMIT,cruisePolicy,defaultCruisePolicy,type CruiseMaterial,type CruisePolicy,type MorningCandidate} from "../types/autopilot";
import {readFeed,normalize,type HotItem} from "./aihot";
import {feishuMethods} from "./feishu";
import {articleStateInTransaction,ensureArticleTables} from "./article-store";
import {productionDb,entities} from "./production-db";
import {draftSchema,previewDraft,saveProductionDraft,submitBatch,type Entity,type ProductionDraft} from "./production";
import {cloudEnabled} from "./production-cloud";
import type {Flow} from "./collaboration";
import {reviewVisual} from "./review-visual";
import {reviewRoleLabels} from "./discussion-reader";
import {enqueueLedger} from "./feishu-ledger";
import {autopilotHopState} from "./autopilot-guard";
import {ensureFeishuResolutions,resolvedOnWeb,resolvedInWorkbench} from "./feishu-resolution";

const dayFormat=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
const timeFormat=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Shanghai",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
export const cruiseDay=(date=new Date())=>dayFormat.format(date);
const segmenter=new Intl.Segmenter("zh",{granularity:"word"});
const taskBudget={requests:32,tokens:20000};
const terminal=new Set(["待人工审核","受阻","失败","已停止"]);

interface Idea {key:string;title:string;text:string;hot?:HotItem;pin?:string;source?:string;origin?:string}
interface Plan {key:string;draft:ProductionDraft;hot?:HotItem;source?:string;material:CruiseMaterial}
interface Run {day:string;id:string;status:string;policy:string;changed:number;detail:string;plans:string}
function schema(db:DatabaseSync){
  ensureFeishuResolutions(db);
  db.exec("CREATE TABLE IF NOT EXISTS cruise_policy(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);"
    +"CREATE TABLE IF NOT EXISTS cruise_runs(day TEXT PRIMARY KEY,id TEXT UNIQUE,status TEXT,policy TEXT,changed INTEGER,detail TEXT,plans TEXT);"
    +"CREATE TABLE IF NOT EXISTS cruise_attempts(day TEXT,source_key TEXT,account TEXT,UNIQUE(source_key,account));"
    +"CREATE TABLE IF NOT EXISTS cruise_decisions(task TEXT,version INTEGER,decision TEXT,at TEXT,PRIMARY KEY(task,version));"
    +"CREATE TABLE IF NOT EXISTS cruise_reruns(task TEXT PRIMARY KEY,day TEXT,batch TEXT UNIQUE,plan TEXT,status TEXT);");
}
export function getCruisePolicy(db:DatabaseSync):CruisePolicy{
  schema(db);
  const row=db.prepare("SELECT payload FROM cruise_policy WHERE id=1").get();
  return row?cruisePolicy.parse(JSON.parse(String(row.payload))):defaultCruisePolicy;
}
export function saveCruisePolicy(input:unknown){
  const policy=cruisePolicy.parse(input),db=productionDb();
  try{schema(db);db.prepare("INSERT OR REPLACE INTO cruise_policy VALUES(1,?)").run(JSON.stringify(policy));return policy;}finally{db.close();}
}
function assertLocal(){
  if(cloudEnabled()||!/^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(process.env.STUDIO_MODEL_URL??"http://127.0.0.1:11434/"))
    throw Error("无人值守预生产仅使用回环地址的本机模型。");
  if(!process.env.STUDIO_MODEL)throw Error("请先配置本机模型。");
}
const fixture=[
  ["morning-pass","写作校样｜蓝笔改稿"],
  ["morning-low","写作校样｜会诊演练低分"],
  ["morning-blocked","写作校样｜核验演练硬阻断"],
];
async function ideas():Promise<{items:Idea[];detail:string}>{
  const demo=process.env.STUDIO_DEMO_INSTANCE==="1";
  const feed=demo?{error:"",items:normalize({items:fixture.map(([key,title])=>({title,summary:"虚构的写作改稿练习",links:{aihot:"https://example.invalid/"+key}}))})}:await readFeed("latest");
  const hot=feed.error?[]:feed.items.map(item=>({key:"hot:"+item.key,title:item.title,text:item.summary,hot:item,source:demo?"模拟热点":"AIHOT · "+item.source}));
  const methods=demo?[{key:"feishu-demo:paper",title:"写作校样｜纸角动作",text:"虚构飞书灵感：用动作表现犹豫。",pin:"scene-editing@1",source:"模拟飞书灵感"}]:
    feishuMethods().map(item=>({key:"feishu:"+item.id,title:item.title,text:item.method,pin:item.id+"@"+item.version,source:"已授权飞书写法参考",origin:item.source}));
  return {items:[...hot,...methods],detail:feed.error?"热点读取异常，未使用缓存；已继续检查本机授权飞书资料。":""};
}

export function selectCruisePlans(accounts:Entity[],items:Idea[],limit:number,used:Set<string>){
  const profiles=accounts.filter(account=>account.status==="启用"&&account.platform).map(account=>{
    const profile=[account.name,account.body,account.audience].join(" ").normalize("NFKC").toLowerCase();
    const terms=[...new Set([...segmenter.segment(profile)].filter(word=>word.isWordLike&&word.segment.length>=2).map(word=>word.segment))];
    const ranked=items.map(item=>{
      const source=(item.title+" "+item.text).normalize("NFKC").toLowerCase();
      return {item,score:terms.filter(term=>source.includes(term)).length*2+(item.pin&&account.sources.includes(item.pin)?4:0)};
    }).filter(row=>row.score>0&&!used.has(JSON.stringify([row.item.key,account.id]))).sort((a,b)=>b.score-a.score);
    return {account,ranked};
  });
  const plans:Plan[]=[],claimed=new Set<string>();
  while(plans.length<limit){
    const before=plans.length;
    for(const {account,ranked} of profiles){
      if(plans.length>=limit)break;
      const found=ranked.find(({item})=>!claimed.has(item.key));
      if(!found)continue;
      const item=found.item;claimed.add(item.key);
      const material:CruiseMaterial={id:item.key,title:item.title.slice(0,240),text:item.text.slice(0,8000),
        source:item.hot?.original||item.hot?.canonical||item.origin||item.source||"",type:item.pin?"writing-reference":"hot-topic",reference:item.pin};
      plans.push({key:item.key,hot:item.hot,source:item.source,material,draft:draftSchema.parse({
        id:randomUUID(),version:0,intent:"queued",topic:item.title.slice(0,240),account:account.id,platform:account.platform,kind:"图文",
        budgetProfile:"local_extended",sources:[...new Set([...account.sources,...(item.pin?[item.pin]:[])])],
        requirements:item.pin?"飞书资料仅供写法与选题参考，涉及业务事实须核验。":"热点仅作选题线索，依据可核实材料创作，无法确认的信息须保留为待核验。",
      })});
    }
    if(plans.length===before)break;
  }
  return plans;
}
function submitPrepared(batch:string,plans:Plan[],parent?:string){
  assertLocal();
  const db=productionDb();
  let drafts:ProductionDraft[];
  try{
    if(db.prepare("SELECT 1 FROM production_batches WHERE id=?").get(batch))return;
    drafts=plans.map(({draft,hot})=>{
      const row=db.prepare("SELECT payload FROM production_drafts WHERE id=?").get(draft.id);
      if(row){
        const saved=draftSchema.parse(JSON.parse(String(row.payload)));
        if(saved.version!==1||saved.account!==draft.account||saved.topic!==draft.topic||saved.intent!=="queued")
          throw Error("待巡航需求曾被修改，请核对草稿。");
        return saved;
      }
      return saveProductionDraft(draft,hot);
    });
  }finally{db.close();}
  submitBatch({id:batch,drafts,preview:drafts.map(previewDraft),tokenLimit:taskBudget.tokens*plans.length,requestLimit:taskBudget.requests*plans.length,
    autopilot:{parent,materials:new Map(plans.map(plan=>[plan.draft.id,plan.material]))}});
}

let scanning=false;
export async function runCruise(now=new Date(),manual=false){
  const day=cruiseDay(now),db=productionDb();
  try{
    const policy=getCruisePolicy(db);
    if(!manual&&(!policy.enabled||timeFormat.format(now)<policy.time))return;
    assertLocal();
    if(scanning)return;
    scanning=true;
    try{
      db.exec("BEGIN IMMEDIATE");
      let run=db.prepare("SELECT * FROM cruise_runs WHERE day=?").get(day) as unknown as Run|undefined;
      const savedPlans=run?.plans&&run.plans!=="[]";
      if(run&&(run.status==="submitted"||run.status==="empty"&&!manual||run.status==="planning"&&Date.now()-run.changed<60000)){
        db.exec("COMMIT");return;
      }
      if(!run){
        run={day,id:randomUUID(),status:"planning",policy:JSON.stringify(policy),changed:Date.now(),detail:"",plans:"[]"};
        db.prepare("INSERT INTO cruise_runs VALUES(?,?,?,?,?,?,?)").run(day,run.id,run.status,run.policy,run.changed,run.detail,run.plans);
      }else db.prepare("UPDATE cruise_runs SET status=?,changed=? WHERE day=?").run(savedPlans?"prepared":"planning",Date.now(),day);
      db.exec("COMMIT");
      try{
        const config=cruisePolicy.parse(JSON.parse(run.policy));
        const max=Math.min(config.maxTasks,Math.floor(config.requestLimit/taskBudget.requests),Math.floor(config.tokenLimit/taskBudget.tokens));
        const intake=savedPlans?null:await ideas();
        const used=new Set(db.prepare("SELECT source_key,account FROM cruise_attempts").all().map(row=>JSON.stringify([row.source_key,row.account])));
        const plans:Plan[]=intake?selectCruisePlans(entities(db,"account") as Entity[],intake.items,max,used):JSON.parse(run.plans);
        const detail=intake?.detail??run.detail;
        if(!plans.length){
          db.prepare("UPDATE cruise_runs SET status='empty',detail=? WHERE day=?").run(detail||"没有符合启用账号画像的未处理来源。",day);
          return;
        }
        db.prepare("UPDATE cruise_runs SET status='prepared',plans=?,detail=? WHERE day=?").run(JSON.stringify(plans),detail,day);
        submitPrepared(run.id,plans);
        db.exec("BEGIN IMMEDIATE");
        for(const plan of plans)db.prepare("INSERT OR IGNORE INTO cruise_attempts VALUES(?,?,?)").run(day,plan.key,plan.draft.account);
        db.prepare("UPDATE cruise_runs SET status='submitted',changed=? WHERE day=?").run(Date.now(),day);
        db.exec("COMMIT");
      }catch(error){
        if(db.isTransaction)db.exec("ROLLBACK");
        db.prepare("UPDATE cruise_runs SET status='failed',detail=?,changed=? WHERE day=? AND status<>'submitted'").run(error instanceof Error?error.message:"巡航未完成",Date.now(),day);
      }
    }finally{scanning=false;}
  }finally{db.close();}
}
function readCandidate(db:DatabaseSync,taskId:string,minScore:number){
  ensureArticleTables(db);
  const row=db.prepare("SELECT q.status,q.reason,f.payload,v.payload AS task FROM production_queue q LEFT JOIN collaboration f ON f.task=q.task JOIN versions v ON v.id=q.task WHERE q.task=? ORDER BY v.rev DESC LIMIT 1").get(taskId);
  if(!row)return {reason:"暂无队列记录"};
  if(autopilotHopState(db,taskId)?.fused)return {reason:String(row.reason)};
  if(!terminal.has(String(row.status)))return {reason:"等待生成或专业审核"};
  const snapshot=JSON.parse(String(row.task));
  const panel=(row.payload?JSON.parse(String(row.payload)) as Flow:null)?.panels?.at(-1);
  if(!snapshot.article||!panel||panel.phase!=="complete"||!panel.reviews.length)return {reason:String(row.reason||"未完成审核")};
  const article=articleStateInTransaction(db,taskId);
  if(resolvedOnWeb(db,taskId,panel.articleVersion))return {reason:resolvedInWorkbench};
  if(article.head.version!==panel.articleVersion||article.head.confirmed)return {reason:"母稿已改变或已经定稿"};
  if(article.draft&&(article.draft.title!==article.head.title||JSON.stringify(article.draft.document)!==JSON.stringify(article.head.document)))
    return {reason:"存在未定稿的修改"};
  const visual=reviewVisual(article.head.version,panel,undefined,new Set());
  const score=Math.round(visual.experts.reduce((n,e)=>n+e.score,0)/visual.experts.length);
  if(row.status==="失败"||row.status==="已停止"||panel.reviews.some(review=>review.result.status==="blocked"||review.result.issues.some(issue=>issue.type==="安全"&&issue.severity==="严重")||
    review.result.facts.checks.some(check=>check.status!=="来源原文匹配")||review.result.facts.requestTriggered&&!review.result.facts.checks.length)||
    panel.reviews.some(review=>review.opinions.some(opinion=>opinion.blocking))||
    panel.status!=="pass"&&!(panel.status==="human"&&panel.verdict?.decisions.some(decision=>decision.action==="human")))
    return {score,reason:"存在硬阻断、未核事实或审核未就绪"};
  if(score<minScore)return {score,reason:"低于 "+minScore+" 分"};
  const body=article.head.body.split(/^## 正文\s*$/m).at(-1)?.split(/^## /m)[0]?.trim()||article.head.body;
  const candidate:MorningCandidate={taskId,articleVersion:article.head.version,draftRevision:article.draft?.revision??0,reviewId:panel.id,
    title:article.head.title,account:snapshot.input.production?.accountName??"未归属",summary:body.replace(/\s+/g," ").slice(0,150),score,
    disagreements:visual.conflicts.slice(0,3).map(group=>{
      const quote=group.options[0]?.anchor.quote.slice(0,40)??"";
      const alternatives=group.options.slice(0,3).map(option=>(option.role==="basic"?"基础检查":reviewRoleLabels[option.role])+
        (option.action==="retain"?"主张保留":option.action==="delete"?"主张删除":"建议改为「"+option.text.slice(0,45)+"」"));
      return "「"+quote+"」"+alternatives.join("、");
    })};
  return {score,reason:"待翻牌",candidate};
}

export function morning(db:DatabaseSync,day=cruiseDay()){
  schema(db);
  const run=db.prepare("SELECT * FROM cruise_runs WHERE day=?").get(day) as unknown as Run|undefined;
  if(!run)return {run:null,items:[]};
  const policy=cruisePolicy.parse(JSON.parse(run.policy));
  const plans:Plan[]=JSON.parse(run.plans);
  const jobs=db.prepare(`SELECT q.task,q.status,q.batch,json_extract(v.payload,'$.input.production.draftId') AS draft
    FROM production_queue q JOIN versions v ON v.id=q.task AND v.rev=0
    WHERE q.batch=? OR q.batch IN (SELECT batch FROM cruise_reruns WHERE day=?) ORDER BY q.batch,q.position`).all(run.id,day);
  const items=jobs.map(row=>{
    const id=String(row.task),result=readCandidate(db,id,policy.minScore);
    const decision=db.prepare("SELECT decision,version FROM cruise_decisions WHERE task=? ORDER BY version DESC LIMIT 1").get(id);
    const rerun=row.batch===run.id?null:db.prepare("SELECT plan FROM cruise_reruns WHERE batch=?").get(row.batch);
    const plan:Plan|undefined=rerun?JSON.parse(String(rerun.plan)):plans.find(plan=>plan.draft.id===row.draft);
    return {taskId:id,title:result.candidate?.title??plan?.draft.topic??"未命名稿件",status:String(row.status),source:plan?.source??"",
      hopCount:autopilotHopState(db,id)?.hopCount??0,...result,decision:decision?{action:String(decision.decision),version:Number(decision.version)}:null};
  });
  return {run:{day,id:run.id,status:run.status,detail:run.detail,policy},items};
}
export function morningBinding(candidate:MorningCandidate){
  return createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
}
export function currentMorningCandidate(db:DatabaseSync,day:string,taskId:string){
  return morning(db,day).items.find(row=>row.taskId===taskId&&!row.decision)?.candidate;
}
export function rerunAvailable(db:DatabaseSync,day:string,taskId:string){
  const run=db.prepare("SELECT * FROM cruise_runs WHERE day=?").get(day) as unknown as Run|undefined;
  if(!run||!db.prepare("SELECT 1 FROM production_queue WHERE task=? AND batch=?").get(taskId,run.id)||
    (autopilotHopState(db,taskId)?.hopCount??0)>=AUTOPILOT_HOP_LIMIT||db.prepare("SELECT 1 FROM cruise_reruns WHERE task=?").get(taskId))return false;
  const config=cruisePolicy.parse(JSON.parse(run.policy)),plans:Plan[]=JSON.parse(run.plans);
  const count=Number(db.prepare("SELECT COUNT(*) AS n FROM cruise_reruns WHERE day=?").get(day)?.n);
  const projected=plans.length+count+1;
  return projected*taskBudget.requests<=config.requestLimit&&projected*taskBudget.tokens<=config.tokenLimit;
}
export function decideMorning(db:DatabaseSync,day:string,candidate:MorningCandidate,decision:"approve"|"rerun"){
  if(!db.isTransaction)throw Error("早报决定须在事务内记录");
  if(decision==="approve")enqueueLedger(db,candidate.taskId,candidate.articleVersion);
  else{
    assertLocal();
    if(!rerunAvailable(db,day,candidate.taskId))throw Error("本日重跑预算不足，或此稿已经是重跑结果。");
    const run=db.prepare("SELECT id,plans FROM cruise_runs WHERE day=?").get(day)!;
    const original=db.prepare("SELECT json_extract(payload,'$.input.production.draftId') AS draft FROM versions WHERE id=? AND rev=0").get(candidate.taskId);
    const plans:Plan[]=JSON.parse(String(run.plans));
    const plan=plans.find(plan=>plan.draft.id===original?.draft);
    if(!plan)throw Error("找不到原巡航计划。");
    db.prepare("INSERT INTO cruise_reruns VALUES(?,?,?,?,?)").run(candidate.taskId,day,randomUUID(),
      JSON.stringify({...plan,draft:{...plan.draft,id:randomUUID(),version:0,experiment:"作者已打回重跑"}}),"pending");
  }
  db.prepare("INSERT INTO cruise_decisions VALUES(?,?,?,?)").run(candidate.taskId,candidate.articleVersion,decision,new Date().toISOString());
  return decision==="approve"?"已通过，可在工作台分发此版。":"已登记重跑，等待投入生产队列。";
}
export function dispatchCruiseReruns(){
  const db=productionDb();
  try{
    schema(db);
    for(const row of db.prepare("SELECT * FROM cruise_reruns WHERE status='pending'").all()){
      try{submitPrepared(String(row.batch),[JSON.parse(String(row.plan))],String(row.task));db.prepare("UPDATE cruise_reruns SET status='submitted' WHERE task=?").run(row.task);}
      catch(error){db.prepare("UPDATE cruise_reruns SET status=? WHERE task=? AND status='pending'").run("失败："+(error instanceof Error?error.message:"请检查生产队列"),row.task);}
    }
  }finally{db.close();}
}
