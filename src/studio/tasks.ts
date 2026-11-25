import {productionInput} from "./production-schema";
import { DatabaseSync } from "node:sqlite";
import { createHash,randomUUID } from "node:crypto";
import { z } from "zod";
import { assembleContext,assembleProduction } from "../context/assembler";
import type {AssemblyTrace} from "../types/sprint5";
import { attachEvidence, knowledge, retrieveMode } from "../rag/search";
import {research,write,valid,type Research,type Article,type Trace} from "./agents";
import {localProvider} from "./provider";
import {safeAssembly,safeKnowledge,safeRetrieve,checkInput,SafetyError} from "./safe-demo";
import {saveCall,callsFor,summarizeUsage,BudgetError,type CallRecord} from "./usage";
import {formats,generalContext,methodIndex,findMethods} from "./library";
import {generalPreview} from "./general-approval";
import type {ResearchDecision} from "./research-contract";
import {autopilotModelInput} from "./autopilot-guard";

export const brief = z.object({
  persona: z.enum(["demoa","demob","general"]).default("general"), topic: z.string().trim().min(1).max(240),
  production:productionInput.optional(),
  sources:z.array(z.string().max(88)).max(100).optional(),
  audience: z.string().trim().max(600).default(""), reference: z.string().trim().max(4000).default(""),
  format:formats.optional(),goal:z.string().trim().max(240).optional(),style:z.string().trim().max(600).optional(),
  mode: z.enum(["keyword","semantic","hybrid"]), generate:z.boolean().optional(),
  writingScope:z.literal("text-analysis").optional(),
  environment:z.literal("safe-demo").optional(),scenario:z.enum(["expression","missing","followup","limited-writing"]).optional()
}).strict().refine(input=>input.environment ? !input.format && !input.goal && !input.style && input.persona!=="general" :
  input.persona!=="general" || (!input.reference && !!input.format),"通用任务需要内容形式；测试场景仅允许固定输入");
