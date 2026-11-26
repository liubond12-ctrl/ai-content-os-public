import Link from "next/link";
import {contentList,openContent} from "@/studio/content-index";
import {draftHref,editorHref,reviewHref} from "@/studio/article-navigation";
import {RestoreArticlePosition} from "@/components/RestoreArticlePosition";
import {redirect} from "next/navigation";
import {productionPlatforms} from "@/studio/production-schema";

export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const raw=await searchParams, params=new URLSearchParams();
  for(const [k,v] of Object.entries(raw))if(typeof v==="string")params.set(k,v);
  const archivedDraft=params.get("archivedDraft");
  params.delete("archivedDraft");
  let archivedTitle:string|undefined;
  if(archivedDraft&&/^[\da-f-]{36}$/i.test(archivedDraft)){
    const db=openContent();
    try{
      const row=db.prepare("SELECT title FROM content_heads JOIN archived_tasks USING(id) WHERE id=?").get(archivedDraft);
      if(row)archivedTitle=String(row.title);
    }finally{db.close();}
  }
  const {rows,total,page,pages,accounts,historyById}=contentList(params,{personalOnly:params.get("samples")!=="1"});
  const showSampleShortcut=!total&&params.get("samples")!=="1"&&!!params.get("q")?.trim()&&contentList(params).total>0;
  const url=(change:Record<string,string>={})=>{const p=new URLSearchParams(params);for(const [k,v] of Object.entries(change))p.set(k,v);return "/articles?"+p;};
  const back=url(),archived=params.get("archived")==="1";
  async function update(form:FormData){
    "use server";
    const db=openContent(),id=String(form.get("id"));
    const action=form.get("action");
    try{
      if(!db.prepare("SELECT 1 FROM content_heads WHERE id=?").get(id))throw Error("稿件不存在");
      if(action==="archive")db.prepare("INSERT OR IGNORE INTO archived_tasks VALUES(?)").run(id);
      else if(action==="restore"||action==="undoArchive")db.prepare("DELETE FROM archived_tasks WHERE id=?").run(id);
      else if(action==="notes"){
        const tags=[...new Set(String(form.get("tags")||"").split(/[,，、]/).map(s=>s.trim()).filter(Boolean))];
        if(tags.length>5||tags.some(t=>t.length>30))throw Error("最多五个标签，每个不超过30字");
        db.prepare("INSERT OR REPLACE INTO content_notes VALUES(?,?,?,?)").run(id,form.has("favorite")?1:0,String(form.get("series")||"").trim().slice(0,100),tags.join(","));
      }
    }finally{db.close();}
    if(action==="archive"){
      const query=new URLSearchParams(back.split("?")[1]);
      query.set("archivedDraft",id);
      redirect("/articles?"+query+"#archive-receipt");
    }
    if(action==="undoArchive")redirect(back+"#article-"+id);
    redirect(back);
  }
  const select=(name:string,label:string,choices:readonly string[])=><label>{label}<select name={name} defaultValue={params.get(name)||""}><option value="">全部</option>{choices.map(s=><option key={s} value={s}>{name==="destination"&&s==="未记录"?"尚未登记发布":s}</option>)}</select></label>;
  const filterCount=["samples","history","account","platform","kind","status","destination","from","to","series","tag","favorite"].filter(key=>params.get(key)).length;
  return <main className="dashboard content-index"><header className="mast"><h1>{params.get("status")==="需求草稿"?"需求草稿":"历史文章"}</h1><Link href={url({archived:archived?"0":"1",page:"1"})}>{archived?"返回当前内容":"查看归档"}</Link></header>
  <form action="/articles" className="production content-filters"><input type="hidden" name="archived" value={archived?"1":"0"}/>
  <div className="content-search-row"><label><span className="article-sr-only">搜索稿件</span><input name="q" type="search" defaultValue={params.get("q")||""} placeholder="搜索选题、标题或正文"/></label><button>查找</button></div>
  <details><summary>筛选条件{filterCount>0&&` · 已选 ${filterCount} 项`}</summary><div className="content-filter-grid"><label>账号<select name="account" defaultValue={params.get("account")||""}><option value="">全部</option>{accounts.map(a=><option key={String(a.account)} value={String(a.account)}>{String(a.name||a.account)}</option>)}</select></label>
  {select("platform","平台",productionPlatforms)}{select("kind","类型",["图文","口播稿","分镜脚本","自由文章","旧文章"])}{select("status","状态",["已定稿","未定稿","需求草稿"])}{select("destination","发布去向",["未记录","待发布","已发布","暂不采用"])}
  {([["from","从","date"],["to","至","date"],["series","专题","text"],["tag","标签","text"]] as const).map(([key,label,type])=><label key={key}>{label}<input name={key} type={type} defaultValue={params.get(key)||""}/></label>)}
  <label><input type="checkbox" name="favorite" value="1" defaultChecked={params.get("favorite")==="1"}/>只看收藏</label>
  <label><input type="checkbox" name="samples" value="1" defaultChecked={params.get("samples")==="1"}/>包含示例与验收稿</label>
  <label><input type="checkbox" name="history" value="1" defaultChecked={params.get("history")==="1"}/>包含历史版本</label></div>
  <button>应用筛选</button></details></form>
  {archivedTitle&&<section className="surface archive-receipt" id="archive-receipt" aria-label="归档结果">
    <p role="status">已归档《{archivedTitle}》</p>
    <form action={update}><input type="hidden" name="id" value={archivedDraft!}/><button name="action" value="undoArchive">撤回归档</button></form>
  </section>}
  <section id="content-results" tabIndex={-1}><RestoreArticlePosition key={archivedTitle?"archive":"list"} prefix="article-" fallback="content-results"/><div className="content-results-head"><h2>{archived?"已归档内容":"内容"} <small>{total}</small></h2><Link href={"/hot?tab=saved&q="+encodeURIComponent(params.get("q")||"")}>查找热点收藏</Link></div>
  {params.get("history")==="1"&&<p>每篇显示最近命中的旧版本。日期按当前稿件的更新时间筛选。</p>}
  <div className="list">{rows.map(r=>{
    const id=String(r.id),origin=back+"#article-"+id;
    const href=r.version?editorHref(id,origin):r.isTask?reviewHref(id,origin):draftHref(id,String(r.kind),origin);
    const historyMatch=historyById.get(id);
    return <article id={"article-"+id} tabIndex={-1} key={id}><div className="item"><Link className="content-title" href={href}>{String(r.title)}</Link>
      {historyMatch&&<p><Link href={href+"&"+new URLSearchParams({version:String(historyMatch.version),field:historyMatch.field,at:String(historyMatch.offset),length:String(historyMatch.length)})}>查看命中的旧版 v{historyMatch.version}</Link> · <Link href={href}>打开当前稿 v{r.version}</Link><br/>{historyMatch.excerpt}</p>}
      <p className="meta">{String(r.accountName||r.account||"未归属")} · {r.updated?<time dateTime={String(r.updated)}>{new Date(String(r.updated)).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai",hour12:false})}</time>:"时间未记录"} · {String(r.status)}</p>
      <details><summary>稿件详情与发布记录</summary>
        <p>{r.isSample?"示例或验收稿 · ":""}{String(r.platform||"自由创作")} · {String(r.kind)}{r.version?" · v"+r.version:""}</p>
        <p>{String(r.destination||"尚未登记发布")}{r.publishedVersion?" · v"+r.publishedVersion:""} {r.url&&<a href={String(r.url)} target="_blank" rel="noreferrer">发布链接</a>}</p>
        {!!r.version&&<Link href={href}>查看版本与完整发布记录</Link>}
      </details>
      {params.get("q")&&!historyMatch&&<p className="content-excerpt">{String(r.excerpt||r.topic)}</p>}
      <details><summary>{[r.favorite?"已收藏":"收藏",r.series||"专题",r.tags||"标签"].join(" · ")}</summary><form action={update}><input type="hidden" name="id" value={id}/><label><input type="checkbox" name="favorite" defaultChecked={!!r.favorite}/>收藏</label><label>专题<input name="series" defaultValue={String(r.series||"")} maxLength={100}/></label><label>标签（逗号分隔）<input name="tags" defaultValue={String(r.tags||"")} pattern="[^,，、]+([,，、][^,，、]+){0,4}|"/></label><button>保存分类</button></form></details></div>
      {archived?<form action={update}><input type="hidden" name="id" value={id}/><button name="action" value="restore">恢复稿件</button></form>:
      <details className="creator-confirm"><summary>归档稿件</summary><p>归档后可从「查看归档」恢复。</p>
        <form action={update}><input type="hidden" name="id" value={id}/><button name="action" value="archive">确认归档</button></form></details>}</article>;})}{!rows.length&&<div className="empty"><p>没有匹配的稿件。</p>{showSampleShortcut&&<Link href={url({samples:"1",page:"1"})}>在示例与验收稿中查找匹配稿件</Link>}</div>}</div>
      <nav>{page>1&&<Link href={url({page:String(page-1)})}>上一页 </Link>}第 {page} / {pages} 页 {page<pages&&<Link href={url({page:String(page+1)})}>下一页</Link>}</nav></section></main>;
}
