import {timingSafeEqual} from "node:crypto";
import {mockAuthor,mockTransport,notify,receive} from "@/studio/feishu-cards";
import {liveSettings,liveTransport} from "@/studio/feishu-message-transport";
import {runCruise,dispatchCruiseReruns} from "@/studio/autopilot";
import {feishuLedger} from "@/studio/feishu";
import {flushLedger,mockLedger} from "@/studio/feishu-ledger";
export const runtime="nodejs";
export async function POST(request:Request){
  const key=process.env.FEISHU_CARD_WORKER_KEY||"",actual=request.headers.get("authorization")?.replace(/^Bearer /,"")||"";
  if(!key||Buffer.byteLength(actual)!==Buffer.byteLength(key)||!timingSafeEqual(Buffer.from(actual),Buffer.from(key)))return Response.json({error:"未授权"},{status:403});
  try{
    const body=await request.json(),mode=body.mode==="live"?"live":"mock";
    const demo=process.env.STUDIO_DEMO_INSTANCE==="1";
    if(demo&&mode==="live")return Response.json({error:"离线演练仅用模拟传输"},{status:403});
    if(body.action==="ledger"){
      const ledger=mode==="mock"?(demo?mockLedger():undefined):feishuLedger();
      if(!ledger)return Response.json({error:"台账写入权限尚未配置"},{status:403});
      await flushLedger(mode,ledger);
      return Response.json({ok:true});
    }
    const owner=mode==="live"?liveSettings().owner:mockAuthor;
    if(body.action==="callback")return Response.json({message:receive(mode,owner,body.event)});
    if(body.action!=="tick")throw Error("未知操作");
    await runCruise().catch(()=>{});
    await notify(mode,owner,mode==="live"?liveTransport():mockTransport(),String(body.link||"未确认").slice(0,40));
    dispatchCruiseReruns();
    const ledger=mode==="mock"?(demo?mockLedger():undefined):feishuLedger();
    if(ledger)await flushLedger(demo?"mock":"live",ledger);
    return Response.json({ok:true});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"未确认"},{status:409});}
}
