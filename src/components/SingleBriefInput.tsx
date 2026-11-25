"use client";
import Link from "next/link";
import Image from "next/image";
import {useRef,useState} from "react";
import type {ProductionDraft,ProductionView} from "@/studio/production";
import type {SingleBrief} from "@/studio/single-brief";

export const emptyBrief:SingleBrief={note:"",adjust:{},materials:[],articleRefs:[],failed:[]};
type ArticleRef={id:string;title:string;version:number};
type Update=(fn:(draft:SingleBrief)=>SingleBrief)=>void;
const purpose={facts:"本次事实资料",style:"只参考写法",image:"只作配图"};

export function SingleBriefInput({draft,data,update,updateSources,loading,disabled,checking}:{draft:ProductionDraft;data:ProductionView;update:Update;updateSources:(sources:string[])=>void;loading:(value:boolean)=>void;disabled:boolean;checking:boolean}){
  const input=draft.brief??emptyBrief;
  const file=useRef<HTMLInputElement>(null),loadingFiles=useRef(false);
  const [drag,setDrag]=useState(false),[progress,setProgress]=useState(""),[notice,setNotice]=useState("");
  const [matches,setMatches]=useState<ArticleRef[]>([]),[query,setQuery]=useState("");
  const [menu,setMenu]=useState(false),[panel,setPanel]=useState<"references"|string|null>(null);
  const canAttach=!disabled;
  const account=data.accounts.find(a=>a.id===draft.account);
  async function upload(files:File[]){
    if(!canAttach||!files.length||loadingFiles.current)return;
    const capacity=12-input.materials.length-input.failed.length;
    if(capacity<1){setNotice("每篇最多 12 个文件，请先移除不用的材料。");return;}
    setNotice(files.length>capacity?"只接收了本篇剩余名额内的文件。":"");
    loadingFiles.current=true;loading(true);
    try{
      for(const original of files.slice(0,capacity)){
        const name=original.name.includes(".")?original.name:("截图-"+Date.now()+"."+({"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[original.type]||"bin"));
        setProgress("正在读取 "+name);
        try{
          const form=new FormData();form.set("file",original,name);form.set("source","作者提供 · "+name);form.set("draft",draft.id);form.set("account",draft.account);form.set("allowed","true");
          const response=await fetch("/api/production/assets",{method:"POST",body:form});const row=await response.json();
          if(!response.ok)throw Error(row.error||"读取失败");
          update(previous=>({...previous,failed:previous.failed.filter(f=>f.name!==row.name),materials:[...previous.materials,{id:row.id,name:row.name,mime:row.mime,purpose:row.mime.startsWith("image/")?"image":"facts",source:"作者提供 · "+row.name,note:""}]}));
        }catch(error){
          update(previous=>({...previous,failed:[...previous.failed.filter(f=>f.name!==name),{name:name.slice(0,180),error:(error instanceof Error?error.message:"读取失败").slice(0,400),required:true}]}));
        }
      }
    }finally{loadingFiles.current=false;loading(false);setProgress("");if(file.current)file.current.value="";}
  }
  async function findArticles(){
    setNotice("");
    try{
      const r=await fetch("/api/production/brief?"+new URLSearchParams({account:draft.account,q:query}));
      if(!r.ok)throw Error("暂时无法读取本账号稿件");
      const rows:ArticleRef[]=await r.json();setMatches(rows);if(!rows.length)setNotice("没有匹配的本账号稿件。");
    }catch(e){setNotice(String(e));}
  }
  function material(id:string,patch:Partial<SingleBrief["materials"][number]>){update(p=>({...p,materials:p.materials.map(a=>a.id===id?{...a,...patch}:a)}));}
  const selected=input.materials.find(item=>item.id===panel);
  const failed=input.failed.find(item=>"failed:"+item.name===panel);
  const dialogTitle=selected?.name||failed?.name||"引用稿件或资料";
  return <div className="single-brief" data-drag={drag} onDragOver={e=>{if(canAttach&&Array.from(e.dataTransfer.types).includes("Files")){e.preventDefault();setDrag(true);}}}
    onDragLeave={e=>{if(!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setDrag(false);}}
    onDrop={e=>{if(e.dataTransfer.files.length){e.preventDefault();setDrag(false);void upload(Array.from(e.dataTransfer.files));}}}>
    {!!(input.materials.length||input.failed.length||input.articleRefs.length||draft.sources.length)&&<div className="chat-attachments" aria-label="已添加的素材与参考">
      {input.materials.map(a=><div className="chat-attachment" key={a.id}>
        <button type="button" className="chat-attachment-name" title={a.name} onClick={()=>setPanel(a.id)}>
          {a.mime.startsWith("image/")?<Image alt="" src={"/api/production/assets?id="+a.id} width={28} height={28} unoptimized/>:<span aria-hidden="true">▤</span>}
          <span className="chat-file-label"><span>{a.name}</span><small>{a.purpose==="image"?"本机配图":a.mime.startsWith("image/")?(a.note.trim()?"已补文字":"待补文字"):"文本已读"}</small></span>
        </button>
        <button type="button" className="chat-remove" aria-label={"移除 "+a.name} onClick={()=>update(p=>({...p,materials:p.materials.filter(item=>item.id!==a.id)}))}>×</button>
      </div>)}
      {input.failed.map(a=><div className="chat-attachment" data-error key={a.name}>
        <button type="button" className="chat-attachment-name" onClick={()=>setPanel("failed:"+a.name)}>未读取 · {a.name}</button>
        <button type="button" className="chat-remove" aria-label={"移除 "+a.name} onClick={()=>update(p=>({...p,failed:p.failed.filter(item=>item.name!==a.name)}))}>×</button>
      </div>)}
      {input.articleRefs.map(a=><div className="chat-attachment" key={a.id+":"+a.version}><button className="chat-attachment-name" type="button" onClick={()=>setPanel("references")}>稿件参考</button><button type="button" className="chat-remove" aria-label="移除稿件参考" onClick={()=>update(p=>({...p,articleRefs:p.articleRefs.filter(item=>item.id!==a.id||item.version!==a.version)}))}>×</button></div>)}
      {draft.sources.map(pin=>{
        const reference=data.references.find(r=>r.id+"@"+r.version===pin);
        const title=reference?.title??"参考已失效";
        return <div className="chat-attachment" key={pin} data-error={reference?undefined:true}>
          <button type="button" className="chat-attachment-name" title={title} onClick={()=>setPanel("references")}>
            <span className="chat-file-label"><span>{title}</span><small>{reference?"只参考写法":"请移除或重新选择"}</small></span>
          </button>
          <button type="button" className="chat-remove" aria-label={"移除 "+title} onClick={()=>updateSources(draft.sources.filter(s=>s!==pin))}>×</button>
        </div>;
      })}
    </div>}
    <label className="article-sr-only" htmlFor="single-brief-note">这篇想怎么写？</label>
    <textarea id="single-brief-note" maxLength={12000} value={input.note} onChange={e=>{const note=e.target.value;update(p=>({...p,note}));}}
      onPaste={e=>{const files=Array.from(e.clipboardData.files);if(files.length&&canAttach){if(!e.clipboardData.getData("text/plain"))e.preventDefault();void upload(files);}}}
      placeholder="这篇想怎么写？"/>
    <div className="chat-composer-actions">
      <input ref={file} type="file" multiple accept=".txt,.md,.png,.jpg,.jpeg,.webp" hidden aria-label="选择创作材料" onChange={e=>void upload(Array.from(e.target.files??[]))}/>
      <div className="chat-add-menu" onKeyDown={e=>{if(e.key==="Escape")setMenu(false);}}>
        <button type="button" className="chat-plus" aria-label="添加附件或引用" aria-expanded={menu} disabled={disabled} onClick={()=>setMenu(value=>!value)}>＋</button>
        {menu&&<div className="chat-add-options">
          <button type="button" onClick={()=>{setMenu(false);file.current?.click();}}>上传文件</button>
          <button type="button" onClick={()=>{setMenu(false);setPanel("references");}}>引用稿件或资料</button>
        </div>}
      </div>
      <span role="status" className="chat-upload-status">{progress||(!panel?notice:"")}</span>
      <button type="submit" className="chat-send primary" disabled={disabled} aria-busy={checking} aria-label={checking?"正在检查":"发送"} title={checking?"正在检查":"发送"}>{checking?"…":"↑"}</button>
    </div>
    {panel&&<dialog className="chat-material-dialog" aria-labelledby="chat-material-title" onClose={()=>setPanel(null)}
      ref={node=>{if(node&&!node.open)node.showModal();}}>
      <header><h2 id="chat-material-title">{dialogTitle}</h2><button type="button" className="chat-close" onClick={()=>setPanel(null)} aria-label="关闭">×</button></header>
      {selected&&<>
        <p>{selected.purpose==="image"?"仅本机配图，未读取截图文字。":selected.mime.startsWith("image/")?"模型只使用你填写的文字。":"已读取文本。"}</p>
        <p><a href={"/api/production/assets?id="+selected.id} target="_blank" rel="noreferrer">打开原文件预览 ↗</a></p>
        <label>用途<select value={selected.purpose} onChange={e=>material(selected.id,{purpose:e.target.value as typeof selected.purpose})}>
          {Object.entries(purpose).filter(([key])=>key!=="image"||selected.mime.startsWith("image/")).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
        <label>出处<input maxLength={1000} value={selected.source} onChange={e=>material(selected.id,{source:e.target.value})}/></label>
        {selected.purpose!=="image"&&selected.mime.startsWith("image/")&&<label>粘贴截图里的相关文字<textarea maxLength={4000} value={selected.note} onChange={e=>material(selected.id,{note:e.target.value})}/></label>}
      </>}
      {failed&&<><p>{failed.error}</p><label><input type="checkbox" checked={failed.required} onChange={e=>{
        const required=e.target.checked;update(p=>({...p,failed:p.failed.map(a=>a.name===failed.name?{...a,required}:a)}));
      }}/>生成依赖此文件</label></>}
      {panel==="references"&&<>
        <p><Link href="/studio/settings#sources" target="_blank" rel="noreferrer">查看业务资料来源 ↗</Link></p>
        {account&&(account.audience||account.writingPreference)&&<p>账号默认 {account.audience} {account.writingPreference}。本次明确要求优先。</p>}
        {data.references.map(r=>{const pin=r.id+"@"+r.version;return <label key={r.id}><input type="checkbox" checked={draft.sources.includes(pin)} onChange={e=>updateSources(e.target.checked?[...draft.sources,pin]:draft.sources.filter(s=>s!==pin))}/>{r.title} · 写法参考</label>;})}
        {draft.sources.filter(s=>!data.references.some(r=>r.id+"@"+r.version===s)).map(pin=><p key={pin}>参考已失效 <button type="button" onClick={()=>updateSources(draft.sources.filter(s=>s!==pin))}>移除此参考</button></p>)}
        {draft.account?<><div className="single-material-controls"><label>搜索本账号已有稿件<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button type="button" onClick={()=>void findArticles()}>查找稿件</button></div>
          {matches.filter(r=>!input.articleRefs.some(a=>a.id===r.id&&a.version===r.version)).map(r=><button key={r.id} type="button" disabled={input.articleRefs.length>=5} onClick={()=>update(p=>({...p,articleRefs:[...p.articleRefs,{id:r.id,version:r.version,method:""}]}))}>引用《{r.title}》</button>)}
        </>:<p>选定账号后可引用该账号的稿件。</p>}
        {input.articleRefs.map(r=><div className="single-material" key={r.id+":"+r.version}><Link href={"/studio/editor?taskId="+r.id+"&version="+r.version} target="_blank">{matches.find(a=>a.id===r.id)?.title??"查看引用原稿"} · v{r.version}</Link>
          <label>借鉴哪种写法<input maxLength={600} placeholder="例如：先写一个动作，再给方法" value={r.method} onChange={e=>{const method=e.target.value;update(p=>({...p,articleRefs:p.articleRefs.map(a=>a.id===r.id&&a.version===r.version?{...a,method}:a)}));}}/></label></div>)}
        <p role="status">{notice}</p>
      </>}
      <button type="button" onClick={()=>setPanel(null)}>完成</button>
    </dialog>}
  </div>;
}
