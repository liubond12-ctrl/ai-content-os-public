import {z} from "zod";
import {advance,startLocalWriting,brief,create,lookup} from "../../../studio/tasks";
import {ArticleUnavailable,readArticles} from "../../../studio/article-store";
import {DatabaseSync} from "node:sqlite";
export async function GET(req:Request){
  const params=new URL(req.url).searchParams;
  const task=lookup(params.get("id")??"",params.has("version")?Number(params.get("version")):undefined);
  if(task&&params.get("detail")==="1"&&!params.has("version")){
    let article=null;
    try{
      const head=readArticles(task.id).head;
      const {title,body,version,confirmed,researchVersion,citations,reviewLabel}=head;
      article={title,body,version,confirmed,researchVersion,citations,reviewLabel};
    }catch(error){if(!(error instanceof ArticleUnavailable))throw error;}
    let queueStatus:string|undefined,queueReason:string|undefined;
    if(task.input.production&&!article?.confirmed){
      const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite",{readOnly:true});
      try{
        db.exec("PRAGMA busy_timeout=5000");
        if(db.prepare("SELECT 1 FROM sqlite_master WHERE name='production_queue'").get()){
          const row=db.prepare("SELECT status,reason FROM production_queue WHERE task=?").get(task.id);
          if(typeof row?.status==="string")queueStatus=row.status;
          if(typeof row?.reason==="string")queueReason=row.reason;
        }
      }
      finally{db.close();}
    }
    return Response.json({...task,detail:{article,status:article?.confirmed?"已定稿":queueStatus,reason:queueReason}});
  }
  return Response.json(task??{error:"任务或版本不存在"},{status:task?200:404});
}
export async function POST(req:Request){
  const input=await req.json().catch(()=>null);
  const local=z.object({localWrite:z.literal(true),id:z.uuid(),revision:z.number().int()}).strict().safeParse(input);
  if(local.success){
    const host=req.headers.get("host")??new URL(req.url).host;
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)||req.headers.get("origin")!=="http://"+host)return Response.json({error:"请从本机工作台开始写作"},{status:403});
    try{return Response.json(startLocalWriting(local.data.id,local.data.revision));}
    catch(e){return Response.json({error:e instanceof Error?e.message:"无法开始写作"},{status:409});}
  }
  const next=z.object({id:z.uuid(),revision:z.number().int().nonnegative()}).strict().safeParse(input);
  if(next.success){
    const task=await advance(next.data.id,next.data.revision);
    return Response.json(task??{error:"任务不存在"},{status:task?200:404});
  }
  const parsed=brief.safeParse(input);
  if(!parsed.success)return Response.json({error:"请检查账号、主题、字数和检索模式。"},{status:400});
  try{return Response.json(create(parsed.data),{status:201});}
  catch{return Response.json({error:"任务不符合测试环境资料限制"},{status:403});}
}

