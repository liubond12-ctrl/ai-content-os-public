import {z} from "zod";
import {randomUUID} from "node:crypto";
import {articleSubject,assessment,finalize,type Review} from "./eval";
import {localProvider,type ModelProvider} from "./provider";
import {factTrigger,localFactQuotes} from "./fact-claims";
export {factTrigger} from "./fact-claims";
export const RULE_VERSION="professional-v1";
export const EXPRESSION_RULE_VERSION="local-expression-v1";
export type Role="strategy"|"language"|"facts";
const duties={strategy:"回应需求、受众目标、结构与论证。",language:"清晰度、重复、衔接、措辞及账号表达要求。",facts:"具体数字、日期、政策、考试赛事规则、真实经历的事实依据。无来源必须标待核验，不创造事实。"};
const action=z.object({issueIndex:z.number().int().nonnegative(),action:z.enum(["retain","delete","replace"]),replacement:z.string().max(1200).default(""),evidenceIds:z.array(z.string()).max(8),blocking:z.boolean()}).strict();
export const professionalOutput=z.object({assessment,actions:z.array(action).max(6)}).strict();
export type Opinion={id:string;role:Role;articleVersion:number;rulesVersion:string;issue:NonNullable<Review["result"]>["issues"][number];action:"retain"|"delete"|"replace";replacement:string;evidenceIds:string[];blocking:boolean};
export interface Independent {role:Role;rulesVersion:string;expressionRules:string|false;articleVersion:number;result:NonNullable<Review["result"]>;opinions:Opinion[]}
export interface Discussion {role:Role;responses:Array<{opinionId:string;position:"maintain"|"withdraw";reason:string;evidenceIds:string[]}>}
export interface Verdict {decisions:Array<{opinionIds:string[];action:"accept"|"reject"|"merge"|"human";selectedIds:string[];reason:string;evidenceIds:string[]}>}
export interface Panel {id:string;articleVersion:number;phase:"independent"|"discussion"|"judge"|"complete";roles:Role[];reviews:Independent[];conflicts:string[][];discussion:Discussion[];verdict?:Verdict;selected:Opinion[];status?:"pass"|"revise"|"human";reason?:string;aggregate?:Review;expressionRules:boolean}
export function newPanel(id:string,version:number,expressionRules=false):Panel {const s=articleSubject(id,version);return {id:randomUUID(),articleVersion:version,phase:"independent",roles:factTrigger(s.title+"\n"+s.body+"\n"+JSON.stringify(s.request),!!s.task.research?.handoff?.needsFacts)?["strategy","language","facts"]:["strategy","language"],reviews:[],conflicts:[],discussion:[],selected:[],expressionRules};}
export function conflicts(opinions:Opinion[]){const pairs:string[][]=[];for(let i=0;i<opinions.length;i++)for(let j=i+1;j<opinions.length;j++){const a=opinions[i],b=opinions[j];if(a.role===b.role||a.issue.field!==b.issue.field)continue;const overlap=a.issue.offset<b.issue.offset+b.issue.quote.length&&b.issue.offset<a.issue.offset+a.issue.quote.length;const incompatible=a.action!==b.action||(a.action==="replace"&&a.replacement!==b.replacement);if(overlap&&incompatible)pairs.push([a.id,b.id]);}return pairs;}
function finish(p:Panel){
 const hard=p.reviews.some(r=>r.result.facts.checks.some(c=>c.status!=="来源原文匹配")||r.result.status==="blocked"||(r.result.facts.requestTriggered&&!r.result.facts.checks.length));
 if(hard){p.status="human";p.reason=p.reviews.some(r=>r.result.status==="blocked"||r.result.facts.checks.some(c=>c.critical&&c.status!=="来源原文匹配"))?"关键事实或安全问题待核验，Judge 无权解除":"非关键主张需人工核对（可能是文本观察），不代表已证实存在现实事实错误";}
 else if(p.reviews.some(r=>r.result.disputed||(r.result.label==="不合格"&&!r.opinions.length))||p.verdict?.decisions.some(d=>d.action==="human")){p.status="human";p.reason="主观取舍或未解决分歧，需人工决定";}
 else{p.status=p.selected.some(o=>o.action!=="retain")?"revise":"pass";p.reason=p.status==="pass"?"专业审核通过，待人工确认":"根据最终确认意见定向修订";}
 p.phase="complete";return p;
}
export function applyVerdict(p:Panel,v:Verdict){
 const all=p.reviews.flatMap(r=>r.opinions),ids=new Set(all.map(o=>o.id));const required=new Set(p.conflicts.flat());const covered=new Set<string>();
 for(const d of v.decisions){if(!d.opinionIds.length||d.opinionIds.some(id=>!required.has(id)||covered.has(id))||d.selectedIds.some(id=>!d.opinionIds.includes(id)||!ids.has(id)))throw Error("Judge 引用未知、重复或不相关意见");d.opinionIds.forEach(id=>covered.add(id));if(d.action==="reject"&&d.selectedIds.length||["accept","merge"].includes(d.action)&&!d.selectedIds.length)throw Error("Judge 裁决动作与选定意见不一致");}
 if([...required].some(id=>!covered.has(id)))throw Error("Judge 未裁决所有冲突意见");
 const selected=new Set(v.decisions.filter(d=>d.action!=="human").flatMap(d=>d.selectedIds));p.selected=all.filter(o=>!required.has(o.id)||selected.has(o.id));p.verdict=v;
 if(conflicts(p.selected).length){p.status="human";p.reason="Judge 后仍存在互斥建议";p.phase="complete";return p;}return finish(p);
}
export function nextPanelRole(p:Panel){if(p.phase==="independent")return p.roles.find(role=>!p.reviews.some(r=>r.role===role))??"merge";if(p.phase==="discussion")return "discussion:"+p.reviews.find(r=>r.opinions.some(o=>p.conflicts.flat().includes(o.id))&&!p.discussion.some(d=>d.role===r.role))!.role;return p.phase;}
export async function advancePanel(taskId:string,p:Panel,discussionUsed:boolean,canRevise=true,isolated?:{subject:ReturnType<typeof articleSubject>;provider:ModelProvider}){
 const s=isolated?.subject??articleSubject(taskId,p.articleVersion);const sourceIds=new Set(s.sources.map(s=>s.id));
 const checkSources=(ids:string[])=>{if(ids.some(id=>!sourceIds.has(id)))throw Error("意见或裁决引用未知来源");};
 // Reserve the remaining mandatory independent roles; revisions separately reserve their new-version reviews.
 const future=(canRevise?4:0)+(p.phase==="independent"?Math.max(0,p.roles.length-p.reviews.length-1):p.phase==="discussion"?p.reviews.filter(r=>r.opinions.some(o=>p.conflicts.flat().includes(o.id))).length-p.discussion.length:0);
 const provider=()=>isolated?.provider??localProvider({task:s.task,evalId:p.id+":"+nextPanelRole(p),professional:true,futureCalls:future,purpose:"quick-review"});
 const common={articleVersion:p.articleVersion,title:s.title,body:s.body,request:s.request,sources:s.sources,accountRules:s.task.context?.compiledContext??"",rulesVersion:RULE_VERSION};
 if(p.phase==="independent"){
 const role=p.roles.find(role=>!p.reviews.some(r=>r.role===role))!;
 const instruction=independentInstruction(role,p.expressionRules);
 const raw=professionalOutput.parse(await provider().json(instruction,common));
 const localClaims=role==="facts"?(["title","body"] as const).flatMap(field=>localFactQuotes(s[field]).map(({quote,offset})=>({
   field,quote,offset,critical:true,sourceId:null,
   ...(offset?{before:s[field].slice(0,offset)}:{}),
   ...(offset+quote.length<s[field].length?{after:s[field].slice(offset+quote.length)}:{}),
 }))):[];
 const result=finalize(s,raw.assessment,localClaims);
 if(raw.actions.length!==result.issues.length||new Set(raw.actions.map(a=>a.issueIndex)).size!==result.issues.length)throw Error("审核问题与建议动作不匹配");
 const opinions=raw.actions.map(a=>{checkSources(a.evidenceIds);const issue=result.issues[a.issueIndex];if(!issue)throw Error("建议引用无效问题");if(a.action==="replace"&&!a.replacement)throw Error("替换建议缺少文本");return {id:randomUUID(),role,articleVersion:p.articleVersion,rulesVersion:RULE_VERSION,issue,...a};});
 p.reviews.push({role,articleVersion:p.articleVersion,rulesVersion:RULE_VERSION,expressionRules:role==="language"&&p.expressionRules?EXPRESSION_RULE_VERSION:false,result,opinions});
 if(result.facts.triggered&&!p.roles.includes("facts"))p.roles.push("facts");
 if(p.reviews.length===p.roles.length){p.selected=p.reviews.flatMap(r=>r.opinions);p.conflicts=conflicts(p.selected);if(p.reviews.some(r=>r.result.facts.checks.some(c=>c.status!=="来源原文匹配")||r.result.status==="blocked"))return finish(p);if(!p.conflicts.length)return finish(p);if(discussionUsed){p.phase="complete";p.status="human";p.reason="新版仍有实质分歧，已用完一轮讨论";}else p.phase="discussion";}
 }else if(p.phase==="discussion"){
 const role=nextPanelRole(p).split(":")[1] as Role;const allowed=p.reviews.find(r=>r.role===role)!.opinions.filter(o=>p.conflicts.flat().includes(o.id)).map(o=>o.id);
 const schema=z.object({responses:z.array(z.object({opinionId:z.string(),position:z.enum(["maintain","withdraw"]),reason:z.string().min(1),evidenceIds:z.array(z.string())}).strict())}).strict();
 const out=schema.parse(await provider().json(discussionInstruction(role),{...common,opinions:p.reviews.flatMap(r=>r.opinions),conflicts:p.conflicts,respondTo:allowed}));
 if(out.responses.length!==allowed.length||new Set(out.responses.map(r=>r.opinionId)).size!==allowed.length||out.responses.some(r=>!allowed.includes(r.opinionId)))throw Error("讨论回应与角色意见不一致");out.responses.forEach(r=>checkSources(r.evidenceIds));p.discussion.push({role,...out});
 if(p.reviews.filter(r=>r.opinions.some(o=>p.conflicts.flat().includes(o.id))).every(r=>p.discussion.some(d=>d.role===r.role)))p.phase="judge";
 }else if(p.phase==="judge"){
 const schema=z.object({decisions:z.array(z.object({opinionIds:z.array(z.string()),action:z.enum(["accept","reject","merge","human"]),selectedIds:z.array(z.string()),reason:z.string().min(1),evidenceIds:z.array(z.string())}).strict())}).strict();
 const verdict=schema.parse(await provider().json(judgeInstruction,{...common,opinions:p.reviews.flatMap(r=>r.opinions),conflicts:p.conflicts,discussion:p.discussion}));verdict.decisions.forEach(d=>checkSources(d.evidenceIds));applyVerdict(p,verdict);
 }
 return p;
}
export function aggregatePanel(taskId:string,p:Panel):Review {
 const result=p.reviews[0].result;
 return {id:p.id,taskId,articleVersion:p.articleVersion,version:0,createdAt:new Date().toISOString(),status:p.status==="human"?"human_review":p.status!,rules:[RULE_VERSION,...(p.expressionRules?[EXPRESSION_RULE_VERSION]:[])],sourceIds:[...new Set(p.selected.flatMap(o=>o.evidenceIds))],result:{...result,status:p.status==="human"?"human_review":p.status!,disputed:p.status==="human",issues:p.selected.filter(o=>o.action!=="retain").map(o=>({...o.issue,suggestion:o.action==="delete"?"删除指定片段":o.replacement})),facts:{...result.facts,checks:p.reviews.flatMap(r=>r.result.facts.checks)}}};
}







