import {z} from "zod";
import {openContent,similar} from "@/studio/content-index";
import {readArticles} from "@/studio/article-store";
import {registerPublication} from "@/studio/calibration";
export const runtime="nodejs";
export function GET(req:Request){
  const p=new URL(req.url).searchParams;
  if(p.has("topic"))return Response.json(similar((p.get("topic")||"").trim().slice(0,240),p.get("exclude")||""));
  const db=openContent();
  try{
    if(p.has("task")){
      const task=p.get("task")!;
      const origin=db.prepare("SELECT 1 FROM sqlite_master WHERE name='hot_origins'").get()
        ?db.prepare("SELECT title,source,original,canonical FROM hot_origins WHERE task=?").get(task):null;
      return Response.json({origin,history:db.prepare("SELECT * FROM content_destinations WHERE id=? ORDER BY version DESC").all(task),
        notes:db.prepare("SELECT * FROM content_lessons WHERE task=? ORDER BY rowid DESC").all(task),
        series:db.prepare("SELECT series FROM content_notes WHERE id=?").get(task)?.series||"",
        account:db.prepare("SELECT account FROM content_heads WHERE id=?").get(task)?.account||""});
    }
    return Response.json(db.prepare("SELECT * FROM content_lessons WHERE (scope='账号' AND account=? AND account<>'') OR (scope='专题' AND series=? AND series<>'') ORDER BY rowid DESC").all(p.get("account")||"",p.get("series")||""));
  }finally{db.close();}
}
const base={task:z.uuid(),version:z.number().int().positive()};
const input=z.discriminatedUnion("action",[
  z.object({...base,action:z.literal("destination"),status:z.enum(["待发布","已发布","暂不采用"]),day:z.union([z.literal(""),z.iso.date()]),url:z.union([z.literal(""),z.url({protocol:/^https?$/})]),publishedAt:z.iso.datetime({offset:true}).optional()}),
  z.object({...base,action:z.literal("lesson"),previous:z.number().int().positive(),before:z.string().max(4000),after:z.string().max(4000),reason:z.string().trim().min(1).max(2000),scope:z.enum(["账号","专题"]),series:z.string().trim().max(100)})
]);
export async function POST(req:Request){
  const host=req.headers.get("host");
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host||"")||req.headers.get("origin")!=="http://"+host)return Response.json({error:"请从本机工作台操作"},{status:403});
  try{
    const v=input.parse(await req.json()),articles=readArticles(v.task).versions,current=articles.find(a=>a.version===v.version);
    if(!current)throw Error("正式版本不存在");
    const db=openContent();
    try{
      if(v.action==="destination"){
        if(!current.confirmed)throw Error("只能登记已定稿版本");
        db.exec("BEGIN IMMEDIATE");
        if(v.status==="已发布")registerPublication(db,v,v.publishedAt,v.day);
        db.prepare("INSERT OR REPLACE INTO content_destinations VALUES(?,?,?,?,?)").run(v.task,v.version,v.status,v.day,v.url);
        db.exec("COMMIT");
      }else{
        const prev=articles.find(a=>a.version===v.previous&&a.version<v.version);
        if(!prev||v.before===v.after||!(prev.body.includes(v.before)||prev.title.includes(v.before))||!(current.body.includes(v.after)||current.title.includes(v.after)))throw Error("请核对两个正式版本的原文与修改");
        const account=String(db.prepare("SELECT account FROM content_heads WHERE id=?").get(v.task)?.account||"");
        if(v.scope==="账号"&&!account||v.scope==="专题"&&!v.series)throw Error("请指定专题或使用有归属账号的稿件");
        const series=v.scope==="专题"?v.series:"";
        const result=db.prepare("INSERT INTO content_lessons VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(crypto.randomUUID(),v.task,account,series,v.previous,v.version,v.before,v.after,v.reason,v.scope);
        if(!result.changes)return Response.json({message:"这处修改已记录"});
      }
      return Response.json({message:"已保存"});
    }finally{db.close();}
  }catch(e){return Response.json({error:e instanceof Error?e.message:"保存失败"},{status:400});}
}
