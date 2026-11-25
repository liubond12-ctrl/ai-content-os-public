import Link from "next/link";
import {reviewHref} from "@/studio/article-navigation";
import {RestoreArticlePosition} from "@/components/RestoreArticlePosition";
import {workOverview} from "@/studio/work-overview";
import {TaskLink} from "@/components/Cockpit";
export const dynamic="force-dynamic";
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
  const params=await searchParams;
  const data=workOverview({...params,page:Number(params.page)||1,list:true});
  const pages=Math.max(1,Math.ceil(data.matched/data.size));
  const href=(page:number)=>{const q=new URLSearchParams();for(const key of ["q","status","account","batch"])if(params[key])q.set(key,params[key]!);q.set("page",String(page));return "/production/tasks?"+q;};
  return <main className="production"><h1>全部任务</h1><p>当前条件共 {data.matched} 条，每页最多 {data.size} 条。历史和未完成任务均可查找。</p>
    <form className="filters"><label>稿件标题或选题<input name="q" defaultValue={params.q}/></label><label>账号名称<input name="account" defaultValue={params.account}/></label>
    <label>状态<select name="status" defaultValue={params.status||""}><option value="">全部状态</option><option value="todo">待我处理</option><option value="active">活跃生产</option>{["排队","整理资料","生成","审核","修订","待人工审核","受阻","失败","已停止","已定稿"].map(s=><option key={s}>{s}</option>)}</select></label>
    {params.batch&&<input type="hidden" name="batch" value={params.batch}/>}<button>搜索</button><Link href="/production/tasks">清除筛选</Link></form>
    <div className="queue-list" id="task-results" tabIndex={-1}><RestoreArticlePosition prefix="task-" fallback="task-results"/>{data.rows.map(t=><article id={"task-"+t.id} tabIndex={-1} key={t.id}><div><span className="status-pill">{t.status}</span><h2>{t.title||t.topic}</h2><p>{t.production?.accountName||"自由创作"} · {new Date(t.updated).toLocaleString("zh-CN")}</p><p>{t.reason}</p></div><div className="actions"><TaskLink task={t} source={href(data.page)+"#task-"+t.id}/>{t.version&&<Link href={reviewHref(t.id,href(data.page)+"#task-"+t.id,{discussion:"1"})+"#task-discussion"}>查看审核争议 →</Link>}</div></article>)}</div>
    {!data.rows.length&&<p>{params.status==="todo"&&!data.todoCount?"当前没有待处理的任务。":data.total?"没有符合筛选条件的任务，请调整筛选。":"还没有提交过生产任务。"}</p>}
    <nav aria-label="任务分页">{data.page>1&&<Link href={href(data.page-1)}>上一页</Link>}<span>第 {data.page} / {pages} 页</span>{data.page<pages&&<Link href={href(data.page+1)}>下一页</Link>}</nav>
    <p><Link href="/">返回首页</Link> · <Link href="/production/queue">进入历史批次与队列操作</Link></p>
  </main>;
}