export function discussionInstruction(role:Role){return "你是"+role+"审核者。只回应自己存在冲突的意见，可维持或撤回，引用已给来源，不新增事实。返回 {responses:[{opinionId,position:'maintain|withdraw',reason,evidenceIds:[]}]}。";}

export const judgeInstruction="你是Judge。根据需求、原文、意见及一轮回应裁决，不投票、不创造事实，不解除未核实事实阻断。返回 {decisions:[{opinionIds:涉及的冲突意见ID,action:'accept|reject|merge|human',selectedIds:保留的已有意见ID,reason,evidenceIds:已有来源ID}]}。只裁决 conflicts 中出现的意见，不要处理其他意见。存在共享 opinionId 的多组冲突必须合并为一个决策组，同一 ID 不得重复出现在 decisions 中。所有冲突意见恰好覆盖一次，互斥建议不可同时接受，主观取舍交human。";

export function independentInstruction(role:Role,expressionRules=false){return "你是独立专业审核者。"+duties[role]+"输出 JSON {assessment:{label:'优秀|普通|不合格',disputed:boolean,dimensions:{内容策略:string,表达质量:string,内容结构:string,基础规范:string},issues:[{field:'title|body',quote,offset:UTF16,before?:紧邻前文,after?:紧邻后文,type:'策略|表达|结构|规范|安全',severity:'轻微|明显|严重',reason,suggestion}],claims:[{field,quote,offset,critical,sourceId:string|null}]},actions:[{issueIndex,action:'retain|delete|replace',replacement,evidenceIds:[],blocking:boolean}]}。quote 必须逐字摘录当前 title 或 body，包含原有标点与换行；优先选择只出现一次的完整片段，此时省略 before/after。若片段重复，才提供逐字相邻的 before/after，不能省略段落间的换行。claims 只列需核实的现实事实；写作方法、虚构动作及文本观察不是现实事实主张。例如“缺少真实经历与核实信息的地方，不作补足”是写作约束，不列入 claims。同句或同段另有现实日期、经历或其他具体断言时，只逐字引用需核实的部分，仍须独立核验。每条issue必须对应一个action，最多6条；保留建议仅在有具体理由时提出。关键事实无依据必须记录claims。不要编造来源。账号规则和用户需求优先。"+(role==="language"&&expressionRules?"可选本地表达规则 local-expression-v1：删无信息重复，采用具体措辞，保留有意节奏；不得改写账号风格或新增事实。":"");}
