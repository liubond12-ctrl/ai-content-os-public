import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import type {Task} from "./tasks";
import {articleForReview} from "./article-store";
import {localProvider} from "./provider";
import {callsFor,BudgetError} from "./usage";
import {SafetyError,reviewSources} from "./safe-demo";
import {blindSample,developmentCalibration,evaluations} from "./library";
import {ReviewError} from "./review-error";
import {isWritingConstraintQuote} from "./fact-claims";
import {autopilotModelInput} from "./autopilot-guard";

const dimensions=["内容策略","表达质量","内容结构","基础规范"] as const;
const label=z.enum(["优秀","普通","不合格"]);
const location=z.object({field:z.enum(["title","body"]),quote:z.string().min(1),offset:z.number().int().default(-1),before:z.string().min(1).optional(),after:z.string().min(1).optional()});
export const assessment=z.object({
  label,disputed:z.boolean(),
  dimensions:z.object(Object.fromEntries(dimensions.map(d=>[d,z.string().trim().min(1)])) as Record<typeof dimensions[number],z.ZodString>),
  issues:z.array(location.extend({type:z.enum(["策略","表达","结构","规范","安全"]),severity:z.enum(["轻微","明显","严重"]),reason:z.string().min(1),suggestion:z.string().min(1)})).max(20),
  claims:z.array(location.extend({critical:z.boolean(),sourceId:z.string().nullable()})).max(20)
});
import {instruction,demoSubject,evalPreview} from "./eval-demo";
type Source={id:string;text:string;kind:string;verified:boolean;current:boolean;applicableDate:string};
type Subject={task:Task;version:number;title:string;body:string;request:object;sources:Source[];caseId?:string};

