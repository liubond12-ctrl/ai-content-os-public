import "./reader.css";
import Link from "next/link";
import {redirect} from "next/navigation";
import {revalidatePath} from "next/cache";
import {randomUUID} from "node:crypto";
import {hotDb,readFeed,savedHot,categories,type HotItem,type Section} from "@/studio/aihot";
import {saveProductionDraft} from "@/studio/production";

export const dynamic="force-dynamic";
const tabs={latest:"精选",events:"事件榜",daily:"日报",saved:"收藏"};
function stamp(value:string|number){return new Date(value).toLocaleString("zh-CN");}
function Card({item,read,note}:{item:HotItem;read:boolean;note:string|undefined}){
  async function mark(){ "use server";const db=hotDb();try{db.prepare("INSERT OR IGNORE INTO hot_read VALUES(?)").run(item.key);}finally{db.close();}revalidatePath("/hot");}
  async function save(form:FormData){ "use server";const db=hotDb();try{db.exec("BEGIN IMMEDIATE");db.prepare("INSERT OR REPLACE INTO hot_saved VALUES(?,?,?,?,?,?)").run(item.key,item.title,item.original,item.source,String(form.get("note")||"").trim().slice(0,2000),new Date().toISOString());db.prepare("INSERT OR REPLACE INTO hot_saved_source VALUES(?,?,?)").run(item.key,item.canonical,item.date);db.exec("COMMIT");}finally{db.close();}revalidatePath("/hot");}
  async function remove(){ "use server";const db=hotDb();try{db.exec("BEGIN IMMEDIATE");db.prepare("DELETE FROM hot_saved WHERE key=?").run(item.key);db.prepare("DELETE FROM hot_saved_source WHERE key=?").run(item.key);db.exec("COMMIT");}finally{db.close();}revalidatePath("/hot");}
  async function draft(){ "use server";const id=randomUUID();saveProductionDraft({id,version:0,kind:"图文",topic:item.title.slice(0,240),requirements:["新闻线索，使用前请核实原始报道。",item.source,item.original,item.canonical].join("\n").slice(0,4000)},item);redirect("/production/create?draft="+id+"&from=hot");}
  const storyId=item.story?new URL(item.story).pathname.match(/^\/story\/([\w-]+)$/)?.[1]:"";
  return <article className="hot-report"><div className="hot-byline"><time>{item.date?new Date(item.date).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",timeZone:"Asia/Shanghai"}):""}</time> <span>{item.source}</span>{item.category&&categories[item.category]&&<span>{categories[item.category]}</span>}{read&&<span>已读</span>}</div>
  <h3>{item.rank?<><b className="hot-num">{item.rank}</b><Link href={storyLink(item)}>{item.title}</Link></>:<a href={item.original} target="_blank" rel="noreferrer">{item.title}</a>}</h3>
  <div className="hot-tools"><details className="hot-expand"><summary>摘要与来源</summary><div>{item.summary&&<p>{item.summary}</p>}
  {item.sourceNames?.length? <p>相关来源 · {item.sourceNames.join("、")}</p>:null}<p><a href={item.original} target="_blank" rel="noreferrer">打开原始来源</a>　<a href={item.canonical} target="_blank" rel="noreferrer">AIHOT 原站</a>　{storyId&&<Link href={"/hot?tab=events&story="+storyId}>查看事件进展</Link>}</p>{!read&&<form action={mark}><button>标为已读</button></form>}</div></details>
  <details className="hot-save"><summary>{note===undefined?"收藏":"已收藏"}</summary><form action={save}><label>个人备注<input name="note" maxLength={2000} defaultValue={note}/></label><button>保存收藏</button></form>{note!==undefined&&<form action={remove}><button>取消收藏</button></form>}</details><form action={draft}><button>作为选题</button></form></div></article>;
}
function storyLink(item:HotItem){const id=item.story&&new URL(item.story).pathname.match(/^\/story\/([\w-]+)$/)?.[1];return id?"/hot?tab=events&story="+id:item.canonical;}
function dateLabel(value:string){return value?new Date(value).toLocaleDateString("zh-CN",{timeZone:"Asia/Shanghai",year:"numeric",month:"long",day:"numeric",weekday:"short"}):"日期未记录";}
type Params={tab?:string;story?:string;q?:string;mode?:string;category?:string;cursor?:string;cursorCategory?:string;unread?:string};
export default async function Hot({searchParams}:{searchParams:Promise<Params>}){
  const p=await searchParams,tab=Object.hasOwn(tabs,p.tab||"")?p.tab as keyof typeof tabs:"latest",q=String(p.q||"").trim();
  const story=tab==="events"&&typeof p.story==="string"&&/^[\w-]{1,100}$/.test(p.story)?p.story:"";
  const latest=tab==="latest",all=latest&&p.mode==="all",category=Object.hasOwn(categories,p.category||"")?p.category:"";
  const [feed,rank]=await Promise.all([tab==="saved"?null:readFeed(tab as Section,story,{all,category,cursor:p.cursorCategory===undefined||p.cursorCategory===category?p.cursor:undefined}),latest?readFeed("events"):null]);
  const rows=tab==="saved"?savedHot(q):[],notes=new Map(rows.map(r=>[String(r.key),String(r.note)]));
  const items:HotItem[]=feed?.items||rows.map(r=>({key:String(r.key),title:String(r.title),summary:String(r.note),canonical:String(r.canonical||r.key),original:String(r.original),source:String(r.source),date:String(r.published||""),story:String(r.key).includes("/story/")?String(r.key):""}));
  const read=new Set<string>(),db=hotDb();
  try{const check=db.prepare("SELECT 1 FROM hot_read WHERE key=?"),saved=db.prepare("SELECT note FROM hot_saved WHERE key=?");for(const item of items){if(check.get(item.key))read.add(item.key);const note=saved.get(item.key);if(note)notes.set(item.key,String(note.note));}}finally{db.close();}
  const filtered=items.filter(i=>(!p.unread||!read.has(i.key))&&(tab==="saved"||(i.title+" "+i.summary).toLocaleLowerCase().includes(q.toLocaleLowerCase())));
  const groups=new Map<string,HotItem[]>();for(const i of filtered){const day=dateLabel(i.date);if(!groups.has(day))groups.set(day,[]);groups.get(day)!.push(i);}
  const query=(extra:Params)=>{const params=new URLSearchParams();for(const [k,v] of Object.entries({...p,...extra}))if(typeof v==="string"&&v)params.set(k,v);return "/hot?"+params;};
  return <main className="hot-reader"><header className="hot-mast"><div><h1>今日热点</h1><p>AIHOT <span>／</span> AI 新闻与事件进展</p></div><a href="https://aihot.news" target="_blank" rel="noreferrer">访问原站 ↗</a></header>
    <nav className="hot-tabs" aria-label="热点栏目">{Object.entries(tabs).map(([key,name])=><Link key={key} href={"/hot?tab="+key} aria-current={tab===key?"page":undefined}>{name}</Link>)}</nav>
    <div className={latest?"hot-layout":"hot-single"}>
    {latest&&<aside className="hot-ranks"><div className="hot-rank-head"><h2>当前热点</h2><Link href="/hot?tab=events">完整榜单 →</Link></div><ol>{rank?.items.slice(0,5).map((i,n)=><li key={i.key}><span>{i.rank??n+1}</span><div><Link href={storyLink(i)}>{i.title}</Link>{i.sourceCount!==undefined&&<small>{i.sourceCount} 个来源</small>}</div></li>)}</ol>{rank?.error&&<p>{rank.error} · {rank.time?"上次成功读取 "+stamp(rank.time): "暂无成功缓存"}</p>}{!rank?.items.length&&!rank?.error&&<p>当前暂无排名。</p>}</aside>}
    <div className="hot-flow"><div className="hot-heading"><h2>{latest?(all?"全部动态":"精选报道"):story?"事件报道时间线":tabs[tab]}</h2>{latest&&<div className="hot-mode"><Link aria-current={!all?"page":undefined} href={query({mode:"",cursor:""})}>精选</Link><Link aria-current={all?"page":undefined} href={query({mode:"all",cursor:""})}>全部动态</Link></div>}</div>
    {latest&&<p className="hot-range">最近 7 天 · 按发布时间排序{items.length>0&&" · 本页 "+items.length+" 条"}</p>}
    <form className="hot-filters"><input type="hidden" name="tab" value={tab}/>{all&&<input type="hidden" name="mode" value="all"/>}{story&&<input type="hidden" name="story" value={story}/>}
    <input type="search" name="q" aria-label="搜索" placeholder={tab==="saved"?"搜索收藏与备注":"搜索本页标题、摘要"} defaultValue={q}/>
    {latest&&<select aria-label="分类" name="category" defaultValue={category}><option value="">所有分类</option>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}
    {p.cursor&&<><input type="hidden" name="cursor" value={p.cursor}/><input type="hidden" name="cursorCategory" value={p.cursorCategory??category}/></>}<label><input type="checkbox" name="unread" value="1" defaultChecked={!!p.unread}/>仅未读</label><button>筛选</button></form>
    {feed&&<p className="hot-update">{feed.error&&<strong>{feed.error}。 </strong>}{feed.time?(feed.error?"上次成功读取 ":"刷新于 ")+stamp(feed.time):"暂无成功缓存"}　<a href={query({})}>{feed.error?"重试":"刷新"}</a></p>}
    {!story&&tab==="events"?filtered.map(i=><Card key={i.key} item={i} read={read.has(i.key)} note={notes.get(i.key)}/>):
    [...groups].map(([day,group])=><section className="hot-day" key={day}><h2>{day} <small>{group.length} 条</small></h2>{group.map(i=><Card key={i.key} item={i} read={read.has(i.key)} note={notes.get(i.key)}/>)}</section>)}
    {!filtered.length&&!feed?.error&&<p>{items.length?"没有符合当前筛选的条目。":latest&&!all?"最近 7 天暂无匹配的精选报道。":"当前没有条目。"}</p>}
    {feed?.cursor&&<Link className="hot-older" href={query({cursor:feed.cursor,cursorCategory:category})}>继续阅读较早报道 →</Link>}{p.cursor&&<Link className="hot-older" href={query({cursor:""})}>回到最新报道</Link>}
    </div></div></main>;
}