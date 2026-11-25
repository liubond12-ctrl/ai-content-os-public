import type {Hit} from "../rag/search";
import type {Research} from "./agents";
import type {Task} from "./tasks";
import {catalog} from "./safe-demo-catalog";

export const draftLabel="限定范围草稿，待人工审核";
export const generalLimits=["只作限定的文本观察、观点分析或明确标注的原创虚构示例，不作普遍因果证明。","不得编造统计数据、真实人物经历、模型内部机制或研究结果；未核实主张不得写成确定事实。","创作技法仅作方法参考，案例人物、数据和经历不得迁移；内部规则不得复制进正文。"];
export interface Handoff {
  supported:Array<{sourceId:string;quote:string}>;
  coreGaps:string[];
  limits:string[];
  forbidden:string[];
  scope:string;
  needsFacts:boolean;
  optionalQuestions?:string[];
  writingPlan?:{goal:string;methodIds:string[];steps:string[]};
  requirementChecks?:{required:string[];excluded:string[]};
}
// Evaluate affirmative requirements separately from explicit writing prohibitions.
// Never suppress a positive clause elsewhere in the request.
export function requirementChecks(input:Task["input"]){
  const required:string[]=[],excluded:string[]=[];
  const fact=/(报名(?:日期|时间|费用)|赛事规则|考级.{0,12}(日期|时间|费用|资格)|资格条件|官方费用|升学政策|统计比例|真实统计|内部机制|(?:证明|证实|实证|验证).{0,30}(?:因果|导致|必然|普遍|彻底|机制))/;
  for(const field of [input.topic,input.goal,input.style]){
    for(const raw of (field??"").split(/[。！？；，\n]|但是|但|然而|不过/)){
      const clause=raw.trim();if(!clause)continue;
      const prohibition=/^(?:也)?(?:不对|不得对|不能对).*(?:作|做|给出).*(?:确定结论|确定性结论|确定断言|确定性断言)$/.test(clause) ||
        /^(?:也)?(?:不编造|不得编造|不能编造|不引用|不得引用).+$/.test(clause) ||
        /^(?:也)?(?:不要求|无需|不需要)(?:证明|证实|验证).+$/.test(clause);
      if(prohibition)excluded.push(clause);else if(fact.test(clause))required.push(clause);
    }
  }
  return {required,excluded};
}

