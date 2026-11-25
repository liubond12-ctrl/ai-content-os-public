import {productionBudget} from "./production-schema";
import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import type {Task} from "./tasks";
import type {ModelReceipt} from "./provider";
export const OUTPUT_LIMIT=800;
const REQUEST_LIMIT=6;
export const TASK_LIMIT=20_000;
export class BudgetError extends Error {}
export interface CallRecord {
  id:string;taskId:string;node:string;model:string;started:string;ended?:string;durationMs?:number;
  status:"running"|"ok"|"failed";usage:NonNullable<ModelReceipt["usage"]>|"unknown";error?:string;
  estimatedCny?:number;estimatedUsd?:number;pricing?:{source:string;checkedAt:string;basis:string;currency:string;input:number;cachedInput:number;output:number};
  estimatedInput?:number;reservedOutput?:number;
}
function db(){
  const connection=new DatabaseSync(process.env.STUDIO_DB || "data/studio.sqlite");
  connection.exec("CREATE TABLE IF NOT EXISTS model_calls(id TEXT PRIMARY KEY, task_id TEXT NOT NULL, payload TEXT NOT NULL)");
  return connection;
}
export function saveCall(call:CallRecord){
  const connection=db();
  try{connection.prepare("INSERT INTO model_calls VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(call.id,call.taskId,JSON.stringify(call));}
  finally{connection.close();}
}
export function callsFor(id:string):CallRecord[]{
  const connection=db();
  try{return connection.prepare("SELECT payload FROM model_calls WHERE task_id=? ORDER BY rowid").all(id).map(r=>JSON.parse(String(r.payload)));}
  finally{connection.close();}
}
// Serialize check + insertion across processes. A running or uncertain request
// closes admission until its usage is known, even after a process restart.
export function reserveCall(task:Task,model:string,messages:unknown,maxTokens:number,node:string=task.stage,limits={requests:REQUEST_LIMIT,tokens:TASK_LIMIT,future:0}){
  const estimatedInput=Buffer.byteLength(JSON.stringify(messages),"utf8")+256;
  let connection:DatabaseSync|undefined;
  try{
    connection=db();
    connection.exec("BEGIN IMMEDIATE");
    const prior:CallRecord[]=connection.prepare("SELECT payload FROM model_calls WHERE task_id=?").all(task.id)
      .map(row=>JSON.parse(String(row.payload)));
    const legacy=task.modelCalls?.filter(c=>!c.id || c.id.startsWith("legacy:")).length??0;
    const count=prior.length+legacy;
    const summary=summarizeUsage(prior);
    const remaining=legacy || typeof summary.totalTokens!=="number"?null:limits.tokens-summary.totalTokens;
    const deny=(reason:string):never=>{throw new BudgetError(
      `预算阻止：${reason}；剩余请求 ${Math.max(0,limits.requests-count)}，剩余 Tokens ${remaining??"unknown"}，本次预留 ${estimatedInput+maxTokens}`
    );};
    if(count+limits.future>=limits.requests)deny("请求次数已耗尽");
    if(remaining===null || prior.some(c=>c.status==="running"))deny("存在未结算或用量未知的调用");
    const outputLimit=task.input.production?.budget?productionBudget(task.input.production.kind,task.input.production.budget.profile).output:OUTPUT_LIMIT;
    if(maxTokens<1 || maxTokens>outputLimit || !Number.isInteger(maxTokens))deny("输出上限无效");
    if(remaining!==null && estimatedInput+maxTokens+limits.future*4096>remaining)deny("剩余额度不足");
    if(task.input.production){
      const row=connection.prepare("SELECT q.status,b.id,b.token_limit,b.request_limit FROM production_queue q JOIN production_batches b ON b.id=q.batch WHERE q.task=?").get(task.id);
      if(!row||row.status==="已停止")deny("任务已停止或不在批次内");
      const batchCalls:CallRecord[]=connection.prepare("SELECT m.payload FROM model_calls m JOIN production_queue q ON q.task=m.task_id WHERE q.batch=?").all(row!.id).map(r=>JSON.parse(String(r.payload)));
      const reserved=batchCalls.reduce((n,c)=>n+(c.usage==="unknown"?(c.estimatedInput??0)+(c.reservedOutput??OUTPUT_LIMIT):c.usage.total_tokens),0);
      if(batchCalls.length>=Number(row!.request_limit)||reserved+estimatedInput+maxTokens>Number(row!.token_limit))deny("批次预算不足");
    }
    const record:CallRecord={id:randomUUID(),taskId:task.id,node,model,started:new Date().toISOString(),
      status:"running",usage:"unknown",estimatedInput,reservedOutput:maxTokens};
    connection.prepare("INSERT INTO model_calls VALUES(?,?,?)").run(record.id,task.id,JSON.stringify(record));
    connection.exec("COMMIT");
    return {record,previousTokens:summary.knownTotalTokens,tokenLimit:limits.tokens};
  }catch(error){
    if(error instanceof BudgetError)throw error;
    throw new BudgetError("预算阻止：无法确认或预留 SQLite 额度，剩余额度 unknown");
  }finally{connection?.close();}
}
export function summarizeUsage(calls:CallRecord[]){
  const known=calls.filter(c=>c.usage!=="unknown");
  const sum=(key:"prompt_tokens"|"completion_tokens"|"total_tokens")=>known.reduce((n,c)=>n+(c.usage==="unknown"?0:c.usage[key]),0);
  const priced=calls.filter(c=>typeof c.estimatedCny==="number");
  return {knownEstimatedUsd:calls.reduce((sum,c)=>sum+(c.estimatedUsd??0),0),usdPricedCalls:calls.filter(c=>typeof c.estimatedUsd==="number").length,knownEstimatedCny:priced.reduce((sum,c)=>sum+c.estimatedCny!,0),unpricedCalls:calls.filter(c=>typeof c.estimatedCny!=="number"&&typeof c.estimatedUsd!=="number").length,actualBilledCny:null,requests:calls.length,unknownUsageCalls:calls.length-known.length,
    knownInputTokens:sum("prompt_tokens"),knownOutputTokens:sum("completion_tokens"),knownTotalTokens:sum("total_tokens"),
    totalTokens:known.length===calls.length?sum("total_tokens"):"unknown"};
}

