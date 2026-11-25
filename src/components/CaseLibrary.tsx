"use client";
import Link from "next/link";
import {goldCandidates} from "@/studio/gold-candidates";
import {useEffect,useState} from "react";

type Row=Record<string,unknown>;
const textOf=(value:unknown)=>Array.isArray(value)?value.join("、"):String(value??"");
const common={id:"",source:"",rights:"原创",version:1,synthetic:false,allowExternal:false};
const ref={...common,title:"",content:"",format:"图文文章",goal:"",tags:[],method:"",applies:"",avoid:"",quality:[],facts:""};
const ev={...common,content:"",referenceId:"",format:"图文文章",goal:"",label:"普通",reviewer:"",dimensions:[],rationale:"",issues:[],locations:[],positiveExample:"",negativeExample:"",scenario:"",tags:[],suggestion:"",aiSuggestion:"",split:"dev"};
const names:Record<string,string>={id:"案例 ID",title:"标题",source:"出处",rights:"许可",content:"案例原文",format:"内容形式",goal:"创作目标",tags:"技法标签",method:"值得借鉴的方法",applies:"适用场景",avoid:"不适用场景",facts:"原文中的事实信息（仅供人工查看）",quality:"质量描述",label:"人工质量标签",reviewer:"标注人",dimensions:"评价维度",rationale:"人工评价理由",positiveExample:"正面示例",negativeExample:"反面示例",scenario:"适用场景",suggestion:"改进建议",aiSuggestion:"AI 辅助意见（与人工理由分开）",split:"数据集",referenceId:"关联参考案例 ID（可选）",locations:"问题位置描述"};
const options:Record<string,string[]>={rights:["原创","已获许可"],format:["图文文章","口播稿","短视频脚本"],label:["优秀","普通","不合格"],split:["dev","holdout","pool"]};
const splitNames:Record<string,string>={dev:"开发与调试集",holdout:"独立验收集",pool:"已确认，待分集"};
async function api(url:string,init?:RequestInit){
  const r=await fetch(url,{cache:"no-store",...init});const data=await r.json();if(!r.ok)throw Error(data.error);return data;
}
export default function CaseLibrary({kind}:{kind:"ref"|"eval"}){
  const [nominations,nominate]=useState<Array<{kind:string;task:string;version:number;title:string;body:string;reason?:string}>>([]);
  const [rows,list]=useState<Row[]>([]),[form,set]=useState<Row>(kind==="ref"?ref:ev);
  const [editing,setEditing]=useState(false);
  const [selected,select]=useState(false),[message,msg]=useState(""),[key,token]=useState(""),[confirmed,confirm]=useState(false);
  const [issues,setIssues]=useState("[]"),[stats,setStats]=useState<Row[]>([]),[filter,filters]=useState({q:"",goal:"",tag:"",format:"",mode:"keyword"});
  useEffect(()=>{api("/api/articles?view=candidates").then(nominate).catch(e=>msg(String(e)));},[]);
  const isRef=kind==="ref";
  const endpoint=isRef?"/api/references":"/api/eval-cases";
  const headers={"Content-Type":"application/json","x-review-key":key};
  function reset(next=kind){setEditing(false);select(false);set(next==="ref"?{...ref}:{...ev});setIssues("[]");confirm(false);}
  async function load(next=kind){
    const url=next==="ref"?"/api/references?"+new URLSearchParams(filter):"/api/eval-cases"+(key?"?view=history":"");
    list(await api(url,{headers}));
    if(next==="eval"&&key)setStats(await api("/api/eval-cases?view=stats",{headers}));
  }
  useEffect(()=>{api(kind==="ref"?"/api/references":"/api/eval-cases").then(list).catch(e=>msg(String(e)));},[kind]);
  function edit(row:Row){
    setEditing(true);set({...isRef?ref:ev,...row});select(true);confirm(false);setIssues(JSON.stringify(row.issues??[],null,2));
  }
  async function save(){
    const item:Row={...form,id:form.id||crypto.randomUUID(),version:selected?Number(form.version)+1:1,createdAt:form.createdAt??new Date().toISOString()};
    if(!isRef){item.issues=JSON.parse(issues);if(!item.referenceId)delete item.referenceId;}
    const data=await api(endpoint,{method:"POST",headers,body:JSON.stringify(isRef?item:{humanReviewed:confirmed,item})});
    edit(data);await load();msg("已保存 v"+data.version);
  }
  return <main className="app-shell">
    <h1>{isRef?"写作参考库":"人工评测"}</h1>
    {isRef&&<p className="case-source-note">这里借鉴写法。核对活动、产品等业务事实时，请查看原始记录。<Link href="/studio/settings#sources">查看业务资料来源与飞书状态 →</Link></p>}
    <details><summary>从文章收藏的候选（{nominations.length}）</summary>{nominations.filter(a=>isRef?a.kind!=="eval":a.kind==="eval").map(a=><details key={a.task+a.version+a.kind}><summary>{a.title} · v{a.version} · {a.kind==="method"?"写作方法":a.kind==="eval"?"评测候选":"整篇案例"}</summary><p>{a.reason}</p><p>当前选择{isRef?"创作参考":"人工评测"}。请核对摘录、权利及适用范围后保存。</p><button onClick={()=>{reset();setEditing(true);set({...isRef?ref:ev,id:"article-"+a.task+"-"+a.version+"-"+a.kind,source:"本机文章 "+a.task+" v"+a.version,content:a.body.slice(0,2000),...(isRef?{title:a.title}:{referenceId:a.task,split:"pool",aiSuggestion:""}),allowExternal:false});}}>填入下方评审表</button></details>)}</details>
    {isRef?<details><summary>搜索与筛选参考</summary><fieldset><legend>筛选参考</legend>{(["q","tag","format","goal"] as const).map(k=><label key={k}>{{q:"关键词",tag:"技法",format:"形式",goal:"目标"}[k]}<input value={filter[k]} onChange={e=>filters({...filter,[k]:e.target.value})}/></label>)}
      <label>检索方式<select value={filter.mode} onChange={e=>filters({...filter,mode:e.target.value})}>{["keyword","semantic","hybrid"].map(m=><option key={m} value={m}>{{keyword:"关键词",semantic:"语义相近",hybrid:"综合匹配"}[m]}</option>)}</select></label></fieldset><button onClick={()=>load().catch(e=>msg(String(e)))}>查找参考</button></details>:
      <details><summary>查看受限评测记录</summary><label>人工评审密钥（查看独立集和统计时需要）<input type="password" value={key} onChange={e=>{token(e.target.value);list([]);setStats([]);reset();}}/></label></details>}
    {!isRef&&<button onClick={()=>load().catch(e=>msg(String(e)))}>查询列表</button>}
    {!isRef&&<details><summary>待人工确认的候选样本（10 条）</summary><p>候选理由供讨论。选中后填写你的评价与理由，再单独确认保存。</p>{goldCandidates.map(c=><details key={c.id}><summary>{c.kind} · v{c.version}{c.disputed?" · 有争议":""}</summary><p>{c.content}</p><p>候选理由：{c.reason}。允许：{c.allowed}。禁止：{c.forbidden}。</p><button onClick={()=>{reset("eval");set({...ev,id:c.id,source:"工作台原创候选",goal:c.goal,content:c.content,tags:[c.kind],format:"图文文章",aiSuggestion:c.reason+"；允许"+c.allowed+"；禁止"+c.forbidden,scenario:c.goal,referenceId:c.id,split:"pool",synthetic:true});}}>在表单中评审</button></details>)}</details>}
    {stats.map(s=><p key={String(s.split)}>{splitNames[String(s.split)]}：{String(s.count)} 条 · {JSON.stringify(s.labels)}</p>)}
    <ul className="case-list">{rows.map(r=><li key={String(r.id)+":"+r.version}>{isRef?<article className="case-entry"><h2>{String(r.title)} · v{String(r.version)}</h2><blockquote>{String(r.content)}</blockquote><p><strong>可借鉴的方法</strong>　{String(r.method)}</p><p><strong>适用场景</strong>　{String(r.applies)}</p><p className="meta">{String(r.source)} · {String(r.rights)} · {r.allowExternal?"许可允许外发":"仅限本地"}</p>
      <div className="case-entry-actions"><Link href={"/production/create?"+new URLSearchParams({ref:String(r.id),v:String(r.version)})} aria-label={"用这条参考写一篇："+String(r.title??r.id)}>用这条参考写一篇 →</Link><button onClick={()=>edit(r)} aria-label={"编辑参考："+String(r.title??r.id)}>编辑参考</button></div></article>:<button onClick={()=>edit(r)}>{String(r.title??r.id)} · v{String(r.version)} {r.synthetic?" · 虚构样例":""} {r.label?String(r.label):""}</button>}</li>)}</ul>
    <button onClick={()=>{reset();setEditing(true);if(isRef)set({...ref,id:crypto.randomUUID()});msg("");}}>新建{isRef?"案例":"人工标注"}</button>
    {(!isRef||editing)&&<form onSubmit={e=>{e.preventDefault();save().catch(err=>msg(String(err)));}}>
      {[false,true].map(advanced=><details key={String(advanced)} open={!advanced}><summary>{advanced?"补充标注与高级字段":"原文、许可与主要评价"}</summary>{Object.keys(isRef?ref:ev).filter(k=>names[k]&&k!=="id"&&(["tags","quality","facts","referenceId","positiveExample","negativeExample","scenario","aiSuggestion","split","locations"].includes(k)===advanced)).map(k=><label key={k}>{names[k]}
        {options[k]?<select value={textOf(form[k])} onChange={e=>set({...form,[k]:e.target.value})}>{options[k].map(o=><option key={o} value={o}>{splitNames[o]??o}</option>)}</select>:
        k==="dimensions"?<span>{["内容策略","表达质量","内容结构","基础规范"].map(d=><label key={d}><input type="checkbox" checked={(form.dimensions as string[]).includes(d)} onChange={e=>set({...form,dimensions:e.target.checked?[...(form.dimensions as string[]),d]:(form.dimensions as string[]).filter(v=>v!==d)})}/>{d}</label>)}</span>:
        <textarea disabled={selected&&k==="id"} value={textOf(form[k])} placeholder={Array.isArray(form[k])?"多项用顿号分隔":""} onChange={e=>set({...form,[k]:Array.isArray(form[k])?e.target.value.split("、"):e.target.value})}/>}</label>)}</details>)}
      {!isRef&&<details><summary>精确定位问题片段（高级）</summary><label>问题片段 JSON（offset 从 0 开始，quote 为原文，severe 表示严重问题）<textarea value={issues} onChange={e=>setIssues(e.target.value)}/></label></details>}
      <label><input type="checkbox" checked={Boolean(form.synthetic)} onChange={e=>set({...form,synthetic:e.target.checked})}/>原创虚构素材</label>
      <label><input type="checkbox" checked={Boolean(form.allowExternal)} onChange={e=>set({...form,allowExternal:e.target.checked})}/>来源许可允许外发（不会启用云端发送）</label>
      {!isRef&&<label><input type="checkbox" checked={confirmed} onChange={e=>confirm(e.target.checked)}/>我已核对原文并确认人工标签和评价理由</label>}
      <button disabled={!isRef&&!confirmed}>保存{selected?"下一版本":""}</button>
    <button type="button" onClick={()=>reset()}>结束编辑</button></form>}
    {isRef&&selected&&<button onClick={async()=>{if(!window.confirm("从创作检索中移除此案例？历史版本保留。"))return;
      try{await api(endpoint+"?"+new URLSearchParams({id:String(form.id),version:String(form.version)}),{method:"DELETE",headers});reset();await load();msg("已移除");}catch(e){msg(String(e));}
    }}>移除参考案例</button>}
    <p role="status">{message}</p></main>;
}
