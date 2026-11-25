"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import type {Review} from "../studio/eval";
import type {Flow} from "../studio/collaboration";
import type {Opinion} from "../studio/professional-review";
import {conflictGroups,exactRevision,type VersionText} from "../studio/discussion-reader";
import {reviewVisual} from "../studio/review-visual";
import {ReviewConsultation} from "./ReviewConsultation";
type Anchor=Pick<Opinion["issue"],"field"|"quote"|"offset">;
type AuthorView={versions:VersionText[];detailHref:string;returnToBody:()=>void;onReady:()=>void;onLocateVersion:(version:number,issue:Anchor)=>void;unmapped?:Anchor;resolved?:string[];onEdit?:(id:string,anchor:Anchor,text:string)=>Promise<void>;onRewrite?:(id:string,anchor:Anchor,suggestion:string)=>Promise<void>};

export function ArticleReview({taskId,version,stale=false,article,onLocate,onDecide,authorView}:{taskId:string;version:number;article?:{title:string;body:string};stale?:boolean;onDecide?:(review:string,index:number,quote:string,replacement:string,reason:string)=>Promise<void>;onLocate?:(issue:Anchor)=>void;authorView?:AuthorView}){
  const [rows,setRows]=useState<Review[]>([]),[busy,setBusy]=useState(false),[error,warn]=useState("");
  const [ready,setReady]=useState(false),[flow,setFlow]=useState<Flow|null>(null);
  const author=!!authorView;
  const onReady=authorView?.onReady;
  useEffect(()=>{if(ready||error)onReady?.();},[ready,error,onReady]);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/reviews?taskId="+encodeURIComponent(taskId)+"&articleVersion="+version,{signal:controller.signal,cache:"no-store"})
      .then(async r=>{if(!r.ok)throw Error("无法读取审核记录");const data=await r.json();setRows(prev=>[...prev,...data.filter((v:Review)=>!prev.some(p=>p.id===v.id))]);setReady(true);})
      .catch(e=>{if(!controller.signal.aborted)warn(String(e));});
    return ()=>controller.abort();
  },[taskId,version]);
  useEffect(()=>{
    if(!author)return;
    const controller=new AbortController();
    let timer:ReturnType<typeof setTimeout>|undefined;
    async function read(){
      try{
        const response=await fetch("/api/collaboration?taskId="+encodeURIComponent(taskId),{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw Error("无法读取角色意见");
        const data:{flow:Flow|null}=await response.json();
        if(controller.signal.aborted)return;
        setFlow(data.flow);
        if(data.flow&&["ready","running"].includes(data.flow.state))timer=setTimeout(read,2000);
      }catch(e){if(!controller.signal.aborted)warn(String(e));}
    }
    void read();return()=>{controller.abort();clearTimeout(timer);};
  },[taskId,author]);
  const followed=useRef(false);
  useEffect(()=>{
    if(followed.current||!onLocate||!rows.length)return;
    const query=new URLSearchParams(location.search);
    if(Number(query.get("version"))!==version)return;
    const row=rows.find(r=>r.id===query.get("review"));
    const issue=query.has("claim")?row?.result?.facts.checks[Number(query.get("claim"))]:row?.result?.issues[Number(query.get("issue"))];
    if(!issue)return;
    followed.current=true;onLocate(issue);
    document.getElementById("review-"+row!.id)?.scrollIntoView({block:"center"});
  },[rows,version,onLocate]);
  const [decision,edit]=useState<{review:string;index:number;replacement:string;reason:string;mode:string}|null>(null);
  function matches(row:Review){
    if(!article||!row.parsedOutput||row.diagnostic?.code!=="AMBIGUOUS_QUOTE")return [];
    const path=/^(issues|claims)\.(\d+)\.quote$/.exec(row.diagnostic.path??"");
    const item=path&&(row.parsedOutput as Record<string,Array<{field:"title"|"body";quote:string}>>)[path[1]]?.[Number(path[2])];
    if(!item?.quote)return [];
    const value=article[item.field],options=[];
    for(let at=value.indexOf(item.quote);at>=0;at=value.indexOf(item.quote,at+1))options.push({offset:at,context:value.slice(Math.max(0,at-12),at)+"【"+item.quote+"】"+value.slice(at+item.quote.length,at+item.quote.length+12)});
    return options;
  }
  async function resolve(resolveId:string,offset:number){
    setBusy(true);try{const response=await fetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,articleVersion:version,resolveId,offset})});const next=await response.json();if(!response.ok)throw Error(next.error);setRows([next,...rows]);}catch(e){warn(String(e));}finally{setBusy(false);}
  }
  async function run(){
    setBusy(true);warn("");
    try{
      const response=await fetch("/api/reviews",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,articleVersion:version})});
      const data=await response.json();if(!response.ok)throw Error(data.error);
      setRows(prev=>[data,...prev.filter(r=>r.id!==data.id)]);
    }catch(e){warn(String(e));}finally{setBusy(false);}
  }
  function issueControls(r:Review,k:number,i:NonNullable<Review["result"]>["issues"][number]){
    return <>{onLocate&&<button type="button" onClick={()=>onLocate(i)}>定位原文</button>} {onDecide&&<button type="button" disabled={stale} onClick={()=>edit({review:r.id,index:k,replacement:i.quote,reason:"",mode:"retain"})}>处理建议</button>}
        {decision?.review===r.id&&decision.index===k&&onDecide&&<fieldset><legend>决定如何处理这处原句</legend>
        <label>处理方式<select value={decision.mode} onChange={e=>edit({...decision,mode:e.target.value,replacement:e.target.value==="delete"?"":e.target.value==="suggest"?i.suggestion:i.quote})}>
        <option value="retain">保留原文</option><option value="delete">删除这句</option><option value="custom">自己修改</option>{r.rules.includes("professional-v1")&&i.suggestion!=="删除指定片段"&&<option value="suggest">接受建议替换文本</option>}</select></label>
        {decision.mode==="custom"&&<label>替换文字<textarea value={decision.replacement} onChange={e=>edit({...decision,replacement:e.target.value})}/></label>}
        <p>修改预览：{article?.[i.field].slice(Math.max(0,i.offset-16),i.offset)}{decision.mode==="retain"?<mark>{i.quote}</mark>:<><del>{i.quote}</del><ins>{decision.replacement}</ins></>}{article?.[i.field].slice(i.offset+i.quote.length,i.offset+i.quote.length+16)}</p>
        <label>决定理由<input value={decision.reason} onChange={e=>edit({...decision,reason:e.target.value})}/></label>
        <button disabled={busy||stale||!decision.reason.trim()} onClick={async()=>{setBusy(true);try{await onDecide(r.id,k,i.quote,decision.replacement,decision.reason);}finally{setBusy(false);}}}>确认处理</button><button onClick={()=>edit(null)}>取消</button></fieldset>}</>;
  }
  if(authorView){
    function archivedQuote(issue:Anchor){
      if(!article||authorView?.unmapped?.field!==issue.field||authorView.unmapped.offset!==issue.offset)return null;
      const saved=article[issue.field],end=issue.offset+issue.quote.length;
      return <figure className="audit-snapshot"><figcaption>审核时的原文 · 当前草稿已改动</figcaption>
        <blockquote>{saved.slice(Math.max(0,issue.offset-24),issue.offset)}<mark>{issue.quote}</mark>{saved.slice(end,end+32)}</blockquote></figure>;
    }
    const panel=flow?.panels?.findLast(p=>p.articleVersion===version);
    const row=rows.find(r=>r.result);
    const pendingSource=[...(row?.result?.facts.checks??[]),...(panel?.reviews.flatMap(r=>r.result.facts.checks)??[])];
    const savedChecks=[...new Map(pendingSource.slice().reverse().map(c=>[c.field+":"+c.offset+":"+c.quote,c])).values()];
    const pending=savedChecks.filter(c=>c.status!=="来源原文匹配");
    const current=authorView.versions.find(v=>v.version===version);
    const historical=authorView.versions.some(v=>v.version>version);
    const priorDispute=flow?.panels?.find(p=>p.id===current?.revisionReviewId&&conflictGroups(p).length>0);
    const disputed=panel&&conflictGroups(panel).length>0?panel:priorDispute;
    const base=authorView.versions.find(v=>v.version===disputed?.articleVersion);
    const applied=disputed&&base&&current&&exactRevision(disputed,base,current);
    const hasRecord=rows.length>0||!!panel;
    const running=!!panel&&["ready","running"].includes(flow?.state??"")&&flow?.articleVersion===version;
    const reviewing=busy||running;
    const issues=row?.result?.issues??[];
    const blocked=panel?.reviews.some(r=>r.result.status==="blocked")||row?.status==="blocked";
    const pass=!blocked&&!pending.length&&!issues.length&&(panel?.status==="pass"||row?.status==="pass");
    const headline=reviewing?"正在审核这篇文章":pending.length?"有原句待核验":blocked?"有问题需要处理":
      pass?(historical?"该版本审核通过":current?.confirmed?"审核通过，作者已定稿":"审核通过，待作者确认") :
      disputed?"请核对审核分歧":hasRecord?(issues.length||panel?.reviews.some(r=>r.opinions.length)?"请核对修改建议":"请核对已有审核记录"):"这版还没有审核记录";
    const next=stale?"草稿已有修改。以下意见对应正式版本，重新审核也只读取当前正式版本。":
      reviewing?"可以返回正文，稍后再查看结果。":pending.length?"定位原句，补充能核对该句的来源，或改写缺少依据的断言。":
      pass?(historical?"可在修改历史中切回当前稿件。":current?.confirmed?"可回到正文查看定稿。":"核对正文后，由你确认定稿。"):
      disputed?"对照角色意见和裁决，再决定正文是否需要修改。":hasRecord?"查看下方记录，在正文处理需要修改的地方。":"可提交当前正式版本进行基础审核。";
    const visualPanel=disputed??panel;
    const handled=new Set(authorView.resolved);
    if(applied&&disputed)for(const ids of conflictGroups(disputed))handled.add(ids.toSorted().join(":"));
    const visual=reviewVisual(visualPanel?.articleVersion??version,visualPanel,row,handled);
    const auditLabel=hasRecord?"重新审核":"开始审核";
    return <section className="editor-audit" aria-label="作者审核结果">
      {!ready&&!error?<p role="status">正在读取审核记录…</p>:<>
      <div className="editor-audit-lead" data-tone={pending.length||blocked?"attention":pass?"clear":"normal"}>
        <h2>{headline}</h2><p>{next}</p>
        {!pending.length&&<button type="button" className="audit-goto" onClick={authorView.returnToBody}>回到正文</button>}
      </div>
      {pending.map(c=><article className="editor-audit-note" key={c.field+":"+c.offset+":"+c.quote}>
        <blockquote>{c.quote}</blockquote>
        <p><strong>原因</strong> {c.sourceId?"现有来源未能核对此句。":"审核记录中没有匹配的可核实来源。"}</p>
        <p><strong>处理</strong> 补充包含这句主张的来源，或改写、删除缺证部分。</p>
        <button type="button" className="audit-claim-action" onClick={()=>onLocate?.(c)}>定位并改写</button>{archivedQuote(c)}
      </article>)}
      {(visual.experts.length>0||visual.conflicts.length>0)&&<ReviewConsultation key={visualPanel?"panel:"+visualPanel.id:"basic:"+row?.id} visual={visual} resolved={handled} applied={!!applied}
        onEdit={visual.version===version?authorView.onEdit:undefined} onRewrite={visual.version===version?authorView.onRewrite:undefined}
        onLocate={issue=>visual.version===version?onLocate?.(issue):authorView.onLocateVersion(visual.version,issue)}/>}
      {rows[0]&&matches(rows[0]).map((m,i)=><button key={m.offset} disabled={reviewing||stale} onClick={()=>resolve(rows[0].id,m.offset)}>选定第 {i+1} 处 · {m.context}</button>)}
      {rows[0]?.error&&!reviewing&&<p role="status">{rows[0].error}</p>}
      <div className="editor-audit-rerun">
        <button type="button" disabled={!ready||reviewing} aria-describedby="editor-audit-call" onClick={()=>{if(window.confirm(auditLabel+"会请求配置的模型，云端模型可能计费。继续？"))void run();}}>{reviewing?"审核中…":auditLabel}</button>
        <p id="editor-audit-call">对正式版本发起一次基础审核，会调用已配置的模型。使用云端模型时可能计费。</p>
      </div>
      {hasRecord&&<details className="editor-audit-evidence"><summary>查看完整审核记录与来源</summary>
        <Link href={authorView.detailHref}>打开审核记录页</Link>
        {savedChecks.filter(c=>c.status==="来源原文匹配").map(c=><p key={c.field+c.offset}>{c.quote} · {c.sourceId}</p>)}
        {rows.filter(r=>r.sourceIds.length).map(r=><p key={r.id}>审核记录来源 · {r.sourceIds.join("、")}</p>)}
        {rows.length>0&&<details><summary>查看本版审核明细</summary><pre>{JSON.stringify(rows,null,2)}</pre></details>}
      </details>}
      </>}
      {error&&<p role="alert">{error}</p>}
    </section>;
  }
  return <section><h2>文章审核</h2><p>审核文章 v{version}，使用本任务配置的模型与剩余额度。</p>
    {stale&&<p role="status">草稿已有修改；以下审核仅针对正式版本 v{version}，不代表当前草稿通过。请先保存新版本再审核。</p>}
    <button onClick={run} disabled={busy}>{busy?"审核中…":"开始审核"}</button><p role="status">{error}</p>
    {rows.map(r=><details id={"review-"+r.id} key={r.id} open={rows[0].id===r.id||new URLSearchParams(location.search).get("review")===r.id}><summary>审核 v{r.version} · {r.status}</summary>
      <details><summary>模型与用量记录</summary><p>{r.model} · {r.durationMs??0} ms · Tokens {r.call?.usage&&r.call.usage!=="unknown"?r.call.usage.total_tokens:"未知或未调用"}</p></details>
      {r.error&&<p>{r.error}</p>}{rows[0].id===r.id&&matches(r).map((m,i)=><button key={m.offset} disabled={busy||stale} onClick={()=>resolve(r.id,m.offset)}>选定第 {i+1} 处 · {m.context}</button>)}
      {r.result&&<><p>基础审核标签（业务合格需按已配置标准确认）：{r.result.label}</p>{Object.entries(r.result.dimensions).map(([k,v])=><p key={k}><strong>{k}</strong> {v}</p>)}
        {r.result.issues.map((i,k)=><section key={k}><blockquote>{i.quote}</blockquote><p>{i.reason}。建议：{i.suggestion}</p>
        {issueControls(r,k,i)}</section>)}
        <p>事实核验：{r.result.facts.triggered?"已触发，仅核对本地资料":"本次无需核验"}</p>
        {r.result.facts.requestClaims?.map((c,k)=><p key={k}>需求中待核对：{c.quote}</p>)}
        {r.result.facts.checks.map((c,k)=><p key={k}>{c.quote} · {c.status} {c.sourceId} {c.critical&&c.status!=="来源原文匹配"&&<span>请补充能核对此句的来源并重新审核，或删除无依据的断言。 <a href="/studio/cases">查看资料库</a></span>}</p>)}</>}
    </details>)}</section>;
}
