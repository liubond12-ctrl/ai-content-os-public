import {Icon} from "@/components/WorkspaceIcon";
import Link from "next/link";
import {DatabaseSync} from "node:sqlite";
import {redirect} from "next/navigation";


export default async function Dashboard({searchParams,articlesOnly=false}:{articlesOnly?:boolean;searchParams:Promise<{q?:string;notice?:string;archived?:string}>}){
  const {q="",archived}=await searchParams;
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  let articles,tasks;
  const todos:{id:string;label:string;href:string}[]=[];
  try{
    db.exec("CREATE TABLE IF NOT EXISTS versions(id TEXT,rev INTEGER,payload TEXT,PRIMARY KEY(id,rev))");
    db.exec("CREATE TABLE IF NOT EXISTS archived_tasks(id TEXT PRIMARY KEY)");
    const archiveFilter=archived==="1"?"id IN (SELECT id FROM archived_tasks)":"id NOT IN (SELECT id FROM archived_tasks)";
    tasks=db.prepare("WITH ranked AS (SELECT id,payload,row_number() OVER(PARTITION BY id ORDER BY rev DESC) AS pos FROM versions) SELECT id,json_extract(payload,'$.input.topic') AS topic,json_extract(payload,'$.stage') AS stage,json_extract(payload,'$.research.questions[0]') AS gap FROM ranked WHERE pos=1 AND "+archiveFilter+" AND json_extract(payload,'$.article') IS NULL AND instr(json_extract(payload,'$.input.topic'),?)>0 ORDER BY topic").all(q);
    const snapshots=db.prepare("SELECT name FROM sqlite_master WHERE name='article_snapshots'").get();
    const union=snapshots?" UNION ALL SELECT task_id,version,json_extract(payload,'$.title'),json_extract(payload,'$.confirmed'),json_extract(payload,'$.createdAt'),json_extract(payload,'$.body') FROM article_snapshots":"";
    articles=db.prepare("WITH heads AS (SELECT id,rev,json_extract(payload,'$.article.title') AS title,0 AS confirmed,json_extract(payload,'$.records[#-1].ended') AS updated,json_extract(payload,'$.article.body') AS body FROM versions WHERE json_extract(payload,'$.article.version')=rev"+union+"), ranked AS (SELECT *,row_number() OVER(PARTITION BY id ORDER BY rev DESC) AS pos FROM heads) SELECT id,title,rev,confirmed,updated,substr(body,1,60) AS excerpt,(SELECT json_extract(v.payload,'$.article.model') FROM versions v WHERE v.id=ranked.id AND json_extract(v.payload,'$.article.model') IS NOT NULL ORDER BY v.rev DESC LIMIT 1) AS model FROM ranked WHERE pos=1 AND "+archiveFilter+" AND instr(title,?)>0 ORDER BY updated DESC,rev DESC,id").all(q);
    if(!articlesOnly&&archived!=="1"){
      const reviews=db.prepare("SELECT 1 FROM sqlite_master WHERE name='reviews'").get()
        ?db.prepare("SELECT id,payload FROM reviews WHERE task=? AND article=? ORDER BY version DESC LIMIT 1"):null;
      for(const article of articles){
        if(article.confirmed)continue;
        const href="/studio/editor?taskId="+article.id+"&version="+article.rev;
        const row=reviews?.get(article.id,article.rev);
        const review=row&&JSON.parse(String(row.payload));
        const claim=review?.result?.facts?.checks?.find((c:{critical:boolean;status:string})=>c.critical&&c.status!=="来源原文匹配");
        const issue=review?.result?.issues?.[0];
        todos.push({id:String(article.id),label:article.title+" · v"+article.rev+" · "+(claim?"缺少依据："+claim.quote+" · 查看待核实原句":issue?issue.reason+" · 处理原句":"尚未定稿 · 核对正文并确认"),href:href+(claim||issue?"&review="+row!.id+(claim?"&claim="+review.result.facts.checks.indexOf(claim):"&issue=0"):"")});
      }
      for(const task of tasks)if(task.stage==="blocked"&&task.gap)todos.push({id:String(task.id),label:task.topic+" · "+task.gap+" · 补充资料",href:"/studio?taskId="+task.id+"#gap"});
    }
  }finally{db.close();}
  async function toggleArchive(form:FormData){
    "use server";
    const id=String(form.get("id"));if(!/^[a-f0-9-]{36}$/i.test(id))return;
    const d=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
    try{if(form.get("restore")==="yes")d.prepare("DELETE FROM archived_tasks WHERE id=?").run(id);
      else d.prepare("INSERT OR IGNORE INTO archived_tasks SELECT id FROM versions WHERE id=? LIMIT 1").run(id);
    }finally{d.close();}
    redirect(articlesOnly?"/articles":"/");
  }
  const archiveView=archived==="1";
  const archiveButton=(id:string)=><form action={toggleArchive}><input type="hidden" name="id" value={id}/><input type="hidden" name="restore" value={archiveView?"yes":"no"}/><button className="quiet">{archiveView?"恢复":"归档"}</button></form>;
  const listPath=articlesOnly?"/articles":"/";
  return <main className="dashboard"><header className="mast"><h1>{articlesOnly?"我的文章":"创作工作台"}</h1>{!articlesOnly&&<Link href="/examples">查看验收示例</Link>}</header>
    {!articlesOnly&&<section><div className="sectionHead"><h2>新建创作</h2></div>
    <form className="composer" action="/studio"><label htmlFor="idea">创作需求</label><input id="idea" name="topic" maxLength={240} required placeholder="今天想创作什么内容？"/><div className="composeBar"><span className="hint">下一步可设置受众、形式与参考资料</span><button className="primary">新建创作　→</button></div></form></section>}
    {!articlesOnly&&!archiveView&&<section><h2>待我决定</h2>{todos.length?todos.map(t=><p key={t.id}><a href={t.href}>{t.label}</a></p>):<p>暂无待决定事项。</p>}</section>}
    <section id="articles"><div className="sectionHead"><h2>{archiveView?"已归档文章":"最近文章"} <small>{articles.length}</small></h2><Link href={archiveView?listPath+"#articles":listPath+"?archived=1#articles"}>{archiveView?"返回当前文章":"查看归档"} ›</Link></div>
    <div className="list"><form className="search" action={listPath+"#articles"}>{archiveView&&<input type="hidden" name="archived" value="1"/>}<Icon type="search"/><input type="search" name="q" aria-label="按文章标题查找" placeholder="搜索文章标题" defaultValue={q}/><button>查找</button></form>
    {articles.map(a=><article key={String(a.id)}><span className="paper"><Icon type="doc"/></span><div className="item"><Link href={"/studio/editor?taskId="+a.id}>{String(a.title)}</Link><p>{String(a.excerpt)}</p><div className="meta">{/模拟|fixture|mock/i.test(String(a.model))?"模拟示例 · ":""}{a.updated?new Date(String(a.updated)).toLocaleString("zh-CN"):"时间未记录"} · <span>{a.confirmed?"已定稿":"未定稿"}</span> v{String(a.rev)}</div></div><div className="actions"><Link href={"/studio/editor?taskId="+a.id}>{a.confirmed?"查看定稿":"继续编辑"} →</Link>{archiveButton(String(a.id))}</div></article>)}{!articles.length&&<p className="empty">没有匹配的文章。</p>}</div></section>
    {!articlesOnly&&<details className="tasks"><summary>{archiveView?"已归档待处理任务":"待处理任务"} <small>{tasks.length}</small></summary>{tasks.map(t=><article key={String(t.id)}><div className="item"><Link href={"/studio?taskId="+t.id}>{String(t.topic)}</Link><div className="meta">{t.stage==="blocked"?"需要补充资料或核实执行结果":"继续准备"}</div></div>{archiveButton(String(t.id))}</article>)}{!tasks.length&&<p className="empty">暂无待处理任务。</p>}</details>}
  </main>;
}
