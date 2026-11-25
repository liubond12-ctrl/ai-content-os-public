import {z} from "zod";
import {lightRoute,routePlan} from "./model-routing";
import {cardDb,prefs} from "./feishu-cards";
import {feishuLedger} from "./feishu";
import type {DoctorCheck} from "../types/readiness";

const loopback=/^http:\/\/127\.0\.0\.1(?::\d+)?\/(?!\/)[^@?#\\\s]*$/;
async function probeModel(name:string,plan:ReturnType<typeof routePlan>|undefined,request:typeof fetch):Promise<DoctorCheck>{
  const next="核对模型 ID、127.0.0.1 URL 与服务端口；启动本机模型后重测。";
  if(!plan?.model)return {name,status:"未配置",basis:"启动配置",detail:"缺少模型 ID 或轻量地址。",next};
  if(!loopback.test(plan.url))return {name,status:"待授权验证",basis:"目标配置",detail:"远端请求属于单独的授权联调。",next:"在批准的工作台生产入口核对模型回执。"};
  try{
    const result=await request(plan.url,{method:"POST",headers:{"Content-Type":"application/json"},redirect:"error",signal:AbortSignal.timeout(4500),
      body:JSON.stringify({model:plan.model,stream:false,max_tokens:32,messages:[{role:"system",content:"返回 JSON {ok:true}。"},
        {role:"user",content:JSON.stringify({probe:"local-readiness"})}]})});
    const wire=z.object({model:z.string(),choices:z.array(z.object({message:z.object({content:z.string()})})).min(1)}).parse(await result.json());
    if(!result.ok||wire.model!==plan.model)throw Error("模型回执不匹配");
    return {name,status:"通过",basis:"本机 HTTP 推理回执",detail:"模型 ID 匹配，返回了消息。",next:""};
  }catch{return {name,status:"异常",basis:"本机 HTTP 探活",detail:"无响应、需要认证或返回模型不匹配。",next};}
}
async function pythonBge(request:typeof fetch):Promise<DoctorCheck>{
  const name="本地 Python BGE",url=process.env.STUDIO_PYTHON_BGE_HEALTH??"";
  const next="配置 STUDIO_PYTHON_BGE_HEALTH 为本机健康端点，返回 ready 与 backend=bge。当前内置检索可使用本机 ONNX。";
  if(!url)return {name,status:"未配置",basis:"启动配置",detail:"当前没有 Python BGE 健康端点。",next};
  if(!loopback.test(url))return {name,status:"异常",basis:"地址检查",detail:"仅支持本机 127.0.0.1。",next};
  try{
    const response=await request(url,{redirect:"error",signal:AbortSignal.timeout(3500)});
    if(!response.ok||!z.object({ready:z.literal(true),backend:z.literal("bge")}).safeParse(await response.json()).success)throw Error("未就绪");
    return process.env.STUDIO_DEMO_INSTANCE==="1"?{name,status:"模拟",basis:"本机替身健康回执",detail:"已收到模拟就绪响应。",next:""}:
      {name,status:"通过",basis:"本机 Python 健康回执",detail:"已收到 BGE 就绪响应。",next:""};
  }catch{return {name,status:"异常",basis:"本机 HTTP 健康探测",detail:"服务无响应或尚未加载嵌入模型。",next};}
}
export async function systemDoctor(request:typeof fetch=fetch):Promise<DoctorCheck[]>{
  const demo=process.env.STUDIO_DEMO_INSTANCE==="1";
  const db=cardDb();let ws:ReturnType<typeof prefs>;
  try{ws=prefs(db,demo?"mock":"live");}finally{db.close();}
  const results=await Promise.all([probeModel("主模型",routePlan("default"),request),probeModel("轻量模型",lightRoute("default"),request),pythonBge(request)]);
  const socket=ws.online&&["connected","open","ready"].includes(ws.link.toLowerCase());
  let validLedger=false;
  try{validLedger=!demo&&!!feishuLedger();}catch{}
  return [...results,
    {name:"飞书 WebSocket",status:demo?"模拟":socket?"通过":ws.online?"待授权验证":"异常",basis:"通知进程心跳",
      detail:demo?(ws.online?"本机模拟通知在线。":"模拟通知未启动。"):socket?"近期心跳报告已连接。":"缺少可确认的真实联机状态。",
      next:"核对通知进程、长连接模式与已批准的接收人，再刷新状态。"},
    {name:"im:message:update",status:demo?"模拟":"待授权验证",basis:demo?"本机模拟传输":"配置与历史证据",detail:demo?"仅支持本机卡片更新。":"本次没有查询真实权限或更新远端消息。",
      next:"管理员在飞书开放平台确认应用权限与发布状态；授权后在测试会话更新一张测试卡。"},
    {name:"飞书多维表写入",status:demo?"模拟":validLedger?"待授权验证":"未配置",basis:"独立写入配置",
      detail:demo?"写入本机模拟表。":validLedger?"写入配置已通过格式校验；实际写权限待验证。":"写入配置不完整或格式无效。",
      next:"检查专用写入授权、目标表及七列映射；授权后单独在测试表核对回执。"},
  ];
}