export function articleSubject(id:string,version:number):Subject{
  const task=articleForReview(id,version);
  if(!task?.article || task.article.version!==version)throw Error("文章版本不存在");
  if(task.article.researchVersion!==task.research?.version)throw Error("文章研究依赖不一致");
  const sources=reviewSources(task);
  return {task,version,title:task.article.title,body:task.article.body,request:autopilotModelInput(task.input),sources};
}
function caseSubject(id:string,version:number):Subject{
  const sample=blindSample(id,version);
  if(!sample)throw Error("盲测样本不存在或版本已变化");
  const task:Task={id:"benchmark:"+id,revision:version,records:[],stage:"done",input:{
    persona:"general",topic:sample.goal??"内容质量评估",audience:"",reference:"",mode:"keyword",format:sample.format??undefined}};
  return {task,version,caseId:id,title:"",body:sample.content,request:{goal:sample.goal,format:sample.format},sources:[]};
}
const policyPattern=/(?:报名(?:日期|时间|费|截止)|官方费用|资格条件|升学政策|考纲|赛事规则|报名.{0,12}\d|考试.{0,12}(?:日期|费用|资格)|(?:比赛|竞赛|考试|报名|费用|资格|政策|GESP|CSP).{0,35}(?:\d+月\d+日|\d+元|必须|仅限)|(?:\d+月\d+日|\d+元).{0,25}(?:考试|报名|比赛))/i;
const assertionPattern=/\d|[一二三四五六七八九十]+月|免费|必须|不得|仅限|要求|统一为|只允许|取消|免试|改为|公布为/;
type Claim=z.infer<typeof assessment>["claims"][number];
export function finalize(s:Subject,raw:unknown,localClaims:Claim[]=[]){
  const parsed=assessment.safeParse(raw);
  if(!parsed.success)throw new ReviewError("assessment_schema","SCHEMA_VALIDATION_ERROR",parsed.error.issues[0].path.join(".")||"$");
  const ai=parsed.data;
  const locations:Array<{group:string;index:number;reported:number;resolved:number}>=[];
  for(const group of ["issues","claims"] as const){
    for(const [i,item] of ai[group].entries()){
      const original=s[item.field];
      const first=original.indexOf(item.quote);
      if(first<0)throw new ReviewError("location","QUOTE_NOT_FOUND",group+"."+i+".quote");
      let resolved=-1;
      for(let at=first;at>=0;at=original.indexOf(item.quote,at+1)){
        if(item.before&&!original.slice(0,at).endsWith(item.before))continue;
        if(item.after&&!original.startsWith(item.after,at+item.quote.length))continue;
        if(resolved>=0)throw new ReviewError("location","AMBIGUOUS_QUOTE",group+"."+i+".quote");
        resolved=at;
      }
      if(resolved<0)throw new ReviewError("location","CONTEXT_MISMATCH",group+"."+i+".quote");
      locations.push({group,index:i,reported:item.offset,resolved});
      item.offset=resolved;
    }
  }
  const claims=ai.claims.filter(c=>!isWritingConstraintQuote(s[c.field],c.offset,c.quote));
  for(const claim of localClaims){
    if(!claims.some(c=>c.field===claim.field&&c.offset<=claim.offset&&
      c.offset+c.quote.length>=claim.offset+claim.quote.length))claims.push(claim);
  }
  // Missing model detections cannot waive a concrete policy/date statement.
  for(const field of ["title","body"] as const){
    for(const m of s[field].matchAll(/[^。！？\n]+/gu)){
      if(policyPattern.test(m[0]) && assertionPattern.test(m[0]) &&
        !claims.some(c=>c.field===field && c.offset===m.index && c.quote===m[0]))
        claims.push({field,quote:m[0],offset:m.index,critical:true,sourceId:null});
    }
  }
  const checks=claims.map(c=>{
    const source=s.sources.find(h=>(c.sourceId===null||h.id===c.sourceId) && h.kind==="fact-reference" && h.verified && h.current &&
      h.applicableDate && h.applicableDate!=="unknown" && h.text.includes(c.quote));
    return {...c,sourceId:source?.id??c.sourceId,critical:c.critical||policyPattern.test(c.quote),status:source?"来源原文匹配":"待核验",applicableDate:source?.applicableDate};
  });
  const requestClaims=Object.entries(s.request).flatMap(([field,value])=>typeof value==="string"?
    Array.from(value.matchAll(/[^。！？\n]+/gu)).filter(m=>policyPattern.test(m[0])).map(m=>({field,offset:m.index,quote:m[0]})):[]);
  const requestTriggered=requestClaims.length>0;
  const pending=checks.filter(c=>c.status==="待核验");
  const status=pending.some(c=>c.critical)||ai.issues.some(i=>i.type==="安全" && i.severity==="严重")?"blocked":
    pending.length||ai.disputed||(requestTriggered&&!checks.length)?"human_review":
    ai.issues.length||ai.label==="不合格"?"revise":"pass";
  return {locations,status,label:ai.label,dimensions:ai.dimensions,issues:ai.issues,disputed:ai.disputed,
    facts:{triggered:requestTriggered||checks.length>0,requestTriggered,requestClaims,checks,externalVerification:false}};
}
function database(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec("CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,task TEXT,article INTEGER,version INTEGER,payload TEXT,UNIQUE(task,article,version))");
  return db;
}
export interface Review {
  id:string;taskId:string;articleVersion:number;version:number;createdAt:string;caseId?:string;
  status:string;model?:string;durationMs?:number;call?:ReturnType<typeof callsFor>[number];error?:string;
  parsedOutput?:unknown;manualParent?:string;manualOffset?:number;
  diagnostic?:{evalId:string;stage:string;code:string;path?:string};
  rules:string[];sourceIds:string[];calibrationRefs?:Array<{id:string;version:number}>;result?:Omit<ReturnType<typeof finalize>,"locations">&{locations?:ReturnType<typeof finalize>["locations"]};
}
export function readReviews(taskId:string,version:number):Review[]{
  const db=database();
  try{return db.prepare("SELECT payload FROM reviews WHERE task=? AND article=? ORDER BY version DESC").all(taskId,version).map(r=>JSON.parse(String(r.payload)));}
  finally{db.close();}
}
export async function review(id:string,version:number,blind=false,fixed=false){
  if(fixed&&!evalPreview().approved)throw new SafetyError("固定审核清单尚未批准");
  const s=fixed?demoSubject(id,version):blind?caseSubject(id,version):articleSubject(id,version);
  const db=database(),start=Date.now();
  const record:Review={id:randomUUID(),taskId:s.task.id,articleVersion:version,caseId:"caseId" in s?s.caseId:undefined,version:1,
    createdAt:new Date(start).toISOString(),status:"running",rules:[...dimensions],sourceIds:s.sources.map(h=>h.id)};
  try{
    db.exec("BEGIN IMMEDIATE");
    const row=db.prepare("SELECT MAX(version) AS v FROM reviews WHERE task=? AND article=?").get(record.taskId,version);
    if(fixed && row?.v)throw new Error("该固定样本已审核过");
    record.version=Number(row?.v??0)+1;
    db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(record.id,record.taskId,version,record.version,JSON.stringify(record));
    db.exec("COMMIT");
    let stage="provider_setup";
    try{
      const provider=localProvider({task:s.task,evalId:record.id,purpose:"quick-review"});
      record.model=provider.model;
      stage="calibration";
      // Only development calibration summaries; never send holdout labels or excerpts.
      const examples=!fixed && s.task.input.persona==="general"?developmentCalibration(s.body,record.caseId??""):[];
      record.calibrationRefs=examples.map(e=>({id:e.id,version:e.version}));
      const calibration=examples.map(e=>({label:e.label,dimensions:e.dimensions,rationale:e.rationale}));
      stage="model_request";
      const output=await provider.json(instruction,{request:s.request,title:s.title,body:s.body,sources:s.sources,calibration});
      stage="assessment";
      record.parsedOutput=output;record.result=finalize(s,output);record.status=record.result.status;
    }catch(e){
      record.status=e instanceof ReviewError&&e.code==="AMBIGUOUS_QUOTE"?"human_review":"failed";
      const failure=e instanceof ReviewError?e:new ReviewError(stage,e instanceof BudgetError?"BUDGET_ERROR":
        e instanceof SafetyError?"SAFETY_ERROR":stage==="model_request"?"MODEL_REQUEST_ERROR":
        stage==="provider_setup"?"MODEL_CONFIG_ERROR":"INTERNAL_ERROR");
      record.diagnostic={evalId:record.id,stage:failure.stage,code:failure.code,path:failure.path};
      record.error=e instanceof BudgetError||e instanceof SafetyError?e.message:failure.message;
    }
    record.durationMs=Date.now()-start;
    record.call=callsFor(s.task.id).find(c=>c.node==="eval:"+record.id);
    record.model=record.call?.model??record.model;
    db.prepare("UPDATE reviews SET payload=? WHERE id=?").run(JSON.stringify(record),record.id);
    return record;
  }finally{db.close();}
}
// Invoked only after a blind prediction is persisted, behind the reviewer key.
export function compareReview(id:string){
  const db=database();
  try{
    const row=db.prepare("SELECT payload FROM reviews WHERE id=?").get(id);
    const review:Review|undefined=row?JSON.parse(String(row.payload)):undefined;
    if(!review?.result||!review.caseId)throw Error("无可对照的盲测预测");
    const gold=evaluations().find(e=>e.id===review.caseId && e.version===review.articleVersion && e.split==="holdout");
    if(!gold)throw Error("未找到对应版本的独立集标签");
    const expected=gold.issues??[], predicted=review.result.issues.filter(i=>i.field==="body");
    return {evalId:id,caseId:gold.id,version:gold.version,agreement:review.result.label===gold.label,
      severeMiss:expected.some(i=>i.severe)&&review.status==="pass",excellentMisclassified:gold.label==="优秀"&&review.result.label!=="优秀",
      expectedLocations:expected.length,matchedLocations:expected.filter(e=>predicted.some(p=>p.offset===e.offset&&p.quote===e.quote)).length,
      sampleCount:1};
  }finally{db.close();}
}


