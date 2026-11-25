import {createHash,randomUUID} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {ArticleState} from "./article-store";
import type {Flow} from "./collaboration";
import {reviewVisual} from "./review-visual";
import {entities} from "./production-db";
import type {Entity} from "./production";
import type {BlindPrediction,CalibrationCheck,Metrics,Retro,RubricBumpProposal,RubricFocus,VersionKey} from "../types/calibration";

const waitMs=72*60*60*1000;
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
type Publication=VersionKey & {publishedAt:string;dueAt:string;demoWake:boolean};
export function calibrationTables(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS cal_predictions(task TEXT,version INTEGER,account TEXT,payload TEXT NOT NULL,PRIMARY KEY(task,version));
    CREATE INDEX IF NOT EXISTS cal_predictions_account ON cal_predictions(account);
    CREATE TABLE IF NOT EXISTS cal_publications(task TEXT,version INTEGER,published TEXT,due TEXT,PRIMARY KEY(task,version));
    CREATE TABLE IF NOT EXISTS cal_retro(id TEXT PRIMARY KEY,task TEXT,version INTEGER,payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS cal_retro_version ON cal_retro(task,version);
    CREATE TABLE IF NOT EXISTS cal_demo_wake(task TEXT,version INTEGER,PRIMARY KEY(task,version));
    CREATE TABLE IF NOT EXISTS cal_proposals(id TEXT PRIMARY KEY,account TEXT,payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cal_applied(id TEXT PRIMARY KEY,version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS cal_bricks(id TEXT,version INTEGER,account TEXT,fingerprint TEXT UNIQUE,payload TEXT NOT NULL,PRIMARY KEY(id,version));`);
  for(const table of ["cal_predictions","cal_publications","cal_retro","cal_bricks","cal_proposals"]){
    for(const action of ["UPDATE","DELETE"])db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_no_${action.toLowerCase()}
      BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'append only'); END;`);
  }
  db.exec(`CREATE TRIGGER IF NOT EXISTS cal_predictions_no_replace BEFORE INSERT ON cal_predictions
    WHEN EXISTS(SELECT 1 FROM cal_predictions WHERE task=NEW.task AND version=NEW.version)
    BEGIN SELECT RAISE(ABORT,'append only'); END;
    CREATE TRIGGER IF NOT EXISTS cal_retro_no_replace BEFORE INSERT ON cal_retro
    WHEN EXISTS(SELECT 1 FROM cal_retro WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'append only'); END;
    CREATE TRIGGER IF NOT EXISTS cal_publications_no_replace BEFORE INSERT ON cal_publications
    WHEN EXISTS(SELECT 1 FROM cal_publications WHERE task=NEW.task AND version=NEW.version)
    BEGIN SELECT RAISE(ABORT,'append only'); END;`);
}
function table(db:DatabaseSync,name:string){return !!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name);}
export function getPrediction(db:DatabaseSync,{task,version}:VersionKey):BlindPrediction|null{
  const row=db.prepare("SELECT payload FROM cal_predictions WHERE task=? AND version=?").get(task,version);
  return row?JSON.parse(String(row.payload)):null;
}
export function getPublication(db:DatabaseSync,{task,version}:VersionKey):Publication|null{
  const row=db.prepare(`SELECT published,due,EXISTS(SELECT 1 FROM cal_demo_wake w WHERE w.task=p.task AND w.version=p.version) AS wake
    FROM cal_publications p WHERE task=? AND version=?`).get(task,version);
  return row?{task,version,publishedAt:String(row.published),dueAt:String(row.due),demoWake:!!row.wake}:null;
}
export function getRetros(db:DatabaseSync,{task,version}:VersionKey):Retro[]{
  return db.prepare("SELECT payload FROM cal_retro WHERE task=? AND version=? ORDER BY rowid").all(task,version).map(row=>JSON.parse(String(row.payload)));
}
export function taskAccount(db:DatabaseSync,task:string){
  return String(db.prepare("SELECT json_extract(payload,'$.input.production.account') AS account FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1").get(task)?.account??"");
}
export function lockPrediction(db:DatabaseSync,key:VersionKey,state:ArticleState,at=new Date()){
  if(!db.isTransaction)throw Error("预测须与正式版本一起锁定");
  calibrationTables(db);
  const existing=getPrediction(db,key);
  if(existing)return {prediction:existing,reason:""};
  const blocked=(reason:string)=>({prediction:null,reason});
  if(getPublication(db,key)||table(db,"content_destinations")&&db.prepare("SELECT 1 FROM content_destinations WHERE id=? AND version=? AND status='已发布'").get(key.task,key.version))
    return blocked("该版本已登记发布，不能补做盲预测。");
  const account=taskAccount(db,key.task);
  const snapshot=state.versions.find(row=>row.version===key.version);
  if(!account||!snapshot)return blocked("需要有归属账号的正式稿件。");
  const snap=table(db,"collaboration")?db.prepare("SELECT payload FROM collaboration WHERE task=?").get(key.task):null;
  const flow:Flow|null=snap?JSON.parse(String(snap.payload)):null;
  const ancestors=new Set([key.version]);
  let parent=snapshot.parentVersion;
  while(parent&&!ancestors.has(parent)){ancestors.add(parent);parent=state.versions.find(row=>row.version===parent)?.parentVersion;}
  const panel=flow?.panels?.findLast(row=>row.articleVersion===key.version&&row.phase==="complete"&&row.reviews.length>=2)
    ??flow?.panels?.findLast(row=>ancestors.has(row.articleVersion)&&row.phase==="complete"&&row.reviews.length>=2);
  if(!panel)return blocked("没有完成的多角色会诊，本版暂不能锁定盲预测。");
  const visual=reviewVisual(panel.articleVersion,panel,undefined,new Set());
  const score=Math.round(visual.experts.reduce((sum,r)=>sum+r.score,0)/visual.experts.length);
  const level=score>=90?"高潜":score>=80?"稳定":"试探";
  const reach:[number,number]=level==="高潜"?[1000,4000]:level==="稳定"?[300,1000]:[0,300];
  const ranges={reach,likes:[Math.floor(reach[0]*.02),Math.ceil(reach[1]*.08)],saves:[0,Math.ceil(reach[1]*.04)],
    comments:[0,Math.ceil(reach[1]*.02)],conversions:[0,Math.ceil(reach[1]*.01)]} as BlindPrediction["ranges"];
  const raw=state.versions.findLast(row=>row.origin==="model"&&row.version<=key.version);
  const rubric=table(db,"production_entities")?entities(db,"rule").find(row=>row.id===rubricId(account)):null;
  const taskRow=db.prepare("SELECT payload FROM versions WHERE id=? AND rev=?").get(key.task,snapshot.sourceTaskRevision);
  const rules:(BlindPrediction["rules"])=taskRow?JSON.parse(String(taskRow.payload)).input.production?.rules??[]:[];
  const prediction:BlindPrediction={...key,account,title:snapshot.title,body:snapshot.body,initialVersion:raw?.version??0,lockedAt:at.toISOString(),
    level,score,bet:visual.experts.find(row=>row.role==="strategy")?.observation||panel.reason||"检验当前选题与正文表达的匹配度",
    ranges,reviewId:panel.id,reviewVersion:panel.articleVersion,rubricVersion:rubric?.version??0,rules:rules.map(({id,version})=>({id,version}))};
  db.prepare("INSERT INTO cal_predictions VALUES(?,?,?,?)").run(key.task,key.version,account,JSON.stringify(prediction));
  return {prediction,reason:""};
}

