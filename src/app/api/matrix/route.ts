import {productionDb,entities} from "@/studio/production-db";
import {articleStateInTransaction,ensureArticleTables,ArticleUnavailable} from "@/studio/article-store";
import {topicKey} from "@/studio/matrix";
import type {Task} from "@/studio/tasks";

export const runtime="nodejs";
export function GET(request:Request){
  const p=new URL(request.url).searchParams,query=topicKey((p.get("q")??"").slice(0,240));
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.get("host")??new URL(request.url).host))
    return Response.json({error:"请从本机访问"},{status:403});
  const db=productionDb();
  try{
    ensureArticleTables(db);
    const accounts=entities(db,"account").map(row=>({id:String(row.id),name:String(row.name)}));
    const tasks=db.prepare("SELECT v.payload FROM production_queue q JOIN versions v ON v.id=q.task AND v.rev=(SELECT max(rev) FROM versions WHERE id=q.task) ORDER BY q.updated DESC").all()
      .map(row=>JSON.parse(String(row.payload)) as Task).filter(task=>task.input.production?.account);
    if(p.has("task")){
      const task=tasks.find(row=>row.id===p.get("task"));
      if(!task)return Response.json({error:"稿件不存在"},{status:404});
      return Response.json({versions:articleStateInTransaction(db,task.id).versions.map(row=>({version:row.version,title:row.title,body:row.body,confirmed:row.confirmed})),
        trace:task.assemblyTrace??null});
    }
    const groups=new Map<string,typeof tasks>();
    for(const task of tasks){
      if(!task.article)continue;
      const key=topicKey(task.input.topic);
      const group=groups.get(key)??[];
      group.push(task);groups.set(key,group);
    }
    const rows=[...groups.values()].filter(group=>new Set(group.map(task=>task.input.production!.account)).size>=2&&
      (!query||topicKey(group[0].input.topic).includes(query))).slice(0,60).map(group=>({topic:group[0].input.topic,
        tasks:group.map(task=>({id:task.id,account:task.input.production!.account,name:task.input.production!.accountName,title:task.article?.title}))}));
    return Response.json({groups:rows,accounts,traces:tasks.filter(task=>task.assemblyTrace&&(!p.has("account")||task.input.production?.account===p.get("account")))
      .slice(0,45).map(task=>({id:task.id,title:task.input.topic,trace:task.assemblyTrace}))},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    return Response.json({error:error instanceof ArticleUnavailable?error.message:"暂时无法读取矩阵记录"},{status:409});
  }finally{db.close();}
}
