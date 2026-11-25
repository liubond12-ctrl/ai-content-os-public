import {references,importCase,removeReference,findMethods,formats,methodIndex} from "../../../studio/library";
import {z} from "zod";
export async function GET(req?:Request){
  const p=new URL(req?.url??"http://localhost").searchParams;
  const rows=references().filter(c=>(!p.get("tag")||c.tags.includes(p.get("tag")!))&&(!p.get("goal")||c.goal===p.get("goal"))&&(!p.get("format")||c.format===p.get("format")));
  const q=p.get("q")?.trim();
  if(!q)return Response.json(rows);
  const mode=z.enum(["keyword","semantic","hybrid"]).safeParse(p.get("mode")??"keyword");
  if(!mode.success)return Response.json({error:"无效检索方式"},{status:400});
  const allowed=new Set(rows.map(c=>"general/reference/"+c.id+"/v"+c.version));
  const ranked=await findMethods({topic:q,format:formats.safeParse(p.get("format")).data,audience:"",goal:p.get("goal")??""},q,mode.data,
    {chunks:methodIndex().chunks.filter(c=>allowed.has(c.id))});
  const ids=ranked.hits.map(h=>h.id.split("/")[2]);
  return Response.json(rows.filter(c=>ids.includes(c.id)||[c.title,c.content,c.method,...c.tags].join(" ").includes(q)).sort((a,b)=>(ids.includes(a.id)?ids.indexOf(a.id):99)-(ids.includes(b.id)?ids.indexOf(b.id):99)));
}
export async function DELETE(req:Request){
  if(req.headers.get("origin") && req.headers.get("origin")!==new URL(req.url).origin)return Response.json({error:"拒绝跨域删除"},{status:403});
  const p=new URL(req.url).searchParams;
  try{removeReference(p.get("id")??"",Number(p.get("version")));return Response.json({removed:true});}
  catch{return Response.json({error:"版本冲突或案例不存在"},{status:409});}
}
export async function POST(req:Request){
  if(req.headers.get("origin") && req.headers.get("origin")!==new URL(req.url).origin)
    return Response.json({error:"仅接受本机同源导入"},{status:403});
  try{return Response.json(importCase(await req.json(),"reference"),{status:201});}
  catch{return Response.json({error:"请检查案例字段、ID、版权声明与版本唯一性"},{status:400});}
}
