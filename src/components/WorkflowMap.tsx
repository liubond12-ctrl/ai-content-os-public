"use client";
import {useEffect,useState} from "react";
import {editorHref} from "@/studio/article-navigation";
import Link from "next/link";
import type {Task} from "@/studio/tasks";
import type {Flow} from "@/studio/collaboration";
import type {ProductionView} from "@/studio/production";
import {conflictGroups} from "@/studio/discussion-reader";
import {Collaboration} from "./Collaboration";

type QueueItem=ProductionView["queue"][number];
export function WorkflowMap({tasks,workerOnline,source}:{tasks:QueueItem[];workerOnline:boolean;source?:string}){
  const [chosen,choose]=useState("");
  const selected=tasks.find(t=>t.id===chosen)??tasks.find(t=>["整理资料","生成","审核","修订"].includes(t.status));
  const id=selected?.id;
  const [snapshot,setSnapshot]=useState<{id:string;task:Task;flow:Flow|null}|null>(null);
  const [error,setError]=useState("");
  const [showTeam,setShowTeam]=useState(false);
  useEffect(()=>{
    if(!id)return;
    let active=true;
    const refresh=async()=>{
      try{
        const response=await fetch("/api/work-overview?task="+encodeURIComponent(id),{cache:"no-store"});
        if(!response.ok)throw Error("无法读取当前流程，稍后自动重试");
        const {task,flow}=await response.json();
        if(active){setSnapshot({id,task,flow});setError("");}
      }catch(e){if(active)setError(String(e));}
    };
    void refresh();const timer=setInterval(refresh,3000);
    return()=>{active=false;clearInterval(timer);};
  },[id]);
  if(!selected)return <section className="workflow"><h2>内容生产全流程</h2><p>当前没有正在执行的内容。等待生产开始后，这里会显示实际进展；历史内容可在全部任务中查看。</p><Link href="/production/create">新建第一篇内容 →</Link></section>;
  const current=snapshot?.id===id?snapshot:null;
  const task=current?.task,flow=current?.flow,panel=flow?.panels?.at(-1);
  const running=flow?.state==="running"&&workerOnline;
  const blocked=["受阻","失败","已停止"].includes(selected.status);
  const activeStage:Record<string,string>={"排队":"需求","整理资料":"资料研究","生成":"正文写作","审核":"团队审核","修订":"修订","待人工审核":"人工定稿","已定稿":"人工定稿"};
  const stages=[
    {name:"需求",icon:"✎",done:true,detail:"已提交 · "+(selected.production?.kind??"文章")},
    {name:"资料研究",icon:"◎",done:task?.research?.status==="ready",detail:task?.research?"研究记录已保存":"等待资料准备"},
    {name:"正文写作",icon:"▤",done:!!selected.version,detail:selected.version?"已产出文章 v"+selected.version:"等待初稿"},
    {name:"团队审核",icon:"◈",done:panel?.phase==="complete",detail:panel?panel.reviews.length+" 位已提交意见":flow?.reviewId?"已有审核记录":"尚无完成记录"},
    {name:"修订",icon:"↻",done:!!flow?.rounds,detail:flow?.rounds?"已有 "+flow.rounds+" 轮修订":"按审核结果决定"},
    {name:"人工定稿",icon:"✓",done:selected.confirmed,detail:selected.confirmed?"作者已确认":"由你确认最终版本"}
  ];
  return <section className="workflow" aria-label="内容生产全流程">
    <div className="workflow-heading"><div><p className="workflow-kicker">内容生产全流程</p><h2>{selected.topic}</h2></div>
      <label>查看内容<select value={selected.id} onChange={e=>{choose(e.target.value);setShowTeam(false);}}>{tasks.map(t=><option key={t.id} value={t.id}>{t.topic} · {t.status}</option>)}</select></label>
    </div>
    <div className="workflow-now"><span className={"flow-beacon "+(running?"is-running":"")}/><strong>{selected.status}</strong><span>{selected.confirmed?"已定稿，可查看和导出":selected.reason||"等待执行记录更新"}</span></div>
    {!workerOnline&&!selected.confirmed&&<p className="workflow-warning">执行服务离线，图中保留最后记录；恢复执行服务后才能继续生产。</p>}
    {error&&<p role="alert">{error}，当前保留上次记录。</p>}
    <ol className="flow-track">{stages.map((s,i)=><li key={s.name} className={(s.done?"flow-done":"flow-waiting")+(activeStage[selected.status]===s.name?" flow-current":"")}><span className="flow-node" aria-hidden="true">{s.icon}</span><strong>{s.name}</strong>{activeStage[selected.status]===s.name&&<b className="flow-current-label">{selected.confirmed?"已完成":workerOnline?"当前步骤":"停留于此"}</b>}<span>{current?s.detail:"读取记录…"}</span>{i<stages.length-1&&<span className="flow-connector" aria-hidden="true">→</span>}</li>)}</ol>
    <div className="flow-team"><div className="flow-team-label"><h3>审核团队</h3><p>{panel?"对应文章 v"+panel.articleVersion:"角色在实际审核开始后更新"}</p></div>
    {(["strategy","language","facts"] as const).map(role=>{
      const review=panel?.reviews.find(r=>r.role===role);
      const planned=panel?.roles.includes(role);
      return <div key={role} className={"flow-role "+(review?"has-result":"")}><span className="flow-avatar" aria-hidden="true">{{strategy:"策",language:"文",facts:"核"}[role]}</span><div><strong>{{strategy:"内容策略",language:"语言表达",facts:"事实核验"}[role]}</strong><p>{review?"已完成 · "+review.opinions.length+" 条意见":planned?"等待完成记录":role==="facts"?"按事实核验需要参与":"尚未启动"}</p></div></div>;
    })}</div>
    <div className="flow-outcomes"><div><span>分歧讨论</span><strong>{panel?conflictGroups(panel).length+" 个争议点 · "+panel.discussion.length+" 份回应":"尚无讨论记录"}</strong></div><div><span>Judge 裁决</span><strong>{panel?.verdict?panel.verdict.decisions.length+" 项决定已记录":"尚无裁决记录"}</strong></div><div><span>下一步</span><strong>{selected.confirmed?"查看定稿":blocked?"处理阻塞原因":selected.version?"查看正文和审核意见":"等待正文产出"}</strong></div></div>
    <div className="flow-actions"><button className="primary" aria-expanded={showTeam} onClick={()=>setShowTeam(!showTeam)}>{showTeam?"收起协作详情":"查看多 Agent 协作"}</button>{selected.version&&<Link href={editorHref(selected.id,source)}>打开正文 v{selected.version} →</Link>}</div>
    {showTeam&&<div className="flow-detail"><Collaboration key={selected.id} taskId={selected.id}/></div>}
  </section>;
}
