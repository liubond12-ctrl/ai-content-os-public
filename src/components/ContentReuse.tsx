"use client";
import {articleReturn,editorHref} from "@/studio/article-navigation";
import {usePathname,useSearchParams} from "next/navigation";
import {useEffect,useState} from "react";
import type {ArticleSnapshot} from "@/studio/article-store";
type Hit={id:string;title:string;account:string;accountName:string;kind:string;updated:string;status:string;archived:number;reason:string};
export function SimilarTopics({topic,account,id}:{topic:string;account:string;id:string}){
  const pathname=usePathname(),query=useSearchParams();
  const origin=pathname+(query.size?"?"+query:"");
  const [hits,setHits]=useState<{q:string;rows:Hit[]}|null>(null);
  useEffect(()=>{
    if(!topic.trim())return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{try{const r=await fetch("/api/content?"+new URLSearchParams({topic,exclude:id}),{signal:controller.signal});if(r.ok&&!controller.signal.aborted)setHits({q:topic,rows:await r.json()});}catch{}},350);
    return()=>{clearTimeout(timer);controller.abort();};
  },[topic,id]);
  if(hits?.q!==topic||!hits.rows.length)return null;
  return <aside><strong>相似选题</strong>{hits.rows.map(h=><p key={h.id}><a target="_blank" rel="noreferrer" href={editorHref(h.id,origin)}>{h.title}</a> · {h.account? h.account===account?"本账号":"跨账号":"未归属"} {h.accountName} · {h.kind} · {h.status} · {h.updated?h.updated.slice(0,10):"时间未记录"} {h.archived?" · 已归档":""}<br/>命中词：{h.reason}</p>)}</aside>;
}
type Lesson={id:string;task:string;account:string;series:string;scope:string;previous:number;current:number;beforeText:string;afterText:string;reason:string};
type Destination={version:number;status:string;day:string;url:string};
async function read(url:string,body?:unknown){
  const r=await fetch(url,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const value=await r.json();if(!r.ok)throw Error(value.error);return value;
}
function Lessons({items}:{items:Lesson[]}){
  const path=usePathname(),query=useSearchParams();
  const origin=path+(query.size?"?"+query:"");
  const [message,setMessage]=useState("");
  return <>{items.map(l=><details key={l.id}><summary>{l.scope} · {l.series||l.account} · {l.reason}</summary>
    <a href={editorHref(l.task,query.get("taskId")===l.task?articleReturn(l.task,query.get("returnTo")??undefined).source:origin,{version:String(l.current)})}>原稿 v{l.previous} → v{l.current}</a><p>{l.beforeText} → {l.afterText}</p>
    {l.account&&<details><summary>升级为账号规范</summary><p>适用账号：{l.account}<br/>规范正文：{l.reason}（{l.beforeText} → {l.afterText}）</p><button type="button" onClick={async()=>{try{await read("/api/production",{action:"entity",kind:"rule",value:{id:l.id,version:0,name:l.reason.slice(0,80),body:l.reason+"（"+l.beforeText+" → "+l.afterText+"）",account:l.account,status:"启用"}});setMessage("账号规范已启用");}catch(e){setMessage(String(e));}}}>确认启用账号规范</button></details>}</details>)}<p role="status">{message}</p></>;
}
export function LessonFinder({account=""}:{account?:string}){
  const [series,setSeries]=useState(""),[items,setItems]=useState<Lesson[]>([]);
  useEffect(()=>{let active=true;read("/api/content?"+new URLSearchParams({account,series})).then(v=>{if(active)setItems(v);}).catch(()=>{if(active)setItems([]);});return()=>{active=false;};},[account,series]);
  return <details><summary>找回账号或专题经验</summary><label>经验专题<input value={series} onChange={e=>setSeries(e.target.value)}/></label>{!items.length&&<p>没有匹配的经验。</p>}<Lessons items={items}/></details>;
}
type Records={origin?:{title:string;source:string;original:string;canonical:string};account:string;series:string;history:Destination[];notes:Lesson[]};
export function ArticleReuse({version,versions,embedded=false}:{version:ArticleSnapshot;versions:ArticleSnapshot[];embedded?:boolean}){
  const [data,setData]=useState<Records|null>(null),[message,setMessage]=useState("");
  const url="/api/content?task="+version.taskId;
  useEffect(()=>{let active=true;read(url).then(v=>{if(active)setData(v);}).catch(e=>{if(active)setMessage(String(e));});return()=>{active=false;};},[url]);
  const old=versions.filter(v=>v.version<version.version);
  const [prev,setPrev]=useState(old[0]?.version??0);
  const source=old.find(v=>v.version===prev);
  const prior=data?.history.find(r=>r.version===version.version);
  async function save(form:HTMLFormElement,action:string){
    try{
      const fields=Object.fromEntries(new FormData(form)),clock=fields.publicationClock;
      delete fields.publicationClock;
      const publishedAt=fields.status==="已发布"&&typeof clock==="string"&&clock?new Date(clock).toISOString():undefined;
      const result=await read("/api/content",{...fields,publishedAt,task:version.taskId,version:version.version,previous:prev,action});
      setData(await read(url));setMessage(result.message);
    }catch(e){setMessage(String(e));}
  }
  return <section>{!embedded&&<h2>发布与修改经验</h2>}<p role="status">{message}</p>{data&&<>
    {data.origin&&<p>选题出处：{data.origin.title} · {data.origin.source} {/^https?:\/\//i.test(data.origin.original)&&<a href={data.origin.original} target="_blank" rel="noreferrer">原始报道</a>} {/^https?:\/\//i.test(data.origin.canonical)&&<a href={data.origin.canonical} target="_blank" rel="noreferrer">AIHOT 原站</a>}</p>}
    {data.history.length?data.history.map(r=><p key={r.version}>v{r.version} · {r.status} {r.day} {r.url&&<a target="_blank" rel="noreferrer" href={r.url}>发布链接</a>}</p>):<p>发布去向：未记录</p>}
    {version.confirmed&&<details><summary>登记 v{version.version} 发布去向</summary><form onSubmit={e=>{e.preventDefault();void save(e.currentTarget,"destination");}}>
      <label>发布状态<select name="status" defaultValue={prior?.status}>{["待发布","已发布","暂不采用"].map(s=><option key={s}>{s}</option>)}</select></label><label>实际发布日期<input type="date" name="day" defaultValue={prior?.day}/></label>
      <label>实际发布时间（本机时区）<input type="datetime-local" name="publicationClock" step="1"/></label>
      <p>填写实际发布时间，便于核对盲预测先于发布，并从该时刻安排 T+3d。</p>
      <label>平台链接<input name="url" type="url" defaultValue={prior?.url}/></label><button>保存去向</button></form></details>}
    {source&&<details><summary>记为账号经验</summary><form className="reuse-form" onSubmit={e=>{e.preventDefault();void save(e.currentTarget,"lesson");}}>
      <label>改前版本<select value={prev} onChange={e=>setPrev(Number(e.target.value))}>{old.map(v=><option key={v.version} value={v.version}>v{v.version}</option>)}</select></label>
      <details><summary>核对两个版本的原文</summary><p>v{prev} · {source.title}</p><pre onMouseUp={e=>{const text=window.getSelection()?.toString();const field=e.currentTarget.closest("form")?.elements.namedItem("before") as HTMLTextAreaElement|null;if(text&&field)field.value=text;}}>{source.body}</pre><p>v{version.version} · {version.title}</p><pre onMouseUp={e=>{const text=window.getSelection()?.toString();const field=e.currentTarget.closest("form")?.elements.namedItem("after") as HTMLTextAreaElement|null;if(text&&field)field.value=text;}}>{version.body}</pre></details>
      <label>改前原文<textarea name="before" maxLength={4000}/></label><label>改后原文（v{version.version}）<textarea name="after" maxLength={4000}/></label><label>修改原因<textarea name="reason" required maxLength={2000}/></label><label>适用范围<select name="scope">{data.account&&<option>账号</option>}<option>专题</option></select></label><label>经验专题<input name="series" defaultValue={data.series}/></label><button>保存经验</button></form></details>}
    <Lessons items={data.notes}/></>}</section>;
}
