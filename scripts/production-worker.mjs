import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
const owner=randomUUID(),root=process.env.STUDIO_WORKER_URL||"http://127.0.0.1:3588";
if(process.argv.includes("--demo"))process.env.STUDIO_WORKER_KEY=readFileSync("data-production-demo/worker.key","utf8").trim();
if(!process.env.STUDIO_WORKER_KEY)throw Error("需要 STUDIO_WORKER_KEY");
const auth={authorization:"Bearer "+process.env.STUDIO_WORKER_KEY,"x-worker-id":owner};
let heartbeatPending=false;
const heartbeat=setInterval(async()=>{
 if(stopped||heartbeatPending)return;
 heartbeatPending=true;
 try{
  await fetch(root+"/api/production/worker",{method:"POST",headers:{...auth,"x-worker-heartbeat":"1"},signal:AbortSignal.timeout(3500)});
 }catch{}finally{heartbeatPending=false;}
},4000);
heartbeat.unref();
let stopped=false;
process.on("SIGINT",()=>{stopped=true;});process.on("SIGTERM",()=>{stopped=true;});
while(!stopped){
 try{const r=await fetch(root+"/api/production/worker",{method:"POST",headers:auth,signal:AbortSignal.timeout(250000)});if(!r.ok)console.error("worker HTTP",r.status);}
 catch{console.error("服务暂不可达，保留队列，等待服务恢复");}
 await new Promise(resolve=>setTimeout(resolve,750));
}
