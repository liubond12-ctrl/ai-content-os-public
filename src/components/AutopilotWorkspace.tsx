"use client";

import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import {editorHref} from "@/studio/article-navigation";
import {defaultCruisePolicy,type CruisePolicy,type LedgerRecord,type MorningCandidate} from "@/types/autopilot";
import {defaultAutomationPolicy,type AutomationPolicy} from "@/types/readiness";
import "./autopilot.css";

type PreviewCard={id:string;message:string;delivery:string;result:string;card:{kind:string;title:string;text:string;task:string;version:number;options:string[]}};
type View={
  day:string;demo:boolean;policy:CruisePolicy;
  run:null|{day:string;status:string;detail:string;policy:CruisePolicy};
  items:Array<{taskId:string;title:string;status:string;reason:string;source:string;hopCount:number;score?:number;candidate?:MorningCandidate;decision:null|{action:string;version:number}}>;
  cards:PreviewCard[];
  ledger:Array<{record:LedgerRecord;state:string;detail:string;mode:string}>;
  reruns:Array<{task:string;batch:string;status:string}>;
  automation:AutomationPolicy;
  budget:{spent:number;pending:number;limit:number;paused:boolean;light:boolean};
  screens:{title:string;score:number|null}[];
};
const states:Record<string,string>={pending:"待同步",unknown:"回执待核对",retry:"等待重试",sent:"已同步",planning:"扫描来源",prepared:"准备提交",submitted:"已提交",empty:"无匹配",failed:"失败"};
const settings="/studio/settings/autopilot";

