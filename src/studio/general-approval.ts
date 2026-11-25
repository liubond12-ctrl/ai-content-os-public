import {createHash} from "node:crypto";
import {generalContext,methodIndex,references} from "./library";
import {SafetyError} from "./safe-demo";
import type {Task} from "./tasks";
import {researchPrompt,generalWritingPrompt} from "./agents";
import {generalLimits} from "./writability";
import {messageSuffix} from "./eval-demo";

export function generalPreview(t:Task){
  if(t.input.persona!=="general" || t.input.environment || t.input.reference || !t.result)
    throw new SafetyError("仅允许通用任务预览");
  const input=t.input;
  const cases=references();
  const methods=methodIndex(true,t.input.sources).chunks.map(c=>{
    const item=cases.find(r=>c.id===`general/reference/${r.id}/v${r.version}`)!;
    return {id:c.id,hash:c.sha256,method:c.text,tags:c.tags,source:item.source,rights:item.rights,version:item.version,allowExternal:true};
  });
  const manifest={taskId:t.id,model:process.env.STUDIO_MODEL,endpoint:process.env.STUDIO_MODEL_URL,
    input,rules:generalContext(input).compiledContext,methods,
    instructions:{research:researchPrompt(true)+messageSuffix,write:generalWritingPrompt+messageSuffix},
    writingBoundaries:generalLimits,
    writingPlan:{goal:input.goal||input.topic,steps:["构造明确标注的原创示例","按所选技法比较表达差异","提出有限建议，不回答缺证事实"]},
    limits:{requests:6,maxOutputTokens:800,conservativeTotalTokens:20000},
    handoff:"研究轮次标志、已审方法的子集；写作接收被选方法与研究版本。案例原文及事实备注不发送。"};
  if(manifest.endpoint!=="https://api.deepseek.com/chat/completions" || !manifest.model || !methods.length)
    throw new SafetyError("请配置指定 DeepSeek 地址和模型，并准备至少一条允许外发的方法");
  const json=JSON.stringify(manifest);
  if(/sk-[\w-]{12,}|Bearer\s+\S+|resources\/source-pack/i.test(json) || (process.env.STUDIO_MODEL_KEY && json.includes(process.env.STUDIO_MODEL_KEY)))throw new SafetyError("任务内容疑似包含凭证或内部路径");
  return {manifest,hash:createHash("sha256").update(json).digest("hex")};
}
export function authorizedPayload(t:Task,data:unknown,instruction:string){
  const {manifest,hash}=generalPreview(t);
  if(!t.generalConsent || t.generalConsent.hash!==hash)throw new SafetyError("本任务未授权或预览已变化");
  if((t.stage!=="research" && t.stage!=="write") || instruction+messageSuffix!==manifest.instructions[t.stage])throw new SafetyError("模型指令不在本任务批准范围");
  const p=data as {evidence?:Array<{id:string;text:string}>;lastRound?:boolean;research?:{version:number;supported:{sourceId:string;quote:string}[]}};
  function method(id:string,text:string){
    const item=manifest.methods.find(m=>m.id===id && m.method===text);
    if(!item)throw new SafetyError("研究引用不在本任务批准的方法内");
    return {id:item.id,text:item.method,tags:item.tags};
  }
  if(t.stage==="research" && Array.isArray(p.evidence))return {input:manifest.input,lastRound:p.lastRound,evidence:p.evidence.map(h=>method(h.id,h.text))};
  if(t.stage==="write" && p.research && p.research.version===t.research?.version)
    return {input:manifest.input,rules:manifest.rules,research:{version:p.research.version,status:t.research!.status,ruleRefs:[],writingPlan:manifest.writingPlan,needsFacts:t.research!.handoff?.needsFacts,limits:manifest.writingBoundaries,forbidden:manifest.writingBoundaries,scope:"仅借鉴创作方法，不得将参考案例转为事实",supported:p.research.supported.map(s=>{
      const m=method(s.sourceId,s.quote);return {sourceId:m.id,quote:m.text};
    })}};
  throw new SafetyError("不允许的通用任务模型请求");
}
