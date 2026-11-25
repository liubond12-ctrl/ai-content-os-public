"use client";
import {useId,useRef,useState} from "react";
import type {MultiAgentReviewVisual,ReviewAnchor,ReviewExpertRole} from "@/types/multi-agent-review";
import "./review-consultation.css";

const roles = {
  strategy:["内","内容策略"],language:["语","语言表达"],facts:["核","事实核验"],basic:["审","基础审核"],
} as const;
const stances = {agree:"赞同",oppose:"反驳",supplement:"补充",maintain:"维持意见",withdraw:"撤回意见"} as const;

function Badge({role}:{role:ReviewExpertRole}){
  return <span className="consult-role" data-role={role}><span aria-hidden="true">{roles[role][0]}</span>{roles[role][1]}</span>;
}

export function ReviewConsultation({visual,resolved,onLocate,onEdit,onRewrite,applied=false}:{
  visual:MultiAgentReviewVisual;
  resolved:ReadonlySet<string>;
  onLocate:(anchor:ReviewAnchor)=>void;
  onEdit?:(id:string,anchor:ReviewAnchor,text:string)=>Promise<void>;
  onRewrite?:(id:string,anchor:ReviewAnchor,suggestion:string)=>Promise<void>;
  applied?:boolean;
}){
  const lowest=visual.experts.toSorted((a,b)=>a.score-b.score)[0]?.role;
  const [expanded,setExpanded]=useState<ReviewExpertRole|null>(lowest??null);
  const accordionId=useId();
  const [merge,setMerge]=useState<{id:string;text:string}|null>(null);
  const [all,setAll]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const total=visual.experts.length?Math.round(visual.experts.reduce((n,e)=>n+e.score,0)/visual.experts.length):null;
  const exchanges=visual.exchanges;
  const flight=useRef(false);

  async function apply(run:()=>Promise<void>){
    if(flight.current)return;
    flight.current=true;
    setBusy(true);setError("");
    try{await run();setMerge(null);}
    catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{flight.current=false;setBusy(false);}
  }

  return <div className="review-consultation">
    {total!==null&&<header className="consult-overview">
      <div><h3>会诊总览</h3><p>文章 v{visual.version} · 按本次审核待处理项计算</p></div>
      <strong className="consult-score" data-low={total<65} aria-live="polite"><span>草稿处理进度分</span>{total}<small>/100</small></strong>
    </header>}
    {visual.summary.length>0&&<section className="consult-summary"><h3>仲裁摘要</h3>{visual.summary.map(line=><p key={line}>{line}</p>)}</section>}
    {visual.experts.map(expert=><section className="consult-expert" key={expert.role} data-role={expert.role}>
      <button type="button" className="consult-expert-toggle" aria-expanded={expanded===expert.role} aria-controls={accordionId+"-"+expert.role}
        onClick={()=>setExpanded(previous=>previous===expert.role?null:expert.role)}><Badge role={expert.role}/><strong className="consult-expert-score" data-low={expert.score<65}>{expert.score}<small>/100</small></strong></button>
      <div id={accordionId+"-"+expert.role} className="consult-expert-content" hidden={expanded!==expert.role}>
        <p>{expert.observation}</p>
        {expert.suggestions.map(item=><article className="consult-suggestion" key={item.id}>
          <blockquote>{item.anchor.quote}</blockquote>
          <p data-kind="problem"><strong>问题</strong> {item.problem}</p>
          <p data-kind="suggestion"><strong>建议</strong> {item.suggestion}</p>
          <div className="consult-actions">
            <button type="button" onClick={()=>onLocate(item.anchor)}>定位原文</button>
            {resolved.has(item.id)?<span role="status">已修改</span>:onRewrite&&<button type="button" disabled={busy} onClick={()=>void apply(()=>onRewrite(item.id,item.anchor,item.suggestion))}>一键改写</button>}
          </div>
        </article>)}
      </div>
    </section>)}
    {visual.conflicts.map(group=>{
      const first=group.options[0];
      if(!first)return null;
      const resolvedGroup=applied||resolved.has(group.id);
      return <section key={group.id} className="consult-conflict">
        <div className="consult-conflict-heading"><h3>角色分歧{applied?" · 已保存修订":""}</h3>{resolvedGroup&&<span role="status">已处理</span>}</div>
        <blockquote>{first.anchor.quote}</blockquote>
        <div className="consult-options">{group.options.map(option=><article key={option.id} data-role={option.role}>
          <Badge role={option.role}/>
          <p className="consult-option-text">{option.action==="delete"?"删除原句":option.text}</p>
          <p>{option.reason}</p>
          {onEdit&&!resolvedGroup&&<button type="button" disabled={busy} onClick={()=>void apply(()=>onEdit(group.id,option.anchor,option.text))}>{option.action==="retain"?"保留原文":option.action==="delete"?"采纳并删除原句":"采纳此方案替换"}</button>}
          <button type="button" onClick={()=>onLocate(option.anchor)}>定位原文</button>
        </article>)}</div>
        {group.verdict&&<p><strong>裁决</strong> {group.verdict}</p>}
        {onEdit&&!resolvedGroup&&merge?.id===group.id?<div className="consult-merge">
          <label>合并后的文字<textarea rows={3} value={merge.text} onChange={e=>setMerge({...merge,text:e.target.value})}/></label>
          <button type="button" disabled={busy||!merge.text.trim()} onClick={()=>void apply(()=>onEdit(group.id,first.anchor,merge.text.trim()))}>应用合并</button>
          <button type="button" onClick={()=>setMerge(null)}>取消</button>
        </div>:onEdit&&!resolvedGroup&&<button type="button" onClick={()=>setMerge({id:group.id,text:first.anchor.quote})}>自定义合并</button>}
      </section>;
    })}
    {exchanges.length>0&&<section className="consult-discussion">
      <h3>专家辩论</h3>
      <ol>{(all?exchanges:exchanges.slice(0,3)).map(exchange=><li key={exchange.id}><Badge role={exchange.role}/><span className="consult-stance" data-stance={exchange.stance}>{stances[exchange.stance]}</span><p>{exchange.message}</p></li>)}</ol>
      {exchanges.length>3&&<button type="button" aria-expanded={all} onClick={()=>setAll(!all)}>{all?"收起发言":"展开全部 "+exchanges.length+" 条"}</button>}
    </section>}
    {busy&&<p role="status">正在处理建议…</p>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
