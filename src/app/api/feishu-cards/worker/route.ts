import {timingSafeEqual} from "node:crypto";
import {mockAuthor,mockTransport,notify,receive} from "@/studio/feishu-cards";
import {liveSettings,liveTransport} from "@/studio/feishu-message-transport";
export const runtime="nodejs";
export async function POST(request:Request){
  const key=process.env.FEISHU_CARD_WORKER_KEY||"",actual=request.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  if(!key||Buffer.byteLength(actual)!==Buffer.byteLength(key)||!timingSafeEqual(Buffer.from(actual),Buffer.from(key)))return Response.json({error:"未授权"},{status:403});
  try{
    const body=await request.json(),mode=body.mode==="live"?"live":"mock",owner=mode==="live"?liveSettings().owner:mockAuthor;
    if(body.action==="callback")return Response.json({message:receive(mode,owner,body.event)});
    if(body.action!=="tick")throw Error("未知操作");
    await notify(mode,owner,mode==="live"?liveTransport():mockTransport(),String(body.link||"未确认").slice(0,40));return Response.json({ok:true});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"未确认"},{status:409});}
}