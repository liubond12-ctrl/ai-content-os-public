import {z} from "zod";
import {readArticles,ArticleUnavailable} from "@/studio/article-store";
import {lookup} from "@/studio/tasks";
import {control,flow,flowView,tick} from "../../../studio/collaboration";
export const runtime="nodejs";
export async function GET(req:Request){
 const params=new URL(req.url).searchParams,id=params.get("taskId")||"",headers={"Cache-Control":"no-store"};
 if(params.get("view")==="evidence"){
   const mode=lookup(id)?.input.production?.mode??null;
   try{const versions=params.get("modeOnly")==="1"?[]:readArticles(id).versions.map(({version,parentVersion,title,body,confirmed,origin,decision,revisionReviewId,restoredFrom})=>({version,parentVersion,title,body,confirmed,origin,decision,revisionReviewId,restoredFrom}));
     return Response.json({mode,versions},{headers});}catch(e){if(e instanceof ArticleUnavailable)return Response.json({mode,versions:[]},{headers});throw e;}
 }
 return Response.json(flowView(id),{headers});
}
export async function POST(req:Request){
 const u=new URL(req.url),host=req.headers.get("host")??u.host;
 if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)||new URL(u.protocol+"//"+host).port!==u.port||req.headers.get("origin")!==u.protocol+"//"+host||!req.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"请从本机工作台操作"},{status:403});
 const p=z.object({taskId:z.uuid(),action:z.enum(["start","stop","pause","resume","tick"]),expressionRules:z.boolean().optional(),revision:z.number().int().nonnegative().optional()}).strict().safeParse(await req.json().catch(()=>null));
 if(!p.success)return Response.json({error:"参数无效"},{status:400});
 if(lookup(p.data.taskId)?.input.production)return Response.json({error:"此任务由持久化队列调度，请在中控停止或重试，避免双重调度"},{status:409});
 try{const {taskId,action,revision}=p.data;if(action==="tick")await tick(taskId,revision??-1);else control(taskId,action,revision,{professional:true,expressionRules:p.data.expressionRules});if(action!=="stop"&&action!=="pause"){for(let i=0;i<40;i++){const f=flow(taskId);if(f?.state!=="ready")break;await tick(taskId,f.revision);}}return Response.json(flowView(taskId));}catch(e){return Response.json({error:String(e)},{status:409});}
}


