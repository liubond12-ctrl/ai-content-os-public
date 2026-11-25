import {workOverview,workTaskSnapshot} from "@/studio/work-overview";
export const runtime="nodejs";
export function GET(req:Request){
  const id=new URL(req.url).searchParams.get("task");
  const data=id?workTaskSnapshot(id):workOverview();
  return Response.json(data??{error:"任务不存在"},{status:data?200:404,headers:{"Cache-Control":"no-store"}});
}
