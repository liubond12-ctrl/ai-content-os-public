"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {experimentPreview,experimentUsage} from "@/studio/deepseek-experiment";
type Preview=ReturnType<typeof experimentPreview>&{usage:ReturnType<typeof experimentUsage>|null};
const labels:Record<string,string>={approved:"已授权，未启动",ready:"等待继续",running:"正在请求模型",done:"已完成，待人工评价",human:"需要人工处理",failed:"失败，已停止",unknown:"用量未知，禁止重试",stopped:"已停止"};
const roles:Record<string,string>={strategy:"内容策略",language:"语言表达",writing:"定向修订","discussion:strategy":"策略审核回应","discussion:language":"语言审核回应",judge:"分歧裁决"};
export default function ExperimentPage(){
 const [data,setData]=useState<Preview|null>(null),[confirmation,setConfirmation]=useState(""),[checked,setChecked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function load(){const r=await fetch("/api/deepseek-experiment",{cache:"no-store"});const p=await r.json();if(!r.ok)throw Error(p.error);setData(p);return p as Preview;}
 useEffect(()=>{const controller=new AbortController();fetch("/api/deepseek-experiment",{cache:"no-store",signal:controller.signal}).then(async r=>{const p=await r.json();if(!r.ok)throw Error(p.error);setData(p);}).catch(e=>{if(!controller.signal.aborted)setError(String(e));});return ()=>controller.abort();},[]);
 async function post(body:unknown){const r=await fetch("/api/deepseek-experiment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const p=await r.json();if(!r.ok)throw Error(p.error);setData(p);return p as Preview;}
 async function act(action:"approve"|"start"|"continue"|"stop"){
  setError("");if(action!=="stop")setBusy(true);
  try{let p=data!;if(action==="approve"){await post({action,hash:p.hash,confirmation});return;}
   if(action==="stop"){await post({action});return;}
   if(action==="start")p=await post({action});else p=await load();
   // Refreshing the page never starts network execution.
   while(p.experiment?.state==="ready")p=await post({action:"tick",revision:p.experiment.revision});
  }catch(e){setError(String(e));await load().catch(()=>{});}finally{if(action!=="stop")setBusy(false);}
 }
 if(!data)return <main><h1>真实协作实验预检</h1><p role="alert">{error||"正在读取本机预检，没有模型调用…"}</p></main>;
 const m=data.manifest,e=data.experiment;
 const box={padding:24,border:"1px solid var(--line)",borderRadius:12,background:"white",marginBottom:20};
 const pre={whiteSpace:"pre-wrap" as const,overflowWrap:"anywhere" as const,lineHeight:1.8};
 return <main>
  <Link href="/quality">← 返回质量检查</Link><h1>《灯还亮着》真实协作实验</h1>
  <p>先检查资料 → 单独授权 → 手动启动一次。浏览本页不会调用模型。</p>
  <section style={box}><h2>{e?labels[e.state]:"未授权 · 未执行"}</h2><p>{e?.reason||"本次仅使用原创虚构短文，不读取历史业务文章。"}</p>
   {e&&<p>最近记录阶段：{roles[e.calls.at(-1)?.role??""]??e.calls.at(-1)?.role??"尚无请求"}。回执确认 {data.usage?.knownActualTokens} Tokens，{data.usage?.unknownCalls} 次用量未知。已知回执估算 ¥{data.usage?.knownReceiptEstimatedCny.toFixed(6)}，实扣以供应商账单为准。</p>}
   {e&&["unknown","failed","stopped"].includes(e.state)&&<p>先核对末次回执和已有版本。结果未知时保留现场，不重新发送请求。</p>}
   <p>最多 12 次请求 · 保守预算 60,000 Tokens · 每次输出 800 · 最多一次修订</p>
   <p>模型：{m.model}（关闭思考）<br/>API：{m.endpoint}</p>
   <p>固定高峰费率下理论费用上界约 ¥{m.projectedMaximumCny}；应用内费用额度 ¥1。</p>
   <p>{m.feeNote}</p><p>价格核实日：{m.price.verifiedAt}；有效至 {m.price.expiresAt}。<a href={m.price.source} target="_blank" rel="noreferrer">官方价格</a></p>
   <p>密钥：{data.keyConfigured?"服务端已配置，不展示内容":"尚未配置"}；价格快照：{data.priceValid?"有效":"已过期，禁止启动"}</p>
  </section>
  <section style={box}><h2>将发送的文章全文</h2><h3>{m.article.title}</h3><div style={pre}>{m.article.body}</div><h3>写作需求与规则</h3><p>{m.request.audience}；{m.request.goal}</p><p>{m.accountRules}</p><p>可选表达规则关闭；不调用 Research、不生成初稿、不追加事实 Agent。</p><p>{m.dynamicScope}</p>
   <h3>唯一参考来源</h3><p>{m.sources[0].id}：就是上方文章标题与全文，标记为虚构，不能作为现实事实依据。没有外部资料、历史文章或账号知识库。</p>
  </section>
  <section style={box}><h2>各角色实际提示词与数据</h2><p>以下为实际发送的完整系统提示词。首轮两位审核者独立读取同一篇文章，不看彼此意见。动态讨论和复审内容尚未产生，只允许本实验的派生数据。</p>
   {Object.entries(m.prompts).map(([key,value])=><details key={key} style={{marginBottom:16}}><summary>{({strategy:"内容策略审核",language:"语言表达审核",discussionStrategy:"策略审核讨论",discussionLanguage:"语言审核讨论",judge:"Judge 裁决",writing:"Writing 定向修订",reReview:"专业复审"} as Record<string,string>)[key]}</summary><pre style={pre}>{value}</pre></details>)}
   <details><summary>首轮实际外发数据（完整 JSON）</summary><pre style={pre}>{JSON.stringify(m.initialPayload,null,2)}</pre></details>
   <details><summary>后续外发字段白名单与授权清单</summary><pre style={pre}>{JSON.stringify(m,null,2)}</pre></details>
   <p style={{overflowWrap:"anywhere"}}>本次预览指纹：{data.hash}</p>
  </section>
  <section style={box}><h2>人工授权与启动</h2><p role="alert">{error}</p>
   {!e?<><label style={{display:"block"}}><input type="checkbox" checked={checked} onChange={v=>setChecked(v.target.checked)}/> 我已检查文章、规则、所有角色提示词、派生数据范围及费用限制，理解没有供应商账单硬限额。</label><p>请手动输入：{data.confirmation}</p><input aria-label="授权确认文字" style={{width:"100%",padding:12}} value={confirmation} onChange={v=>setConfirmation(v.target.value)}/><button disabled={busy||!checked||confirmation!==data.confirmation||!data.priceValid} onClick={()=>act("approve")}>确认授权（尚不调用模型）</button></>:<>
    {e.state==="approved"&&<button disabled={busy||!data.keyConfigured||!data.priceValid} onClick={()=>act("start")}>启动唯一一次真实实验（将产生费用）</button>}
    {e.state==="ready"&&!busy&&<button onClick={()=>act("continue")}>继续本次实验的未执行步骤</button>}
    {["approved","ready","running"].includes(e.state)&&<button onClick={()=>act("stop")}>停止本次实验</button>}
    <button disabled={busy} onClick={()=>load().catch(e=>setError(String(e)))}>刷新执行记录</button>
   </>}
   {busy&&<p aria-live="polite">正在执行本次实验。可以停止后续调度；已发出的请求仍可能计费。</p>}
  </section>
  {e&&<section style={box}><h2>实验结果与费用记录</h2><p>隔离任务：{e.id}；授权时间：{e.approvedAt}</p><p>请求 {data.usage?.requests} 次；实际已知 {data.usage?.knownActualTokens} Tokens；未知回执 {data.usage?.unknownCalls} 次。</p><p>保守预留及消耗 ¥{data.usage?.conservativeCny.toFixed(6)}；已知用量按高峰费率估算 ¥{data.usage?.knownReceiptEstimatedCny.toFixed(6)}（不是供应商实扣账单）。</p>
   {e.panels.map(p=><div key={p.id}><h3>第 {p.articleVersion} 版审核</h3><p>实质冲突：{p.conflicts.length?p.conflicts.length+" 组":p.phase==="independent"?"审核尚未结束":"未发现"}；{p.reason}</p>{p.reviews.map(r=><details key={r.role}><summary>{roles[r.role]}：{r.result.label}</summary><pre style={pre}>{JSON.stringify(r,null,2)}</pre></details>)}<details><summary>讨论与 Judge 裁决{!p.discussion.length?"（未触发）":""}</summary><pre style={pre}>{JSON.stringify({discussion:p.discussion,verdict:p.verdict},null,2)}</pre></details></div>)}
   <h3>文章版本与修改差异</h3>{e.articles.map((a,i)=><details key={a.version} open><summary>第 {a.version} 版{i?"（父版本 "+e.articles[i-1].version+"）":"（原文）"}</summary><h4>{a.title}</h4><p style={pre}>{a.body}</p></details>)}
   {e.articles.length>1&&<div><h4>已执行的片段修改</h4>{e.panels[0].selected.filter(o=>o.action!=="retain").map(o=><p key={o.id}><del>{o.issue.quote}</del> → <ins>{o.action==="delete"?"（删除）":o.replacement}</ins></p>)}</div>}
   <details><summary>逐次请求、实际消息与响应记录</summary><pre style={pre}>{JSON.stringify(e.calls,null,2)}</pre></details>
  </section>}
 </main>;
}
