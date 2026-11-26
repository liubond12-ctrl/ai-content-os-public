"use client";
import type {ReviewAttention,SavedPassage} from "@/types/creator-workspace";
import {TaskBriefNotes} from "./TaskBriefNotes";
import Link from "next/link";
import {editorHref,reviewHref} from "@/studio/article-navigation";
import {ArticleReuse} from "./ContentReuse";
import {useEffect,useRef,useState} from "react";
import {Plate,PlateContent,PlateElement,PlateLeaf,ParagraphPlugin,createPlatePlugin,usePlateEditor,type PlateElementProps,type PlateLeafProps} from "platejs/react";
import {H1Plugin,H2Plugin,BoldPlugin} from "@platejs/basic-nodes/react";
import {validateBody,renderSections} from "../studio/production-schema";
import {bodySection,fromText,stabilizeBlocks,mapReviewAnchor,plainText,quoteRange,textDiff,type ArticleDocument} from "../studio/article-document";
import type {ArticleState} from "../studio/article-store";
import type {Review} from "@/studio/eval";
import {endingEditId,type LocalArticleEdit,type ReviewAnchor} from "@/types/multi-agent-review";
import {ArticleReview} from "./ArticleReview";
import {ChannelDistribution} from "./ChannelDistribution";
import {PredictionLink} from "./CalibrationWorkspace";
import {Storyboard} from "./Storyboard";
import {TaskAssembly} from "./MatrixWorkspace";
import "./article-editor.css";


function Paragraph(props:PlateElementProps){return <PlateElement {...props} as="p"/>;}
function Heading1(props:PlateElementProps){return <PlateElement {...props} as="h1"/>;}
function Heading2(props:PlateElementProps){return <PlateElement {...props} as="h2"/>;}
function Quote(props:PlateElementProps){return <PlateElement {...props} as="blockquote"/>;}
function ListItem(props:PlateElementProps){return <PlateElement {...props} as="div" className="article-list-item"/>;}
function Bold(props:PlateLeafProps){return <PlateLeaf {...props} as="strong"/>;}
const plugins=[ParagraphPlugin.withComponent(Paragraph),H1Plugin.withComponent(Heading1),H2Plugin.withComponent(Heading2),
  // Plate 53's built-in blockquote wraps nested blocks. v1 deliberately uses
  // flat single-paragraph quotes to preserve the deterministic text contract.
  createPlatePlugin({key:"blockquote",node:{isElement:true,component:Quote}}),BoldPlugin.withComponent(Bold),createPlatePlugin({key:"li",node:{isElement:true,component:ListItem}})];
