"use client";
import {useEffect,useState} from "react";
import {imagePlatform,type ImagePlatform} from "@/types/sprint5";
import {storyboardCards} from "@/studio/storyboard";
import type {imageState} from "@/studio/content-package";
import "./storyboard.css";

type State=ReturnType<typeof imageState>;
export function Storyboard({task,version,data,onChange}:{task:string;version?:number;data?:State;onChange?:()=>void}){
  const [loaded,setLoaded]=useState<State|null>(null),[platform,setPlatform]=useState<ImagePlatform|null>(null);
  const [slot,setSlot]=useState(1),[status,setStatus]=useState(""),[busy,setBusy]=useState(false),[allow,setAllow]=useState(false);
  const current=data??loaded;
  async function load(){
    const r=await fetch("/api/production/package?id="+encodeURIComponent(task),{cache:"no-store"});
    const value=await r.json();if(!r.ok)throw Error(value.error);
    setLoaded(value);onChange?.();
  }
  useEffect(()=>{if(!data)void load().catch(error=>setStatus(error.message));},[task,data]); // eslint-disable-line react-hooks/exhaustive-deps
  if(!current)return <p role="status">{status||"正在读取分镜…"}</p>;
  if(version&&current.article.version!==version)return <p>分镜只在当前正式版本回填。</p>;
  const cards=platform?storyboardCards(task,current.article.version,current.article.title,current.article.body,platform):current.cards;
  const card=cards.find(row=>row.slot===slot)??cards[0];
  const last=current.images.find(row=>Number(row.page)===card.slot);
  const matching=last&&Number(last.article)===card.articleVersion;
  async function bind(asset:string,confirmed:boolean){
    const r=await fetch("/api/production/package",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({task,page:card.slot,article:card.articleVersion,asset,confirmed,expected:Number(last?.version??0)})});
    if(!r.ok)throw Error((await r.json()).error);
    await load();
  }
  async function upload(source:File){
    if(!allow||busy){setStatus("请先确认有权使用图片。");return;}
    const name=source.name.match(/\.(png|jpeg|jpg|webp)$/i)?source.name:"回填."+({ "image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[source.type]??"unknown");
    const file=new File([source],name,{type:source.type}),form=new FormData();
    form.set("file",file);form.set("source","作者回填到正式稿图位");form.set("allowed","true");form.set("draft",task);
    setBusy(true);
    try{
      const r=await fetch("/api/production/assets",{method:"POST",body:form}),saved=await r.json();
      if(!r.ok)throw Error(saved.error);
      await bind(saved.id,false);setStatus("图片已回填，请核对后确认。");
    }catch(error){setStatus(error instanceof Error?error.message:"图片未保存");}
    finally{setBusy(false);}
  }
  return <section className="storyboard-workspace">
    <h3>视觉分镜 · v{card.articleVersion}</h3>
    <div className="story-controls"><label>目标预览<select value={card.platform} onChange={e=>{setPlatform(imagePlatform.parse(e.target.value));setSlot(1);}}>
      {imagePlatform.options.map(value=><option key={value}>{value}</option>)}</select></label>
      <button type="button" disabled={card.slot<=1} onClick={()=>setSlot(card.slot-1)}>上一图</button>
      <button type="button" disabled={card.slot>=cards.length} onClick={()=>setSlot(card.slot+1)}>下一图</button>
      <span>{card.slot}/{cards.length} · {card.platform==="公众号"&&card.slot===1?"头图 · ":""}{card.ratio}</span>
    </div>
    <div className="story-grid"><div className="story-preview" style={{aspectRatio:card.ratio.replace(":"," / "),maxWidth:card.ratio==="9:16"?292:card.ratio==="3:4"?390:420}} tabIndex={0}
      aria-label="图位预览，可粘贴或拖入图片" onPaste={e=>{const file=e.clipboardData.files[0];if(file){e.preventDefault();void upload(file);}}}
      onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();const file=e.dataTransfer.files[0];if(file)void upload(file);}}>
      {matching?<img src={"/api/production/assets?id="+last.asset} alt={card.description}/>:<svg viewBox="0 0 160 110" role="img" aria-label="线框占位">
        <rect x="12" y="12" width="136" height="86" fill="none" stroke="currentColor"/><path d="M12 98l44-47 27 24 18-19 47 42" fill="none" stroke="currentColor"/><circle cx="110" cy="36" r="8" fill="none" stroke="currentColor"/>
      </svg>}
    </div><div>
      <p>{card.description}</p>{card.overlayText&&<p>叠字 · {card.overlayText}</p>}
      <button type="button" onClick={()=>void navigator.clipboard.writeText(card.prompt).then(()=>setStatus("已复制 image2 提示词"),()=>setStatus("可展开提示词手动复制"))}>复制 image2 提示词</button>
      <details><summary>查看结构化提示词</summary><textarea readOnly value={card.prompt} rows={6}/></details>
      <label><input type="checkbox" checked={allow} onChange={e=>setAllow(e.target.checked)}/> 我有权使用图片</label>
      <label>选择图片<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!allow} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);}}/></label>
      {matching&&!last.confirmed&&<button type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await bind(String(last.asset),true);setStatus("已确认图位");}catch(e){setStatus(String(e));}finally{setBusy(false);}}}>确认当前图位</button>}
    </div></div><p role="status">{status}</p>
  </section>;
}
