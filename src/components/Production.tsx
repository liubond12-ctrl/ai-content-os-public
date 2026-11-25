"use client";
import {articleReturn,editorHref,reviewHref} from "@/studio/article-navigation";
import {RestoreArticlePosition} from "./RestoreArticlePosition";
import {LessonFinder} from "./ContentReuse";
import Link from "next/link";
import {WorkflowMap} from "./WorkflowMap";
import {useSearchParams,useRouter} from "next/navigation";
import {useEffect,useId,useRef,useState} from "react";
import type {ProductionView,ProductionDraft,Entity} from "@/studio/production";
import {productionBudget,productionPlatforms} from "@/studio/production-schema";
import {taskGuidance} from "@/studio/task-guidance";
import {SingleBriefInput,emptyBrief} from "./SingleBriefInput";
import {resolveBrief,type SingleBrief} from "@/studio/single-brief";
import type {imageState} from "@/studio/content-package";

async function api(body?:unknown,url="/api/production"){
  const r=await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const d=await r.json();if(!r.ok)throw Error(d.error);return d;
}
const kinds=["图文","口播稿","分镜脚本","自由文章"] as const;
const initialEntity:Entity={id:"",version:0,brand:"default",name:"",body:"",audience:"",platform:"",sources:[],rules:[],status:"草稿",account:"",goal:"",type:"",hard:false,constraintKey:"",constraintValue:""};
type Preview = ReturnType<typeof import("@/studio/production").previewDraft>;
function fresh(free:boolean):ProductionDraft{return {intent:"draft",id:crypto.randomUUID(),version:0,account:"",platform:"",topic:"",goal:free?"自由表达":"品宣",kind:free?"自由文章":"图文",requirements:"",outline:"",audience:"",sources:[],assets:[],imagesRequired:false,budgetProfile:"protected"};}

