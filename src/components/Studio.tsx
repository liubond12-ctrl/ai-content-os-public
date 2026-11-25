"use client";
import {TaskBriefNotes} from "./TaskBriefNotes";
import Link from "next/link";
import {articleReturn,editorHref} from "@/studio/article-navigation";
import {Collaboration} from "@/components/Collaboration";
import {useEffect,useState} from "react";
import type {ArticleSnapshot} from "@/studio/article-store";
import type {Task} from "@/studio/tasks";
import {taskGuidance} from "@/studio/task-guidance";
import {ArticleReview} from "@/components/ArticleReview";
import type {generalPreview} from "@/studio/general-approval";

const stages={assemble:"等待装配规则",retrieve:"规则已装配，等待检索",ready:"资料包已就绪",research:"研究阶段",write:"写作阶段",done:"文章已生成，待人工审阅",blocked:"任务受阻"};
const terminal=(t:Task)=>["ready","blocked","done"].includes(t.stage);
type StudioTask=Task&{detail?:{article:Pick<ArticleSnapshot,"title"|"body"|"version"|"confirmed"|"researchVersion"|"citations"|"reviewLabel">|null;status?:string;reason?:string}};
const taskStatus=(task:StudioTask)=>task.detail?.status??stages[task.stage];
async function request(input?:unknown,id?:string):Promise<StudioTask>{
  const response=input ? await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)}) :
    await fetch("/api/tasks?detail=1&id="+encodeURIComponent(id??""),{cache:"no-store"});
  const data=await response.json();
  if(!response.ok) throw Error(data.error??"任务请求失败");
  return data;
}
export default function Studio({initialTopic,initialPin,localModel,initialDiscussion=false}:{initialDiscussion?:boolean;initialTopic:string;initialPin:string;localModel:boolean}){
  const [discussion,setDiscussion]=useState(initialDiscussion);
  const [task,show]=useState<StudioTask|null>(null),[busy,lock]=useState(false),[error,warn]=useState("");
  const [sources,setSources]=useState<Array<{id:string;title:string;version:number}>>([]),[chosen,choose]=useState<string[]>(initialPin?[initialPin]:[]);
  const missing=chosen.filter(pin=>!sources.some(s=>s.id+"@"+s.version===pin));
  useEffect(()=>{fetch("/api/references").then(r=>r.json()).then(setSources).catch(()=>warn("资料库读取失败，请刷新重试。"));},[]);
  const [identifier,setId]=useState("");
  const [profile,setProfile]=useState("general"),[importStatus,setImportStatus]=useState("");
  const [preview,setPreview]=useState<(ReturnType<typeof generalPreview>&{revision:number})|null>(null);
  const [progress,setProgress]=useState("");
  useEffect(()=>{const id=new URLSearchParams(window.location.search).get("taskId");if(id)request(undefined,id).then(t=>{show(t);setId(t.id);setProgress(taskStatus(t));}).catch(e=>warn(String(e)));},[]);
  const openedTask=task?.id;
  useEffect(()=>{if(openedTask&&initialDiscussion)document.getElementById("task-discussion")?.scrollIntoView({block:"start"});},[openedTask,initialDiscussion]);
  const productionTaskId=task?.input.production?task.id:undefined;
  useEffect(()=>{
    if(!productionTaskId)return;
    let active=true;
    const timer=setInterval(()=>{
      request(undefined,productionTaskId).then(next=>{
        if(active){show(next);setProgress(taskStatus(next));warn("");}
      }).catch(e=>{if(active)warn(String(e));});
    },3000);
    return()=>{active=false;clearInterval(timer);};
  },[productionTaskId]);
  async function run(action:()=>Promise<Task>,execute:boolean){
    lock(true);warn("");setProgress("正在提交请求，请勿重复点击…");
    try {
      let current=await action();
      show(current);setId(current.id);
      setProgress(taskStatus(current));
      while(execute && !terminal(current)){
        if(current.lease && current.lease>Date.now())break;
        current=await request({id:current.id,revision:current.revision});
        show(current);
        setProgress(current.records.at(-1)?.error??taskStatus(current));
        if(current.records.at(-1)?.status==="failed") break;
      }
    } catch(e){warn(String(e));setProgress("请求未完成。请先重新打开任务检查状态，勿直接重复生成。");} finally {lock(false);}
  }
  const article=task?.detail?.article??(task?.article?.researchVersion===task?.research?.version?task?.article:undefined);
  const confirmed=task?.detail?.article?.confirmed===true;
  const interrupted=task?.records.at(-1)?.error?.match(/中断|结果未知|租约|重复发送/);
  const queueStatus=task?.detail?.status;
  const queueActive=productionTaskId&&["排队","整理资料","生成","审核","修订"].includes(queueStatus??"");
  const queueReason=task?.detail?.reason||"";
  const guidance=taskGuidance(queueReason,!!article);
  const nextStep=confirmed?"可查看并导出已定稿的版本。":
    queueStatus==="待人工审核"?"核对当前正文与审核意见，然后确认定稿。":
    queueStatus==="受阻"?guidance?.next??(article?"打开审核查看原句，补充可核实的来源，或改写缺少依据的断言。":"展开执行记录查看受阻原因，再决定如何补充资料。"):
    queueStatus==="失败"||queueStatus==="已停止"?guidance?.next??"查看执行记录，并从执行队列决定是否继续。":
    "后台会继续处理。可以离开页面，稍后从首页或我的内容找回。";
  const back=articleReturn(task?.id??"",task?new URLSearchParams(location.search).get("returnTo")??undefined:undefined);
  if(task&&productionTaskId&&article&&!queueActive){
    const bodyHref=editorHref(task.id,back.source);
    return <main className="app-shell author-review-page">
      <a className="author-back" href={back.href}>← {back.label}</a>
      <h1>{article.title}</h1>
      <Collaboration key={task.id} taskId={task.id} progress={{task,status:taskStatus(task)}} authorView={{status:taskStatus(task),bodyHref}} returnTo={back.source}/>
      <TaskBriefNotes taskId={task.id}/>
      <details className="author-diagnostics"><summary>任务与执行记录</summary>
        <p>{nextStep}</p>{queueReason&&<p>{queueReason}</p>}
        <p>文章 v{article.version} · 研究 v{article.researchVersion} · {task.model}</p>
        <Link href="/production/queue">打开执行队列</Link>
        <pre>{JSON.stringify({...task,detail:undefined},null,2)}</pre>
      </details>
    </main>;
  }
  return <main className="app-shell">
    
    {!productionTaskId&&<header><h1>{task?"内容进度":"真实创作"}</h1>
    <p>从创作需求中匹配可借鉴的方法，查看适用场景与来源。</p><Link href="/studio/cases">浏览写作参考库</Link></header>}
    {!productionTaskId&&<details><summary>导入一条原创或获许可的参考案例</summary><label>选择案例 JSON 文件
      <input type="file" accept=".json" onChange={async e=>{
        const file=e.target.files?.[0];if(!file)return;
        try{
          if(file.size>64000)throw Error("案例文件应小于 64 KB");
          const response=await fetch("/api/references",{method:"POST",headers:{"Content-Type":"application/json"},body:await file.text()});
          const data=await response.json();if(!response.ok)throw Error(data.error);
          setImportStatus("已导入 "+data.title+" v"+data.version);
        }catch(error){setImportStatus(String(error));}
      }}/></label><p role="status">{importStatus}</p></details>}
    {!task&&<form className="brief" onSubmit={e=>{e.preventDefault();const input=Object.fromEntries(new FormData(e.currentTarget));if(!input.writingScope)delete input.writingScope;void run(()=>request({...input,...(profile==="general"&&chosen.length?{sources:chosen}:{}),generate:input.generate==="on"}),true);}}>
      <label>内容主题<input name="topic" defaultValue={initialTopic} required maxLength={240}/></label>
      <label>受众要求<textarea name="audience" maxLength={600}/></label>
      {profile==="general"&&<details open={!!initialPin}><summary>选择参考资料 · {chosen.join("、")||"自动检索"}</summary>{missing.map(pin=><p role="alert" key={pin}>{pin} 未找到对应版本。<button type="button" onClick={()=>choose(chosen.filter(c=>c!==pin))}>移除此选择，重新选参考</button></p>)}{sources.map(s=><label key={s.id}><input type="checkbox" checked={chosen.includes(s.id+"@"+s.version)} onChange={e=>choose(e.target.checked?[...chosen,s.id+"@"+s.version]:chosen.filter(id=>id!==s.id+"@"+s.version))}/>{s.title} · v{s.version}</label>)}</details>}
      <details><summary>更多创作要求与检索设置</summary>
      <label>创作配置<select name="persona" value={profile} onChange={e=>setProfile(e.target.value)}><option value="general">通用创作</option><option value="demoa">历史实验 · 示例甲</option><option value="demob">历史实验 · 示例乙</option></select></label>
      {profile==="general"&&<label>内容形式<select name="format"><option>图文文章</option><option>口播稿</option><option>短视频脚本</option></select></label>}
      {profile==="general"&&<label>允许的交付范围<select name="writingScope" defaultValue=""><option value="">按完整原要求研究（必要事实缺失则阻塞）</option><option value="text-analysis">仅文本分析与原创虚构示例；缺证主张不作结论</option></select></label>}
      {profile==="general"?<><label>创作目标（可选）<input name="goal" maxLength={240}/></label>
      <label>风格、技法或特殊要求（可选）<textarea name="style" maxLength={600}/></label></>:<label>补充参考原文（可选）<textarea name="reference" maxLength={4000}/></label>}
      <label>检索方式<select name="mode" defaultValue="keyword"><option value="semantic">按语义</option><option value="keyword">按关键词</option><option value="hybrid">关键词与语义混合</option></select></label>
      </details>
      <button className="primary-button" disabled={busy||!!missing.length}>准备资料</button>
    </form>}
    {!productionTaskId&&<details><summary>找回已有任务</summary><label>任务 ID<input value={identifier} onChange={e=>setId(e.target.value)}/></label>
    <button disabled={busy||!identifier.trim()} onClick={()=>run(()=>request(undefined,identifier.trim()),false)}>打开任务</button></details>}
    {error&&<p role="alert">{error}</p>}
    {!productionTaskId&&(progress||error)&&<aside aria-live="polite" style={{position:discussion?"static":"sticky",top:0,zIndex:20,background:"var(--background, white)",padding:12,border:"1px solid currentColor"}}><p role="status">{progress}</p>{error&&<p role="alert">{error}</p>}</aside>}

    {task&&<section className={productionTaskId?"production-progress":undefined} aria-live="polite">{productionTaskId?<><a className="author-back" href={back.href}>← {back.label}</a><h1>{task.input.topic}</h1></>:<h2>{task.input.topic}</h2>}{(!queueActive||article)&&<p>{queueActive?"文章 v"+article?.version:taskStatus(task)+(article?" · 文章 v"+article.version:"")}</p>}{productionTaskId&&<><TaskBriefNotes taskId={task.id}/><p>{nextStep}</p><div className="actions task-page-actions">{article&&<Link href={editorHref(task.id,back.source)}>打开正文与审核建议 →</Link>}{!confirmed&&article&&<a href="#task-discussion">{queueStatus==="受阻"?"查看待核验原句与审核意见":"查看审核意见"}</a>}<Link href="/production/queue">打开执行队列</Link></div></>}
    {productionTaskId?<div id="task-discussion"><Collaboration key={task.id} taskId={task.id} progress={{task,status:taskStatus(task)}} returnTo={back.source}/></div>:<details id="task-discussion" open={discussion} onToggle={e=>setDiscussion(e.currentTarget.open)}><summary>协作审核与争议详情</summary>{discussion&&<Collaboration key={task.id} taskId={task.id} returnTo={back.source}/>}</details>}{!confirmed&&task.records.at(-1)?.error&&<p role="alert">{task.records.at(-1)?.error}</p>}
    {task.stage==="ready"&&<section><h2>本次资料</h2><p>{task.result?.retrieval.hits.map(h=>h.id).join("、")||"未检索到可用资料"}</p>
    {localModel&&<button disabled={busy} onClick={()=>run(()=>request({localWrite:true,id:task.id,revision:task.revision}),true)}>开始写初稿 · 本机模型</button>}</section>}
    {task.stage==="ready"&&!localModel&&task.input.persona==="general"&&<section><button disabled={busy} onClick={async()=>{
      try{const r=await fetch("/api/tasks/generation?id="+task.id,{cache:"no-store"});const p=await r.json();if(!r.ok)throw Error(p.error);setPreview(p);warn("");}catch(e){warn(String(e));}
    }}>开始生成文章 · 查看外发预览</button>
    {preview?.manifest.taskId===task.id&&<><p>本次将向 {preview.manifest.model} 发送下列任务内容及可选方法。仅授权本任务的研究与写作，可能产生费用。</p>
    <p>原资料包中未允许外发的案例将排除。确认后，仅在下列方法范围重新检索及补查；不发送案例原文，不将方法当作事实。最多 6 次模型请求，每次输出最多 800 Tokens，沿用累计 20,000 Tokens 保守预算保护。</p>
    <p>拟采用的技法：{preview.manifest.methods.map(m=>m.method).join("；")}</p><details><summary>查看完整外发清单</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify(preview.manifest,null,2)}</pre></details>
    <button disabled={busy} onClick={()=>run(async()=>{
      setProgress("正在确认任务授权并检索获准资料，请勿重复点击…");
      const r=await fetch("/api/tasks/generation",{method:"POST",signal:AbortSignal.timeout(30000),headers:{"Content-Type":"application/json"},body:JSON.stringify({id:task.id,revision:preview.revision,hash:preview.hash,approved:true})});
      const data=await r.json().catch(()=>null);if(!r.ok)throw Error(`授权请求 HTTP ${r.status}：${data?.error??"服务返回非 JSON 错误"}`);if(!data?.id)throw Error("授权接口返回无效任务，请重新打开任务核对状态");setPreview(null);return data;
    },true)}>{busy?"正在处理，请勿重复点击…":"授权本任务并开始生成文章"}</button>
    <p role="status">{progress}</p>{error&&<p role="alert">{error}</p>}</>}</section>}
    {!productionTaskId&&!terminal(task)&&<button disabled={busy} onClick={()=>run(()=>request(undefined,task.id),true)}>刷新并继续未完成阶段</button>}
    {task.model&&<p>模型 {task.model}</p>}
    {!confirmed&&task.stage==="blocked"&&interrupted&&<section><h2>执行中断 · 先核对回执</h2><p>保留任务与草稿。检查下方执行记录以及模型服务的请求记录，确认结果前不要重新生成。</p></section>}
    {!confirmed&&task.stage==="blocked"&&!interrupted&&<details open id="gap" ref={el=>{if(el&&location.hash==="#gap")el.scrollIntoView();}}><summary>补充资料后继续</summary><p>原任务与回执已保留。可在资料库添加有权使用的来源，再以原主题新建需求。现实事实需要可核实的依据。</p><a href="/studio/cases">管理资料</a> · <a href={"/studio?topic="+encodeURIComponent(task.input.topic)}>用原主题重新准备</a></details>}
    {task.research&&<p>研究版本 {task.research.version} · {task.research.status} {task.research.questions.join("；")}</p>}
    {!!task.tools?.length&&<details><summary>研究查询与来源 · {task.tools.length} 次</summary>{task.tools.map((x,i)=><div key={i}><strong>{x.query}</strong>{x.error?<p>{x.error}</p>:x.hits.length?<ul>{x.hits.map(h=><li key={h.id}>{h.path} · {h.location}</li>)}</ul>:<p>没有命中</p>}</div>)}</details>}
    {article&&<article aria-label="当前正式正文">{!confirmed&&article.reviewLabel&&<strong>{article.reviewLabel}</strong>}<h2>{article.title}</h2><p style={{whiteSpace:"pre-wrap"}}>{article.body}</p><p>引用 {article.citations.join("、")}</p><p>依据研究 v{article.researchVersion} · 文章 v{article.version}</p></article>}

    {article&&!productionTaskId&&<><p><a href={editorHref(task.id,back.source)}>编辑文章与版本</a></p><ArticleReview key={task.id+":"+article.version} taskId={task.id} version={article.version}/></>}
    {task.context&&<p>采用 {task.context.manifest.loadedModules.length} 个规则模块。{task.context.manifest.conflicts.filter(c=>c.status==="needs-confirmation").map(c=>c.title).join("、")} 需复核。</p>}
    {task.result&&<><h2>检索证据</h2>{task.result.retrieval.warnings.map(w=><p key={w}>{w}</p>)}
    {task.result.retrieval.hits.map(h=><details key={h.id}><summary>{h.heading} · {h.location}</summary><p>{h.text}</p><p>{h.sources.map(s=>s.path).join(" / ")}</p></details>)}</>}
    <details><summary>技术记录与完整资料包 · 执行快照 r{task.revision}</summary>{queueReason&&<p>执行原因 · {queueReason}</p>}<p>指定资料 · {task.input.sources?.map(id=>sources.find(s=>s.id===id)?.title??id).join("、")||"从可用资料库检索"}</p><pre style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{JSON.stringify({...task,detail:undefined},null,2)}</pre></details></section>}
    <footer>资料准备支持离线执行。DeepSeek 生成需逐任务预览与授权；未经核实的关键事实会阻止写作。<br/>构建版本：{process.env.NEXT_PUBLIC_STUDIO_BUILD??"dev-unidentified"} · <a href="/api/version" target="_blank" rel="noreferrer">核对服务版本</a></footer>
  </main>;
}

