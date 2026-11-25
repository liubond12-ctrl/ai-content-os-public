"use client";
import type {Task} from "@/studio/tasks";
import {ExecutionTimeline} from "./ExecutionTimeline";
import {DiscussionReader} from "./DiscussionReader";
import Link from "next/link";
import {editorHref} from "@/studio/article-navigation";
import {useEffect,useState} from "react";
import type {ArticleSnapshot} from "../studio/article-store";
import type {Opinion} from "../studio/professional-review";
import type {Flow} from "../studio/collaboration";
import type {reviewLocationHelp} from "../studio/review-location-help";
import {taskGuidance} from "../studio/task-guidance";
const labels:Record<string,string>={paused:"已暂停",ready:"等待下一步",running:"正在执行",human:"待人工处理",failed:"执行失败",unknown:"请求结果未知",stopped:"已停止",awaiting_acceptance:"待人工验收"};
export function Collaboration({taskId,versions=[],onLocate,progress,authorView,returnTo}:{taskId:string;versions?:ArticleSnapshot[];onLocate?:(version:number,issue:Pick<Opinion["issue"],"field"|"quote"|"offset">)=>void;progress?:{task:Task;status:string};authorView?:{status:string;bodyHref:string};returnTo?:string}){
 const [loaded,setLoaded]=useState(false),[readError,setReadError]=useState("");
 const [expressionRules,setExpressionRules]=useState(false);
 const [data,setData]=useState<{flow:Flow|null;locationHelp?:ReturnType<typeof reviewLocationHelp>;usage:{requests:number;totalTokens:number|string;knownEstimatedCny:number;knownEstimatedUsd:number;usdPricedCalls:number;unpricedCalls:number;knownTotalTokens:number;unknownUsageCalls:number}|null}>({flow:null,usage:null}),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 useEffect(()=>{let alive=true;const refresh=()=>fetch("/api/collaboration?taskId="+taskId,{cache:"no-store"}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(d=>{if(alive){setData(d);setLoaded(true);setReadError("");}}).catch(()=>{if(alive){setReadError("协作记录暂时无法读取，正在重试。");}});void refresh();const timer=setInterval(refresh,2000);return ()=>{alive=false;clearInterval(timer);};},[taskId]);
 async function act(action:string){setBusy(true);setError("");try{const r=await fetch("/api/collaboration",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({taskId,action,revision:data.flow?.revision,expressionRules})});const d=await r.json();if(!r.ok)throw Error(d.error);setData(d);}catch(e){setError(String(e));}finally{setBusy(false);}}
 const f=data.flow;
 const hint=taskGuidance(f?.reason??"",!!f?.articleVersion),help=data.locationHelp;
 const latest=versions.reduce<ArticleSnapshot|undefined>((a,b)=>!a||b.version>a.version?b:a,undefined);
 const historical=!!latest&&(latest.confirmed||latest.version!==(f?.articleVersion??latest.version));
 const running=progress&&["排队","整理资料","生成","审核","修订"].includes(progress.status);
 return <section className="collaboration" aria-label="协作流程">{running?<ExecutionTimeline {...progress} flow={f}/>:!authorView?<h2>协作审核</h2>:null}{f&&!running&&<DiscussionReader key={taskId} flow={f} taskId={taskId} versions={versions} onLocate={onLocate} showRecentDispute={!!progress||!!authorView} authorView={authorView} returnTo={returnTo}/>}
 {authorView&&(!f||readError)&&<Link className="author-primary" href={authorView.bodyHref}>打开正文</Link>}
 {readError&&<p role="alert">{readError}</p>}{!loaded?<p>正在读取审核记录…</p>:!f&&!progress?<details><summary>暂无协作记录 · 配置审核</summary><label><input type="checkbox" checked={expressionRules} onChange={e=>setExpressionRules(e.target.checked)}/>可选表达检查（local-expression-v1，账号规则优先）</label><p>模型与额度由任务快照及服务端授权决定。真实云端仅用于已授权的原创隔离样本；最多两轮修订，未知回执不自动重发。</p><button disabled={busy} onClick={()=>act("start")}>启动协作流程</button></details>:f&&!authorView?<><details><summary>流程状态与执行控制</summary><p role="status">{historical?"历史流程 · ":""}{labels[f.state]??f.state} · {({prepare:"研究与写作",eval:"审核",revision:"修订"} as Record<string,string>)[f.step]??f.step} · 已修订 {f.rounds}/2 轮</p>{hint?<details><summary>查看技术原因</summary><p>{f.reason}</p></details>:<p>{f.reason}</p>}{f.state==="unknown"&&<p>请核对最后一次调用回执与服务端账单。确认前保留现场，不重新发送。</p>}{f.state==="paused"&&<p>检查已完成的步骤与当前版本后，可继续尚未执行的步骤。</p>}<details><summary>调用额度与费用记录</summary><p>调用 {data.usage?.requests??0} 次 · 回执已知 {data.usage?.knownTotalTokens??0} Tokens · {data.usage?.unknownUsageCalls??0} 次用量未知 · 请求余量 {Math.max(0,(f.budget?.requests??(f.professional?32:6))-(data.usage?.requests??0))} · Token 余量 {typeof data.usage?.totalTokens==="number"?Math.max(0,(f.budget?.tokens??(f.professional?120000:20000))-data.usage.totalTokens):"待核实"} · 已知估算 {data.usage?.usdPricedCalls?data.usage.knownEstimatedUsd.toFixed(6)+" USD":"¥"+(data.usage?.knownEstimatedCny??0)}（{data.usage?.unpricedCalls??0} 次未计价，实扣未知） · 已记录耗时 {Math.round(f.executions.reduce((n,e)=>n+(e.ended?Date.parse(e.ended)-Date.parse(e.started):0),0)/1000)} 秒</p></details>
 {hint&&<section aria-label="处理指引"><h3>{historical?"历史审核记录：":""}{hint.title}</h3>{historical&&<p>当前文章 v{latest!.version}{latest!.confirmed?"已由作者定稿":"已有更新"}。以下是旧审核现场，不代表当前版本受阻或审核通过。</p>}<p>{hint.detail}</p>{!historical&&<p>{hint.next}</p>}
 {help&&<><blockquote>{help.quote}</blockquote><p>以下 {help.candidates.length} 处均来自审核时的文章 v{help.articleVersion}。点击只定位，不会替换原文或重新调用模型。</p>{help.candidates.map((c,i)=><div key={c.offset}><p style={{whiteSpace:"pre-wrap"}}>{c.context}</p>{onLocate?<button onClick={()=>onLocate(help.articleVersion,{field:help.field,quote:help.quote,offset:c.offset})}>查看第 {i+1} 处原句</button>:<Link href={editorHref(taskId,returnTo)}>打开编辑器核对位置</Link>}</div>)}</>}
 </section>}
 {f.queueManaged?<p>由后台持久化队列推进；停止和重试请回到中控。<Link href="/">打开中控</Link></p>:<>{f.state==="ready"&&<button disabled={busy} onClick={()=>act("tick")}>继续下一步</button>}{(f.state==="failed"||(f.state==="human"&&f.step==="prepare"))&&<button disabled={busy} onClick={()=>act("resume")}>重试未完成步骤</button>}
 {["ready","running"].includes(f.state)&&<button disabled={f.pauseRequested} onClick={()=>act("pause")}>{f.pauseRequested?"将在本步结束后暂停":"暂停后续步骤"}</button>}{f.state==="paused"&&<button onClick={()=>act("resume")}>继续已暂停的任务</button>}
 {!["stopped","awaiting_acceptance"].includes(f.state)&&<button onClick={()=>act("stop")}>停止协作</button>}</>}
 <p>停止后在途请求仍可能返回，结果只保留供人工处理。执行超过预期或服务重启后仍显示执行中时，请停止并核实记录，不重复发送。</p>
 <a href={editorHref(taskId,returnTo)}>查看文章版本、对应审核与修订差异</a></details>
 <details><summary>执行记录与用量</summary><pre style={{whiteSpace:"pre-wrap"}}>{JSON.stringify({executions:f.executions,usage:data.usage},null,2)}</pre></details></>:null}{error&&<p role="alert">{error}</p>}</section>;
}





