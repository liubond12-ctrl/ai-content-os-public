import {z} from "zod";
import {assertCloudTask,cloudPayload} from "./production-cloud";
import {productionBudget} from "./production-schema";
import {DatabaseSync} from "node:sqlite";
import type {Task} from "./tasks";
import {checkOutbound,checkEvalOutbound,preflight,SafetyError} from "./safe-demo";
import {reserveCall,saveCall,BudgetError,OUTPUT_LIMIT} from "./usage";
import {verifyDemo,messageSuffix} from "./eval-demo";
import {ReviewError} from "./review-error";
import {feishuMethods} from "./feishu";
import {authorizedPayload} from "./general-approval";
import {parseDecision} from "./research-contract";

export interface ModelProvider {
  model:string;
  json(instruction:string, data:unknown):Promise<unknown>;
}
export interface ModelReceipt {
  model:string;
  status:number;
  usage?:{prompt_tokens:number;completion_tokens:number;total_tokens:number;prompt_cache_hit_tokens?:number;prompt_cache_miss_tokens?:number};
}
function resolveTarget(){
  const raw=(process.env.STUDIO_MODEL_URL??"http://127.0.0.1:11434/v1/chat/completions").trim();
  const denied=()=>new SafetyError("只允许本机 127.0.0.1 HTTP 或指定的 DeepSeek HTTPS 接口");
  if(!/^https?:\/\//i.test(raw) || /[\\?#\s]/.test(raw) || raw.split("/")[2].includes("@"))throw denied();
  let url:URL;
  try{url=new URL(raw);}catch{throw denied();}
  const deepseek=url.href==="https://api.deepseek.com/chat/completions" && raw.endsWith("/chat/completions") &&
    /^https:\/\/api\.deepseek\.com(?::443)?\/chat\/completions$/i.test(raw);
  if(!deepseek && !(url.protocol==="http:" && /^http:\/\/127\.0\.0\.1(?::\d+)?(?:\/|$)/i.test(raw)))throw denied();
  return {url,deepseek};
}
export function localProvider(options:{task?:Task;evalId?:string;maxTokens?:number;professional?:boolean;futureCalls?:number;onResponse?:(receipt:ModelReceipt)=>void}={}):ModelProvider {
  const {url,deepseek}=resolveTarget();
  const productionCloud=deepseek&&options.task?.input.production?.mode==="真实云端";
  if(productionCloud)assertCloudTask(options.task!);
  if(options.professional && !productionCloud && (deepseek||options.task?.generalConsent||options.task?.input.environment))throw new SafetyError("专业审核、讨论、Judge及修订仅限普通本机任务，云端用途尚未授权");
  const fixed=!!options.evalId && !!options.task?.id.startsWith("safe-eval:");
  if(options.evalId && ((deepseek&&!fixed&&!productionCloud) || !options.task))throw new SafetyError("Eval 仅开放本机推理；当前云端审批不包含审核");
  const general=deepseek && !options.evalId && options.task?.input.persona==="general" && !!options.task.generalConsent;
  if(!options.evalId && options.task?.generalConsent && !general)throw new SafetyError("授权目标已变化");
  const guarded=(!general && !productionCloud && deepseek) || options.task?.input.environment==="safe-demo";
  if(guarded && !fixed && (!options.task || !preflight(options.task).approved))
    throw new SafetyError("安全阻塞：模型目标要求已审核的 safe-demo 任务");
  const model=process.env.STUDIO_MODEL;
  if(!model) throw Error("模型未配置：请在 .env.local 设置 STUDIO_MODEL 和 STUDIO_MODEL_URL");
  const plan=options.task?.input.production?.budget;
  const cap=plan?productionBudget(options.task!.input.production!.kind,plan.profile):undefined;
  if(cap?.profile==="local_extended"&&deepseek)throw new SafetyError("本机长文额度不授权云端调用");
  const outputCap=cap?.output??OUTPUT_LIMIT;
  const maxTokens=z.number().int().min(1).max(outputCap).parse(options.maxTokens??(options.evalId?Math.min(outputCap,2000):outputCap));
  return {model, async json(instruction,data){
    if(options.task){const {flow}=await import("./collaboration");const f=flow(options.task.id);if(f&&["stopped","unknown"].includes(f.state))throw new SafetyError("流程已停止或结果未知，不再发起新请求");}
    if(options.task){
      const used=[...(options.task.result?.retrieval.hits??[]),...(options.task.tools??[]).flatMap(trace=>trace.hits)].filter(h=>h.id.startsWith("general/reference/fs-"));
      if(used.length){
        const available=new Set(feishuMethods().filter(r=>!deepseek||r.allowExternal).map(r=>"general/reference/"+r.id+"/v"+r.version));
        if(used.some(hit=>!available.has(hit.id)))throw new SafetyError("资料授权或版本已变化，已保留草稿，请重新准备资料。");
      }
    }
    if(productionCloud)data=cloudPayload(options.task!,data);
    if(general)data=authorizedPayload(options.task!,data,instruction);
    if(guarded && !options.evalId)checkOutbound(options.task!,data);
    if(guarded && options.evalId && !fixed)checkEvalOutbound(options.task!,data);
    const messages=[
      {role:"system",content:instruction+messageSuffix},
      {role:"user",content:JSON.stringify(data)}];
    if(fixed){
      if(!deepseek)throw new SafetyError("固定验收仅允许清单中的模型目标");
      verifyDemo(options.task!,messages);
    }
    const reservation=options.task?reserveCall(options.task,model,messages,maxTokens,options.evalId?"eval:"+options.evalId:undefined,options.task?.input.production?{requests:cap?.requests??6,tokens:cap?.tokens??20000,future:options.futureCalls??0}:options.professional?{requests:32,tokens:120000,future:options.futureCalls??0}:undefined):undefined;
    const call=reservation?.record;
    if(productionCloud&&call){
      const audit=new DatabaseSync(process.env.STUDIO_DB!);
      try{audit.exec("CREATE TABLE IF NOT EXISTS production_call_payloads(call TEXT PRIMARY KEY,task TEXT,article INTEGER,messages TEXT,response TEXT)");
        audit.prepare("INSERT INTO production_call_payloads VALUES(?,?,?,?,NULL)").run(call.id,options.task!.id,options.task!.article?.version??options.task!.revision,JSON.stringify(messages));
      }finally{audit.close();}
    }
    try{
    const response=await fetch(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(60000),
      headers:{"Content-Type":"application/json",...(process.env.STUDIO_MODEL_KEY?{Authorization:"Bearer "+process.env.STUDIO_MODEL_KEY}:{})},
      body:JSON.stringify({model,stream:false,max_tokens:maxTokens,
        ...(deepseek?{thinking:{type:"disabled"},response_format:{type:"json_object"}}:{}),messages})});
    if(!response.ok) throw Error("模型接口返回 HTTP "+response.status);
    const body=z.object({model:z.string(),usage:z.object({
      prompt_tokens:z.number().int().nonnegative(),completion_tokens:z.number().int().nonnegative(),
      total_tokens:z.number().int().nonnegative(),prompt_cache_hit_tokens:z.number().optional(),prompt_cache_miss_tokens:z.number().optional()
    }).optional(),choices:z.array(z.object({finish_reason:z.string(),message:z.object({content:z.string()})})).min(1)}).parse(await response.json());
    if(call && reservation){
      call.model=body.model;
      const usage=body.usage;
      if(usage && usage.prompt_tokens+usage.completion_tokens===usage.total_tokens)call.usage=usage;
      if(usage&&call.usage!=="unknown"){
        if(!deepseek)call.estimatedCny=0;
        else if(productionCloud&&model==="deepseek-flash"){
          const hit=usage.prompt_cache_hit_tokens??0;
          call.estimatedUsd=((usage.prompt_tokens-hit)*0.3+hit*0.006+usage.completion_tokens*1.2)/1e6;
          call.pricing={source:"https://api-docs.deepseek.com/quick_start/pricing/",checkedAt:"2026-11-05",basis:"按官方峰值单价保守估算，未核对优惠、谷段与实扣",currency:"USD",input:0.3,cachedInput:0.006,output:1.2};
        }
        else if(process.env.STUDIO_PRICE_MODEL===model&&Date.now()<Date.parse(process.env.STUDIO_PRICE_EXPIRES??"")){
          const input=Number(process.env.STUDIO_INPUT_CNY_PER_MILLION??NaN),output=Number(process.env.STUDIO_OUTPUT_CNY_PER_MILLION??NaN);
          if(Number.isFinite(input)&&input>=0&&Number.isFinite(output)&&output>=0)call.estimatedCny=(input*usage.prompt_tokens+output*usage.completion_tokens)/1e6;
        }
      }
      saveCall(call);
      if(call.usage!=="unknown" && reservation.previousTokens+call.usage.total_tokens>reservation.tokenLimit)
        throw new BudgetError("预算阻止：实际回执超过任务额度，剩余 Tokens 0");
    }
    if(options.evalId&&call&&options.task){
      const audit=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
      try{audit.exec("CREATE TABLE IF NOT EXISTS review_responses(call TEXT PRIMARY KEY,task TEXT,version INTEGER,finish TEXT,content TEXT)");
        audit.prepare("INSERT INTO review_responses VALUES(?,?,?,?,?)").run(call.id,options.task.id,options.task.article?.version??options.task.revision,body.choices[0].finish_reason,body.choices[0].message.content);
      }finally{audit.close();}
    }
    if(productionCloud&&call){const audit=new DatabaseSync(process.env.STUDIO_DB!);try{audit.prepare("UPDATE production_call_payloads SET response=? WHERE call=?").run(JSON.stringify(body),call.id);}finally{audit.close();}}
    options.onResponse?.({model:body.model,status:response.status,usage:body.usage});
    if(body.choices[0].finish_reason!=="stop") throw new ReviewError("model_content",body.choices[0].finish_reason==="length"?"OUTPUT_TRUNCATED":"OUTPUT_INTERRUPTED","choices.0.finish_reason");
    if(!deepseek && body.model!==model) throw Error("返回模型与配置的模型 ID 不一致");
    let result:unknown;
    try{result=JSON.parse(body.choices[0].message.content);}catch{
      if(options.evalId)throw new ReviewError("model_content","JSON_PARSE_ERROR","choices.0.message.content");
      throw new ReviewError("model_content","JSON_PARSE_ERROR","choices.0.message.content");
    }
    if(options.task?.stage==="research" && !options.evalId)result=parseDecision(result);
    if(call)call.status="ok";
    return result;
    }catch(error){
      if(!call)throw error;
      call.status="failed";
      if(error instanceof ReviewError){call.error=error.message;throw error;}
      if(error instanceof Error && error.name==="TimeoutError"){
        call.error="预算阻止：模型调用超时；此次已计数，剩余 Tokens unknown";
        throw new BudgetError(call.error);
      }
      call.error=error instanceof BudgetError?error.message:"模型请求失败或超时；未结算用量按 unknown 保留";
      throw error instanceof BudgetError?error:new Error(call.error);
    }finally{
      if(call){call.ended=new Date().toISOString();call.durationMs=Date.parse(call.ended)-Date.parse(call.started);saveCall(call);}
    }
  }};
}