export function registerPublication(db:DatabaseSync,key:VersionKey,declared?:string,day="",now=new Date()){
  if(!db.isTransaction)throw Error("发布事件须在事务中保存");
  calibrationTables(db);
  const existing=getPublication(db,key);
  if(existing)return existing;
  if(!declared&&getPrediction(db,key))throw Error("已有盲预测，请填写实际发布时间以核对先后顺序");
  const instant=declared??(day?day+"T00:00:00+08:00":now.toISOString());
  const ms=Date.parse(instant);
  if(!Number.isFinite(ms)||ms>now.getTime())throw Error("实际发布时间不能晚于现在");
  if(declared&&day&&today.format(new Date(ms))!==day)throw Error("实际发布时间与发布登记日期不同");
  const publishedAt=new Date(ms).toISOString(),dueAt=new Date(ms+waitMs).toISOString();
  db.prepare("INSERT INTO cal_publications VALUES(?,?,?,?)").run(key.task,key.version,publishedAt,dueAt);
  return {...key,publishedAt,dueAt,demoWake:false};
}
export function effectiveDue(publication:Publication){return publication.demoWake&&process.env.STUDIO_DEMO_INSTANCE==="1"?publication.publishedAt:publication.dueAt;}
export function duePublications(db:DatabaseSync,now=new Date()){
  calibrationTables(db);
  return db.prepare(`SELECT p.task,p.version,c.payload FROM cal_publications p JOIN cal_predictions c USING(task,version)
    WHERE c.payload IS NOT NULL AND (p.due<=? OR (?=1 AND EXISTS(SELECT 1 FROM cal_demo_wake w WHERE w.task=p.task AND w.version=p.version)))
    AND NOT EXISTS(SELECT 1 FROM cal_retro r WHERE r.task=p.task AND r.version=p.version)`)
    .all(now.toISOString(),process.env.STUDIO_DEMO_INSTANCE==="1"?1:0)
    .map(row=>({task:String(row.task),version:Number(row.version),prediction:JSON.parse(String(row.payload)) as BlindPrediction}))
    .filter(row=>Date.parse(row.prediction.lockedAt)<Date.parse(getPublication(db,row)!.publishedAt));
}
export function appendRetro(db:DatabaseSync,key:VersionKey,state:ArticleState,value:Metrics,source:string,observedAt:string,now=new Date()){
  if(!db.isTransaction)throw Error("复盘须在事务中登记");
  const prediction=getPrediction(db,key),publication=getPublication(db,key);
  if(!prediction||!publication||Date.parse(prediction.lockedAt)>=Date.parse(publication.publishedAt))
    throw Error("没有在实际发布前锁定的同版预测，不能进入校准样本池");
  const observed=Date.parse(observedAt);
  const previous=getRetros(db,key).at(-1);
  if(!Number.isFinite(observed)||observed<Date.parse(effectiveDue(publication))||observed>now.getTime()||observed<=Date.parse(prediction.lockedAt)||
    previous&&observed<Date.parse(previous.observedAt))throw Error("实绩观测须在发布满 72 小时后且不能早于上次观测");
  const reachDelta=value.reach-prediction.ranges.reach[1];
  const initial=state.versions.find(row=>row.version===prediction.initialVersion);
  const before=initial?.body??"",after=prediction.body;
  const diff=editDiff(before,after);
  const outside=(["likes","saves","comments","conversions"] as const).filter(metric=>value[metric]<prediction.ranges[metric][0]||value[metric]>prediction.ranges[metric][1]);
  const retro:Retro={...key,id:randomUUID(),source,metrics:value,observedAt:new Date(observed).toISOString(),addedAt:now.toISOString(),
    reachDelta,beat:reachDelta>0,authorDiff:diff,
    attribution:(reachDelta>0?"流量高于预测上界":value.reach<prediction.ranges.reach[0]?"流量低于预测下界":"流量位于预测区间")+
      (outside.length?"，互动偏离项："+outside.map(k=>({likes:"赞",saves:"藏",comments:"评论",conversions:"转化"}[k])).join("、"):"，互动位于预测区间")+
      (initial&&before!==after?"。保留初稿到该版的改动供复核。":"。暂无可归因的正文改动记录。")};
  db.prepare("INSERT INTO cal_retro VALUES(?,?,?,?)").run(retro.id,key.task,key.version,JSON.stringify(retro));
  return retro;
}
function editDiff(before:string,after:string){
  if(before===after)return {before:"",after:""};
  const a=before.split("\n"),b=after.split("\n");
  let start=0,end=0;
  while(start<Math.min(a.length,b.length)&&a[start]===b[start])start++;
  while(end<Math.min(a.length,b.length)-start&&a.at(-1-end)===b.at(-1-end))end++;
  return {before:a.slice(start,a.length-end).join("\n").slice(0,1800),after:b.slice(start,b.length-end).join("\n").slice(0,1800)};
}
export function samplePool(db:DatabaseSync,account:string){
  const rows=db.prepare(`SELECT p.payload,r.payload AS retro FROM cal_predictions p JOIN cal_retro r USING(task,version)
    WHERE p.account=? ORDER BY p.version DESC,r.rowid DESC`).all(account);
  const unique=new Map<string,{prediction:BlindPrediction;retro:Retro}>();
  for(const row of rows){
    const prediction:BlindPrediction=JSON.parse(String(row.payload));
    if(!unique.has(prediction.task))unique.set(prediction.task,{prediction,retro:JSON.parse(String(row.retro))});
  }
  return [...unique.values()].sort((a,b)=>a.prediction.task.localeCompare(b.prediction.task));
}
export function rubricScore(text:{title:string;body:string},focus:RubricFocus){
  const body=text.body.replace(/^##\s.+$/gm,""),lines=body.split(/\n+/).map(row=>row.trim()).filter(Boolean);
  if(focus==="结构")return Math.min(100,lines.filter(row=>/^(?:第[一二三四五六七八九十\d]+步|步骤\s*\d+|\d+[.、])/.test(row)).length*10);
  if(focus==="互动引导")return Math.min(100,[...body.matchAll(/(?:欢迎评论|留言|告诉我|试试看|收藏|写下来)/g)].length*10);
  return Math.min(100,[...body.matchAll(/(?:具体|例如|比如|记录|比较|观察|毫米|分钟)/g)].length*10);
}
export function checkRubric(pool:ReturnType<typeof samplePool>,focus:RubricFocus):CalibrationCheck{
  const samples=pool.map(({prediction,retro})=>({task:prediction.task,version:prediction.version,title:prediction.title,
    score:rubricScore({title:prediction.title,body:prediction.body},focus),reach:retro.metrics.reach}));
  const conflicts:CalibrationCheck["conflicts"]=[];
  let aligned=0,comparable=0;
  for(let i=0;i<samples.length;i++)for(let j=i+1;j<samples.length;j++){
    const a=samples[i],b=samples[j];
    if(a.reach===b.reach)continue;
    comparable++;
    const [higher,lower]=a.reach>b.reach?[a,b]:[b,a];
    if(higher.score>lower.score)aligned++;
    else conflicts.push({higher:higher.title,lower:lower.title,reason:higher.score===lower.score?"规则分并列":"规则排序与实绩相反"});
  }
  return {focus,samples,comparable,aligned,agreement:comparable?aligned/comparable:null,passed:samples.length>=5&&comparable>0&&aligned*5>=comparable*4,conflicts};
}
const rubricId=(account:string)=>"cal-"+digest(account).slice(0,32);
function ruleContext(db:DatabaseSync,account:string){
  const row:Entity|undefined=entities(db,"account").find(row=>row.id===account);
  if(!row||row.status!=="启用")throw Error("请先选择启用账号");
  const rules:Entity[]=entities(db,"rule").filter(rule=>!rule.account||rule.account===account);
  const prior=rules.find(rule=>rule.id===rubricId(account));
  return {row,rules,prior};
}
function fingerprint(pool:ReturnType<typeof samplePool>,config:ReturnType<typeof ruleContext>){
  return digest([pool.map(item=>[item.prediction.task,item.prediction.version,item.retro.id]),config.row.version,
    config.rules.map(rule=>[rule.id,rule.version]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
}
export function createProposal(db:DatabaseSync,account:string,focus:RubricFocus){
  const config=ruleContext(db,account),pool=samplePool(db,account),check=checkRubric(pool,focus);
  const best=pool.filter(({retro})=>retro.beat&&retro.authorDiff.after).sort((a,b)=>b.retro.reachDelta-a.retro.reachDelta)[0];
  const reason=best?"以「"+best.prediction.title+"」的复盘偏差与作者改动为提案依据。"+best.retro.attribution+" 改动："+best.retro.authorDiff.after.slice(0,300)
    :"暂无跑赢预测且有改动的样本。此提案记录为表达维度备选，等待历史校验。";
  const proposal:RubricBumpProposal={...check,id:randomUUID(),account,fingerprint:fingerprint(pool,config),createdAt:new Date().toISOString(),reason};
  db.prepare("INSERT INTO cal_proposals VALUES(?,?,?)").run(proposal.id,account,JSON.stringify(proposal));
  return proposal;
}
export function proposals(db:DatabaseSync,account:string):RubricBumpProposal[]{
  return db.prepare(`SELECT p.payload,a.version FROM cal_proposals p LEFT JOIN cal_applied a USING(id)
    WHERE p.account=? ORDER BY p.rowid DESC LIMIT 30`).all(account).map(row=>({...JSON.parse(String(row.payload)),appliedVersion:row.version??undefined}));
}
export function mergeableProposals(db:DatabaseSync,account:string){
  if(!entities(db,"account").some(row=>row.id===account&&row.status==="启用"))return [];
  const current=fingerprint(samplePool(db,account),ruleContext(db,account));
  return proposals(db,account).filter(row=>row.passed&&!row.appliedVersion&&row.fingerprint===current);
}
export function applyProposal(db:DatabaseSync,account:string,id:string){
  if(!db.isTransaction)throw Error("规则须在事务中合并");
  const row=db.prepare("SELECT payload FROM cal_proposals WHERE id=? AND account=?").get(id,account);
  if(!row)throw Error("提案不存在");
  const priorApply=db.prepare("SELECT version FROM cal_applied WHERE id=?").get(id);
  if(priorApply)return Number(priorApply.version);
  const proposal:RubricBumpProposal=JSON.parse(String(row.payload));
  const config=ruleContext(db,account),pool=samplePool(db,account);
  if(fingerprint(pool,config)!==proposal.fingerprint)throw Error("历史池或活跃规则已变化，请重新重打");
  if(!checkRubric(pool,proposal.focus).passed)throw Error("排序一致率低于 80% 或有效样本不足，规则未合并");
  const version=(config.prior?.version??0)+1;
  const description:Record<RubricFocus,string>={"结构":"每个步骤写明动作和产出，按执行顺序组织段落。","具体表达":"用可观察细节和明确的比较替换抽象评价。","互动引导":"提供与正文任务相符且读者可执行的下一步。"};
  const rule:Entity={id:rubricId(account),version,brand:"default",name:"校准 · "+proposal.focus,body:description[proposal.focus],
    account,status:"启用",platform:"",audience:"",type:"",goal:"",sources:[],rules:[],hard:false,constraintKey:"",constraintValue:""};
  db.prepare("INSERT INTO production_entities VALUES('rule',?,?,?)").run(rule.id,version,JSON.stringify(rule));
  db.prepare("INSERT INTO cal_applied VALUES(?,?)").run(id,version);
  return version;
}
