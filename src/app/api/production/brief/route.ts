import {z} from "zod";
import {contentList} from "@/studio/content-index";
import {productionDb} from "@/studio/production-db";

export const runtime="nodejs";
export async function GET(req:Request){
  const params=new URL(req.url).searchParams;
  if(params.has("account")){
    const account=params.get("account")||"";
    if(!account)return Response.json([]);
    const {rows}=contentList(new URLSearchParams({account,q:(params.get("q")||"").slice(0,240)}));
    return Response.json(rows.filter(r=>Number(r.version)>0).map(r=>({id:r.id,title:r.title,version:r.version})),{headers:{"Cache-Control":"no-store"}});
  }
  const task=z.uuid().safeParse(params.get("task"));
  if(!task.success)return Response.json({error:"稿件编号无效"},{status:400});
  const db=productionDb();
  try{
    const record=db.prepare("SELECT payload FROM production_brief_records WHERE task=?").get(task.data);
    return Response.json(record?{
      brief:JSON.parse(String(record.payload)),
      suggestions:db.prepare("SELECT key,label,state FROM production_supplements WHERE task=? ORDER BY rowid").all(task.data),
      notes:db.prepare("SELECT body,created FROM production_task_notes WHERE task=? ORDER BY created,id").all(task.data),
    }:null,{headers:{"Cache-Control":"no-store"}});
  }finally{db.close();}
}

const action=z.discriminatedUnion("action",[
  z.object({action:z.literal("suggestion"),task:z.uuid(),key:z.enum(["ending","title"]),state:z.enum(["added","skipped"])}),
  z.object({action:z.literal("note"),task:z.uuid(),id:z.uuid(),note:z.string().trim().min(1).max(600)}),
]);
export async function POST(req:Request){
  const host=req.headers.get("host");
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host??"")||req.headers.get("origin")!=="http://"+host)return Response.json({error:"请从本机工作台操作"},{status:403});
  const result=action.safeParse(await req.json().catch(()=>null));
  if(!result.success)return Response.json({error:"补充内容无效"},{status:400});
  const data=result.data,db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    if(!db.prepare("SELECT task FROM production_brief_records WHERE task=?").get(data.task))return Response.json({error:"任务不存在"},{status:404});
    if(data.action==="note")db.prepare("INSERT OR IGNORE INTO production_task_notes VALUES(?,?,?,?)").run(data.task,data.id,data.note,new Date().toISOString());
    else db.prepare("UPDATE production_supplements SET state=? WHERE task=? AND key=? AND state='pending'").run(data.state,data.task,data.key);
    db.exec("COMMIT");
    return Response.json({ok:true});
  }finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
