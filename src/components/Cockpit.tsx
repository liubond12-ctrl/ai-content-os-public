"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { WorkOverview, WorkTask } from "@/studio/work-overview";
import {draftHref,editorHref,reviewHref} from "@/studio/article-navigation";
import {RestoreArticlePosition} from "./RestoreArticlePosition";
import { taskGuidance } from "@/studio/task-guidance";
import { WorkflowMap } from "./WorkflowMap";
import { Icon } from "./WorkspaceIcon";
import CockpitOcean from "./CockpitOcean";
import "./cockpit.css";

function taskHref(task:WorkTask,source?:string){
  return task.version?editorHref(task.id,source):reviewHref(task.id,source);
}
export function TaskLink({task,source}:{task:WorkTask;source?:string}) {
  return <Link href={taskHref(task,source)}>{task.version ? "查看正文与审核" : "查看任务进度"} →</Link>;
}
function PriorityCard({ task }: { task: WorkTask }) {
  const guidance = taskGuidance(task.reason, !!task.version);
  const next = guidance?.next ?? (task.status === "待人工审核" ? "核对正文和审核建议，然后确认定稿。" :
    /关键事实.*待核验/.test(task.reason) ? "定位审核标出的原句，补充可核实的来源或改写后再定稿。" :
    task.status === "已停止" ? "执行已停止，请核对已有内容后决定下一步。" : "执行遇到问题，请核对原因与已保存的结果。");
  const returnTo="/#todo-"+task.id;
  const href=task.status==="待人工审核"&&task.version?reviewHref(task.id,returnTo):taskHref(task,returnTo);
  return <Link id={"todo-"+task.id} href={href} className="ck-card">
    <span className="ck-icon"><Icon type="doc" /></span>
    <div className="ck-copy"><span className="ck-status">{task.status}</span>
      <h3>{task.title||task.topic}</h3><p>{next}</p>
      <span className="ck-meta">{task.production?.accountName || "自由创作"} · {new Date(task.updated).toLocaleString("zh-CN")}</span>
    </div><span className="ck-secondary">{task.status==="待人工审核"?"审阅并定稿":task.version?"查看正文并处理":task.status==="受阻"?"查看受阻原因":"查看任务进度"} →</span>
  </Link>;
}

import {DailyDesk} from "./ReadinessWorkspace";

export default function Cockpit({ initial }: { initial: WorkOverview }) {
  const [data,setData] = useState(initial);
  const [error,setError] = useState("");
  const [paused,setPaused] = useState(false);
  const [visible,setVisible] = useState(false);
  const [strength,setStrength] = useState(.4);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const timer = setInterval(async () => {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch("/api/work-overview",{ signal:controller.signal, cache:"no-store" });
        if (!response.ok) throw Error("读取失败");
        const next = await response.json();
        if (!controller.signal.aborted) { setData(next); setError(""); }
      } catch {
        if (!controller.signal.aborted) setError("暂时无法更新，正在显示上次读取的记录。");
      } finally { pending = false; }
    },10000);
    return () => { controller.abort(); clearInterval(timer); };
  },[]);
  return <main className="cockpit-home">
    <CockpitOcean visible={visible} paused={paused} strength={strength} />
    <header className="ck-header"><h1>今日待办</h1>
      <div className="ck-header-actions"><div className="ck-shortcuts"><Link className="ck-hot" href="/hot"><Icon type="hot"/>今日热点</Link><Link className="ck-primary" href="/production/create">＋ 新建稿件</Link></div>
        <details className="ck-settings"><summary>显示设置</summary><div>
      <label><input type="checkbox" checked={visible} onChange={e=>setVisible(e.target.checked)} /> 显示背景海洋</label>
      <label><input type="checkbox" checked={paused} onChange={e=>setPaused(e.target.checked)} /> 静态阅读模式</label>
      <label>背景强度<input type="range" min=".25" max="1" step=".05" value={strength} onChange={e=>setStrength(Number(e.target.value))} /></label>
    </div></details>
      </div>
    </header>
    <DailyDesk/>
    {error && <p role="status">{error}</p>}
    {data.todos.length>0&&<section className="ck-work ck-todos" id="home-todos" tabIndex={-1}><RestoreArticlePosition prefix="todo-" fallback="home-todos"/><div className="ck-section-head"><h2>待我处理 {data.todoCount>0&&<small>{data.todoCount}</small>}</h2>
      {data.todoCount>data.todos.length && <Link href="/production/tasks?status=todo">查看全部 →</Link>}</div>
      {data.todos.map(task=><PriorityCard key={task.id} task={task}/>)}
    </section>}
    {data.recent.length>0&&<section className="ck-work ck-recent" aria-label="最近编辑" id="home-recent" tabIndex={-1}><RestoreArticlePosition prefix="recent-" fallback="home-recent"/>
      <div className="ck-section-head"><h2>最近编辑</h2></div>
      {data.recent.map(item=><Link className="ck-recent-item" id={"recent-"+item.id} key={item.id} href={item.isDraft?draftHref(item.id,item.kind,"/#recent-"+item.id):editorHref(item.id,"/#recent-"+item.id)}>
        <span className="ck-icon"><Icon type="doc"/></span><div className="ck-copy"><h3>{item.title}</h3><span className="ck-meta">{item.isDraft?"需求草稿":item.kind} · {item.updated&&new Date(item.updated).toLocaleString("zh-CN")}</span></div><span className="ck-secondary">继续编辑 →</span>
      </Link>)}
    </section>}
    {data.groups.length>0&&<section className="ck-batch"><div className="ck-section-head"><h2>活跃生产批次</h2>
      {data.activeCount>data.groups.reduce((sum,g)=>sum+g.count,0) && <Link href="/production/tasks?status=active">查看全部 →</Link>}</div>
      {data.groups.map(g=>{
        const queued = g.count-g.running;
        const description = g.running+" 篇执行中 · "+queued+" 篇等待执行";
        return <div className="ck-row" key={g.batch}><span className="ck-dot" aria-hidden="true" />
          <div><h3>{g.name}</h3><p>{g.count} 篇待完成 · {description}</p></div>
          <span className="ck-progress" role="img" aria-label={description} title={description}>
            {g.running>0 && <i style={{flexGrow:g.running}}/>}{queued>0 && <i className="queued" style={{flexGrow:queued}}/>}
          </span><Link href={"/production/tasks?batch="+encodeURIComponent(g.batch)}>查看进度 →</Link>
        </div>;
      })}
    </section>}
    <details className="ck-flow" id="home-flow" tabIndex={-1}><summary>查看稿件进度</summary>
      <RestoreArticlePosition prefix="home-flow" fallback="home-flow"/><WorkflowMap tasks={data.active} workerOnline={data.workerOnline} source="/#home-flow"/>
    </details>

  </main>;
}
