import {workerHeartbeat,workerTick} from "@/studio/production";
import {timingSafeEqual} from "node:crypto";
export const runtime="nodejs";
export async function POST(req:Request){
  const expected=process.env.STUDIO_WORKER_KEY??"",actual=req.headers.get("authorization")?.replace(/^Bearer /,"")??"";
  if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(actual)||!timingSafeEqual(Buffer.from(expected),Buffer.from(actual)))return new Response(null,{status:403});
  const id=req.headers.get("x-worker-id")??"";
  if(!/^[a-z0-9-]{10,80}$/.test(id))return new Response(null,{status:400});
  if(req.headers.get("x-worker-heartbeat")==="1")workerHeartbeat(id);
  else await workerTick(id);
  return Response.json({ok:true});
}
