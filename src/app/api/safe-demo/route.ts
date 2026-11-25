import {z} from "zod";
import {create,lookup} from "../../../studio/tasks";
import {safeInput,preflight} from "../../../studio/safe-demo";
export async function POST(req:Request){
  const parsed=z.object({scenario:z.enum(["expression","missing","followup","limited-writing"])}).strict().safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"仅支持固定脱敏场景"},{status:400});
  return Response.json(create(safeInput(parsed.data.scenario)),{status:201});
}
export async function GET(req:Request){
  const id=new URL(req.url).searchParams.get("id");
  const task=id?lookup(id):{input:safeInput("expression")};
  if(!task)return Response.json({error:"任务不存在"},{status:404});
  try{return Response.json(preflight(task as Parameters<typeof preflight>[0]));}
  catch{return Response.json({error:"安全预检失败，资料归属不明确或不是测试环境"},{status:403});}
}
