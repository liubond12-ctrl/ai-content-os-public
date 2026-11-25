"use client";

import {useEffect,useState} from "react";
import Link from "next/link";
import {textDiff} from "@/studio/article-document";
import type {AssemblyTrace} from "@/types/sprint5";
import "./matrix.css";

type Member={id:string;account:string;name:string;title:string};
type Version={version:number;title:string;body:string;confirmed?:boolean};
type Result={groups:{topic:string;tasks:Member[]}[];accounts:{id:string;name:string}[];
  traces:{id:string;title:string;trace:AssemblyTrace}[]};
async function read(params:Record<string,string>={}){
  const response=await fetch("/api/matrix?"+new URLSearchParams(params),{cache:"no-store"});
  const result=await response.json();if(!response.ok)throw Error(result.error);
  return result;
}
export function MatrixWorkspace(){
  const [data,setData]=useState<Result|null>(null),[query,setQuery]=useState(""),[topic,setTopic]=useState("");
  const [account,setAccount]=useState(""),[error,setError]=useState(""),[left,setLeft]=useState<Version|null>(null),[right,setRight]=useState<Version|null>(null);
  async function load(filters:Record<string,string>={}){
    try{setData(await read(filters));setError("");}catch(e){setError(e instanceof Error?e.message:"暂时无法读取");}
  }
  useEffect(()=>{void load();},[]);
  const active=data?.groups.find(row=>row.topic===topic)??data?.groups[0];
  const first=active?.tasks[0],second=active?.tasks.find(row=>row.account!==first?.account);
  const comparison=left&&right?textDiff(left.title+"\n"+left.body,right.title+"\n"+right.body):null;
  return <main className="dashboard matrix-page"><header className="mast"><Link href="/studio/settings">返回工具与设置</Link><h1>矩阵与装配记录</h1></header>
    {error&&<p role="alert">{error}</p>}
    <section className="surface" aria-labelledby="matrix-compare"><h2 id="matrix-compare">同题成稿对比</h2>
      <form className="matrix-filters" onSubmit={e=>{e.preventDefault();setTopic("");void load({q:query,...(account?{account}:{})});}}>
        <label>搜索选题<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button>搜索</button></form>
      {!active?<p>{data?"暂无两个动态账号均已生成的同题稿件。":"正在读取…"}</p>:<>
        <label>同题组<select value={active.topic} onChange={e=>{setTopic(e.target.value);setLeft(null);setRight(null);}}>
          {data?.groups.map(group=><option key={group.topic}>{group.topic}</option>)}</select></label>
        <div className="matrix-pair" key={active.topic}>
          {first&&<MatrixColumn label="左侧" entries={active.tasks} initial={first.id} onChange={setLeft}/>}
          {second&&<MatrixColumn label="右侧" entries={active.tasks} initial={second.id} onChange={setRight}/>}
        </div>
        {comparison&&<details><summary>查看文字差异</summary><pre>{comparison.prefix}<del>{comparison.removed}</del><ins>{comparison.added}</ins>{comparison.suffix}</pre></details>}
      </>}
    </section>
    <section className="surface" aria-labelledby="matrix-assembly"><h2 id="matrix-assembly">生产装配记录</h2>
      <label>按账号查看<select value={account} onChange={e=>{const value=e.target.value;setAccount(value);void load({q:query,...(value?{account:value}:{})});}}>
        <option value="">全部账号</option>{data?.accounts.map(row=><option value={row.id} key={row.id}>{row.name}</option>)}</select></label>
      {data?.traces.map(row=><details key={row.id}><summary>{row.title}</summary><Link href={"/studio/editor?taskId="+row.id}>查看稿件</Link><AssemblyDetails trace={row.trace}/></details>)}
    </section>
  </main>;
}
function MatrixColumn({label,entries,initial,onChange}:{label:string;entries:Member[];initial:string;onChange:(row:Version|null)=>void}){
  const [task,setTask]=useState(initial),[data,setData]=useState<Version[]>([]),[version,setVersion]=useState(0),[error,setError]=useState("");
  const current=data.find(row=>row.version===version);
  useEffect(()=>{
    let active=true;setData([]);setError("");onChange(null);
    void read({task}).then(result=>{if(active){setData(result.versions);setVersion(result.versions[0]?.version??0);onChange(result.versions[0]??null);}})
      .catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[task,onChange]);
  return <section aria-label={label} className="matrix-column">
    <label>{label}账号稿件<select value={task} onChange={e=>setTask(e.target.value)}>
      {entries.map(row=><option value={row.id} key={row.id}>{row.name} · {row.title}</option>)}</select></label>
    <label>{label}文章版本<select value={version} onChange={e=>{const v=Number(e.target.value);setVersion(v);onChange(data.find(row=>row.version===v)??null);}}>
      {data.map(row=><option key={row.version} value={row.version}>v{row.version}{row.confirmed?" · 已定稿":""}</option>)}</select></label>
    {error&&<p role="alert">{error}</p>}
    {current&&<><h3>{current.title}</h3><pre>{current.body}</pre><Link href={"/studio/editor?"+new URLSearchParams({taskId:task,version:String(version)})}>打开此版本</Link></>}
  </section>;
}
export function AssemblyDetails({trace}:{trace:AssemblyTrace}){
  return <div className="matrix-trace"><p>账号版本 v{trace.accountVersion} · {trace.modules.length} 项装配记录</p>
    <p>快照哈希 <code>{trace.hash}</code></p>
    <ul>{trace.modules.map((module,index)=><li key={module.source+":"+index}>{module.source} · <code>{module.hash.slice(0,12)}</code>{module.duplicateOf&&" · 与 "+module.duplicateOf+" 重复"}</li>)}</ul>
    {trace.references.length>0&&<p>选定资料 · {trace.references.join("、")}</p>}
    {trace.conflicts.map(row=><p key={row.key}>{row.key} · {row.resolution} · {row.sources.join("、")}</p>)}
  </div>;
}
export function TaskAssembly({task}:{task:string}){
  const [trace,setTrace]=useState<AssemblyTrace|null>(null),[error,setError]=useState("");
  return <details onToggle={e=>{if(e.currentTarget.open&&!trace&&!error)void read({task}).then(result=>setTrace(result.trace)).catch(e=>setError(e.message));}}>
    <summary>查看账号装配与来源</summary>
    {trace?<AssemblyDetails trace={trace}/>:<p>{error||"此任务暂无装配快照。"}</p>}
  </details>;
}
