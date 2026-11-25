"use client";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {channelContent,type ChannelContent,type ChannelDerivation,type ChannelVariant} from "@/types/channel-derivation";
import {channelDelivery,channelFields,channelRadar} from "@/studio/channel-delivery";
import "./channel-distribution.css";

type Entry={saved:ChannelDerivation|null;content?:ChannelContent};
const channels=[["xiaohongshu","小红书"],["douyin-script","抖音"],["wechat","公众号"]] as const;

export function ChannelDistribution({taskId,version,dirtyMother}:{taskId:string;version:number;dirtyMother:boolean}){
  const [open,setOpen]=useState(()=>typeof window!=="undefined"&&new URLSearchParams(location.search).get("distribution")==="1"),[variant,setVariant]=useState<ChannelVariant>("xiaohongshu");
  const [entries,setEntries]=useState<Partial<Record<ChannelVariant,Entry>>>({});
  const [pending,setPending]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState("");
  const lock=useRef(false);
  const entry=entries[variant],content=entry?.content;
  const dirty=!!content&&JSON.stringify(content)!==JSON.stringify(entry?.saved?.content);
  const path="/api/derivations?"+new URLSearchParams({taskId,articleVersion:String(version),variant});
  const opener=useRef<HTMLButtonElement>(null);

  useEffect(()=>{
    if(!open||entry!==undefined)return;
    const controller=new AbortController();
    fetch(path,{signal:controller.signal,cache:"no-store"}).then(async response=>{
      const saved:ChannelDerivation|null=await response.json();
      if(!response.ok)throw Error("暂时无法读取渠道稿。");
      if(!controller.signal.aborted)setEntries(previous=>({...previous,[variant]:{saved,content:saved?.content}}));
    }).catch(error=>{if(!controller.signal.aborted)setError(String(error));});
    return()=>controller.abort();
  },[open,path,variant,entry]);

  function select(next:ChannelVariant){setVariant(next);setMessage("");setError("");}
  function close(){setOpen(false);requestAnimationFrame(()=>opener.current?.focus());}
  async function submit(action:"save"|"generate"){
    if(lock.current||!entry)return;
    if(action==="generate"&&!window.confirm((content?"重新生成会追加一份渠道修订，当前输入将换成生成结果。":"将从正式母稿生成此渠道稿。")+" 使用云端模型时会发送母稿并可能计费。继续？"))return;
    if(action==="save"){
      const check=channelContent.safeParse(content);
      if(!check.success){setError(check.error.issues[0]?.message||"请检查渠道稿格式。");return;}
    }
    lock.current=true;setPending(action==="save"?"正在保存…":"正在生成…");setError("");setMessage("");
    try{
      const response=await fetch("/api/derivations",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({taskId,articleVersion:version,variant,revision:entry.saved?.revision??0,action,...(action==="save"?{content}:{allowCloud:true})})});
      const saved=await response.json();
      if(!response.ok)throw Error(saved.error);
      setEntries(previous=>({...previous,[variant]:{saved,content:saved.content}}));
      setMessage(action==="save"?"渠道稿已保存。":"渠道稿已生成并保存。");
    }catch(error){setError(error instanceof Error?error.message:String(error));}
    finally{lock.current=false;setPending("");}
  }
  async function copy(plainOnly=false){
    if(!content)return;
    setError("");setMessage("");
    const result=channelDelivery(content);
    try{
      if(result.html&&!plainOnly){
        if(!navigator.clipboard?.write||typeof ClipboardItem==="undefined")throw Error("此浏览器不支持富文本剪贴板。可使用「复制纯文本」。");
        await navigator.clipboard.write([new ClipboardItem({
          "text/html":new Blob([result.html],{type:"text/html"}),
          "text/plain":new Blob([result.plain],{type:"text/plain"}),
        })]);
      }else await navigator.clipboard.writeText(result.plain);
      setMessage(result.html&&!plainOnly?"已复制富文本和纯文本。":"已复制纯文本。");
    }catch(error){setError(error instanceof Error?error.message:"剪贴板不可用，请从编辑区选择文字复制。");}
  }
  return <>
    <button type="button" ref={opener} onClick={()=>setOpen(true)}>三端一键分发</button>
    {open&&<dialog className="channel-distribution" aria-labelledby="channel-heading" onClose={close}
      onCancel={event=>{if(lock.current)event.preventDefault();}}
      ref={node=>{if(node&&!node.open)node.showModal();}}>
      <header className="channel-heading"><div><h2 id="channel-heading">三端一键分发</h2><p>正式母稿 v{version}{entry?.saved?" · 渠道修订 "+entry.saved.revision:""}</p></div>
        <button type="button" disabled={!!pending} onClick={close} aria-label="关闭分发">关闭</button>
      </header>
      {dirtyMother&&<p className="channel-hint">这里读取已保存的正式母稿。编辑器中的草稿改动需成为新正式版本后才能用于重新派生。</p>}
      <nav aria-label="分发渠道">{channels.map(([key,label])=><button type="button" key={key} disabled={!!pending}
        aria-pressed={variant===key||key==="douyin-script"&&variant==="douyin-post"} onClick={()=>select(key)}>{label}</button>)}</nav>
      {variant.startsWith("douyin")&&<nav aria-label="抖音形态">
        <button type="button" disabled={!!pending} aria-pressed={variant==="douyin-script"} onClick={()=>select("douyin-script")}>口播逐字稿</button>
        <button type="button" disabled={!!pending} aria-pressed={variant==="douyin-post"} onClick={()=>select("douyin-post")}>短图文</button>
      </nav>}
      {entry?<div className="channel-actions">
        <button type="button" className={!content?"primary":undefined} disabled={!!pending} onClick={()=>void submit("generate")}>{content?"重新生成":"生成渠道稿"}</button>
        {content&&<><button type="button" disabled={!dirty||!!pending} onClick={()=>void submit("save")}>保存渠道稿</button>
          <button type="button" className="primary" disabled={!!pending} onClick={()=>void copy()}>{variant==="wechat"?"复制公众号富文本":"复制渠道稿"}</button>
          {variant==="wechat"&&<button type="button" disabled={!!pending} onClick={()=>void copy(true)}>复制纯文本</button>}
        </>}
      </div>:!error&&<p role="status">正在读取渠道稿…</p>}
      {error&&!entry&&<button type="button" onClick={()=>{setError("");setOpen(false);requestAnimationFrame(()=>setOpen(true));}}>重新读取</button>}
      <p className="channel-status" role="status">{pending||message||(dirty?"渠道稿有未保存的编辑。":"")}</p>
      {error&&<p role="alert">{error}</p>}
      {content&&<div className="channel-layout"><fieldset disabled={!!pending}><legend>编辑渠道稿</legend>
        <ChannelEditor value={content} change={next=>{setMessage("");setEntries(previous=>({...previous,[variant]:{...entry,content:next}}));}}/>
      </fieldset><ChannelRadar content={content}/></div>}
    </dialog>}
  </>;
}