export default function Production({page="home"}:{page?:"home"|"create"|"free"|"accounts"|"rules"|"standards"|"queue"}){
  const query=useSearchParams();
  const draftId=query.get("draft");
  const [lastUpdated,setLastUpdated]=useState("");
  const [data,setData]=useState<ProductionView|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[connectionError,setConnectionError]=useState("");
  const [busy,setBusy]=useState(false),lock=useRef(false);
  const viewUrl=["home","queue"].includes(page)?"/api/production":"/api/production?view=configuration"+(draftId?"&draft="+encodeURIComponent(draftId):"");
  const load=async()=>{setData(await api(undefined,viewUrl));setConnectionError("");setLastUpdated(new Date().toLocaleTimeString("zh-CN"));};
  useEffect(()=>{let active=true;const refresh=()=>api(undefined,viewUrl).then(d=>{if(active){setData(d);setConnectionError("");setLastUpdated(new Date().toLocaleTimeString("zh-CN"));}}).catch(()=>{if(active)setConnectionError("工作台连接中断");});void refresh();return()=>{active=false;};},[viewUrl]);
  async function act(fn:()=>Promise<unknown>){
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try{await fn();await load();}catch(e){if(e instanceof TypeError)setConnectionError("工作台连接中断");else setError(e instanceof Error?e.message:String(e));}finally{lock.current=false;setBusy(false);}
  }
  const refresh=()=>{setError("");void load().catch(()=>setConnectionError("工作台连接中断"));};
  if(!data)return <main><h1>内容中控</h1><p role="status">{connectionError||error||"读取任务记录…"}</p><button onClick={()=>void load().catch(e=>setConnectionError(String(e)))}>重新连接</button></main>;
  return <main className="production"><p className="meta">默认品牌 · {data.mode} · 业务质量标准{data.standards.some(s=>s.status==="启用")?"已配置":"未配置，仅基础检查"}</p>
    {connectionError&&<p className="meta">显示上次 {lastUpdated} 读取的记录。</p>}{error&&!["create","free"].includes(page)&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {["home","queue"].includes(page)&&<Control data={data} busy={busy} act={act} queueOnly={page==="queue"} connected={!connectionError} refresh={refresh}/>}
    {["create","free"].includes(page)&&<Composer key={page+":"+draftId+":"+query.get("mode")} data={data} free={page==="free"} busy={busy} act={act} notify={setNotice} refresh={refresh} connected={!connectionError} error={error}/>}
    {["accounts","rules","standards"].includes(page)&&<Management data={data} kind={page==="accounts"?"account":page==="rules"?"rule":"standard"} busy={busy} act={act}/>}
  </main>;
}
type Action=(fn:()=>Promise<unknown>)=>Promise<void>;
function Control({data,busy,act,queueOnly,connected,refresh}:{data:ProductionView;busy:boolean;act:Action;queueOnly:boolean;connected:boolean;refresh:()=>void}){
  const query=useSearchParams();
  const [filter,setFilter]=useState({account:query.get("account")??"",platform:query.get("platform")??"",batch:query.get("batch")??"",status:query.get("status")??"",q:query.get("q")??""});
  const filters=new URLSearchParams(Object.entries(filter).filter(([,value])=>value));
  const queueSource=(id:string)=>"/production/queue"+(filters.size?"?"+filters:"")+"#queue-"+id;
  const priority=(status:string)=>["待人工审核","受阻","失败","整理资料","生成","审核","修订","排队","草稿","已定稿"].indexOf(status);
  const rows=data.queue.filter(t=>(!filter.account||t.production?.account===filter.account)&&(!filter.platform||t.production?.platform===filter.platform)&&(!filter.batch||t.batch===filter.batch)&&(!filter.status||t.status===filter.status)&&t.topic.includes(filter.q)&&(queueOnly||filter.status||t.status!=="已定稿")).sort((a,b)=>queueOnly?0:priority(a.status)-priority(b.status));
  const [drag,setDrag]=useState<string|null>(null),[dropTarget,setDropTarget]=useState<string|null>(null);
  async function move(id:string,direction:number){
    if(!connected)return;
    const row=data.queue.find(r=>r.id===id)!;const b=data.batches.find(b=>b.id===row.batch)!;
    const ids=data.queue.filter(r=>r.batch===row.batch&&r.status==="排队"&&!r.started).map(r=>r.id),at=ids.indexOf(id);
    const target=at+direction;if(target<0||target>=ids.length)return;
    ids.splice(target,0,ids.splice(at,1)[0]);
    await act(()=>api({action:"reorder",batch:row.batch,version:b.version,ids}));
  }
  return <>
    <header className="production-head"><div><h1>{queueOnly?"批次与执行队列":"今天的内容工作"}</h1><p>从选题到定稿，查看每一条内容的下一步。</p></div><div className="actions"><Link className="primary-link" href="/production/create">新建内容</Link><Link href="/articles">找回内容</Link></div></header>
    <ReadinessNotice id="queue-readiness" state={readiness(connected,data.workerOnline,data.modelConfigured)} scope="queue" refresh={refresh}/>
    <div className="production-summary">{["待人工审核","受阻","排队","已定稿"].map(status=><button key={status} onClick={()=>setFilter({...filter,status})}>{status} <strong>{data.queue.filter(t=>t.status===status).length}</strong></button>)}<button onClick={()=>setFilter({account:"",platform:"",batch:"",status:"",q:""})}>全部任务 <strong>{data.queue.length}</strong></button></div>
    {!queueOnly&&<WorkflowMap tasks={data.queue} workerOnline={data.workerOnline}/>}
    <section><h2>{queueOnly?"执行队列":"继续处理"}</h2><details><summary>筛选任务</summary><div className="filters"><label>选题<input value={filter.q} onChange={e=>setFilter({...filter,q:e.target.value})}/></label>
      <label>账号<select value={filter.account} onChange={e=>setFilter({...filter,account:e.target.value})}><option value="">全部</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label>平台<select value={filter.platform} onChange={e=>setFilter({...filter,platform:e.target.value})}><option value="">全部</option>{productionPlatforms.map(platform=><option key={platform}>{platform}</option>)}</select></label>
      <label>批次<select value={filter.batch} onChange={e=>setFilter({...filter,batch:e.target.value})}><option value="">全部</option>{data.batches.map(b=><option key={String(b.id)} value={String(b.id)}>{data.queue.find(t=>t.batch===b.id)?.topic||"创作批次"} · {new Date(b.created).toLocaleString("zh-CN")}</option>)}</select></label>
      <label>状态<select value={filter.status} onChange={e=>setFilter({...filter,status:e.target.value})}><option value="">全部</option>{["排队","整理资料","生成","审核","修订","待人工审核","已定稿","受阻","失败","已停止"].map(s=><option key={s}>{s}</option>)}</select></label></div></details>
      <div className="queue-list" id="queue-results" tabIndex={-1}><RestoreArticlePosition prefix="queue-" fallback="queue-results"/>{(queueOnly?rows:rows.slice(0,6)).map(t=><article id={"queue-"+t.id} tabIndex={-1} key={t.id} style={dropTarget===t.id?{borderTop:"3px solid #526747"}:undefined} draggable={t.status==="排队"&&!t.started} onDragStart={()=>setDrag(t.id)} onDragOver={e=>{e.preventDefault();setDropTarget(t.id);}} onDragEnd={()=>{setDrag(null);setDropTarget(null);}} onDrop={e=>{e.preventDefault();const origin=data.queue.find(r=>r.id===drag);if(origin?.batch===t.batch&&origin.status==="排队"&&!origin.started&&t.status==="排队"&&!t.started){const ids=data.queue.filter(r=>r.batch===t.batch&&r.status==="排队"&&!r.started).map(r=>r.id);void move(origin.id,ids.indexOf(t.id)-ids.indexOf(origin.id));}setDrag(null);setDropTarget(null);}}>
        <div><span className="status-pill">{t.status}{t.version&&" · v"+t.version}</span>　{t.production?.accountName??"未归属"} · {t.production?.platform||"自由创作"} · {t.production?.kind}<h3>{t.topic}</h3>{taskGuidance(t.reason,!!t.version)&&!t.confirmed?<TaskGuidance reason={t.reason} hasArticle={!!t.version}/>:<p>{t.confirmed?"已由作者确认定稿，可查看或导出。":t.reason||"按批次执行顺序处理"}</p>}{t.production&&!(t.production.standards?.length)&&<p className="queue-basic"><strong>仅基础检查</strong> · 查看事实核验与格式结果，业务质量由作者审阅确认。</p>}<p className="meta">更新于 {new Date(t.updated).toLocaleString("zh-CN")}</p>{queueOnly&&t.excerpt&&<p>{t.excerpt}</p>}</div>
        <div className="actions">{t.version&&<><Link href={editorHref(t.id,queueSource(t.id))}>{t.confirmed?"查看定稿":"编辑与审核"}</Link><Link href={"/production/package?"+new URLSearchParams({id:t.id,returnTo:queueSource(t.id)})}>配图与内容包</Link></>}
          <details><summary>执行详情</summary><Link href={reviewHref(t.id,queueSource(t.id))}>执行记录与规范快照</Link></details>
          {t.status==="排队"&&!t.started&&<><button disabled={busy||!connected} aria-describedby="queue-readiness" onClick={()=>move(t.id,-1)} aria-label={"上移 "+t.topic}>上移</button><button disabled={busy||!connected} aria-describedby="queue-readiness" onClick={()=>move(t.id,1)} aria-label={"下移 "+t.topic}>下移</button></>}
          {!["已定稿","待人工审核"].includes(t.status)&&<button disabled={busy||!connected} aria-describedby="queue-readiness" onClick={()=>act(()=>api({action:["失败","已停止"].includes(t.status)?"retry":"stop",batch:t.batch,version:data.batches.find(b=>b.id===t.batch)!.version,ids:[t.id]}))}>{["失败","已停止"].includes(t.status)?"重试此任务":"停止后续执行"}</button>}</div>
      </article>)}</div>{!rows.length&&<p>当前没有需要处理的内容。可以新建内容，或从“我的内容”找回定稿。</p>}{!queueOnly&&rows.length>6&&<Link href="/production/queue">查看全部待处理内容（{rows.length}）</Link>}</section>
    <section><h2>最近草稿与待生产清单</h2>{data.drafts.length?<ul>{data.drafts.map(d=><li key={d.id}><Link href={(d.kind==="自由文章"?"/production/free":"/production/create")+"?draft="+d.id}>{d.topic||"未填写选题"} · {d.kind}</Link></li>)}</ul>:<p>还没有草稿。先创建一条内容需求。</p>}<Link href="/production/create?mode=batch#batch">预检并提交待生产清单</Link></section>
    <details><summary>历史批次与调用详情</summary>{data.batches.map(b=>{const all=data.queue.filter(t=>t.batch===b.id);return <details key={String(b.id)}><summary>{all[0]?.topic||"创作批次"} · {new Date(String(b.created)).toLocaleString("zh-CN")} · 生成 {all.filter(t=>t.version).length}/{all.length} · 人工定稿 {all.filter(t=>t.confirmed).length}/{all.length}</summary>
      <p>{String(b.mode)} · 上限 {Number(b.request_limit)} 请求 / {Number(b.token_limit)} Tokens · 已请求 {b.usedRequests} 次，已知 {b.knownTokens} Tokens，含未知预留 {b.reservedTokens} Tokens，{b.unknownCalls} 次用量未知。费用估算 {b.estimatedUsd.toFixed(6)} USD（{b.unpriced} 次未计价），实扣未知。{b.mode==="真实云端"?"本次未设总费用上限；请求/Token 上限是防异常循环保护。":""}</p>
      <button disabled={busy||!connected} aria-describedby="queue-readiness" onClick={()=>act(()=>api({action:"stop",batch:b.id,version:b.version,ids:all.filter(t=>!["已定稿","待人工审核"].includes(t.status)).map(t=>t.id)}))}>停止本批次后续执行</button></details>;})}</details>
    <footer><Link href="/articles">查看历史文章与未归属内容</Link> · <Link href="/production/accounts">账号管理</Link> · <Link href="/studio/settings">工具与设置</Link></footer>
  </>;
}
function TaskGuidance({reason,hasArticle}:{reason:string;hasArticle:boolean}){
  const hint=taskGuidance(reason,hasArticle)!;
  return <div><strong>{hint.title}</strong><p>{hint.detail}</p><p>下一步：{hint.next}</p><details><summary>查看技术原因</summary><p>{reason}</p></details></div>;
}
function AccountPicker({accounts,value,onChoose}:{accounts:Entity[];value:string;onChoose:(account:Entity)=>void}){
  const id=useId(),[search,setSearch]=useState<string|null>(null),[active,setActive]=useState(0);
  const selected=accounts.find(account=>account.id===value);
  const options=accounts.filter(account=>account.status==="启用"&&account.name.toLocaleLowerCase().includes((search??"").trim().toLocaleLowerCase()));
  function choose(account:Entity){onChoose(account);setSearch(null);}
  return <div className="account-picker" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setSearch(null);}}>
    <label htmlFor={id}>账号</label>
    <input id={id} role="combobox" autoComplete="off" placeholder="搜索并选择账号" value={search??selected?.name??""}
      aria-autocomplete="list" aria-expanded={search!==null} aria-controls={id+"-options"}
      aria-activedescendant={search!==null&&options[active]?id+"-"+active:undefined}
      onClick={()=>{if(search===null){setSearch("");setActive(0);}}}
      onChange={event=>{setSearch(event.target.value);setActive(0);}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.key==="Escape"){event.preventDefault();setSearch(null);}
        else if(event.key==="ArrowDown"||event.key==="ArrowUp"){
          event.preventDefault();
          if(search===null){setSearch("");setActive(0);}
          else setActive(index=>Math.max(0,Math.min(options.length-1,index+(event.key==="ArrowDown"?1:-1))));
        }else if(event.key==="Enter"&&search!==null){
          event.preventDefault();if(options[active])choose(options[active]);
        }else if(event.key==="Enter"){
          event.preventDefault();setSearch("");setActive(0);
        }
      }}/>
    <div className="account-options" id={id+"-options"} role="listbox" aria-label="启用的账号" hidden={search===null}>
      {options.map((account,index)=><button type="button" role="option" id={id+"-"+index} key={account.id} tabIndex={-1}
        aria-selected={index===active} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(account)}>{account.name} {account.platform&&" · "+account.platform}</button>)}
      {!options.length&&<p role="status">没有匹配的启用账号</p>}
    </div>
  </div>;
}
function accountDefaults(account:Entity):Partial<ProductionDraft>{
  return {account:account.id,platform:account.platform,audience:account.audience,sources:account.sources};
}
function DraftDetails({draft,data,update,notify}:{draft:ProductionDraft;data:ProductionView;update:(change:Partial<ProductionDraft>)=>void;notify:(message:string)=>void}){
  return <>
    <details><summary>受众、要求与核心大纲（可选）</summary>
      <label>受众<input value={draft.audience} onChange={e=>update({audience:e.target.value})}/></label>
      <label>内容要求（可选）<textarea value={draft.requirements} onChange={e=>update({requirements:e.target.value})}/></label>
      <label>核心大纲（可选）<textarea value={draft.outline} onChange={e=>update({outline:e.target.value})}/></label>
    </details>
    <details><summary>写作参考（已选 {draft.sources.length} 条）</summary>
      <fieldset><legend>参考写法</legend><Link href="/studio/cases" target="_blank" rel="noreferrer">打开写作参考库 ↗</Link>
      <p>这里选择表达方法。业务事实请在「业务事实依据与附件」注明可核实的来源并附上资料。</p>
      {data.references.map(r=><label key={r.id}><input type="checkbox" checked={draft.sources.includes(r.id+"@"+r.version)} onChange={e=>update({sources:e.target.checked?[...draft.sources,r.id+"@"+r.version]:draft.sources.filter(s=>s!==r.id+"@"+r.version)})}/>{r.title} · v{r.version}</label>)}
      {draft.sources.filter(s=>!data.references.some(r=>r.id+"@"+r.version===s)).map(s=><p key={s} role="alert">{s} 已失效 <button type="button" onClick={()=>update({sources:draft.sources.filter(v=>v!==s)})}>移除并重新选择</button></p>)}</fieldset>
    </details>
    <details><summary>业务事实依据与附件（已选 {draft.assets.length} 项）</summary>
      <fieldset><legend>事实资料与手动配图</legend><p>附上有权使用的资料并填写出处。事实仍需核实。</p><AttachmentUpload onSaved={id=>{update({assets:[...draft.assets,id]});notify("已选择附件，请在预检中核对来源");}}/>
      {data.assets.map(a=><label key={String(a.id)}><input type="checkbox" checked={draft.assets.includes(String(a.id))} onChange={e=>update({assets:e.target.checked?[...draft.assets,String(a.id)]:draft.assets.filter(id=>id!==a.id)})}/>{String(a.name)} · {a.allowed?"允许创作使用":"尚未许可"} <a href={"/api/production/assets?id="+a.id} target="_blank" rel="noreferrer">预览</a></label>)}
      <label><input type="checkbox" checked={draft.imagesRequired} onChange={e=>update({imagesRequired:e.target.checked})}/>本任务需要手动配图</label></fieldset>
    </details>
  </>;
}
function BatchDrafts({data,busy,connected,act,added,notify}:{data:ProductionView;busy:boolean;connected:boolean;act:Action;added:(ids:string[])=>void;notify:(message:string)=>void}){
  const storageKey="production-batch-input";
  const [rows,setRows]=useState<ProductionDraft[]>(()=>{
    try{const stored=JSON.parse(localStorage.getItem(storageKey)||"null");if(Array.isArray(stored)&&stored.length)return stored;}catch{}
    return [fresh(false)];
  }),[checked,setChecked]=useState(false);
  const latest=useRef(rows);
  function saveInput(next:ProductionDraft[]){latest.current=next;setRows(next);localStorage.setItem(storageKey,JSON.stringify(next));}
  function update(id:string,change:Partial<ProductionDraft>){saveInput(latest.current.map(row=>row.id===id?{...row,...change}:row));}
  const keys=rows.map(row=>JSON.stringify([row.account,row.topic.normalize("NFKC").trim().toLowerCase()]));
  const issues=rows.map((row,index)=>{
    if(!data.accounts.some(a=>a.id===row.account&&a.status==="启用"))return "请选择启用的账号";
    if(!row.platform)return "请选择平台";
    if(!row.topic.trim())return "请填写选题";
    if(keys.indexOf(keys[index])!==index)return "此账号和选题在上方已填写";
    return "";
  });
  return <form className="production-form batch-editor" aria-label="批量填报" onSubmit={event=>{
    event.preventDefault();if(!connected)return;setChecked(true);
    if(issues.some(Boolean))return;
    void act(async()=>{
      const result:ProductionDraft[]=await api({action:"enqueueDrafts",drafts:rows});
      const empty=[fresh(false)];latest.current=empty;setRows(empty);localStorage.removeItem(storageKey);setChecked(false);added(result.map(row=>row.id));
    });
  }}>
    <p>每行填写一个账号和选题。保存到清单后可调整顺序，再预检本批次。</p>
    {rows.map((row,index)=><fieldset key={row.id} className="batch-edit-row" disabled={busy}>
      <legend>第 {index+1} 行</legend>
      <div className="draft-fields">
        <AccountPicker accounts={data.accounts} value={row.account} onChoose={account=>update(row.id,accountDefaults(account))}/>
        <label>平台<select value={row.platform} onChange={e=>update(row.id,{platform:e.target.value as ProductionDraft["platform"]})}><option value="">请选择</option>{productionPlatforms.map(platform=><option key={platform}>{platform}</option>)}</select></label>
        <label className="draft-topic">选题<input maxLength={240} value={row.topic} onChange={e=>update(row.id,{topic:e.target.value})}/></label>
        <label>内容类型<select value={row.kind} onChange={e=>update(row.id,{kind:e.target.value as ProductionDraft["kind"]})}>{kinds.filter(kind=>kind!=="自由文章").map(kind=><option key={kind}>{kind}</option>)}</select></label>
      </div>
      {checked&&issues[index]&&<p className="batch-issue" role="alert">第 {index+1} 行：{issues[index]}</p>}
      <details className="batch-options"><summary>要求、大纲与附件</summary>
        <DraftDetails draft={row} data={data} update={change=>update(row.id,change)} notify={notify}/>
      </details>
      {rows.length>1&&<button type="button" onClick={()=>saveInput(rows.filter(item=>item.id!==row.id))}>移除第 {index+1} 行</button>}
    </fieldset>)}
    <div className="actions batch-actions"><button type="button" disabled={busy||rows.length>=100} onClick={()=>saveInput([...rows,fresh(false)])}>增加一行</button>
      <button className="primary" disabled={busy||!connected} aria-describedby="batch-readiness">检查并加入待生产清单</button></div>
  </form>;
}
function Composer({data,free,busy,act,notify,refresh,connected,error}:{data:ProductionView;free:boolean;busy:boolean;act:Action;notify:(s:string)=>void;refresh:()=>void;connected:boolean;error:string}){
  const router=useRouter();
  const params=useSearchParams();
  const draftId=params.get("draft");
  const draftReturn=draftId?articleReturn(draftId,params.get("returnTo")??undefined):null;
  const batchMode=!free&&params.get("mode")==="batch";
  const key=draftId?"production-draft:"+draftId:free?"production-free-draft":"production-account-draft";
  const savedDraft=data.drafts.find(d=>d.id===draftId);
  const [form,setForm]=useState<ProductionDraft>(()=>{
    if(draftId){
      if(!savedDraft)return fresh(free);
      try{
        const local=JSON.parse(localStorage.getItem(key)||localStorage.getItem("hot-draft:"+draftId)||"null");
        if(local?.id===savedDraft.id&&local.version===savedDraft.version)return {...savedDraft,...local};
      }catch{}
      return savedDraft;
    }
    const initial=fresh(free);const params=new URLSearchParams(location.search),ref=params.get("ref");
    if(ref){initial.sources=[ref+"@"+(params.get("v")||"1")];return initial;}
    try{
      const stored=JSON.parse(localStorage.getItem(key)||"null");
      if(stored&&!data.drafts.some(d=>d.id===stored.id&&JSON.stringify(d)===JSON.stringify(stored)))return stored;
    }catch{}
    if(!batchMode&&!free){
      try{
        const last=data.accounts.find(a=>a.id===localStorage.getItem("production-last-account")&&a.status==="启用");
        if(last)Object.assign(initial,accountDefaults(last));
      }catch{}
    }
    return initial;
  }),[dirty,setDirty]=useState(()=>Boolean(form.topic||form.version||form.account||form.sources.length)&&!data.drafts.some(d=>d.id===form.id&&JSON.stringify(form)===JSON.stringify(d)));
  const [preview,setPreview]=useState<Preview[]|null>(null),[previewKey,setPreviewKey]=useState(""),[batchId,setBatchId]=useState(()=>crypto.randomUUID());
  const [uploading,setUploading]=useState(false),[checking,setChecking]=useState(false),[authorizeText,setAuthorizeText]=useState(false),[showAdjust,setShowAdjust]=useState(false);
  const [tokenLimit,setTokenLimit]=useState(240000),[requestLimit,setRequestLimit]=useState(72);
  const selectionKey="production-batch-selection";
  const [selected,setSelected]=useState<string[]|null>(()=>{
    if(!batchMode)return null;
    try{
      const stored=JSON.parse(sessionStorage.getItem(selectionKey)||"null");
      if(Array.isArray(stored)&&stored.every(id=>typeof id==="string"))return stored;
    }catch{}
    return null;
  });
  useEffect(()=>{
    if(batchMode){
      if(selected===null)sessionStorage.removeItem(selectionKey);
      else sessionStorage.setItem(selectionKey,JSON.stringify(selected));
    }
  },[batchMode,selected]);
  useEffect(()=>{if(dirty)localStorage.setItem(key,JSON.stringify(form));const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[form,dirty,key]);
  function change(next:Partial<ProductionDraft>){setForm(p=>({...p,...next}));setDirty(true);setPreview(null);setAuthorizeText(false);}
  function updateBrief(fn:(p:SingleBrief)=>SingleBrief){
    setForm(p=>p.id===form.id&&p.account===form.account?{...p,brief:fn(p.brief??emptyBrief)}:p);
    setDirty(true);setPreview(null);setAuthorizeText(false);
  }
  function chooseAccount(account:Entity){
    if(account.id===form.account)return;
    localStorage.setItem("production-last-account",account.id);
    const previous=form.brief??emptyBrief;
    change({...accountDefaults(account),...(!form.account&&form.sources.length?{sources:[...new Set([...account.sources,...form.sources])]}:{}),
      ...(form.account?{assets:[],brief:{...previous,materials:[],articleRefs:[],failed:[]}}:{brief:previous})});
    if(form.account&&(previous.materials.length||previous.articleRefs.length||previous.failed.length||form.assets.length))
      notify("已切换账号，本篇文字保留，原账号材料已移出。");
  }
  const listed=data.drafts.filter(d=>d.intent==="queued");
  const pending=listed.filter(d=>selected===null||selected.includes(d.id));
  const signature=(drafts:ProductionDraft[])=>JSON.stringify([drafts,data.rules,data.standards,data.accounts]);
  useEffect(()=>{
    if(preview)document.getElementById(batchMode?"batch-preview":"single-preview")?.focus();
  },[preview,batchMode]);
  useEffect(()=>{
    if(!error||batchMode)return;
    const reply=document.getElementById("chat-preflight-reply");
    reply?.focus({preventScroll:true});
    reply?.scrollIntoView({block:"nearest"});
  },[error,batchMode]);
  const checkedSingle=preview!==null&&previewKey===signature([form]);
  const checkedBatch=preview!==null&&previewKey===signature(pending);
  const plan=productionBudget(form.kind,data.mode==="真实云端"?"cloud_review":form.budgetProfile);
  const offlineError=error.startsWith("生成后台离线");
  const state=readiness(connected,data.workerOnline&&!offlineError,data.modelConfigured);
  const canRun=state==="ready";
  const readyToCheck=form.intent==="draft"&&!uploading;
  const singlePreview=preview?.[0];
  const requiresAuthorization=data.mode==="真实云端"&&singlePreview?.authorBrief!==undefined&&!!singlePreview?.attachments.length;
  const account=data.accounts.find(a=>a.id===form.account);
  const effective=resolveBrief(form.brief??emptyBrief,{...form,audience:form.audience||account?.audience||""});
  async function persist(){
    const saved:ProductionDraft=await api({action:"draft",value:{...form,...(form.intent==="draft"&&!batchMode?{brief:form.brief??emptyBrief}:{})}});
    setForm(saved);setDirty(false);
    localStorage.removeItem(key);
    if(draftId)localStorage.removeItem("hot-draft:"+draftId);
    return saved;
  }
  async function checkSingle(){
    if(!readyToCheck)return;
    await act(async()=>{
      setChecking(true);
      try{
        const checked=await api({action:"preview",drafts:[{...form,brief:form.brief??emptyBrief}]});
        const saved=dirty||!form.version||!form.brief?await persist():form;
        setShowAdjust(true);
        setPreview(checked);setPreviewKey(signature([saved]));
      }finally{setChecking(false);}
    });
  }
  async function submitSingle(){
    await act(async()=>{
      const submitted=await api({action:"single",id:batchId,drafts:[form],tokenLimit:plan.tokens,requestLimit:plan.requests,preview,authorizeText});
      localStorage.removeItem(key);
      router.push("/studio?taskId="+submitted.firstTask);
    });
  }
  function startNew(){
    if(dirty&&!confirm("草稿有未保存的改动，继续新建？"))return;
    localStorage.removeItem(key);
    if(draftId){
      localStorage.removeItem("hot-draft:"+draftId);
      localStorage.removeItem(free?"production-free-draft":"production-account-draft");
      router.push(free?"/production/free":"/production/create");
    }else{
      setForm({...fresh(free),...(account?accountDefaults(account):{})});setBatchId(crypto.randomUUID());setDirty(false);setPreview(null);setAuthorizeText(false);setShowAdjust(false);
    }
  }
  async function moveDraft(id:string,step:number){
    const rows=[...listed],at=rows.findIndex(d=>d.id===id),to=at+step;
    if(to<0||to>=rows.length)return;
    [rows[at],rows[to]]=[rows[to],rows[at]];
    setPreview(null);await act(()=>api({action:"draftOrder",drafts:rows.map(d=>({id:d.id,version:d.version}))}));
  }
  return <><header className={"production-head"+(!batchMode?" chat-production-head":"")}><h1>新建内容</h1><div className="single-header-tools">
    {draftReturn?.source&&<Link className="draft-return" href={draftReturn.href}>{draftReturn.label}</Link>}
    {!batchMode&&dirty&&<button type="button" disabled={busy||uploading||!connected} onClick={()=>void act(async()=>{await persist();setPreview(null);notify("草稿已保存，可在首页最近编辑或我的内容找回。");})}>保存草稿</button>}
    {!batchMode&&(draftId||form.version>0)&&<button type="button" disabled={busy||uploading} onClick={startNew}>另写一篇</button>}
    <Link href="/production/accounts">管理账号</Link>
  </div></header>
    <nav aria-label="创作方式"><Link aria-current={!free&&!batchMode?"page":undefined} href="/production/create">单篇创作</Link><Link aria-current={batchMode?"page":undefined} href="/production/create?mode=batch">批量填报</Link><Link aria-current={free?"page":undefined} href="/production/free">自由文章</Link></nav>
    {free&&<section><h2>直接写正文</h2><p>打开空白编辑器，不调用模型，不加入生产清单。</p><button disabled={busy} onClick={()=>act(async()=>{const r=await api({action:"blankArticle",title:form.topic});router.push(editorHref(r.id,"/production/free"));})}>打开空白文章</button></section>}
    {batchMode&&error&&<p role="alert">{error}</p>}
    {batchMode?<BatchDrafts data={data} busy={busy} connected={connected} act={act} notify={notify} added={ids=>{
      setSelected(ids);setPreview(null);notify("已加入 "+ids.length+" 条，下一步预检本批次");document.getElementById("batch")?.scrollIntoView();
    }}/>:<form className={"production-form"+(form.intent==="draft"?" single-production":"")} noValidate onSubmit={e=>{e.preventDefault();void checkSingle();}}>
      <fieldset className="single-fields" disabled={busy||uploading} aria-label="单篇创作需求">
      <div className="draft-fields">
        {!free&&<><AccountPicker accounts={data.accounts} value={form.account} onChoose={chooseAccount}/>
        <label>平台<select required value={form.platform} onChange={e=>change({platform:e.target.value as ProductionDraft["platform"]})}><option value="">请选择</option>{productionPlatforms.map(platform=><option key={platform}>{platform}</option>)}</select></label></>}
        <label className="draft-topic">选题<input required maxLength={240} value={form.topic} onChange={e=>change({topic:e.target.value})}/></label>
      <label>内容类型<select value={form.kind} onChange={e=>change({kind:e.target.value as ProductionDraft["kind"]})}>{(free?["自由文章"]:kinds.filter(k=>k!=="自由文章")).map(k=><option key={k}>{k}</option>)}</select></label>
      </div>
      {data.draftOrigin&&<p className="single-origin"><a href={data.draftOrigin.original} target="_blank" rel="noreferrer">{data.draftOrigin.source} · {data.draftOrigin.title}</a></p>}
      {form.intent==="draft"&&<SingleBriefInput key={form.id+":"+form.account} draft={form} data={data} update={updateBrief} updateSources={sources=>change({sources})} loading={setUploading} disabled={busy||uploading||!connected} checking={checking}/>}
      {form.intent==="queued"&&<p>此稿在<Link href="/production/create?mode=batch#batch">待生产清单</Link>中，可在批量页提交或移出。</p>}
      {error&&<div id="chat-preflight-reply" className="chat-preflight-reply" role="alert" tabIndex={-1}><strong>发送前请补齐</strong><p>{error}</p></div>}
      {!checkedSingle&&state!=="ready"&&<ReadinessNotice id="single-worker" state={state} scope="single" refresh={refresh} basic={!data.standards.some(s=>s.status==="启用")}/>}
      {preview&&showAdjust&&!checkedSingle&&!error&&<p className="chat-adjust-notice">已更新，发送后重新核对。</p>}
      {preview&&showAdjust&&!error&&<section className="chat-preflight-result" aria-labelledby="single-preview">
        <h2 id="single-preview" tabIndex={-1}>确认生成这篇初稿</h2>
        <p>1 篇 · {form.topic} · {data.mode} · 最多 {plan.requests} 次请求 / {plan.tokens.toLocaleString("zh-CN")} Tokens。</p>
        {singlePreview?.resolved&&<div className="single-brief-confirm">
          <p>已选写作参考 {form.sources.length} 项。{singlePreview.illustrations?.length?`本机配图 ${singlePreview.illustrations.length} 项。`:""}</p>
          {singlePreview.attachments.length>0&&<ul>{singlePreview.attachments.map(a=><li key={a.id}>{a.name} · {a.purpose==="facts"?"作者提供，待核实":"只参考写法"} · {a.source}</li>)}</ul>}
          {requiresAuthorization&&<label><input type="checkbox" checked={authorizeText} onChange={e=>setAuthorizeText(e.target.checked)}/>允许将上列文本材料发给 DeepSeek，用于本篇生成与审核</label>}
        </div>}
        <details><summary>核对或调整本篇要求</summary>
          <div className="single-material-controls"><label>目标<input value={effective.goal} onChange={e=>{const goal=e.target.value;setForm(p=>({...p,brief:{...(p.brief??emptyBrief),adjust:{...p.brief?.adjust,goal}}}));setDirty(true);setAuthorizeText(false);}}/></label>
          <label>受众<input value={effective.audience} onChange={e=>{const audience=e.target.value;setForm(p=>({...p,brief:{...(p.brief??emptyBrief),adjust:{...p.brief?.adjust,audience}}}));setDirty(true);setAuthorizeText(false);}}/></label></div>
          {effective.style&&<p>写法 · {effective.style}</p>}
          <label><input type="checkbox" checked={effective.imagesRequired} onChange={e=>{const images=e.target.checked;setForm(p=>({...p,brief:{...(p.brief??emptyBrief),adjust:{...p.brief?.adjust,images}}}));setDirty(true);setAuthorizeText(false);}}/>需要手动配图</label>
          {account&&<button type="button" disabled={busy} onClick={()=>{
            const value=prompt("只保存下列文字为账号长期写法偏好。",effective.style??account.writingPreference??"");
            if(value!==null&&value.trim()!==(account.writingPreference||""))void act(()=>api({action:"entity",kind:"account",value:{...account,writingPreference:value.trim().slice(0,600)}}));
          }}>保存写法为账号偏好</button>}
        </details>
        <p>规范：{preview[0]?.rules.map(r=>r.name+" v"+r.version).join("、")||"未配置"}；质量标准：{preview[0]?.standards.map(r=>r.name+" v"+r.version).join("、")||"未配置，仅基础检查"}。</p>
                <ProductionCost mode={data.mode}/>
        <details><summary>诊断用完整快照</summary><pre>{JSON.stringify(preview,null,2)}</pre></details>
        <ReadinessNotice id="single-worker" state={state} scope="single" refresh={refresh} basic={!preview?.[0]?.standards.length}/>
        <button className="primary" type="button" disabled={busy||!checkedSingle||!canRun||(requiresAuthorization&&!authorizeText)} aria-describedby="single-worker" onClick={()=>void submitSingle()}>确认并开始这篇内容</button>
      </section>}
      {form.intent!=="draft"?<DraftDetails draft={form} data={data} update={change} notify={notify}/>:
        !!(form.requirements||form.outline||form.assets.length)&&<details><summary>旧草稿的原有要求与材料</summary><DraftDetails draft={form} data={data} update={change} notify={notify}/></details>}
      </fieldset>
    </form>}
    {batchMode&&<><details><summary>已保存的需求草稿</summary>{data.drafts.filter(d=>d.intent==="draft").map(d=><article key={d.id}><Link href={(d.kind==="自由文章"?"/production/free":"/production/create")+"?draft="+d.id}>{d.topic||"未命名"} · {d.kind}</Link><button disabled={busy} onClick={()=>act(async()=>{await api({action:"draft",value:{...d,intent:"queued"}});setSelected(ids=>ids===null?null:[...new Set([...ids,d.id])]);setPreview(null);})}>加入待生产清单</button><button disabled={busy} onClick={()=>{if(confirm("永久删除此需求草稿？"))void act(()=>api({action:"removeDraft",id:d.id,version:d.version}));}}>删除草稿</button></article>)}</details>
    <section id="batch"><h2>待生产清单 · {pending.length} 条</h2>{listed.map(d=><article className="queued-draft" key={d.id}><label><input type="checkbox" checked={selected===null||selected.includes(d.id)} onChange={e=>setSelected(e.target.checked?[...(selected??listed.map(d=>d.id)),d.id]:(selected??listed.map(d=>d.id)).filter(id=>id!==d.id))}/>{d.topic||"未填写选题"} · {data.accounts.find(a=>a.id===d.account)?.name??"自由创作"} · {d.platform} · {d.kind}</label><div className="draft-order-actions"><button disabled={busy} onClick={()=>moveDraft(d.id,-1)}>上移</button><button disabled={busy} onClick={()=>moveDraft(d.id,1)}>下移</button><Link href={(d.kind==="自由文章"?"/production/free":"/production/create")+"?draft="+d.id}>修改此草稿</Link><button disabled={busy} onClick={()=>act(()=>api({action:"draft",value:{...d,intent:"draft"}}))}>移出清单</button></div><details><summary>要求、大纲与附件</summary><p>{d.requirements||"未补充"}</p><p>{d.outline||"自动组织"}</p><p>已选附件 {d.assets.length} 项</p></details></article>)}
      {!checkedBatch&&<ReadinessNotice id="batch-readiness" state={state} scope="batch" refresh={refresh} basic={preview?.some(item=>!item.standards.length)??!data.standards.some(s=>s.status==="启用")}/>}
      <details><summary>调用额度</summary><div className="filters"><label>批次 Tokens 上限<input type="number" min={1000} max={2000000} value={tokenLimit} onChange={e=>{setTokenLimit(Number(e.target.value));setPreview(null);}}/></label><label>请求次数上限<input type="number" min={1} max={600} value={requestLimit} onChange={e=>{setRequestLimit(Number(e.target.value));setPreview(null);}}/></label></div></details>
      <button className={preview?"":"primary"} disabled={busy||!connected||!pending.length} aria-describedby="batch-readiness" onClick={()=>act(async()=>{setPreview(await api({action:"preview",drafts:pending}));setPreviewKey(signature(pending));})}>预检本批次资料与规范</button>
      {checkedBatch&&<div id="batch-preview" tabIndex={-1}><h3>生产顺序</h3><p>{pending.length} 条 · {data.mode} · 最短约 {pending.length*4} 次请求；含研究、事实核验、讨论及两轮修订最多按 {pending.length*22} 次规划，实际按需执行。当前批次上限 {requestLimit} 次 / {tokenLimit} Tokens，失败与未知用量保守占额。{requestLimit<pending.length*22?"当前预算不保证覆盖完整分歧与修订，触顶转人工，不自动扩额。":""}</p><ProductionCost mode={data.mode}/><ol>{pending.map((d,i)=><li key={d.id}><strong>{d.topic}</strong> · {d.kind} · {data.accounts.find(a=>a.id===d.account)?.name||"自由创作"} · {d.platform||"不限平台"}<p>规范：{preview[i]?.rules.map(r=>r.name+" v"+r.version).join("、")||"未配置"}；质量标准：{preview[i]?.standards.map(r=>r.name+" v"+r.version).join("、")||"未配置，仅基础检查"}；参考 {d.sources.length} 条，附件 {d.assets.length} 项。</p></li>)}</ol><details><summary>诊断用完整快照</summary><pre>{JSON.stringify(preview,null,2)}</pre></details>
        <ReadinessNotice id="batch-readiness" state={state} scope="batch" refresh={refresh} basic={preview?.some(item=>!item.standards.length)}/>
        <button className="primary" disabled={busy||!connected||!data.modelConfigured} aria-describedby="batch-readiness" onClick={()=>act(async()=>{const submitted=await api({action:"batch",id:batchId,drafts:pending,tokenLimit,requestLimit,preview});setPreview(null);setSelected(null);setBatchId(crypto.randomUUID());notify("已提交，后台继续执行。");router.push("/production/queue?batch="+encodeURIComponent(submitted.id));})}>确认并开始批量生产</button></div>}
      <Link href="/">回到首页查看进度</Link>
    </section></>}
  </>;
}
type Readiness="disconnected"|"offline"|"unconfigured"|"ready";
function readiness(connected:boolean,online:boolean,modelConfigured:boolean):Readiness{
  return !connected?"disconnected":!modelConfigured?"unconfigured":!online?"offline":"ready";
}
function ReadinessNotice({state,scope,refresh,id,basic=false}:{state:Readiness;scope:"single"|"batch"|"queue";refresh:()=>void;id:string;basic?:boolean}){
  const queue=scope==="queue";
  const copy={
    disconnected:["工作台连接中断 · 暂不能提交",queue?"可以查看上次读取的队列；重新连接后再调整或重试。":"可以继续编辑，本页输入保留；重新连接后再保存或预检。","重新连接工作台"],
    offline:[queue?"生成后台离线 · 队列等待执行":scope==="batch"?"生成后台离线 · 可以先排队":"生成后台离线 · 可预检，暂不能生成",queue?"可以查看已有稿件或调整队列。启动生成后台后，排队任务会继续。":scope==="batch"?"可以保存、预检或提交清单。启动生成后台后，排队任务会开始。":"可以保存草稿和检查需求。启动生成后台后，在这里重新检查。","重新检查后台状态"],
    unconfigured:[queue?"模型未配置 · 队列暂不能执行":"模型未配置 · 可预检，暂不能生成",queue?"可以查看已有稿件。请先配置并启动本机模型，再检查队列状态。":"可以保存草稿和预检。请先配置并启动本机模型，再检查生成状态。","重新检查模型配置"],
    ready:[queue?"生成后台在线 · 队列可以继续执行":"生成后台在线 · 可以继续",queue?"可查看任务进度，或处理已有稿件。":"可以预检并确认开始。","重新检查后台状态"]
  }[state];
  return <div className="production-readiness" data-readiness={state}>
    <div id={id} role="status" aria-live="polite" aria-atomic="true"><strong>{copy[0]}</strong><p>{copy[1]}</p>
      {basic&&<p><strong>仅基础检查</strong> · 仍核验事实和格式，业务质量由作者审阅确认。</p>}
    </div>
    <button type="button" onClick={refresh}>{copy[2]}</button>
    {state==="offline"&&<details><summary>维护说明</summary><p>沿用原数据目录和模型配置重新启动工作台，启动命令中移除 <code>--no-worker</code>。</p></details>}
    {state==="unconfigured"&&<details><summary>维护说明</summary><p>核对启动环境中的 <code>STUDIO_MODEL</code> 和本机 <code>STUDIO_MODEL_URL</code>，启动模型服务并重启工作台。</p></details>}
  </div>;
}
function ProductionCost({mode}:{mode:ProductionView["mode"]}){
  if(mode==="真实云端")return <p>确认即授权本次向云端模型提交已预检的资料，可能产生费用。请求与 Token 额度用于限制执行次数和用量，未设置金额上限，实扣以服务商账单为准。</p>;
  return <p>{mode==="离线示例"?"离线示例 · 不产生云端模型费用。":"使用本机模型 · 不调用云端付费接口。"}</p>;
}
function Management({data,kind,busy,act}:{data:ProductionView;kind:"account"|"rule"|"standard";busy:boolean;act:Action}){
  const list=kind==="account"?data.accounts:kind==="rule"?data.rules:data.standards;
  const storageKey="management-drafts:"+kind;
  const [savedDrafts,setSavedDrafts]=useState<Record<string,Entity>>(()=>{try{return JSON.parse(localStorage.getItem(storageKey)||"{}");}catch{return {};}});
  const [editingRule,setEditingRule]=useState(false);
  const showEditor=kind!=="rule"||editingRule;
  const [form,setForm]=useState<Entity>({...initialEntity}),[dirty,setDirty]=useState(false),[q,setQ]=useState(""),[history,setHistory]=useState<Entity[]>([]);
  function editForm(next:Entity){setForm(next);setDirty(true);const drafts={...savedDrafts,[next.id||"new"]:next};setSavedDrafts(drafts);localStorage.setItem(storageKey,JSON.stringify(drafts));}
  function choose(next:Entity){setForm(savedDrafts[next.id||"new"]??next);setDirty(!!savedDrafts[next.id||"new"]);setHistory([]);if(kind==="rule")setEditingRule(true);}
  function discard(){const drafts={...savedDrafts};delete drafts[form.id||"new"];setSavedDrafts(drafts);localStorage.setItem(storageKey,JSON.stringify(drafts));setDirty(false);}
  useEffect(()=>{const warn=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[dirty]);
  useEffect(()=>{if(editingRule)document.getElementById("entity-name")?.focus();},[editingRule]);
  const title=kind==="account"?"账号管理":kind==="rule"?"写作规范":"质量标准";
  return <><header className="production-head"><h1>{title}</h1><Link href="/production/create">返回创作</Link></header><p>默认品牌。启用新版本仅影响未来提交的任务。</p>
    {kind==="account"&&<LessonFinder account={form.id}/>}
    {(showEditor||Object.keys(savedDrafts).length>0)&&<section className="management-drafts">
      {(dirty||kind!=="rule")&&<p>{dirty?"未保存输入已暂存本机；服务器版本未改变。":"切换条目不会删除本机暂存。"}</p>}
      {Object.entries(savedDrafts).map(([key,d])=><button key={key} onClick={()=>choose(d)}>恢复暂存：{d.name||"未命名"}</button>)}
      {dirty&&<button onClick={()=>{if(confirm("放弃当前本机暂存？")){discard();setForm(list.find(e=>e.id===form.id)??{...initialEntity});}}}>放弃暂存</button>}
      {showEditor&&<button onClick={()=>{const u=URL.createObjectURL(new Blob([JSON.stringify(form,null,2)],{type:"application/json"}));const a=document.createElement("a");a.href=u;a.download=title+"-输入备份.json";a.click();URL.revokeObjectURL(u);}}>导出当前输入</button>}
    </section>}
    <div className={showEditor?"management-grid":"management-grid management-overview"}><section>
      {(kind!=="rule"||list.length>0)&&<label>搜索<input value={q} onChange={e=>setQ(e.target.value)}/></label>}
      {list.filter(e=>e.name.includes(q)).map(e=><article key={e.id}><button onClick={()=>choose(e)}>{e.name} · v{e.version} · {e.status}</button><p>{e.body.slice(0,100)}</p></article>)}
      {!list.length&&<p>尚未配置{title}。</p>}
      <button className={!list.length?"primary":undefined} onClick={()=>{choose({...initialEntity});requestAnimationFrame(()=>document.getElementById("entity-name")?.focus());}}>{list.length?"新建"+title:"添加第一条"+title}</button></section>
    {showEditor&&<form onSubmit={e=>{e.preventDefault();void act(async()=>{const next=await api({action:"entity",kind,value:form});discard();setForm(next);});}}>
      <label>名称<input id="entity-name" required value={form.name} onChange={e=>editForm({...form,name:e.target.value})}/></label>
      <label>{kind==="account"?"业务说明":kind==="standard"?"维度与判断说明":"表达、结构与事实引用要求；正反例"}<textarea value={form.body} onChange={e=>editForm({...form,body:e.target.value})}/></label>
      <label>状态<select value={form.status} onChange={e=>editForm({...form,status:e.target.value as Entity["status"]})}>{["草稿","启用","停用","归档"].map(s=><option key={s}>{s}</option>)}</select></label>
      <label>{kind==="account"?"默认平台":"适用平台"}<select value={form.platform} onChange={e=>editForm({...form,platform:e.target.value as Entity["platform"]})}><option value="">通用 / 未指定</option>{productionPlatforms.map(platform=><option key={platform}>{platform}</option>)}</select></label>
      {kind==="account"?<><label>默认受众<input value={form.audience} onChange={e=>editForm({...form,audience:e.target.value})}/></label>
        <fieldset><legend>默认资料</legend>{data.references.map(r=><label key={r.id}><input type="checkbox" checked={form.sources.includes(r.id+"@"+r.version)} onChange={e=>editForm({...form,sources:e.target.checked?[...form.sources,r.id+"@"+r.version]:form.sources.filter(s=>s!==r.id+"@"+r.version)})}/>{r.title} v{r.version}</label>)}</fieldset>
        <fieldset><legend>关联规范</legend>{data.rules.filter(r=>r.status==="启用").map(r=><label key={r.id}><input type="checkbox" checked={form.rules.includes(r.id)} onChange={e=>editForm({...form,rules:e.target.checked?[...form.rules,r.id]:form.rules.filter(id=>id!==r.id)})}/>{r.name}</label>)}</fieldset></>:<>
        <label>适用账号<select value={form.account} onChange={e=>editForm({...form,account:e.target.value})}><option value="">默认品牌全部账号及自由创作</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>内容目标<select value={form.goal} onChange={e=>editForm({...form,goal:e.target.value})}><option value="">通用</option><option>品宣</option><option>获客</option></select></label>
        <label>内容模板<select value={form.type} onChange={e=>editForm({...form,type:e.target.value})}><option value="">通用</option>{kinds.map(k=><option key={k}>{k}</option>)}</select></label>
        <label><input type="checkbox" checked={form.hard} onChange={e=>editForm({...form,hard:e.target.checked})}/>硬性要求</label>
        {form.hard&&<><label>冲突检查项（统一写法，例如：结尾形式）<input required value={form.constraintKey} onChange={e=>editForm({...form,constraintKey:e.target.value})}/></label><label>要求值（例如：问题；同一检查项出现不同值会阻止提交，近义词请统一）<input required value={form.constraintValue} onChange={e=>editForm({...form,constraintValue:e.target.value})}/></label></>}</>}
      <details><summary>预览本次内容</summary><p style={{whiteSpace:"pre-wrap"}}>{form.body||"尚未填写"}</p></details>
      {kind==="rule"&&<p className="rule-scope">{(data.accounts.find(a=>a.id===form.account)?.name||form.account||"默认品牌的所有账号与自由创作")}，
        {form.platform||"不限平台"}，{form.goal||"不限目标"}，{form.type||"不限内容类型"}。
        {form.status==="启用"?"保存后适用于符合条件的新提交任务。":"启用后才适用于符合条件的新提交任务。"}已提交任务保留原规范版本。</p>}
      <button disabled={busy}>保存{form.version?"下一版本":""}</button>
      {form.id&&<button type="button" disabled={busy} onClick={()=>act(async()=>setHistory(await api({action:"history",kind,id:form.id})))}>查看版本记录</button>}
      {history.map(h=><details key={h.version}><summary>v{h.version} · {h.status}</summary><p>{h.body}</p></details>)}
    </form>}</div></>;
}
export function AttachmentUpload({onSaved}:{onSaved:(id:string)=>void}){
  const [file,setFile]=useState<File|null>(null),[description,setDescription]=useState(""),[source,setSource]=useState(""),[allowed,setAllowed]=useState(false),[status,setStatus]=useState(""),[busy,setBusy]=useState(false);
  return <div className="attachment"><p>UTF-8 TXT / Markdown ≤200 KB；PNG / JPEG / WebP ≤5 MB。图片使用你填写的说明。</p>
    <label>选择文件<input type="file" accept=".txt,.md,.png,.jpg,.jpeg,.webp" onChange={async e=>{const f=e.target.files?.[0]??null;setFile(f);if(f&&/\.(txt|md)$/i.test(f.name))setDescription(await f.text());else setDescription("");}}/></label>
    <label>提取预览或图片内容说明（可修正）<textarea value={description} onChange={e=>setDescription(e.target.value)}/></label><label>来源<input value={source} onChange={e=>setSource(e.target.value)}/></label>
    <label><input type="checkbox" checked={allowed} onChange={e=>setAllowed(e.target.checked)}/>我有权将所选内容用于本任务创作</label>
    <button type="button" disabled={!file||busy} onClick={async()=>{setBusy(true);try{const form=new FormData();const f=file!;form.set("file",/\.(txt|md)$/i.test(f.name)?new File([description],f.name,{type:"text/plain"}):f);form.set("description",description);form.set("source",source);form.set("allowed",String(allowed));const r=await fetch("/api/production/assets",{method:"POST",body:form}),d=await r.json();if(!r.ok)throw Error(d.error);onSaved(d.id);setStatus("已保存 "+d.name);}catch(e){setStatus(String(e));}finally{setBusy(false);}}}>上传并预览</button><p role="status">{status}</p>
  </div>;
}
export function ContentPackage({id}:{id:string}){
  const [data,setData]=useState<ReturnType<typeof imageState>|null>(null),[asset,setAsset]=useState(""),[page,setPage]=useState(1),[confirmed,setConfirmed]=useState(false),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const load=()=>api(undefined,"/api/production/package?id="+id).then(setData).catch(e=>setError(String(e)));
  useEffect(()=>{void load();},[id]); // eslint-disable-line react-hooks/exhaustive-deps
  if(!data)return <main><p>{error||"读取内容包…"}</p></main>;
  const prompt="为第 "+page+" 页设计配图。对应文字 v"+data.article.version+"，不要添加未经核实的数字或事实。\n"+data.article.body;
  return <main className="production"><Link href={editorHref(id,articleReturn(id,new URLSearchParams(location.search).get("returnTo")??undefined).source)}>返回文字编辑</Link><h1>{data.article.title} · 内容包</h1>
    <p>文字 v{data.article.version} · {data.article.confirmed?"已定稿":"待人工审核"} · {data.task?.imagesRequired?"需要配图":"允许仅文字交付"}</p>
    <h2>手动配图</h2><label>页序<input type="number" min={1} max={100} value={page} onChange={e=>setPage(Number(e.target.value))}/></label>
    <label>可复制的画面要求与提示词<textarea readOnly value={prompt}/></label>
    <button onClick={()=>navigator.clipboard.writeText(prompt).then(()=>setError("提示词已复制"),()=>setError("请在文本框中手动复制"))}>复制提示词</button>
    {data.illustrations?.map(image=><p key={image.id}><a href={"/api/production/assets?id="+image.id} target="_blank" rel="noreferrer">{image.name}</a> <button type="button" onClick={()=>{setAsset(image.id);setConfirmed(false);}}>选为本页配图</button></p>)}
    <AttachmentUpload onSaved={setAsset}/><p>所选图片 {asset||"尚未上传"}</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>已核对图片与当前文字版本</label>
    <button disabled={!asset||busy} onClick={async()=>{setBusy(true);try{await api({task:id,page,article:data.article.version,asset,confirmed},"/api/production/package");await load();setError("");}catch(e){setError(String(e));}finally{setBusy(false);}}}>保存图片归位版本</button>
    <h2>图片版本记录</h2>{data.images.map(i=><p key={String(i.id)}>第 {Number(i.page)} 页 · 图片 v{Number(i.version)} · 文字 v{Number(i.article)} · {Number(i.article)!==data.article.version?"文字已改，图片可能过期":i.confirmed?"人工已确认":"待确认"} · <a href={"/api/production/assets?id="+i.asset} target="_blank">查看图片</a><button onClick={()=>{setAsset(String(i.asset));setPage(Number(i.page));setConfirmed(false);}}>重新核对归位</button></p>)}
    <p role="status">{error}</p><button disabled={busy} onClick={async()=>{setBusy(true);try{const r=await fetch("/api/production/package?id="+id+"&download=1");if(!r.ok)throw Error((await r.json()).error);const url=URL.createObjectURL(await r.blob()),a=document.createElement("a");a.href=url;a.download="内容包-v"+data.article.version+".zip";a.click();setError("");setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(String(e));}finally{setBusy(false);}}}>确认整包并下载 ZIP</button>
    <p>导出包含选定文字版本、各页最新且已确认的图片，以及版本清单。</p></main>;
}