function clean(value:unknown):ArticleDocument{
  // Plate assigns node ids; these are UI identities, not part of stored v1.
  return (value as ArticleDocument).map(b=>({type:b.type,...(b.blockId?{blockId:b.blockId}:{}),...(b.sectionId?{sectionId:b.sectionId}:{}),
    children:b.children.map(l=>({text:l.text,...(l.bold?{bold:true}:{})}))}));
}
async function request(body:object){
  const r=await fetch("/api/articles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(!r.ok)throw Error(data.error??"保存失败");return data as ArticleState;
}
export function ArticleWorkspace({taskId,destination}:{taskId:string;destination:{href:string;label:string;source?:string}}){
  const [state,setState]=useState<ArticleState|null>(null),[error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/articles?taskId="+encodeURIComponent(taskId),{cache:"no-store",signal:controller.signal})
      .then(async r=>{const data=await r.json();if(!r.ok)throw Error(data.error);setState(data);})
      .catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));});return ()=>controller.abort();
  },[taskId]);
  return <main className="article-workspace">
    <a className="author-back" href={destination.href}>← {destination.label}</a>
    {state?<EditingSession key={taskId} initial={state} taskId={taskId} returnTo={destination.source}/>:error?<><p role="alert">{error}</p>{taskId==="229ff801-fc09-4c98-b39f-f617368445f9"&&<Link href="/examples?case=conflict">查看隔离分歧回放</Link>}</>:<p role="status">正在读取文章…</p>}
  </main>;
}
type FactAnchor={field:"title"|"body";offset:number;quote:string};
function centerReviewRect(rect:DOMRect){
  window.scrollTo({top:window.scrollY+rect.top+rect.height/2-window.innerHeight/2,
    behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"instant":"smooth"});
}
function EditingSession({initial,taskId,returnTo}:{initial:ArticleState;taskId:string;returnTo?:string}){
  const [state,setState]=useState(initial),[title,setTitle]=useState(initial.draft?.title??initial.head.title);
  const [document,setDocument]=useState(initial.draft?.document??initial.head.document);
  const [status,setStatus]=useState("已保存"),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [selected,setSelected]=useState(()=>{const v=Number(new URLSearchParams(location.search).get("version"));return initial.versions.some(a=>a.version===v)?v:initial.head.version;}),[compare,setCompare]=useState(initial.versions.at(-1)!.version);
  const [kind,setKind]=useState("case");
  const [auditOpen,setAuditOpen]=useState(()=>new URLSearchParams(location.search).has("review"));
  const auditJump=useRef(false);
  const [attention,setAttention]=useState<{version:number;kind:ReviewAttention}>();
  const [savedPassage,setSavedPassage]=useState<SavedPassage>();
  const prompted=useRef(new Set<number>());
  const reviewPanel=useRef<HTMLElement>(null);
  useEffect(()=>{
    const panel=reviewPanel.current;
    if(!auditOpen||!panel)return;
    const desktop=matchMedia("(min-width:1280px)");
    let frame=0,lastTop=-1;
    function size(){
      if(frame)return;
      frame=requestAnimationFrame(()=>{
        frame=0;
        if(!desktop.matches||!panel)return;
        const top=Math.max(0,Math.ceil(panel.getBoundingClientRect().top));
        if(top!==lastTop){lastTop=top;panel.style.setProperty("--review-viewport-top",top+"px");}
      });
    }
    size();
    window.addEventListener("scroll",size,{passive:true});
    window.addEventListener("resize",size);
    return()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll",size);
      window.removeEventListener("resize",size);
    };
  },[auditOpen]);
  const [locating,setLocating]=useState<{field:"title"|"body";quote:string;offset:number}|null>(()=>{
    const p=new URLSearchParams(location.search),field=p.get("field"),at=Number(p.get("at")),length=Number(p.get("length"));
    const source=initial.versions.find(v=>v.version===Number(p.get("version")));
    if(!source||(field!=="title"&&field!=="body")||!p.has("at")||!Number.isSafeInteger(at)||at<0||!Number.isSafeInteger(length)||length<=0||at+length>source[field].length)return null;
    return {field,offset:at,quote:source[field].slice(at,at+length)};
  }),[notice,setNotice]=useState("");
  useEffect(()=>{
    if(!locating||selected===state.head.version)return;
    const frame=requestAnimationFrame(()=>{
      const mark=window.document.querySelector(".history-anchor");
      if(mark)centerReviewRect(mark.getBoundingClientRect());
    });
    return()=>cancelAnimationFrame(frame);
  },[locating,selected,state.head.version]);
  const titleRef=useRef<HTMLTextAreaElement>(null),stateRef=useRef(initial),flight=useRef(false),stopped=useRef(false);
  const current=useRef({title,document});
  useEffect(()=>{current.current={title,document};},[title,document]);
  const saved=useRef(JSON.stringify({title,document}));
  const [savedSerial,setSavedSerial]=useState(JSON.stringify({title,document}));
  const [editorKey,setEditorKey]=useState(0);
  const serial=JSON.stringify({title,document}),unsaved=serial!==savedSerial;
  const version=state.versions.find(v=>v.version===selected)??state.head;
  const stale=selected===state.head.version&&(title!==version.title||JSON.stringify(document)!==JSON.stringify(version.document));
  const [reviews,setReviews]=useState<{version:number;checks:FactAnchor[]}|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/reviews?"+new URLSearchParams({taskId,articleVersion:String(version.version)}),{signal:controller.signal,cache:"no-store"})
      .then(async response=>{
        if(!response.ok)return;
        const rows:Review[]=await response.json();
        const checks=rows.find(row=>row.result)?.result?.facts.checks??[];
        const unmatched=checks.filter(check=>check.status!=="来源原文匹配"&&version[check.field].slice(check.offset,check.offset+check.quote.length)===check.quote);
        if(!controller.signal.aborted)setReviews({version:version.version,checks:[...new Map(unmatched.map(check=>[check.field+":"+check.offset,check])).values()]});
      }).catch(()=>{});
    return()=>controller.abort();
  },[taskId,version]);
  const facts=reviews?.version===version.version&&!version.confirmed?reviews.checks:[];
  const visibleFacts=facts.filter(check=>{
    const text=check.field==="title"?title:plainText(document);
    return selected!==state.head.version||text.slice(check.offset,check.offset+check.quote.length)===check.quote;
  });
  function install(next:ArticleState){stateRef.current=next;setState(next);}
  async function saveDraft(){
    if(flight.current)return;
    const snapshot=current.current,key=JSON.stringify(snapshot);if(key===saved.current)return;
    flight.current=true;setStatus("保存中…");setError("");
    try{
      const s=stateRef.current;
      const next=await request({action:"draft",taskId,revision:s.draft?.revision??0,baseVersion:s.head.version,...snapshot});
      install(next);saved.current=key;setSavedSerial(key);stopped.current=false;setStatus("已保存");
    }catch(e){stopped.current=true;setError(String(e));setStatus("保存失败，输入仍保留");}
    finally{flight.current=false;}
  }
  useEffect(()=>{
    if(!unsaved||stopped.current||busy)return;
    const timer=setTimeout(()=>{void saveDraft();},800);return ()=>clearTimeout(timer);
    // The state/status changes reschedule edits made while a save was in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[serial,status,state,busy,unsaved]);
  useEffect(()=>{
    function warn(e:BeforeUnloadEvent){if(JSON.stringify(current.current)!==saved.current){e.preventDefault();e.returnValue="";}}
    window.addEventListener("beforeunload",warn);return ()=>window.removeEventListener("beforeunload",warn);
  },[]);
  async function formal(action:"publish"|"restore"){
    if(flight.current)return;
    if(action==="restore"&&!window.confirm("恢复将创建一个新正式版本，并替换当前草稿。未保存的输入请先复制。继续？"))return;
    flight.current=true;setBusy(true);setError("");
    try{
      const s=stateRef.current;
      const next=await request({action,taskId,revision:s.draft?.revision??0,baseVersion:s.head.version,
        ...(action==="restore"?{version:selected}:current.current)});
      install(next);const d=next.draft!;setTitle(d.title);setDocument(d.document);
      current.current={title:d.title,document:d.document};saved.current=JSON.stringify(current.current);setSavedSerial(saved.current);
      setSelected(next.head.version);setEditorKey(k=>k+1);stopped.current=false;setStatus("已保存正式版本 v"+next.head.version);setLocating(null);
    }catch(e){setError(String(e));setStatus("保存失败，输入仍保留");stopped.current=true;}
    finally{flight.current=false;setBusy(false);}
  }
  async function rewriteChapter(section:string){
    if(flight.current||JSON.stringify(current.current)!==saved.current)return;
    const feedback=window.prompt("写下只适用于这一章的改写要求。");
    if(!feedback?.trim())return;
    flight.current=true;setBusy(true);setError("");
    try{
      const s=stateRef.current,response=await fetch("/api/chapters",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({taskId,version:s.head.version,revision:s.draft?.revision??0,section,feedback})});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      const next:ArticleState=result,draft=next.draft!;
      install(next);current.current={title:draft.title,document:draft.document};saved.current=JSON.stringify(current.current);
      setSavedSerial(saved.current);setTitle(draft.title);setDocument(draft.document);setEditorKey(key=>key+1);
      setStatus("已保存本章改写");setLocating(null);
    }catch(error){setError(String(error));}
    finally{flight.current=false;setBusy(false);}
  }
  function liveOffset(anchor:ReviewAnchor,snapshot:{title:string;document:ArticleDocument}){
    const original=version[anchor.field],live=anchor.field==="title"?snapshot.title:plainText(snapshot.document);
    return mapReviewAnchor(original,live,anchor.quote,anchor.offset);
  }
  async function generate(edit:{kind:"ending"}|{kind:"rewrite";anchor:ReviewAnchor;suggestion:string}){
    if(!window.confirm("局部生成将调用已配置的模型。云端模型可能计费。继续？"))throw Error("已取消局部生成");
    const active=stateRef.current;
    if(edit.kind==="rewrite"&&liveOffset(edit.anchor,current.current)===null)throw Error("原句已变化，请定位后在正文修改。");
    const response=await fetch("/api/articles",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"generate-edit",taskId,version:version.version,revision:active.draft?.revision??0,allowCloud:true,edit}),signal:AbortSignal.timeout(65000)});
    const output=await response.json();
    if(!response.ok)throw Error(output.error??"局部生成失败");
    return output.text as string;
  }
  async function applyEdit(id:string,create:()=>Promise<LocalArticleEdit>){
    const stateBefore=stateRef.current;
    if(flight.current||selected!==stateBefore.head.version)throw Error("请等待保存完成后在当前版本操作。");
    if(stateBefore.draft?.baseVersion===selected&&stateBefore.draft.reviewEdits?.includes(id))return;
    flight.current=true;setBusy(true);setError("");
    const snapshot=current.current;
    try{
      const edit=await create();
      if(JSON.stringify(current.current)!==JSON.stringify(snapshot))throw Error("正文已变化，生成结果未写入。");
      const next=structuredClone(snapshot);
      let passage:SavedPassage|undefined;
      if(edit.kind==="replace"){
        const {anchor,text}=edit;
        if(/[\r\n]/.test(text))throw Error("请使用单行替换，跨段修改请在正文编辑器中完成。");
        const offset=liveOffset(anchor,snapshot);
        if(offset===null)throw Error("原句已变化，请定位后在正文修改。");
        passage={field:anchor.field,offset,quote:text,previous:anchor.quote};
        if(anchor.field==="title"){
          next.title=next.title.slice(0,offset)+text+next.title.slice(offset+anchor.quote.length);
        }else{
          const range=quoteRange(next.document,anchor.quote,offset);
          if(!range||range.anchor.path[0]!==range.focus.path[0])throw Error("建议跨越多个段落，请在正文修改。");
          const [block,start]=range.anchor.path,end=range.focus.path[1];
          const element=window.document.querySelector('[aria-label="文章正文"]')?.children[block];
          passage={...passage,block,height:element?.getBoundingClientRect().height,previous:plainText([snapshot.document[block]])};
          const leaves=next.document[block].children;
          const first=leaves[start],last=leaves[end];
          if(start===end){
            first.text=first.text.slice(0,range.anchor.offset)+text+first.text.slice(range.focus.offset);
          }else{
            const prefix={...first,text:first.text.slice(0,range.anchor.offset)+text};
            const suffix={...last,text:last.text.slice(range.focus.offset)};
            leaves.splice(start,end-start+1,prefix,suffix);
          }
        }
      }else{
        const blocks=next.document;
        const section=bodySection(blocks,stateBefore.kind);
        if(!section)throw Error("正文区块无法唯一定位，请先核对文章结构。");
        let end=section.end;
        while(end>section.start&&!plainText([blocks[end-1]]).trim())end--;
        blocks.splice(end,0,{type:"p",children:[{text:edit.text}]});
      }
      {
        const result=await request({action:"draft",taskId,revision:stateBefore.draft?.revision??0,baseVersion:stateBefore.head.version,reviewEdit:id,...next});
        install(result);current.current=next;setTitle(next.title);setDocument(next.document);
        saved.current=JSON.stringify(next);setSavedSerial(saved.current);setEditorKey(key=>key+1);
        setLocating(null);setSavedPassage(passage);stopped.current=false;setStatus("已保存修改");
      }
    }finally{flight.current=false;setBusy(false);}
  }
  function locate(issue:{field:"title"|"body";quote:string;offset:number}){
    setLocating(null);setSavedPassage(undefined);setNotice("");
    if(version[issue.field].slice(issue.offset,issue.offset+issue.quote.length)!==issue.quote){setNotice("引用无法与此版本精确匹配，未高亮。");return;}
    const liveAt=selected===state.head.version?liveOffset(issue,current.current):issue.offset;
    if(liveAt===null){setNotice("当前草稿中的原句无法唯一定位，可在审核记录查看原文。");return;}
    setLocating({...issue,offset:liveAt});
    if(issue.field==="title"&&selected===state.head.version&&titleRef.current){
      const input=titleRef.current;
      input.focus({preventScroll:true});input.setSelectionRange(liveAt,liveAt+issue.quote.length);
      centerReviewRect(input.getBoundingClientRect());
    }
  }
  function selectVersion(next:number){
    const version=next===state.head.version?undefined:String(next);
    history.replaceState(null,"",editorHref(taskId,returnTo,version?{version}:undefined));
    setSelected(next);setLocating(null);setNotice("");
  }
  let sections:{name:string;text:string}[]=[];
  if(state.kind){try{sections=validateBody(state.kind,selected===state.head.version?plainText(document):version.body);}catch{}}
  function marked(field:"title"|"body"){const text=version[field];if(locating?.field!==field||text.slice(locating.offset,locating.offset+locating.quote.length)!==locating.quote)return text;return <>{text.slice(0,locating.offset)}<mark className="history-anchor">{locating.quote}</mark>{text.slice(locating.offset+locating.quote.length)}</>;}
  const old=state.versions.find(v=>v.version===compare)??version;
  const diff=textDiff(old.title+"\n"+old.body,version.title+"\n"+version.body);
  function openAudit(){
    auditJump.current=!auditOpen;
    setAuditOpen(true);
    requestAnimationFrame(()=>{
      const summary=window.document.querySelector<HTMLElement>("#article-audit > summary");
      const visible=summary?.getBoundingClientRect();
      if(visible&&(!matchMedia("(min-width:1280px)").matches||visible.top<8||visible.bottom>innerHeight-8))summary?.scrollIntoView({block:"start"});
      summary?.focus({preventScroll:true});
    });
  }
  function revealLoadedAudit(){
    if(!auditJump.current)return;
    auditJump.current=false;
    if(!matchMedia("(min-width:1280px)").matches)
      window.document.querySelector("#article-audit > summary")?.scrollIntoView({block:"start"});
  }
  function returnToBody(){
    const heading=titleRef.current??window.document.querySelector<HTMLElement>(".article-columns h1");
    heading?.scrollIntoView({block:"start"});
    heading?.focus({preventScroll:true});
  }
  function download(text:string,name:string,type:string){
    const url=URL.createObjectURL(new Blob([text],{type}));
    const link=window.document.createElement("a");
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function historyItem(v:ArticleState["head"]){
    const parent=state.versions.find(a=>a.version===v.parentVersion);
    const actor=v.model==="manual"||v.origin==="human"||v.origin==="restore"?"作者":v.origin==="ai-revision"?"审核流程":"写作模型";
    const change=v.origin==="restore"?"恢复历史正文":v.origin==="model"?"保存初稿":!parent?"保存文章":
      v.title!==parent.title&&v.body!==parent.body?"修改标题和正文":v.title!==parent.title?"修改标题":v.body!==parent.body?"修改正文":v.confirmed?"确认定稿":"保存该版";
    const delta=parent&&v.body!==parent.body?textDiff(parent.body,v.body):null;
    const brief=(text:string)=>text.trim().length>34?text.trim().slice(0,34)+"…":text.trim();
    const timestamp=v.createdAt&&Number.isFinite(Date.parse(v.createdAt))?new Intl.DateTimeFormat("zh-CN",{month:"long",day:"numeric",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date(v.createdAt)):"时间未记录";
    return <li key={v.version} className="article-history-event">
      <div>
        <small><time dateTime={v.createdAt||undefined}>{timestamp}</time> · {actor}</small>
        <strong>{change}{v.version===state.head.version?" · 最新":""}</strong>
        {delta&&<p className="article-history-change">{delta.removed.trim()&&<del>{brief(delta.removed)}</del>}{delta.added.trim()&&<ins>{brief(delta.added)}</ins>}</p>}
        {v.decision&&<p>{v.decision.reason}</p>}
      </div>
      <button type="button" aria-current={v.version===selected?"true":undefined} onClick={()=>{selectVersion(v.version);requestAnimationFrame(returnToBody);}}>{v.version===selected?"正在查看":"查看此版"}</button>
    </li>;
  }
  return <div className="article-columns editor-layout" data-audit-open={auditOpen}><div className="editor-stack"><section className="editor-paper" aria-label="文章编辑">
      {selected===state.head.version?<label className="article-heading"><span className="article-sr-only">标题</span><textarea rows={1} ref={titleRef} aria-label="文章标题" value={title} disabled={busy} onChange={e=>{setTitle(e.target.value.replace(/\r?\n/g," "));setLocating(null);}}/></label>:<h1 tabIndex={-1}>{version.title}</h1>}
      <div className="article-actions">
        <span role="status">{unsaved&&status==="已保存"?"等待自动保存…":status}</span>
        <button type="button" aria-controls="article-audit" aria-expanded={auditOpen} onClick={openAudit}>查看审核</button>
        <ChannelDistribution mother={version} key={version.version} taskId={taskId} version={version.version} dirtyMother={stale}/>
    {error&&unsaved&&<button onClick={()=>void saveDraft()} disabled={busy}>重试保存草稿</button>}
    {(!version.confirmed||stale)&&<button onClick={()=>void formal("publish")} disabled={busy||selected!==state.head.version||status==="保存中…"}>确认定稿</button>}
      </div>
      {error&&<p role="alert">{error} 可在文章工具中备份当前输入。</p>}
      {visibleFacts.length>0&&<section className="article-fact" aria-label="待核验原句">
        <strong>待核验原句</strong>
        {visibleFacts.map(check=><div className="article-fact-row" key={check.field+":"+check.offset}>
          <blockquote>{check.quote}</blockquote>
          <button type="button" onClick={()=>locate(check)}>定位并改写</button>
        </div>)}
      </section>}
      {selected===state.head.version?<><BodyEditor key={editorKey} initial={document} disabled={busy} onChange={d=>{setDocument(d);setLocating(null);setSavedPassage(undefined);}} savedPassage={savedPassage} locate={locating?.field==="body"?locating:null}/></>:
        <article><h2>{marked("title")}</h2><pre className="article-history">{marked("body")}</pre><button onClick={()=>void formal("restore")} disabled={busy||status==="保存中…"}>恢复此版本为新版本</button></article>}
      {notice&&<p role="status">{notice}</p>}
    </section>
      <details className="article-tools"><summary>文章工具与版本记录</summary>
        <div className="article-tools-grid">
          <section className="article-export">
            <h3>导出与备份</h3>
            <p>{selected===state.head.version?"最新正式版本":"所选历史版本"} · {version.confirmed?"已定稿":"未定稿"}</p>
            <button type="button" onClick={()=>download(version.body,version.title+"-v"+version.version+".md","text/markdown;charset=utf-8")}>导出正文 <small>Markdown</small></button>
            <button type="button" onClick={()=>navigator.clipboard.writeText(version.body).then(()=>setNotice("正文已复制"),()=>setNotice("复制失败，请使用 Markdown 导出"))}>复制正文</button>
            <button type="button" onClick={()=>download(JSON.stringify(current.current,null,2),"article-draft.json","application/json")}>备份当前草稿</button>
            <Link href={"/production/package?"+new URLSearchParams({id:taskId,...(returnTo?{returnTo}:{})})}>打开配图与内容包 →</Link>
            <details><summary>视觉分镜与图片回填</summary><Storyboard task={taskId} version={version.version}/></details>
          </section>
          <section className="article-history-tools">
            <h3>修改历史</h3>
            <ol>{state.versions.slice(0,3).map(historyItem)}</ol>
            {state.versions.length>3&&<details><summary>更早的修改</summary><ol>{state.versions.slice(3).map(historyItem)}</ol></details>}
            {state.versions.length>1&&<details><summary>对照版本文字</summary><label>比较基准 <select value={compare} onChange={e=>setCompare(Number(e.target.value))}>{state.versions.map(v=><option key={v.version} value={v.version}>v{v.version} · {v.title}</option>)}</select></label>
              <p>基准 v{old.version} → 所选 v{version.version}。包含标题和正文文字。</p>
              <pre className="article-history">{diff.prefix}<del>{diff.removed}</del><ins>{diff.added}</ins>{diff.suffix}</pre>
            </details>}
          </section>
        </div>
        <div className="article-tools-extra">
          <PredictionLink key={version.version} task={taskId} version={version.version}/>
          <TaskAssembly task={taskId}/>
          <details><summary>发布记录与修改经验</summary>
            <ArticleReuse key={version.version} version={version} versions={state.versions} embedded/>
          </details>
          <details><summary>更多编辑工具</summary>
          {(selected===state.head.version?state.draft?.chapters??version.chapters:version.chapters)?.map(chapter=><details key={chapter.id}>
            <summary>{chapter.heading} · 分章来源</summary>
            <ul>{chapter.paragraphs.map((p,index)=><li key={index}>{p.text}<small> · {p.sources.join("、")||"无引用"}</small></li>)}</ul>
            {selected===state.head.version&&<button type="button" disabled={busy||unsaved} onClick={()=>void rewriteChapter(chapter.id)}>改写此章</button>}
          </details>)}
          {state.kind&&!version.chapters&&<details><summary>按栏目编辑或导出</summary>{sections.length?sections.map((s,i)=><div key={s.name}><label>{s.name}<textarea disabled={busy||selected!==state.head.version} value={s.text} onChange={e=>{
            const next=sections.map((item,n)=>n===i?{...item,text:e.target.value}:item);
            setDocument(fromText(renderSections(state.kind!,next)));setEditorKey(k=>k+1);
          }}/></label><button type="button" onClick={()=>download(s.text,s.name+"-v"+version.version+".txt","text/plain;charset=utf-8")}>导出{s.name}</button></div>):<p>栏目标题已改变，请在正文恢复必要栏目后保存。</p>}</details>}
          <label>收藏用途<select value={kind} onChange={e=>setKind(e.target.value)}><option value="case">整篇案例</option><option value="method">写作方法</option><option value="eval">评测候选</option></select></label>
          <button type="button" onClick={async()=>{try{await request({action:"nominate",kind,taskId,version:version.version});setNotice("已加入资料库候选区，需人工确认用途。");}catch(e){setError(String(e));}}}>收藏此版本为候选</button>
          <button type="button" onClick={()=>{if(window.confirm("重新载入会舍弃本窗口未保存内容，请先导出。继续？"))location.reload();}}>重新载入</button>
          </details>
          <details><summary>版本编号与来源</summary><p>正式版本 v{version.version} · 草稿修订 {state.draft?.revision??0} · 研究 v{version.researchVersion}</p><p>引用来源 {version.citations.join("、")||"无"} · 来源任务快照 r{version.sourceTaskRevision}{version.restoredFrom&&" · 恢复自 v"+version.restoredFrom}</p></details>
        </div>
      </details>
    <TaskBriefNotes taskId={taskId} endingInserted={state.head.endingInserted||state.draft?.baseVersion===selected&&state.draft.reviewEdits?.includes(endingEditId)} onGenerateEnding={selected===state.head.version?()=>applyEdit(endingEditId,async()=>({
      kind:"append",text:await generate({kind:"ending"}),
    })):undefined}/>
    </div><aside className="editor-review-panel" ref={reviewPanel}><details id="article-audit" open={auditOpen} onToggle={e=>setAuditOpen(e.currentTarget.open)}><summary className="review-capsule" data-attention={attention?.version===version.version?attention.kind:"normal"}>{attention?.version===version.version&&attention.kind!=="normal"?(attention.kind==="risk"?"有内容待核对":attention.kind==="conflict"?"有不同修改意见":"常规检查已完成 · 查看建议"):"查看审核与修改建议"}</summary><ArticleReview key={taskId+":"+version.version} taskId={taskId} version={version.version} stale={stale} article={version}
      authorView={{versions:state.versions,
        resolved:state.draft?.baseVersion===selected?state.draft.reviewEdits:undefined,
        onEdit:selected===state.head.version?(id,anchor,text)=>applyEdit(id,async()=>({kind:"replace",anchor,text})):undefined,
        onRewrite:selected===state.head.version?(id,anchor,suggestion)=>applyEdit(id,async()=>({kind:"replace",anchor,text:await generate({kind:"rewrite",anchor,suggestion})})):undefined,
        detailHref:reviewHref(taskId,returnTo),returnToBody,onReady:revealLoadedAudit,onAttention:kind=>{
          setAttention(previous=>previous?.version===version.version&&previous.kind===kind?previous:{version:version.version,kind});
          if((kind==="risk"||kind==="conflict")&&!prompted.current.has(version.version)){prompted.current.add(version.version);setAuditOpen(true);}
        },unmapped:locating&&stale&&(locating.field==="title"?title:plainText(document)).slice(locating.offset,locating.offset+locating.quote.length)!==locating.quote?locating:undefined,onLocateVersion:(v,i)=>{if(v===version.version)locate(i);else{selectVersion(v);setLocating(i);}}}}
      onDecide={selected!==state.head.version?undefined:async(review,issue,quote,replacement,reason)=>{
      try{await request({action:"decide",taskId,baseVersion:selected,revision:state.draft?.revision??0,review,issue,replacement,reason,choice:replacement===quote?"retain":"accept"});const url=new URL(location.href);for(const key of ["version","field","at","length","claim","issue","review"])url.searchParams.delete(key);history.replaceState(null,"",url);location.reload();}catch(e){setError(String(e));}
    }} onLocate={locate}/></details></aside></div>;
}
function BodyEditor({initial,disabled,onChange,locate,savedPassage}:{initial:ArticleDocument;disabled:boolean;onChange:(d:ArticleDocument)=>void;locate:{quote:string;offset:number}|null;savedPassage?:SavedPassage}){
  const editor=usePlateEditor({plugins,value:initial});
  useEffect(()=>{
    if(!locate)return;
    const range=quoteRange(clean(editor.children),locate.quote,locate.offset);
    if(!range)return;
    editor.tf.focus();editor.tf.select(range);
    const frame=requestAnimationFrame(()=>{
      const selection=window.getSelection();
      if(selection?.rangeCount)centerReviewRect(selection.getRangeAt(0).getBoundingClientRect());
    });
    return()=>cancelAnimationFrame(frame);
  },[editor,locate]);
  const body=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(savedPassage?.field!=="body"||!body.current||matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    let cleanup:(()=>void)|undefined;
    const frame=requestAnimationFrame(()=>{
      const container=body.current;
      if(!container||savedPassage.block===undefined)return;
      const block=editor.api.toDOMNode(editor.children[savedPassage.block]);
      if(!block)return;
      const computed=getComputedStyle(block),ease=computed.getPropertyValue("--creator-ease").trim();
      const old=document.createElement("div");
      old.className="creator-old-passage";old.setAttribute("aria-hidden","true");
      old.textContent=savedPassage.previous;
      const rect=block.getBoundingClientRect(),origin=container.getBoundingClientRect();
      Object.assign(old.style,{top:rect.top-origin.top+"px",left:rect.left-origin.left+"px",width:rect.width+"px",
        height:(savedPassage.height??rect.height)+"px",font:computed.font,lineHeight:computed.lineHeight});
      container.append(old);
      const fade=old.animate([{opacity:.8},{opacity:0}],{duration:140,easing:ease});
      void fade.finished.then(()=>old.remove(),()=>old.remove());
      const highlight=block.animate([{backgroundColor:computed.getPropertyValue("--creator-saved-glow").trim()},{backgroundColor:"transparent"}],{duration:600,easing:ease});
      const resize=savedPassage.height&&Math.abs(savedPassage.height-rect.height)>1?block.animate(
        [{height:savedPassage.height+"px",overflow:"clip"},{height:rect.height+"px",overflow:"clip"}],{duration:220,easing:ease}):undefined;
      cleanup=()=>{fade.cancel();highlight.cancel();resize?.cancel();old.remove();};
    });
    return()=>{cancelAnimationFrame(frame);cleanup?.();};
  },[editor,savedPassage]);
  return <Plate editor={editor} onValueChange={({value})=>onChange(stabilizeBlocks(clean(value),initial))}>
    <div className="article-toolbar" role="toolbar" aria-label="正文格式">
      {([['p','段落'],['h1','一级标题'],['h2','二级标题'],['li','列表'],['blockquote','引用']] as const).map(([type,label])=><button key={type} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.tf.setNodes({type},{match:n=>editor.api.isBlock(n)});editor.tf.focus();}}>{label}</button>)}
      <button disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>{editor.tf.toggleMark("bold");editor.tf.focus();}}>加粗</button>
    </div><div className="creator-body-frame" ref={body}><PlateContent className="article-body" aria-label="文章正文" readOnly={disabled} spellCheck={false}/></div>
  </Plate>;
}

