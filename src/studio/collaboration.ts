import {assertCloudTask} from "./production-cloud";
import {reviewLocationHelp} from "./review-location-help";
import {ReviewError} from "./review-error";
import {SafetyError} from "./safe-demo";
import {newPanel,advancePanel,nextPanelRole,aggregatePanel,type Panel,RULE_VERSION} from "./professional-review";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {advance,lookup} from "./tasks";
import {readArticles,articleForReview,appendRevision} from "./article-store";
import {review,readReviews} from "./eval";
import {write,type Article} from "./agents";
import {localProvider} from "./provider";
import {callsFor,summarizeUsage,BudgetError} from "./usage";
import {decideReview} from "./collaboration-policy";
export interface Execution {id:string;role:string;started:string;ended?:string;status:string;inputArticleVersion?:number;researchVersion?:number;reviewId?:string;outputArticleVersion?:number;callIds:string[];candidate?:Article;reason?:string}
export interface Flow {queueManaged?:boolean;budget?:{requests:number;tokens:number};pauseRequested?:boolean;professional?:boolean;expressionRules?:boolean;panels?:Panel[];discussionUsed?:boolean;taskId:string;revision:number;state:string;step:string;rounds:number;reason:string;articleVersion?:number;reviewId?:string;executions:Execution[]}
function db(){const d=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");d.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS collaboration(task TEXT PRIMARY KEY,payload TEXT NOT NULL)");return d;}
function get(d:DatabaseSync,id:string):Flow|null {const r=d.prepare("SELECT payload FROM collaboration WHERE task=?").get(id);return r?JSON.parse(String(r.payload)):null;}
function put(d:DatabaseSync,f:Flow){d.prepare("INSERT INTO collaboration VALUES(?,?) ON CONFLICT(task) DO UPDATE SET payload=excluded.payload").run(f.taskId,JSON.stringify(f));}
export function flow(id:string){const d=db();try{return get(d,id);}finally{d.close();}}
export function flowView(id:string){
 const d=db();try{d.exec("BEGIN IMMEDIATE");const f=get(d,id);if(f?.state==="running"&&Date.now()-Date.parse(f.executions.at(-1)!.started)>300000){f.state="unknown";f.reason="执行超过五分钟，可能中断或请求结果未知；请人工核实，不自动重试";f.revision++;put(d,f);}d.exec("COMMIT");}finally{if(d.isTransaction)d.exec("ROLLBACK");d.close();}
 const current=flow(id);
 return {flow:current,usage:summarizeUsage(callsFor(id)),locationHelp:reviewLocationHelp(current)};
}
export function control(id:string,action:"start"|"stop"|"resume"|"pause",revision?:number,options?:{professional:boolean;expressionRules?:boolean}){const t=lookup(id);if(!t)throw Error("任务不存在");if(t.article)readArticles(id);const d=db();try{d.exec("BEGIN IMMEDIATE");let f=get(d,id);
 if(action==="start"&&!f){f={taskId:id,revision:0,queueManaged:!!t.input.production,budget:t.input.production?{requests:t.input.production.budget?.requests??6,tokens:t.input.production.budget?.tokens??20000}:undefined,state:"ready",step:t.stage==="done"?"eval":"prepare",rounds:0,reason:"",executions:[],professional:options?.professional,expressionRules:options?.expressionRules,panels:[]};if(t.article)f.articleVersion=readArticles(id).head.version;}
 else if(f&&revision===f.revision){if(action==="stop"){f.state="stopped";f.reason="已停止调度；在途请求仍可能返回，结果只留存，不自动推进";f.revision++;}
 else if(action==="pause"&&f.state==="ready"){f.state="paused";f.reason="已暂停后续步骤，可以继续";f.revision++;}
 else if(action==="pause"&&f.state==="running"){f.pauseRequested=true;}
 else if(action==="resume"&&(f.state==="paused"||f.state==="failed"||(f.state==="human"&&f.step==="prepare"&&t.stage==="research"))){f.state="ready";f.reason="从未完成步骤继续";f.revision++;}}
 if(!f)throw Error("流程不存在");put(d,f);d.exec("COMMIT");return f;
 }finally{if(d.isTransaction)d.exec("ROLLBACK");d.close();}}
