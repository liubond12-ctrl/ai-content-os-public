"use client";

import Link from "next/link";
import {useEffect,useState,type FormEvent} from "react";
import {brickKind,rubricFocus,type AtomicBrick,type BlindPrediction,type Metrics,type Retro,type RubricBumpProposal,type RubricFocus,type VersionKey} from "@/types/calibration";
import "./calibration.css";

export const calibrationPath="/studio/settings/calibration";
const keys={reach:"播放或阅读",likes:"赞",saves:"藏",comments:"评论",conversions:"转化"} as const;
const metricKeys=Object.keys(keys) as Array<keyof Metrics>;
const emptyMetrics={reach:0,likes:0,saves:0,comments:0,conversions:0};
const dateLabel=(date:string)=>new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Shanghai"}).format(new Date(date));
type Item=VersionKey & {prediction:Omit<BlindPrediction,"body">;publication:{dueAt:string;publishedAt:string;demoWake:boolean}|null;retro:Retro[];due:boolean};
type Snapshot={demo:boolean;accounts:{id:string;name:string}[];stage:string;count:number;items:Item[];proposals:RubricBumpProposal[];
  cards:{delivery:string;result:string;card:{task:string;version:number;title:string}}[]};
type ModelPlan={purpose:string;model:string;concurrency:number;target:string;configured:boolean};
async function request(path="",body?:object){
  const response=await fetch("/api/calibration"+path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{cache:"no-store"});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"工作台暂时不可用");
  return data;
}

