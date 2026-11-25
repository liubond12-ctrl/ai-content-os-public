import {z} from "zod";
import {cruisePolicy} from "@/types/autopilot";
import {cruiseDay,getCruisePolicy,morning,runCruise,saveCruisePolicy} from "@/studio/autopilot";
import {cardDb,mockAuthor,receive,type Card} from "@/studio/feishu-cards";
import {ledgerRows,setLedgerSchedule} from "@/studio/feishu-ledger";
import {productionView,saveEntity} from "@/studio/production";
import {isLocalArticleWrite} from "@/studio/local-article-request";
import {automationPolicy} from "@/types/readiness";
import {budgetSnapshot,getAutomationPolicy,setAutomationPolicy} from "@/studio/readiness-budget";

export const runtime="nodejs";
const daySchema=z.iso.date();
const action=z.discriminatedUnion("action",[
  z.object({action:z.literal("policy"),policy:cruisePolicy}).strict(),
  z.object({action:z.literal("automation"),policy:automationPolicy}).strict(),
  z.object({action:z.literal("run")}).strict(),
  z.object({action:z.literal("decision"),card:z.uuid(),message:z.string().min(1).max(160),decision:z.enum(["approve","rerun"])}).strict(),
  z.object({action:z.literal("schedule"),taskId:z.uuid(),version:z.number().int().positive(),at:z.iso.datetime().nullable()}).strict(),
]);
const demo=()=>process.env.STUDIO_DEMO_INSTANCE==="1";
function snapshot(day:string){
  const db=cardDb();
  try{
    const cards=demo()?db.prepare("SELECT id,message,card,result,delivery FROM fs_outbox WHERE mode='mock' AND owner=? AND json_extract(card,'$.day')=? ORDER BY rowid").all(mockAuthor,day)
      .map(row=>({id:String(row.id),message:String(row.message),card:JSON.parse(String(row.card)) as Card,result:String(row.result),delivery:String(row.delivery)})):[];
    const policy=getCruisePolicy(db);
    const morningView=morning(db,day);
    const reruns=db.prepare("SELECT task,batch,status FROM cruise_reruns WHERE day=?").all(day);
    const automation=getAutomationPolicy(db);
    const screens=db.prepare("SELECT title,score FROM cruise_match_scores WHERE day=? ORDER BY rowid").all(day);
    return {day,demo:demo(),policy,automation,budget:budgetSnapshot(db,day),screens,...morningView,cards,ledger:ledgerRows(db),reruns};
  }finally{db.close();}
}
export async function GET(request:Request){
  const day=daySchema.safeParse(new URL(request.url).searchParams.get("day")??cruiseDay());
  if(!day.success)return Response.json({error:"日期无效"},{status:400});
  return Response.json(snapshot(day.data),{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request){
  if(!isLocalArticleWrite(request))return Response.json({error:"请从本机工作台操作"},{status:403});
  const parsed=action.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message||"请求无效"},{status:400});
  const input=parsed.data;
  try{
    if(input.action==="policy")saveCruisePolicy(input.policy);
    if(input.action==="automation")setAutomationPolicy(input.policy);
    if(input.action==="run"){
      const view=productionView(true);
      if(!view.workerOnline)throw Error("请先启动生产后台。");
      if(demo()&&!view.accounts.some(row=>row.id==="cruise-demo-writing"))
        saveEntity("account",{id:"cruise-demo-writing",name:"离线写作校样演练",body:"写作、校样、改稿",platform:"小红书",status:"启用",version:0});
      await runCruise(new Date(),true);
    }
    if(input.action==="decision"){
      if(!demo())return Response.json({error:"模拟翻牌仅限离线演练实例"},{status:403});
      const db=cardDb();
      try{
        if(!db.prepare("SELECT 1 FROM fs_outbox WHERE id=? AND mode='mock' AND json_extract(card,'$.kind')='morning-item'").get(input.card))
          throw Error("早报卡片不存在");
      }finally{db.close();}
      receive("mock",mockAuthor,{operator:{open_id:mockAuthor},context:{open_message_id:input.message},action:{value:{decision:input.card,action:input.decision}}});
    }
    if(input.action==="schedule"){
      const db=cardDb();
      try{setLedgerSchedule(db,input.taskId,input.version,input.at);}finally{db.close();}
    }
    return Response.json(snapshot(cruiseDay()));
  }catch(error){return Response.json({error:error instanceof Error?error.message:"巡航操作失败"},{status:409});}
}