function ChannelEditor({value,change}:{value:ChannelContent;change:(content:ChannelContent)=>void}){
  const line=(label:string,text:string,onChange:(text:string)=>void,maxLength?:number)=><label>{label}<input value={text} maxLength={maxLength} onChange={e=>onChange(e.target.value)}/></label>;
  const area=(label:string,text:string,onChange:(text:string)=>void,rows=3)=><label>{label}<textarea rows={rows} value={text} onChange={e=>onChange(e.target.value)}/></label>;
  const replace=<T,>(items:T[],index:number,item:T)=>items.map((old,at)=>at===index?item:old);
  const parts:ReactNode[]=[];
  if(value.variant==="xiaohongshu"){
    parts.push(<section key="titles"><h3>备选标题</h3>{value.titles.map((text,i)=><div key={i}>{line("标题 "+(i+1),text,text=>change({...value,titles:replace(value.titles,i,text)}))}</div>)}</section>);
    parts.push(<div key="body">{area("正文",value.body,body=>change({...value,body}),9)}</div>);
    parts.push(<section key="tags"><h3>搜索标签</h3><div className="channel-tags">{value.tags.map((text,i)=><div key={i}>{line("标签 "+(i+1),text,text=>change({...value,tags:replace(value.tags,i,text)}))}</div>)}</div></section>);
    parts.push(<section key="comments"><h3>作者置顶自问自答</h3>{value.comments.map((comment,i)=><div className="channel-part" key={i}>
      {line("提问 "+(i+1),comment.question,question=>change({...value,comments:replace(value.comments,i,{...comment,question})}))}
      {area("作者回答 "+(i+1),comment.answer,answer=>change({...value,comments:replace(value.comments,i,{...comment,answer})}))}</div>)}</section>);
  }else{
    parts.push(<div key="title">{line("标题",value.title,title=>change({...value,title}))}</div>);
    if(value.variant==="douyin-script"){
      parts.push(<section key="script"><h3>前三秒钩子</h3>{value.hooks.map((text,i)=><div key={i}>{line("钩子 "+(i+1),text,text=>change({...value,hooks:replace(value.hooks,i,text)}))}</div>)}{area("口播逐字稿",value.script,script=>change({...value,script}),12)}</section>);
    }else if(value.variant==="douyin-post"){
      parts.push(<section key="slides"><h3>逐页内容</h3>{value.slides.map((text,i)=><div key={i} className="channel-part">{area("第 "+(i+1)+" 页",text,text=>change({...value,slides:replace(value.slides,i,text)}))}
        <button type="button" disabled={value.slides.length<=2} onClick={()=>change({...value,slides:value.slides.filter((_,index)=>index!==i)})}>移除第 {i+1} 页</button></div>)}
        <button type="button" disabled={value.slides.length>=20} onClick={()=>change({...value,slides:[...value.slides,""]})}>添加一页</button></section>);
    }else{
      const kindLabels={paragraph:"段落",quote:"引用框",highlight:"重点高亮",step:"步骤卡片"} as const;
      parts.push(<section key="blocks"><h3>正文内容块</h3>{value.blocks.map((block,i)=><div key={i} className="channel-part">
        <label>内容块 {i+1} 类型<select value={block.kind} onChange={e=>change({...value,blocks:replace(value.blocks,i,{...block,kind:e.target.value as typeof block.kind})})}>
          {Object.entries(kindLabels).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}
        </select></label>
        {area("内容块 "+(i+1),block.text,text=>change({...value,blocks:replace(value.blocks,i,{...block,text})}),4)}
        <button type="button" disabled={value.blocks.length<=1} onClick={()=>change({...value,blocks:value.blocks.filter((_,index)=>index!==i)})}>移除内容块 {i+1}</button>
      </div>)}<button type="button" disabled={value.blocks.length>=100} onClick={()=>change({...value,blocks:[...value.blocks,{kind:"paragraph",text:""}]})}>添加内容块</button></section>);
    }
  }
  return <>{parts}{area("文末行动引导",value.cta,cta=>change({...value,cta}),2)}
    {line("搜索关键词（用逗号分隔）",value.keywords.join("，"),text=>change({...value,keywords:text.split(/[，,]/)}))}</>;
}