export function resolveReviewLocation(taskId:string,articleVersion:number,reviewId:string,offset:number){
  const subject=articleSubject(taskId,articleVersion),db=database();
  try{
    db.exec("BEGIN IMMEDIATE");
    const row=db.prepare("SELECT payload FROM reviews WHERE task=? AND article=? ORDER BY version DESC LIMIT 1").get(taskId,articleVersion);
    const parent:Review=JSON.parse(String(row?.payload));
    if(parent.id!==reviewId||parent.diagnostic?.code!=="AMBIGUOUS_QUOTE")throw Error("审核意见已变化");
    const match=/^(issues|claims)\.(\d+)\.quote$/.exec(parent.diagnostic.path??"");
    if(!match)throw Error("无法确认位置");
    const raw=assessment.parse(parent.parsedOutput),item=raw[match[1] as "issues"|"claims"][Number(match[2])],original=subject[item.field];
    if(original.slice(offset,offset+item.quote.length)!==item.quote)throw Error("选中位置与原文不符");
    // Both adjacent strings together identify the user's exact occurrence, including at boundaries.
    item.before=original.slice(0,offset)||undefined;item.after=original.slice(offset+item.quote.length)||undefined;
    const next:Review={...parent,id:randomUUID(),version:parent.version+1,parsedOutput:raw,createdAt:new Date().toISOString(),manualParent:parent.id,manualOffset:offset,call:undefined,durationMs:undefined,diagnostic:undefined,error:undefined};
    try{next.result=finalize(subject,raw);next.status=next.result.status;}
    catch(e){if(!(e instanceof ReviewError)||e.code!=="AMBIGUOUS_QUOTE")throw e;
      next.status="human_review";next.error=e.message;next.diagnostic={evalId:next.id,stage:e.stage,code:e.code,path:e.path};}
    db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(next.id,taskId,articleVersion,next.version,JSON.stringify(next));
    db.exec("COMMIT");return next;
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
