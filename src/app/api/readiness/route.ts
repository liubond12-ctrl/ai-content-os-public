import {isLocalArticleWrite} from "@/studio/local-article-request";
import {systemDoctor} from "@/studio/doctor";
import {todayTasks} from "@/studio/readiness-home";
import {readinessEvaluation} from "@/studio/readiness-evaluation";

export const runtime="nodejs";
export function GET(request:Request){
  const url=new URL(request.url);
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.get("host")??url.host))
    return Response.json({error:"请从本机访问"},{status:403});
  return Response.json(url.searchParams.has("evaluation")?readinessEvaluation():todayTasks(),{headers:{"Cache-Control":"no-store"}});
}
let busy=false;
export async function POST(request:Request){
  if(!isLocalArticleWrite(request))return Response.json({error:"请从本机操作"},{status:403});
  if(busy)return Response.json({error:"探活正在运行"},{status:409});
  busy=true;
  try{return Response.json(await systemDoctor(),{headers:{"Cache-Control":"no-store"}});}
  catch{return Response.json({error:"无法完成就绪检查，请核对本机配置"}, {status:503});}
  finally{busy=false;}
}
