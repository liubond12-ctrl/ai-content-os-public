import {z} from "zod";
import {approveExperiment,experimentPreview,experimentUsage,startExperiment,stopExperiment,tickExperiment} from "../../../studio/deepseek-experiment";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
function local(req:Request,write=false){const u=new URL(req.url),host=req.headers.get("host")??u.host;return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&new URL(u.protocol+"//"+host).port===u.port&&(!write||(req.headers.get("origin")===u.protocol+"//"+host&&req.headers.get("content-type")?.startsWith("application/json")));}
function view(){const p=experimentPreview();return {...p,usage:p.experiment?experimentUsage(p.experiment):null};}
export async function GET(req:Request){if(!local(req))return Response.json({error:"仅允许本机访问"},{status:403,headers});return Response.json(view(),{headers});}
export async function POST(req:Request){
 if(process.env.STUDIO_DEMO_INSTANCE==="1")return Response.json({error:"隔离验收实例仅供查看实验记录"},{status:403,headers});
 if(!local(req,true))return Response.json({error:"请从本机预检页操作"},{status:403,headers});
 const body=z.discriminatedUnion("action",[
  z.object({action:z.literal("approve"),hash:z.string().length(64),confirmation:z.string().max(80)}).strict(),
  z.object({action:z.literal("start")}).strict(),z.object({action:z.literal("stop")}).strict(),
  z.object({action:z.literal("tick"),revision:z.number().int().nonnegative()}).strict()
 ]).safeParse(await req.json().catch(()=>null));
 if(!body.success)return Response.json({error:"请求不符合实验白名单"},{status:400,headers});
 try{const b=body.data;if(b.action==="approve")approveExperiment(b.hash,b.confirmation);else if(b.action==="start")startExperiment();else if(b.action==="stop")stopExperiment();else await tickExperiment(b.revision);return Response.json(view(),{headers});}
 catch(e){return Response.json({error:e instanceof Error?e.message:"实验操作失败"},{status:409,headers});}
}