async function revise(id:string,version:number,reviewId:string,professional=false){
 const t=articleForReview(id,version);const r=readReviews(id,version).find(r=>r.id===reviewId);
 if(!r||(professional?r.status!=="revise"||!r.rules.includes(RULE_VERSION):decideReview(r,version,0).state!=="revision"))throw Error("修订缺少对应版本的有效审核");
 const url=process.env.STUDIO_MODEL_URL??"http://127.0.0.1:11434/v1/chat/completions";
 if(t.input.production?.mode==="真实云端")assertCloudTask(t);
 else if(!/^http:\/\/127\.0\.0\.1(?::\d+)?\//.test(url)||t.generalConsent||t.input.environment)throw Error("权限受阻：当前授权不包含修订负载；仅可使用无云端授权的本机普通任务");
 if(professional&&t.input.production?.mode==="真实云端"){
  const panel=flow(id)?.panels?.find(p=>p.id===reviewId);if(!panel)throw Error("缺少定向修订依据");
  const edited={...t.article!};
  for(const field of ["title","body"] as const){let boundary=edited[field].length;const changes=new Map(panel.selected.filter(o=>o.action!=="retain"&&o.issue.field===field).map(o=>[o.issue.offset+":"+o.issue.quote.length,o]));
   for(const o of [...changes.values()].sort((a,b)=>b.issue.offset-a.issue.offset)){const start=o.issue.offset,end=start+o.issue.quote.length;if(start<0||end>boundary||edited[field].slice(start,end)!==o.issue.quote)throw Error("最终修改区间重叠或原文已变更，需要人工处理");edited[field]=edited[field].slice(0,start)+(o.action==="delete"?"":o.replacement)+edited[field].slice(end);boundary=start;}
  }
  if(!edited.title.trim()||!edited.body.trim())throw Error("定向修订不能清空文章");
  return {...edited,version:t.article!.version+1,model:t.article!.model};
 }
 t.stage="write";const p=localProvider({task:t,professional,futureCalls:professional?3:0});
 const revised=await write(t,{model:p.model,json:(instruction,data)=>p.json(instruction+"\n按指定正式文章和审核意见修订，只处理最终意见列出的片段和建议，不做无关重写；保留事实边界。",{researchInput:data,article:t.article,review:r.result})});
 if(professional){
 const panel=flow(id)?.panels?.find(p=>p.id===reviewId);if(!panel)throw Error("缺少定向修订依据");
 for(const field of ["title","body"] as const){let expected=t.article![field];const unique=new Map(panel.selected.filter(o=>o.action!=="retain"&&o.issue.field===field).map(o=>[o.issue.offset+":"+o.issue.quote.length,o]));let boundary=expected.length;
 for(const o of [...unique.values()].sort((a,b)=>b.issue.offset-a.issue.offset)){const start=o.issue.offset,end=start+o.issue.quote.length;if(end>boundary)throw Error("最终修改区间重叠，需要人工处理");expected=expected.slice(0,start)+(o.action==="delete"?"":o.replacement)+expected.slice(end);boundary=start;}
 if(revised[field]!==expected)throw Error("修订超出最终确认片段或未准确执行建议，结果未提交");
 }
 }
 return revised;
}
export async function tick(id:string,revision:number){
 callsFor(id);if(lookup(id)?.article){readArticles(id);readReviews(id,0);}
 const d=db();let f:Flow;let e:Execution;let fence:{head:number;draft:number}|undefined;let prior:string[]=[];
 try{d.exec("BEGIN IMMEDIATE");const current=get(d,id);if(!current||current.revision!==revision||current.state!=="ready"){d.exec("COMMIT");return current;}
 f=current;const t=lookup(id)!;
 if(t.lease){f.state="unknown";f.reason="原任务存在在途或过期执行，需人工核实，禁止自动重发";f.revision++;put(d,f);d.exec("COMMIT");return f;}
 if(t.article){const a=readArticles(id);fence={head:a.head.version,draft:a.draft?.revision??0};if(f.articleVersion!==undefined&&a.head.version!==f.articleVersion){f.state="human";f.reason="正式版本已变更，请在版本页人工处理";f.revision++;put(d,f);d.exec("COMMIT");return f;}}
 if(f.professional&&f.step==="eval"&&!f.panels?.some(p=>p.articleVersion===f.articleVersion)){(f.panels??=[]).push(newPanel(id,f.articleVersion!,f.expressionRules));}
 prior=callsFor(id).map(c=>c.id);e={id:randomUUID(),role:f.professional&&f.step==="eval"?nextPanelRole(f.panels!.at(-1)!):f.step==="prepare"?t.stage:f.step,started:new Date().toISOString(),status:"running",inputArticleVersion:f.articleVersion,researchVersion:t.research?.version,reviewId:f.reviewId,callIds:[]};f.executions.push(e);f.state="running";f.revision++;put(d,f);d.exec("COMMIT");
 }finally{if(d.isTransaction)d.exec("ROLLBACK");d.close();}
 let next="ready",reason="",step=f.step;let candidate:Article|undefined;let output:number|undefined;let reviewId=f.reviewId;
 try{
 if(step==="prepare"){
 const t=lookup(id)!;
 if(t.stage==="ready"||t.stage==="blocked"){next="human";reason=t.stage==="ready"?"资料已就绪，请通过原入口确认生成权限":"研究受阻："+(t.research?.questions.join("；")||t.records.at(-1)?.error);}
 else {const result=await advance(id,t.revision,true);if(!result)throw Error("任务不存在");if(result.records.at(-1)?.status==="failed")throw Error(result.records.at(-1)?.error);if(result.stage==="blocked"){next="human";reason=result.records.at(-1)?.error??"资料不足";}if(result.article){output=result.article.version;step="eval";}}
 }else if(step==="eval"&&f.professional){
 const panel=await advancePanel(id,f.panels!.at(-1)!,!!f.discussionUsed,f.rounds<2&&(!f.queueManaged||(f.budget?.requests??6)>6));
 if(panel.phase==="complete"){
 const aggregate=aggregatePanel(id,panel);panel.aggregate=aggregate;reviewId=aggregate.id;
 if(panel.status==="pass"){next="awaiting_acceptance";reason="专业审核通过，待人工确认";}
 else if(panel.status==="human"||f.rounds>=2){next="human";reason=panel.status==="human"?panel.reason!:"已达两轮修订上限，仍有未解决意见";}
 else if(f.queueManaged&&(f.budget?.requests??6)<=6){next="human";reason="保守预算不足以承诺定向修订及复审，保留意见供人工修改；不自动扩额";}
 else{step="revision";reason="按最终确认意见定向修订";}
 }
 }else if(step==="eval"){
 const r=await review(id,f.articleVersion!);reviewId=r.id;const decision=decideReview(r,f.articleVersion!,f.rounds);next=decision.state;reason=decision.reason;if(next==="revision"){next="ready";step="revision";}
 }else{candidate=await revise(id,f.articleVersion!,f.reviewId!,!!f.professional);step="eval";}
 }catch(error){next=error instanceof SafetyError||error instanceof BudgetError||(error instanceof ReviewError&&error.stage==="location")?"human":"failed";reason=String(error);}
 const calls=callsFor(id).filter(c=>!prior.includes(c.id));if(calls.some(c=>c.usage==="unknown")){next="unknown";reason="请求已发出但结果或用量未知，不自动重试。"+reason;}
 if(next!=="unknown"&&(reason.includes("权限")||reason.includes("SAFETY")||reason.includes("预算")||reason.includes("仅开放")))next="human";
 // Initialize article tables before taking the transaction used for atomic publish + flow completion.
 if(lookup(id)?.article)readArticles(id);
 const end=db();try{end.exec("BEGIN IMMEDIATE");const current=get(end,id)!;if(f.professional){current.panels=f.panels;if(f.panels?.some(p=>p.verdict))current.discussionUsed=true;}const record=current.executions.find(x=>x.id===e.id)!;
 Object.assign(record,{ended:new Date().toISOString(),status:next,reason,callIds:calls.map(c=>c.id),candidate,reviewId});
 let changed=false;if(fence){const a=readArticles(id);changed=a.head.version!==fence.head||(a.draft?.revision??0)!==fence.draft;}
 if(current.state!=="running"||current.revision!==f.revision){record.status="retained";record.reason="停止或状态已变化，结果留存待人工处理";}
 else if(changed){current.state="human";current.reason="执行期间文章或草稿已修改；AI 结果已保留，未覆盖人工内容";}
 else{if(f.professional){const aggregate=f.panels?.at(-1)?.aggregate;if(aggregate&&!end.prepare("SELECT id FROM reviews WHERE id=?").get(aggregate.id)){aggregate.version=Number(end.prepare("SELECT MAX(version) AS v FROM reviews WHERE task=? AND article=?").get(id,aggregate.articleVersion)?.v??0)+1;end.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(aggregate.id,id,aggregate.articleVersion,aggregate.version,JSON.stringify(aggregate));}}
 if(candidate){output=appendRevision(end,id,candidate,f.articleVersion!,f.reviewId);current.rounds++;}current.state=current.pauseRequested&&next==="ready"?"paused":next;current.reason=current.state==="paused"?"在途步骤已结束，后续步骤已暂停":reason;delete current.pauseRequested;current.step=step;current.articleVersion=output??current.articleVersion;current.reviewId=reviewId;record.outputArticleVersion=output;}
 current.revision++;put(end,current);end.exec("COMMIT");return current;
 }finally{if(end.isTransaction)end.exec("ROLLBACK");end.close();}
}