export function CalibrationWorkspace(){
  const [data,setData]=useState<Snapshot|null>(null),[account,setAccount]=useState(""),[focus,setFocus]=useState<RubricFocus>("结构");
  const [routes,setRoutes]=useState<ModelPlan[]>([]),[error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
  const [selection,setSelection]=useState("");
  const path="?account="+encodeURIComponent(account);
  useEffect(()=>{
    let alive=true;
    const load=()=>request(path).then(next=>{if(alive)setData(next);}).catch(e=>{if(alive)setError(String(e.message));});
    void load();
    const timer=setInterval(()=>void load(),3000);
    return()=>{alive=false;clearInterval(timer);};
  },[path]);
  async function perform(body:object,feedback:string){
    setBusy(true);setError("");setNotice("");
    try{
      await request("",body);
      if("action" in body&&body.action==="seed"){
        setAccount("calibration-demo");
        setData(await request("?account=calibration-demo"));
      }else setData(await request(path));
      setNotice(feedback);
    }catch(e){setError(e instanceof Error?e.message:"操作失败");}
    finally{setBusy(false);}
  }
  const active=data?.items.find(item=>item.task+":"+item.version===selection)??data?.items[0];
  return <main className="dashboard calibration-page">
    <header className="mast"><Link href="/studio/settings">返回工具与设置</Link><h1>发布复盘与规则校准</h1>
      <div className="cal-actions"><label>账号<select value={account} onChange={event=>{setAccount(event.target.value);setSelection("");}}>
        <option value="">选择账号</option>{data?.accounts.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {data?.demo&&<button type="button" disabled={busy} onClick={()=>void perform({action:"seed"},"已载入隔离校准数据")}>载入离线校准样例</button>}</div>
    </header>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {account&&<><section className="surface" aria-labelledby="cal-retro"><header className="cal-title"><h2 id="cal-retro">版本与实绩</h2>
      <strong>{data?.stage??"cold-start"} · {data?.count??0} 篇已复盘</strong></header>
      {!active?<p>此账号暂无锁定预测。定稿后可从编辑页打开发布复盘。</p>:<>
        <label>稿件<select value={active.task+":"+active.version} onChange={event=>setSelection(event.target.value)}>
          {data?.items.map(item=><option key={item.task+":"+item.version} value={item.task+":"+item.version}>{item.prediction.title} · v{item.version}</option>)}</select></label>
        <RetroEntry key={active.task+":"+active.version} item={active} demo={!!data?.demo} busy={busy} perform={perform}
          card={data?.cards.find(row=>row.card.task===active.task&&row.card.version===active.version)}/>
      </>}
    </section>
    <section className="surface" aria-labelledby="cal-rules"><h2 id="cal-rules">规则提案</h2>
      <div className="cal-actions"><label>候选维度<select value={focus} onChange={e=>setFocus(e.target.value as RubricFocus)}>
        {rubricFocus.options.map(value=><option key={value}>{value}</option>)}</select></label>
        <button type="button" disabled={busy} onClick={()=>void perform({action:"propose",account,focus},"已完成历史样本重打")}>生成并重打历史样本</button></div>
      {data?.proposals.map(row=><article className="cal-entry" key={row.id}>
        <h3>{row.focus} <span className={row.passed?"cal-pass":"cal-block"}>{row.appliedVersion?"已生效 v"+row.appliedVersion:row.passed?"通过":"拦截"}</span></h3>
        <p><strong>{row.agreement===null?"暂无可比排序":(row.agreement*100).toFixed(1)+"%"}</strong> · {row.aligned}/{row.comparable} 对一致 · {row.samples.length} 篇</p><p>{row.reason}</p>
        {!!row.conflicts.length&&<details><summary>查看 {row.conflicts.length} 对冲突</summary><ul>{row.conflicts.map((pair,index)=><li key={index}>{pair.higher} / {pair.lower} · {pair.reason}</li>)}</ul></details>}
        {row.passed&&!row.appliedVersion&&<button type="button" disabled={busy} onClick={()=>void perform({action:"apply",account,id:row.id},"账号规则已更新")}>合并到账号规则</button>}
      </article>)}
    </section></>}
    {account&&<ReferenceExtraction account={account} busy={busy} perform={perform}/>}
    <section className="surface" aria-labelledby="cal-model"><h2 id="cal-model">模型路由</h2>
      <button type="button" onClick={()=>void request("?routes=1").then(setRoutes).catch(e=>setError(e.message))}>预演模型路由</button>
      {routes.length>0&&<ul aria-label="路由预演结果">{routes.map(row=><li key={row.purpose}><strong>{row.purpose}</strong> · {row.model||"未配置"} · {row.target} · 并发 {row.concurrency}</li>)}</ul>}
    </section>
  </main>;
}

function ReferenceExtraction({account,busy,perform}:{account:string;busy:boolean;perform:(body:object,notice:string)=>Promise<void>}){
  type Ref={id:string;version:number;title:string;source:string;method:string;content:string;synthetic?:boolean};
  const [items,setItems]=useState<Ref[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState("");
  const [id,setId]=useState(""),[text,setText]=useState(""),[kind,setKind]=useState<AtomicBrick["kind"]>("方法论");
  const selected=items.find(row=>row.id===id);
  return <details className="surface" onToggle={event=>{
    if(event.currentTarget.open&&!loaded){setLoaded(true);void request("?references=1").then(setItems).catch(error=>setError(error.message));}
  }}><summary>从爆款参考萃取积木</summary>
    {error&&<p role="alert">{error}</p>}
    {loaded&&!items.length?<p>参考库当前没有明确标为「爆款」且可用的案例。</p>:<form onSubmit={event=>{
      event.preventDefault();
      if(selected)void perform({action:"reference-brick",reference:id,version:selected.version,account,kind,text,tags:[]},"素材积木已保存");
    }}>
      <div className="cal-actions"><label>参考来源<select required value={id} onChange={event=>{setId(event.target.value);setText("");}}>
        <option value="">选择来源版本</option>{items.map(row=><option key={row.id} value={row.id}>{row.title} · v{row.version}</option>)}</select></label>
        <label>类型<select value={kind} onChange={event=>setKind(event.target.value as AtomicBrick["kind"])}>
          {brickKind.options.map(value=><option key={value}>{value}</option>)}</select></label></div>
      {selected&&<p>{selected.source} · {selected.method}</p>}
      <label>摘自来源的原句<textarea required value={text} onChange={event=>setText(event.target.value)} maxLength={1500}/></label>
      <button disabled={busy||!selected}>保存参考积木</button>
    </form>}
  </details>;
}

function RetroEntry({item,demo,busy,perform,card}:{item:Item;demo:boolean;busy:boolean;perform:(body:object,notice:string)=>Promise<void>;card?:Snapshot["cards"][number]}){
  const {task,version,prediction,publication,retro,due}=item,key={task,version},last=retro.at(-1);
  const [values,setValues]=useState<Metrics>(last?.metrics??emptyMetrics),[source,setSource]=useState(demo?"隔离模拟平台实绩":"");
  const [observedAt,setObservedAt]=useState("");
  const [recordedAt,setRecordedAt]=useState(""),[kind,setKind]=useState<AtomicBrick["kind"]>("Hook"),[text,setText]=useState(""),[tags,setTags]=useState("");
  const updated=(event:FormEvent)=>{event.preventDefault();void perform({action:"retro",...key,metrics:values,source,observedAt:observedAt?new Date(observedAt).toISOString():new Date().toISOString()},"实绩已追加");};
  return <div className="cal-entry">
    <h3>{prediction.title} · v{version}</h3>
    <p>{prediction.level} · {prediction.score} 分 · 依据 v{prediction.reviewVersion} 会诊 · {dateLabel(prediction.lockedAt)} 锁定</p>
    <p>{prediction.bet}</p>
    <div className="cal-metrics">{metricKeys.map(k=><div key={k}><span>{keys[k]}</span><strong>{prediction.ranges[k].join("–")}</strong>{last&&<small>实绩 {last.metrics[k]}</small>}</div>)}</div>
    <Link href={"/studio/editor?"+new URLSearchParams({taskId:task,version:String(version)})}>打开正式版本</Link>
    {!publication?<form className="cal-actions" onSubmit={event=>{event.preventDefault();void perform({action:"publish",...key,publishedAt:new Date(recordedAt).toISOString()},"已登记发布并安排 T+3d");}}>
      <label>实际发布时间（本机时区）<input type="datetime-local" required step="1" value={recordedAt} onChange={e=>setRecordedAt(e.target.value)}/></label>
      <button disabled={busy}>登记已发布</button></form>:<>
      <p>{due?"已到期，可登记实绩":"等待 T+3d"} · {dateLabel(publication.dueAt)}（北京时间）{publication.demoWake&&" · 已模拟到期"}</p>
      {demo&&!due&&<button type="button" disabled={busy} onClick={()=>void perform({action:"wake",...key},"已模拟到期，通知进程将更新卡片")}>模拟 T+3d 到期</button>}
      {card&&<p>{card.card.title} · {card.result|| (card.delivery==="sent"?"已模拟投递":"等待投递")}</p>}
    </>}
    {due&&<form onSubmit={updated}><div className="cal-metrics">{metricKeys.map(k=><label key={k}>{keys[k]}<input type="number" min="0" step="1" required value={values[k]} onChange={e=>setValues({...values,[k]:Number(e.target.value)})}/></label>)}</div>
      <div className="cal-actions"><label>实绩来源<input required value={source} maxLength={500} onChange={e=>setSource(e.target.value)}/></label>
      {!demo&&<label>实际观测时间（本机时区）<input required type="datetime-local" step="1" value={observedAt} onChange={e=>setObservedAt(e.target.value)}/></label>}
      <button disabled={busy}>追加实绩</button></div></form>}
    {last&&<><p>{last.attribution} · 共 {retro.length} 次观测</p>
      <details><summary>查看初稿与正式版本的改动</summary><div className="cal-diff"><div><h4>初稿</h4><pre>{last.authorDiff.before||"无改动"}</pre></div><div><h4>定稿</h4><pre>{last.authorDiff.after||"无改动"}</pre></div></div></details>
      {last.beat&&prediction.score>=80&&<form onSubmit={event=>{event.preventDefault();void perform({action:"article-brick",...key,account:prediction.account,kind,text,tags:tags.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean)},"素材积木已保存");}}>
        <h4>萃取素材积木</h4><div className="cal-actions"><label>类型<select value={kind} onChange={e=>setKind(e.target.value as AtomicBrick["kind"])}>{brickKind.options.map(value=><option key={value}>{value}</option>)}</select></label>
          <label>标签<input value={tags} onChange={event=>setTags(event.target.value)} placeholder="用逗号分隔"/></label></div>
        <label>摘自本版的原句<textarea required maxLength={1500} value={text} onChange={event=>setText(event.target.value)}/></label><button disabled={busy}>保存素材积木</button>
      </form>}</>}
  </div>;
}

export function PredictionLink({task,version}:{task:string;version:number}){
  const [view,setView]=useState<{prediction:BlindPrediction|null;reason:string}|null>(null);
  const [opened,setOpened]=useState(false),[failure,setFailure]=useState("");
  useEffect(()=>{let active=true;if(opened)void request("?"+new URLSearchParams({task,version:String(version)})).then(result=>{if(active)setView(result);}).catch(e=>{if(active)setFailure(e.message);});return()=>{active=false;};},[task,version,opened]);
  async function seal(){
    try{const result=await request("",{action:"seal",task,version});setView(result);setFailure("");}
    catch(error){setFailure(error instanceof Error?error.message:"未能锁定");}
  }
  return <details onToggle={event=>setOpened(event.currentTarget.open)}><summary>盲预测与发布复盘</summary>
    {view?.prediction?<p>已锁定 v{version} · {view.prediction.level} · 流量 {view.prediction.ranges.reach.join("–")}</p>:view&&<><p>{view.reason}</p><button type="button" onClick={()=>void seal()}>尝试锁定当前版预测</button></>}
    {failure&&<p role="alert">{failure}</p>}<Link href={calibrationPath}>打开发布复盘</Link>
  </details>;
}