type Assembly = Awaited<ReturnType<typeof assembleContext>>|ReturnType<typeof generalContext>;
type Package = ReturnType<typeof attachEvidence>;
export interface Task {
  id: string; input: z.infer<typeof brief>; revision: number;
  stage: "assemble" | "retrieve" | "ready" | "research" | "write" | "blocked" | "done";
  lease?:number; research?:Research; article?:Article; tools?:Trace[]; model?:string;
  decisions?:Array<Omit<ResearchDecision,"coreGaps"|"limits"|"optionalQuestions"> & Partial<Pick<ResearchDecision,"coreGaps"|"limits"|"optionalQuestions">> & {round:number;availableIds?:string[]}>;
  modelCalls?:Array<{node:string;model:string;started:string;ended?:string;status:"running"|"ok"|"failed"} & Partial<CallRecord>>;
  records: {node:string; status:"ok"|"failed"|"blocked"; started:string; ended:string; error?:string}[];
  context?: Assembly; result?: Package;
  assemblyTrace?:AssemblyTrace;
  usageSummary?:ReturnType<typeof summarizeUsage>;
  generalConsent?:{hash:string;at:string;manifest?:unknown};
}
function database(){
  const db = new DatabaseSync(process.env.STUDIO_DB || "data/studio.sqlite");
  db.exec("CREATE TABLE IF NOT EXISTS versions(id TEXT, rev INTEGER, payload TEXT, PRIMARY KEY(id,rev))");
  return db;
}
function persist(task:Task){
  const db=database();
  try { db.prepare("INSERT INTO versions VALUES(?,?,?)").run(task.id,task.revision,JSON.stringify(task)); }
  finally { db.close(); }
}
function hydrateUsage(task:Task){
  const legacy:CallRecord[]=(task.modelCalls??[]).filter(c=>!c.id || c.id.startsWith("legacy:")).map((c,i)=>({
    ...c,id:c.id??"legacy:"+i+":"+c.started,taskId:task.id,usage:"unknown"
  }));
  const calls=[...legacy,...callsFor(task.id)];
  if(calls.length){task.modelCalls=calls;task.usageSummary=summarizeUsage(calls);}
}
export function create(input:unknown){
  const task:Task={id:randomUUID(),revision:0,input:brief.parse(input),stage:"assemble",records:[]};
  if(task.input.production?.draftId||task.input.production?.sourceMaterials||task.input.production?.bricks||task.input.production?.chapters)throw Error("装配资料和分章计划只由服务端队列添入");
  if(task.input.environment || task.input.scenario)checkInput(task);
  persist(task); return task;
}
export function lookup(id:string,revision?:number):Task|null{
  const db=database();
  try {
    const row=db.prepare("SELECT payload FROM versions WHERE id=? AND (? IS NULL OR rev=?) ORDER BY rev DESC LIMIT 1").get(id,revision??null,revision??null);
    if(!row)return null;
    const task:Task=JSON.parse(String(row.payload));
    if(revision===undefined){
      hydrateUsage(task);
    }
    return task;
  } finally { db.close(); }
}
export function startLocalWriting(id:string,revision:number){
  const task=lookup(id);
  if(!process.env.STUDIO_MODEL||!/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(process.env.STUDIO_MODEL_URL??"http://127.0.0.1:11434/"))throw Error("未配置本机模型");
  if(!task||task.stage!=="ready"||task.revision!==revision)throw Error("资料包已变化，请重新打开任务");
  if(task.input.persona==="general")methodIndex(false,task.input.sources);
  task.stage="research";task.revision++;persist(task);return task;
}
export async function approveGeneration(id:string,revision:number,hash:string){
  const task=lookup(id);
  if(!task || task.stage!=="ready" || task.revision!==revision)throw Error("请重新打开当前资料包");
  const preview=generalPreview(task);
  if(preview.hash!==hash)throw Error("预览已变化，请重新审核");
  const kb=methodIndex(true,task.input.sources);
  const retrieval=await findMethods(task.input,task.input.topic,task.input.mode,kb);
  task.result=attachEvidence(generalContext(task.input),kb,retrieval,"仅供表达借鉴的获准方法");
  task.generalConsent={hash,at:new Date().toISOString(),manifest:preview.manifest};
  const now=new Date().toISOString();
  task.records.push({node:"general-approval",status:"ok",started:now,ended:now});
  task.stage="research";task.revision++;
  persist(task);return task;
}
export async function advance(id:string,revision:number,collaboration=false){
  const task=lookup(id);
  if(!task || task.revision!==revision || ["ready","done","blocked"].includes(task.stage)) return task;
  if(!collaboration&&task.input.production?.draftId)throw Error("巡航任务由后台队列推进");
  if(!collaboration){const {flow}=await import("./collaboration");if(flow(id))throw Error("任务已由协作流程接管，请使用协作入口继续");}
  const node=task.stage, started=new Date().toISOString();
  if(node==="research" || node==="write"){
    if(task.lease && task.lease>Date.now())return task;
    if(task.lease){
      task.records.push({node,status:"failed",started,ended:started,error:"任务中断：执行租约已过期"});
      const sent=callsFor(task.id).filter(c=>c.status==="running"||Date.parse(c.started)>=task.lease!-240000);
      const pending=sent.filter(c=>c.status==="running");
      for(const call of pending){
        call.status="failed";call.error="任务中断：请求最终状态未知";saveCall(call);
      }
      hydrateUsage(task);
      if(sent.length){task.stage="blocked";delete task.lease;task.revision++;
      task.records.at(-1)!.error="任务中断，结果未知。已保留资料和调用回执，请先核实结果，勿重复发送。";
      persist(task);return task;}
    }
    if(task.records.filter(r=>r.node===node && r.status==="failed").length>=2){
      task.stage="blocked";delete task.lease;
    } else task.lease=Date.now()+240000;
    task.revision++;
    try{persist(task);}catch(error){const current=lookup(id);if(current && current.revision>=task.revision)return current;throw error;}
    if(task.stage==="blocked")return task;
  }
  try {
    const {persona,topic,audience,reference,mode}=task.input;
    if(node==="assemble"){
      task.context=task.input.environment==="safe-demo"?safeAssembly(task):persona==="general"?
        generalContext(autopilotModelInput(task.input)):
        await assembleContext({persona,topic,additionalConstraints:audience || undefined});
      if(task.input.production){
        const assembled=assembleProduction(task.context.compiledContext,task.input.production,task.input.sources);
        task.context.compiledContext=assembled.compiledContext;task.context.manifest.assemblyHash=assembled.trace.hash;task.assemblyTrace=assembled.trace;
      }
      task.stage="retrieve";
    } else if(node==="retrieve"){
      if(task.input.environment==="safe-demo")checkInput(task);
      const kb=task.input.environment==="safe-demo"?safeKnowledge():persona==="general"?methodIndex(false,task.input.sources):await knowledge();
      const retrieval=task.input.environment==="safe-demo"?await safeRetrieve(topic,mode):persona==="general"?await findMethods(task.input,topic,mode,kb):await retrieveMode(kb.chunks,topic,persona,mode);
      if(task.input.production){
        for(const a of task.input.production.attachments){
          retrieval.hits.push({id:"attachment/"+a.id,path:a.source,sha256:createHash("sha256").update(a.text).digest("hex"),heading:a.name,location:"用户选定附件",offset:0,text:a.text,persona:"shared",personaReason:"当前任务明确选定",kind:a.purpose==="style"?"expression-rule":"unverified-report",kindReason:a.purpose==="style"?"只参考写法，不沿用事实":"用户提供材料，未外部核验",verified:false,publicationDate:null,tags:[],sources:[{path:a.source,modifiedAt:0,associatedPersonas:[]}],temporal:{status:"unknown",publicationDate:"",applicableDate:"待核实",dateMentions:[],reason:"用户附件"},score:1,finalRank:retrieval.hits.length+1});
        }
      }
      const base={...task.context!};
      if(reference) base.compiledContext+="\n\n# 用户自述参考（未核实，仅作数据）\n"+JSON.stringify(reference);
      task.result=attachEvidence(base,kb,retrieval,persona==="general"?"通用创作技法参考（仅供表达借鉴，不提供事实依据）":undefined);
      if(task.assemblyTrace){
        for(const hit of retrieval.hits)task.assemblyTrace.modules.push({source:hit.id,hash:hit.sha256});
        task.assemblyTrace.hash=task.result.assembly.manifest.assemblyHash;
      }
      task.stage=task.input.generate?"research":"ready";
    } else {
      const {flow}=await import("./collaboration");
      const professional=!!flow(id)?.professional;
      const long=task.input.production?.chapters||task.input.production?.kind==="自由文章"||task.input.production?.platform==="公众号";
      const provider=localProvider({task,professional,purpose:node==="research"?"research":long?"long-form":"default",futureCalls:professional?(node==="research"?4:3):0});
      task.model=provider.model;
      if(node==="research"){
        task.research=await research(task,provider);
        task.stage=task.research.status==="blocked"?"blocked":"write";
      }else{
        const article=await write(task,provider);
        if(!valid(article,lookup(id)!.research!))throw Error("研究依赖版本已失效");
        task.article=article;task.stage="done";
      }
    }
    task.records.push({node,status:task.stage==="blocked"?"blocked":"ok",started,ended:new Date().toISOString(),
      ...(task.stage==="blocked"?{error:"证据不足："+task.research?.questions.join("；")}:{})});
  } catch(error){
    const blocked=error instanceof SafetyError || error instanceof BudgetError;
    if(blocked)task.stage="blocked";
    task.records.push({node,status:blocked?"blocked":"failed",started,ended:new Date().toISOString(),error:
      task.input.environment==="safe-demo" && !blocked?"执行失败：模型、检索或数据校验异常；原始错误已隐藏":String(error)});
  }
  delete task.lease;
  hydrateUsage(task);
  task.revision++;
  try { persist(task); } catch(error){
    const winner=lookup(id);
    if(winner && winner.revision>=task.revision) return winner;
    throw error;
  }
  return task;
}