// Permissions follow the fixed task, independent of what the model recommends.
export function assess(input:Task["input"], evidence:Hit[], needsFacts:boolean,
  questions:string[], coreGaps:string[], limits:string[]){
  const gaps=new Set(coreGaps);
  const boundaries=new Set(limits);
  const forbidden:string[]=[];
  const safe=input.environment==="safe-demo";
  const general=input.persona==="general" && !safe;
  const requirements=requirementChecks(input);
  const factualDemand=requirements.required.length>0;
  // A method-only creative scope cannot claim to resolve any external facts.
  // Unanchored research suggestions are retained, not promoted to requirements.
  const creativeScope=general && !factualDemand && evidence.length>0 && evidence.every(h=>h.kind==="expression-rule" && h.id.startsWith("general/reference/")) &&
    input.writingScope==="text-analysis";
  const optionalQuestions=creativeScope?[...coreGaps,...questions]:[];
  if(creativeScope){gaps.clear();if(needsFacts || optionalQuestions.length)generalLimits.forEach(x=>boundaries.add(x));}
  if(general && factualDemand && !evidence.some(h=>h.kind==="fact-reference" && h.verified && h.temporal.status==="current-verified"))gaps.add("原要求涉及需要可靠来源的事实或证明，创作方法不能满足");
  const scenario=input.scenario;
  const observation=safe && (scenario==="followup" || scenario==="limited-writing");
  if(/(?:证明|证实|保证).{0,18}(?:彻底解决|复试成功|必然成功|普遍有效)/.test(input.topic))
    gaps.add("观察性证据不能满足原任务要求的证明");
  const ids=new Set(evidence.map(h=>h.id));
  let material=evidence.filter(h=>h.kind!=="production-sop");
  let scope="围绕原任务撰写有来源支持的内容";
  if(!evidence.length)gaps.add("没有可引用资料");
  if(((needsFacts && !creativeScope) || (safe && input.scenario==="missing")) &&
      !evidence.some(h=>h.kind==="fact-reference" && h.verified && h.temporal.status==="current-verified"))
    gaps.add("缺少已核实且当前有效的事实依据");
  if(safe && input.scenario==="expression"){
    material=material.filter(h=>["safe-demo:actions","safe-demo:revision"].includes(h.id));
    if(!material.length)gaps.add("缺少与动作描写有关的写作样例");
  }
  if(observation){
    if(input.topic!==catalog.scenarios[scenario].topic)gaps.add("原要求超出已审核的观察任务范围");
    if(!ids.has("safe-demo:workshop"))gaps.add("缺少初次困难记录");
    if(!ids.has("safe-demo:notebook"))gaps.add("缺少改动和复试观察记录");
    material=material.filter(h=>["safe-demo:workshop","safe-demo:notebook"].includes(h.id));
    boundaries.add("只记录了一次试飞，尚不能确认左偏是否彻底解决。");
    forbidden.push("复试已证明成功","问题已彻底解决","将一次观察推广为普遍效果");
    scope="仅描述虚构手记中的困难、调整与单次复试观察";
  }
  // For fixed observation tasks the checks above exhaust the required scope.
  // Preserve residual questions as limits only after all those checks pass.
  const observationCovered=observation && gaps.size===0;
  for(const q of questions){
    if(creativeScope)continue;
    if(observationCovered)boundaries.add(q);
    else if(!boundaries.has(q))gaps.add(q);
  }
  const generalCovered=general && gaps.size===0 && (!needsFacts || creativeScope) && material.some(h=>h.kind==="expression-rule" && h.id.startsWith("general/reference/"));
  if(boundaries.size && !observation && !generalCovered)gaps.add(input.writingScope==="text-analysis"?"已选择限定范围，但必要事实或方法来源检查未通过":"当前任务没有批准可独立交付的限定写作范围");
  if(generalCovered && boundaries.size){
    generalLimits.forEach(x=>boundaries.add(x));forbidden.push(...generalLimits);
    scope="仅借鉴创作方法开展限定观察、观点分析与明确标注的虚构举例；不得声称完成实证核验";
  }
  const supported=material.flatMap(h=>{
    if(!observation)return [{sourceId:h.id,quote:h.text}];
    const sentences=h.text.replace(/^虚构(?:手记|叙事素材)：/,"").match(/[^。]+。/g)??[];
    const count=h.id==="safe-demo:workshop"?1:2;
    return sentences.slice(0,count).map(quote=>({sourceId:h.id,quote}));
  });
  const handoff:Handoff={supported,coreGaps:[...gaps],limits:[...boundaries],forbidden,scope:gaps.size?"阻塞，暂无可交付范围":scope,needsFacts,requirementChecks:requirements,
    ...(creativeScope?{optionalQuestions,writingPlan:{goal:input.goal||input.topic,methodIds:supported.map(s=>s.sourceId),steps:["围绕用户目标选一个明确标注为虚构的文本示例","使用所选方法展示修改前后表达差异","仅解释例子中可观察的差异，提出有限建议；不回答缺证事实"]}}:{})};
  const status=gaps.size?"blocked":boundaries.size?"ready_with_limits":"ready";
  return {status,handoff} as const;
}

export function writerBrief(r:Research, business=false){
  const supported=r.handoff?.supported??r.evidence.filter(h=>h.kind!=="production-sop").map(h=>({sourceId:h.id,quote:h.text}));
  return {version:r.version,status:r.status,supported,
    ruleRefs:business?r.evidence.filter(h=>h.kind==="production-sop").map(h=>h.id):[],
    scope:r.handoff?.scope,
    limits:r.handoff?.limits,forbidden:r.handoff?.forbidden,writingPlan:r.handoff?.writingPlan};
}
