"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import type {DoctorCheck,ReadinessTask} from "@/types/readiness";
import type {readinessEvaluation} from "@/studio/readiness-evaluation";
import "./readiness.css";

async function load(path="",method="GET"){
  const response=await fetch("/api/readiness"+path,method==="GET"?{cache:"no-store"}:{method,headers:{"Content-Type":"application/json"},body:"{}"});
  const result=await response.json();if(!response.ok)throw Error(result.error??"读取失败");
  return result;
}
export function DailyDesk(){
  const [rows,setRows]=useState<ReadinessTask[]|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{
    let active=true;
    const refresh=()=>void load().then(data=>{if(active){setRows(data);setFailed(false);}}).catch(()=>{if(active)setFailed(true);});
    refresh();const timer=setInterval(refresh,15000);return()=>{active=false;clearInterval(timer);};
  },[]);
  return <section className="ck-work readiness-daily" aria-labelledby="daily-desk-heading"><h2 id="daily-desk-heading">今日统一作战台</h2>
    {failed&&<p role="status">暂时无法更新。</p>}
    <div>{rows?.map(row=><Link key={row.label} href={row.href}><strong>{row.count}</strong> {row.label}</Link>)}</div>
    {!rows&&!failed&&<p role="status">正在读取待办…</p>}
  </section>;
}
export function DoctorWorkspace(){
  const [rows,setRows]=useState<DoctorCheck[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  async function check(){setBusy(true);setError("");try{setRows(await load("","POST"));}catch(e){setError(e instanceof Error?e.message:"无法探活");}finally{setBusy(false);}}
  return <main className="dashboard readiness-page"><header className="mast"><Link href="/studio/settings">返回工具与设置</Link><h1>System Doctor</h1></header>
    <section className="surface"><button className="primary" disabled={busy} onClick={()=>void check()}>{busy?"正在探活…":"运行本机探活"}</button>
      {error&&<p role="alert">{error}</p>}
      {rows.map(row=><div className="readiness-check" key={row.name}><h2>{row.name} <small>{row.status}</small></h2>
        <p>{row.detail} · {row.basis}</p>{row.next&&<p>{row.next}</p>}</div>)}
    </section></main>;
}
export function GovernanceWorkspace(){
  const [data,setData]=useState<ReturnType<typeof readinessEvaluation>|null>(null),[error,setError]=useState("");
  useEffect(()=>{let active=true;void load("?evaluation=1").then(result=>{if(active)setData(result);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  const display=(result:{count:number;total:number;rate:number|null})=>result.rate===null?"缺测":(result.rate*100).toFixed(0)+"%（"+result.count+"/"+result.total+"）";
  return <main className="dashboard readiness-page"><header className="mast"><Link href="/studio/settings">返回工具与设置</Link><h1>治理效果对比</h1></header>
    <section className="surface"><p>{data?.basis}</p>{error&&<p role="alert">{error}</p>}
      {data?.metrics.map(metric=><div className="readiness-check" key={metric.label}><h2>{metric.label}</h2><p>{metric.formula}</p>
        <dl className="readiness-pair"><div><dt>单 Agent 模拟基准</dt><dd>{display(metric.single)}</dd></div>
          <div><dt>全链路离线检查</dt><dd>{display(metric.full)}</dd></div></dl></div>)}
      {data&&<details><summary>查看样本与逐项结果</summary>
        <ul>{data.facts.map(row=><li key={row.id}>{row.body} · {row.full?"需核验":"未拦截"}</li>)}</ul>
        <ul>{data.personas.map(row=><li key={row.id}>{row.id} · {row.rule} · {row.full?"装配一致":"装配冲突"}</li>)}</ul>
        <ul>{data.channels.map((row,i)=><li key={i}>{row.variant} · {row.text} · {row.full?"提示词表风险":"无风险提示"}</li>)}</ul>
      </details>}
    </section></main>;
}