export function AutopilotWorkspace({budgetOnly=false}:{budgetOnly?:boolean}){
  const [data,setData]=useState<View|null>(null),[day,setDay]=useState(""),[policy,setPolicy]=useState<CruisePolicy|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
  const [automation,setAutomation]=useState<AutomationPolicy|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    let inFlight=false;
    async function load(){
      if(inFlight)return;
      inFlight=true;
      try{
        const response=await fetch("/api/autopilot"+(day?"?day="+encodeURIComponent(day):""),{signal:controller.signal,cache:"no-store"});
        if(!response.ok)throw Error("暂时无法读取早报。");
        const view:View=await response.json();
        if(!controller.signal.aborted){setData(view);setPolicy(current=>current??view.policy);setAutomation(current=>current??view.automation);}
      }catch(error){if(!controller.signal.aborted)setError(error instanceof Error?error.message:String(error));}
      finally{inFlight=false;}
    }
    void load();
    const timer=setInterval(()=>void load(),2500);
    return()=>{clearInterval(timer);controller.abort();};
  },[day]);

  async function post(payload:object){
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch("/api/autopilot",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();
      if(!response.ok)throw Error(result.error);
      setDay("");setData(result);
      setNotice("已记录操作，队列和同步状态会自动更新。");
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{setBusy(false);}
  }
  const draft=policy??defaultCruisePolicy;
  const costs=automation??defaultAutomationPolicy;
  const change=<K extends keyof CruisePolicy>(key:K,value:CruisePolicy[K])=>setPolicy({...draft,[key]:value});
  const candidates=data?.items.filter(item=>item.candidate&&!item.decision)??[];
  const exclusions=data?.items.filter(item=>!item.candidate&&!item.decision)??[];
  const budgetPanel=<>
      <form onSubmit={e=>{e.preventDefault();void post({action:"automation",policy:costs});}}>
        <div className="cruise-fields"><label>画像最低分<input required type="number" min={0} max={100} value={costs.matchMin}
          onChange={e=>setAutomation({...costs,matchMin:e.target.valueAsNumber})}/></label>
        <label>每日估算上限（元）<input required type="number" min=".001" max="100000" step=".001" value={costs.dailyMicros/1e6}
          onChange={e=>setAutomation({...costs,dailyMicros:Math.round(e.target.valueAsNumber*1e6)})}/></label></div>
        <button disabled={busy||!data}>保存画像与预算</button>
      </form>
      {data?.budget&&<p role="status">已估算 {(data.budget.spent/1e6).toFixed(4)} 元 · 在途及待核 {(data.budget.pending/1e6).toFixed(4)} 元 ·
        {data.budget.paused?" 已暂停":data.budget.light?" 非关键调用已切轻量":" 正常"}（北京时间）</p>}
  </>;
  if(budgetOnly)return <main className="dashboard autopilot-page">
    <header className="mast"><Link href="/studio/system">返回系统机房</Link><h1>巡航费用与暂停上限</h1></header>
    <section className="surface" id="cruise-cost" aria-label="巡航预算">{budgetPanel}
      {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
      <Link href={settings+"#cruise-results"}>返回巡航筛选结果</Link>
    </section>
  </main>;
  return <main className="dashboard autopilot-page">
    <header className="mast"><h1>夜间巡航与飞书早报</h1></header>
    <div className="cruise-actions">
      <button type="button" className="primary" disabled={busy||!data} onClick={()=>void post({action:"run"})}>{data?.demo?"模拟夜间巡航":"立即巡航"}</button>
    </div>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}

    <section className="surface" id="cruise-results" aria-labelledby="cruise-morning"><header className="cruise-section-head">
      <h2 id="cruise-morning">飞书早报预览</h2><label>查看日期<input type="date" value={day||data?.day||""} onChange={event=>setDay(event.target.value)}/></label>
    </header>
      {data?.run?<p role="status">巡航{states[data.run.status]??data.run.status} · 本批门槛 {data.run.policy.minScore} 分{data.run.detail&&" · "+data.run.detail}</p>:<p>{data?"这一天暂无巡航记录。":"正在读取巡航记录…"}</p>}
      <p>{candidates.length} 篇候选</p>
      {!!data?.screens.length&&<details><summary>查看画像初筛记录 · {data.screens.length} 条</summary>
        <ul>{data.screens.map((item,index)=><li key={index}>{item.title} · {item.score===null?"未完成，等待核对":item.score+" 分"}</li>)}</ul>
      </details>}
      {data?.cards.filter(card=>card.card.kind==="morning").map(card=><details key={card.id}><summary>查看多篇摘要卡片</summary><p className="cruise-card-text">{card.card.text}</p></details>)}
      {candidates.map(item=>{
        const c=item.candidate!;
        const card=data?.cards.find(row=>row.card.kind==="morning-item"&&row.card.task===c.taskId&&row.card.version===c.articleVersion&&row.delivery==="sent"&&!row.result);
        return <article className="cruise-candidate" key={c.taskId}>
          <div><h3>{c.title}</h3><p>{c.account} · v{c.articleVersion} · {c.score} 分{item.source&&" · "+item.source}</p>
            <p>{c.summary}</p><p>核心分歧：{c.disagreements.join("、")||"没有记录分歧"}</p></div>
          <div className="cruise-actions">
            <Link href={editorHref(c.taskId,settings,{version:String(c.articleVersion),review:"1"})}>查看母稿</Link>
            {card&&<>{card.card.options.includes("rerun")&&<button type="button" disabled={busy} onClick={()=>void post({action:"decision",decision:"rerun",card:card.id,message:card.message})}>模拟打回重跑</button>}
            <button className="primary" type="button" disabled={busy} onClick={()=>void post({action:"decision",decision:"approve",card:card.id,message:card.message})}>模拟通过</button></>}
          </div>
        </article>;
      })}
      {data?.items.filter(item=>item.decision).map(item=><article className="cruise-candidate" key={item.taskId}>
        <div><h3>{item.title}</h3><p>{item.decision?.action==="approve"?"已通过":"已打回"} · v{item.decision?.version}</p></div>
        {item.decision?.action==="approve"&&<Link href={editorHref(item.taskId,settings,{version:String(item.decision.version),distribution:"1"})}>进入三端分发</Link>}
      </article>)}
      {!!data?.reruns.length&&<p role="status">重跑：{data.reruns.map(row=>states[row.status]??row.status).join("、")}</p>}
      {!!exclusions.length&&<details><summary>尚未入选 · {exclusions.length} 篇</summary><ul>{exclusions.map(item=><li key={item.taskId}>
        <Link href={editorHref(item.taskId,settings,{review:"1"})}>{item.title}</Link> · {item.status}{item.score!==undefined&&" · "+item.score+" 分"} · {item.reason}
      </li>)}</ul></details>}
    </section>

    <details className="surface" id="cruise-policy"><summary>查看和修改巡航策略</summary>
      <p>{data?.demo?"离线演练使用虚构来源、模拟模型和模拟飞书表。":"定时任务由通知后台和生产后台执行，预生产使用本机模型。"}</p>
      <form onSubmit={event=>{event.preventDefault();void post({action:"policy",policy:draft});}}>
        <label className="cruise-enabled"><input type="checkbox" checked={draft.enabled} onChange={e=>change("enabled",e.target.checked)}/>按日启用定时巡航</label>
        <div className="cruise-fields">
          <label>北京时间<input type="time" value={draft.time} required onChange={e=>change("time",e.target.value)}/></label>
          <label>最低分<input type="number" min={0} max={100} required value={draft.minScore} onChange={e=>change("minScore",e.target.valueAsNumber)}/></label>
          <label>最多新任务<input type="number" min={1} max={6} required value={draft.maxTasks} onChange={e=>change("maxTasks",e.target.valueAsNumber)}/></label>
          <label>当日请求额度<input type="number" min={32} max={200} required value={draft.requestLimit} onChange={e=>change("requestLimit",e.target.valueAsNumber)}/></label>
          <label>当日 Token 额度<input type="number" min={20000} max={500000} required value={draft.tokenLimit} onChange={e=>change("tokenLimit",e.target.valueAsNumber)}/></label>
        </div>
        <div className="cruise-actions"><button disabled={busy||!data}>保存策略</button>
        </div>
      </form>
    </details>
    <details className="surface" id="cruise-cost"><summary>查看巡航费用与选题记录</summary>{budgetPanel}</details>

    <section className="surface" aria-labelledby="cruise-ledger"><h2 id="cruise-ledger">发布台账</h2>
      {!data?.ledger.length&&<p>审批通过或确认定稿后，稿件会进入台账。</p>}
      {data?.ledger.map(item=><LedgerEntry key={item.record.articleId+":"+item.record.articleVersion} item={item} busy={busy} submit={post}/>)}
    </section>
  </main>;
}
function LedgerEntry({item,busy,submit}:{item:View["ledger"][number];busy:boolean;submit:(body:object)=>Promise<void>}){
  const {record}=item;
  const [schedule,setSchedule]=useState("");
  function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();void submit({action:"schedule",taskId:record.articleId,version:record.articleVersion,at:schedule?new Date(schedule).toISOString():null});
  }
  return <article className="cruise-candidate">
    <div><h3>{record.title}</h3><p>{record.account} · v{record.articleVersion} · {states[item.state]??item.state}{item.mode==="mock"?" · 模拟表":""}</p>
      <p>小红书 {record.channels.xiaohongshu||"待派生"} · 抖音口播 {record.channels.douyinScript||"待派生"} · 抖音图文 {record.channels.douyinPost||"待派生"} · 公众号 {record.channels.wechat||"待派生"}</p>
      <p>排期 {record.scheduledAt?new Date(record.scheduledAt).toLocaleString():"待安排"}{item.detail&&" · "+item.detail}</p></div>
    <form className="cruise-actions" onSubmit={save}><label>排期（本机时区）<input type="datetime-local" value={schedule} onChange={event=>setSchedule(event.target.value)}/></label><button disabled={busy}>保存排期</button></form>
  </article>;
}
