import {createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {resolve,basename,dirname} from "node:path";
import {references} from "./library";
import type {Task} from "./tasks";
export const cloudEndpoint="https://api.deepseek.com/chat/completions";
export function isDeepSeekEndpoint(url:string|undefined){
 return url===cloudEndpoint||url==="https://api.deepseek.com/v1/chat/completions";
}
export function cloudEnabled(){
 if(process.env.STUDIO_DEMO_INSTANCE==="1")return false;
 if(process.env.STUDIO_PRODUCTION_SCOPE==="deepseek-production")
   return isDeepSeekEndpoint(process.env.STUDIO_MODEL_URL)&&!!process.env.STUDIO_MODEL_KEY?.trim();
 return process.env.STUDIO_PRODUCTION_SCOPE==="phase1-original-fiction"&&
 process.env.STUDIO_MODEL_URL===cloudEndpoint&&
 basename(dirname(resolve(/*turbopackIgnore: true*/ process.env.STUDIO_DB||"data/studio.sqlite")))==="data-production-real-phase1";
}
export function inputHash(input:Task["input"]){return createHash("sha256").update(JSON.stringify(input)).digest("hex");}
export function assertCloudTask(task:Task){
 if(!cloudEnabled()||task.input.production?.mode!=="真实云端")throw Error("此任务不在原创虚构云端验收范围");
 if(task.input.sources?.some(s=>!references().some(r=>r.id+"@"+r.version===s&&r.allowExternal)))throw Error("资料许可已变化");
 const db=new DatabaseSync(process.env.STUDIO_DB!);
 try{
 const r=db.prepare("SELECT hash,model FROM production_cloud_grants WHERE task=?").get(task.id);
 if(!r||r.hash!==inputHash(task.input)||r.model!==process.env.STUDIO_MODEL)throw Error("云端任务范围或模型已变化，请重新预检");
 }finally{db.close();}
}
export function cloudPayload(task:Task,data:unknown){
 assertCloudTask(task);
 const json=JSON.stringify(data);
 if(/sk-[a-zA-Z0-9_-]{12,}|Bearer\s+\S+|general\/reference\/fs-/i.test(json)||(process.env.STUDIO_MODEL_KEY&&json.includes(process.env.STUDIO_MODEL_KEY)))throw Error("负载含凭证或未授权飞书资料");
 return data;
}
