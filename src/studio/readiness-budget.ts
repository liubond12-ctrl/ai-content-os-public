import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {z} from "zod";
import {automationPolicy,defaultAutomationPolicy,type AutomationPolicy} from "../types/readiness";
import type {ModelReceipt} from "./provider";
import {BudgetError} from "./usage";

const format=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"});
export const budgetDay=(date=new Date())=>format.format(date);
const price=z.object({input:z.number().min(0).max(10000),output:z.number().min(0).max(10000)}).strict();
const priceTable=z.record(z.string(),price);
export type Estimate=z.infer<typeof price>;
export function budgetTables(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS automation_policy(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS daily_model_cost(id TEXT PRIMARY KEY,day TEXT,model TEXT,reserved INTEGER,settled INTEGER);
    CREATE INDEX IF NOT EXISTS daily_model_cost_day ON daily_model_cost(day);
    CREATE TABLE IF NOT EXISTS daily_model_alert(day TEXT PRIMARY KEY,reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cruise_match_scores(day TEXT,source TEXT,account TEXT,title TEXT,score INTEGER,PRIMARY KEY(day,source,account));`);
}
function connection(){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  db.exec("PRAGMA busy_timeout=5000");budgetTables(db);return db;
}
export function getAutomationPolicy(db:DatabaseSync){
  budgetTables(db);
  const saved=db.prepare("SELECT payload FROM automation_policy WHERE id=1").get();
  return saved?automationPolicy.parse(JSON.parse(String(saved.payload))):defaultAutomationPolicy;
}
export function setAutomationPolicy(policy:AutomationPolicy){
  const db=connection();
  try{
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT OR REPLACE INTO automation_policy VALUES(1,?)").run(JSON.stringify(automationPolicy.parse(policy)));
    const day=budgetDay();
    if(budgetSnapshot(db,day).paused)recordAlert(db,day,"每日自动预算已达 100%，已暂停巡航");
    db.exec("COMMIT");
  }
  finally{db.close();}
}
export function budgetSnapshot(db:DatabaseSync,day=budgetDay()){
  const policy=getAutomationPolicy(db);
  const row=db.prepare(`SELECT COALESCE(sum(CASE WHEN settled IS NULL THEN reserved ELSE 0 END),0) AS pending,
    COALESCE(sum(settled),0) AS spent FROM daily_model_cost WHERE day=?`).get(day)!;
  const pending=Number(row.pending),spent=Number(row.spent),total=pending+spent,limit=policy.dailyMicros;
  return {spent,pending,total,limit,paused:total>=limit,light:total*5>=limit*4};
}
function recordAlert(db:DatabaseSync,day:string,reason:string){
  db.prepare("INSERT OR IGNORE INTO daily_model_alert VALUES(?,?)").run(day,reason);
}
export function lookupPrice(model:string):Estimate|undefined{
  if(process.env.STUDIO_DEMO_INSTANCE==="1")return {input:0.2,output:0.6};
  try{return priceTable.parse(JSON.parse(process.env.STUDIO_AUTOMATION_PRICES??"{}"))[model];}
  catch{return undefined;}
}
export function reserveDaily<T extends {model:string}>(input:{normal:T;light?:T;forceLight?:boolean;canDowngrade?:boolean;inputTokens:number;outputTokens:number;now?:Date}){
  const db=connection(),day=budgetDay(input.now),id=randomUUID();
  try{
    db.exec("BEGIN IMMEDIATE");
    const current=budgetSnapshot(db,day);
    const deny=(reason:string):never=>{
      recordAlert(db,day,reason);db.exec("COMMIT");throw new BudgetError(reason);
    };
    if(current.paused)deny("每日自动预算已达 100%，已暂停巡航");
    const light=input.forceLight||input.canDowngrade&&current.light;
    const target=(light?input.light:input.normal)??deny("轻量模型未配置，自动请求已暂停");
    const price=lookupPrice(target.model)??deny("自动模型单价未知，无法预留费用");
    const estimate=(i:number,o:number)=>Math.ceil(i*price.input+o*price.output);
    const reserved=estimate(input.inputTokens,input.outputTokens);
    if(current.total+reserved>current.limit)deny("当日剩余预算不足，本次自动请求未发送");
    db.prepare("INSERT INTO daily_model_cost VALUES(?,?,?,?,NULL)").run(id,day,target.model,reserved);
    if(current.total+reserved===current.limit)recordAlert(db,day,"每日自动预算已达 100%，已暂停巡航");
    db.exec("COMMIT");
    return {target,id,finish(dispatched:boolean,receipt?:ModelReceipt){
      const conn=connection();
      try{
        conn.exec("BEGIN IMMEDIATE");
        const usage=receipt?.usage;
        if(!dispatched)conn.prepare("DELETE FROM daily_model_cost WHERE id=? AND settled IS NULL").run(id);
        else if(receipt?.model===target.model&&usage&&usage.prompt_tokens+usage.completion_tokens===usage.total_tokens)
          conn.prepare("UPDATE daily_model_cost SET settled=? WHERE id=? AND settled IS NULL").run(estimate(usage.prompt_tokens,usage.completion_tokens),id);
        if(budgetSnapshot(conn,day).paused)recordAlert(conn,day,"每日自动预算已达 100%，已暂停巡航");
        conn.exec("COMMIT");
      }finally{conn.close();}
    }};
  }finally{db.close();}
}
