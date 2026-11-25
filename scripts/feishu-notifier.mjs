import {callbackDispatcher} from "./feishu-card-socket.mjs";
import {WSClient} from "@larksuiteoapi/node-sdk";
const ledgerOnly=process.argv.includes("--ledger-only");
const mode=process.argv.includes("--live")||ledgerOnly?"live":"mock";
if(process.env.STUDIO_DEMO_INSTANCE==="1"&&mode==="live")throw Error("离线演练仅启动模拟通知");
const base=new URL(process.env.FEISHU_CARD_WORKBENCH||"http://127.0.0.1:3590");
if(base.hostname!=="127.0.0.1"&&!["localhost","[::1]"].includes(base.hostname))throw Error("通知进程只连接本机工作台");
const key=process.env.FEISHU_CARD_WORKER_KEY;
if(!key)throw Error("需要本机 FEISHU_CARD_WORKER_KEY");
async function call(data,timeout){
  const r=await fetch(new URL("/api/feishu-cards/worker",base),{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({mode,...data}),signal:AbortSignal.timeout(timeout)});
  const value=await r.json();if(!r.ok)throw Error(value.error||"工作台未确认");return value;
}
let socket;
if(mode==="live"&&!ledgerOnly){
  const {FEISHU_CARD_APP_ID:appId,FEISHU_CARD_APP_SECRET:appSecret,FEISHU_CARD_OWNER:owner}=process.env;
  if(process.env.FEISHU_CARD_LIVE_APPROVED!=="1"||!appId||!appSecret||!owner?.startsWith("ou_"))throw Error("真实私聊需确认应用和指定接收者");
  const dispatcher=callbackDispatcher(call);
  socket=new WSClient({appId,appSecret});await socket.start({eventDispatcher:dispatcher});
}
let stopping=false;
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>{stopping=true;socket?.close();});
while(!stopping){
  try{await call({action:ledgerOnly?"ledger":"tick",link:socket?.getConnectionStatus().state??"模拟传输"},60000);}catch{console.error("工作台未确认后台处理，稍后重连。");}
  if(!stopping)await new Promise(r=>setTimeout(r,3000));
}