function ChannelRadar({content}:{content:ChannelContent}){
  const {matches,keywords,hooks,cta,format}=channelRadar(content);
  return <aside className="channel-radar" aria-label="合规雷达">
    <h3>合规雷达</h3><p>本地词表预检。命中请结合上下文人工复核。</p>
    <p><strong>{matches.length?"词面命中 "+matches.length+" 处":"未命中当前词表"}</strong></p>
    {!!matches.length&&<ul>{matches.map(match=>{
      const source=channelFields(content).find(field=>field.field===match.field)?.text??match.text;
      return <li key={match.field+":"+match.start+match.reason}><strong>{match.field}</strong><p>{source.slice(Math.max(0,match.start-12),match.start)}<mark>{match.text}</mark>{source.slice(match.end,match.end+12)}</p><small>{match.reason}</small></li>;
    })}</ul>}
    <h4>内容完整度</h4><ul>
      <li>搜索关键词 {keywords.length?keywords.filter(item=>item.present).length+"/"+keywords.length+" 已覆盖":"待填写"}</li>
      {keywords.filter(item=>!item.present).map(item=><li key={item.term}>缺少「{item.term}」</li>)}
      <li>行动引导 {cta?"已填写":"待补充"}</li>
      {hooks!==null&&<li>不同钩子 {hooks}/3</li>}
      {format!==null&&<li>{content.variant==="wechat"?"引用框、重点、步骤":"Emoji 分段"} {format?"已具备":"待完善"}</li>}
    </ul>
  </aside>;
}
