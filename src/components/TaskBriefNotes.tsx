"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {editorHref} from "@/studio/article-navigation";

type Record={brief:{note:string;goal:string;audience:string;materials:{id:string;name:string;source:string;purpose:string}[];references:string[];articles:{id:string;version:number;title:string}[]};suggestions:{key:string;label:string;state:string}[];notes:{body:string;created:string}[]};
export function TaskBriefNotes({taskId,onGenerateEnding,endingInserted=false}:{taskId:string;onGenerateEnding?:()=>Promise<void>;endingInserted?:boolean}){
  const [data,setData]=useState<Record|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[note,setNote]=useState("");
  const [generating,setGenerating]=useState(false);
  const noteId=useRef<string|undefined>(undefined),lock=useRef(false);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/production/brief?task="+taskId,{cache:"no-store",signal:controller.signal}).then(r=>{if(!r.ok)throw Error();return r.json();}).then(setData).catch(()=>{if(!controller.signal.aborted)setError("暂时无法读取本篇材料记录。");});
    return()=>controller.abort();
  },[taskId]);
  async function update(body:object){
    if(lock.current)return false;
    lock.current=true;setBusy(true);setError("");
    try{
      const response=await fetch("/api/production/brief",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({task:taskId,...body})});
      if(!response.ok)throw Error("补充保存失败，请重试。");
      const read=await fetch("/api/production/brief?task="+taskId,{cache:"no-store"});
      if(!read.ok)throw Error("补充已保存，请刷新查看。");
      setData(await read.json());return true;
    }catch(e){setError(String(e));return false;}finally{lock.current=false;setBusy(false);}
  }
  if(!data)return error?<p role="status">{error}</p>:null;
  const {brief,suggestions,notes}=data;
  return <section className="task-brief-notes" aria-label="本篇补充与资料">
    <h2>本篇补充</h2>
    {suggestions.filter(s=>s.state!=="skipped").map(s=><div className="task-brief-suggestion" key={s.key}>
      <span>{s.label}</span>{s.key==="ending"&&onGenerateEnding?<div className="actions">
        {endingInserted?<strong role="status">已插入正文</strong>:<button type="button" disabled={busy||generating} onClick={async()=>{
          setGenerating(true);setError("");
          try{await onGenerateEnding();}
          catch(e){setError(e instanceof Error?e.message:String(e));}finally{setGenerating(false);}
        }}>{generating?"正在生成…":"一键生成并插入"}</button>}
        {s.state==="pending"&&!endingInserted&&<button type="button" disabled={busy||generating} onClick={()=>void update({action:"suggestion",key:s.key,state:"skipped"})}>× 跳过</button>}
      </div>:s.state==="added"?<strong>已加入本篇修改清单</strong>:<div className="actions">
        <button type="button" disabled={busy} onClick={()=>void update({action:"suggestion",key:s.key,state:"added"})}>✓ 加上</button>
        <button type="button" disabled={busy} onClick={()=>void update({action:"suggestion",key:s.key,state:"skipped"})}>× 跳过</button>
      </div>}</div>)}
    {notes.map((n,i)=><p key={n.created+":"+i}>{n.body}</p>)}
    <details><summary>补一句或查看资料来源</summary>
      <label>给这篇加一条修改备注<input maxLength={600} value={note} onChange={e=>{noteId.current=undefined;setNote(e.target.value);}}/></label>
      <button type="button" disabled={busy||!note.trim()} onClick={async()=>{
        noteId.current??=crypto.randomUUID();if(await update({action:"note",id:noteId.current,note})){setNote("");noteId.current=undefined;}
      }}>保存本篇备注</button><p>补充保存到这篇的修改清单，正文保留当前版本。</p>
      {!!(brief.note||brief.goal||brief.audience)&&<div><h3>提交时的创作说明</h3>{brief.goal&&<p>目标 · {brief.goal}</p>}{brief.audience&&<p>受众 · {brief.audience}</p>}<p className="task-brief-text">{brief.note}</p></div>}
      {!!brief.materials.length&&<ul>{brief.materials.map(a=><li key={a.id}><a href={"/api/production/assets?id="+a.id} target="_blank" rel="noreferrer">{a.name}</a> · {a.source} · {a.purpose==="facts"?"作者提供，待核实":a.purpose==="style"?"仅参考写法":"本机配图"}</li>)}</ul>}
      {!!brief.references.length&&<p><Link href="/studio/cases">打开写作参考库</Link> · {brief.references.join("、")}</p>}
      {!!brief.articles?.length&&<ul>{brief.articles.map(a=><li key={a.id+":"+a.version}><Link href={editorHref(a.id,undefined,{version:String(a.version)})}>{a.title} · v{a.version}</Link> · 仅复用作者注明的写法</li>)}</ul>}
    </details>
    {error&&<p role="alert">{error}</p>}
  </section>;
}
