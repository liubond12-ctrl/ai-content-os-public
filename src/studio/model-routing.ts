import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {modelRoute,routePurpose,type RoutePurpose} from "../types/calibration";

export function routePlan(purpose:RoutePurpose){
  const current=(process.env.STUDIO_MODEL_URL||"http://127.0.0.1:11434/v1/chat/completions").trim();
  const cloud=/^https:/i.test(current);
  const config=process.env.STUDIO_DEMO_INSTANCE==="1"||cloud?{}:
    z.partialRecord(routePurpose,modelRoute).parse(JSON.parse(process.env.STUDIO_MODEL_ROUTES??"{}"));
  const selected=config[purpose]??config.default;
  return {purpose,model:selected?.model??process.env.STUDIO_MODEL??"",url:selected?.url??current,
    concurrency:selected?.concurrency??(purpose==="default"?4:2),configured:!!selected,cloud};
}
export function dryRunRoutes(){
  return routePurpose.options.map(role=>{
    const {url,...rule}=routePlan(role);
    return {...rule,target:rule.cloud?"现有云端授权目标":new URL(url).origin};
  });
}
export function reserveRoute(purpose:RoutePurpose,limit:number){
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  const id=randomUUID();
  try{
    db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS model_route_leases(id TEXT PRIMARY KEY,purpose TEXT,until INTEGER); BEGIN IMMEDIATE");
    const now=Date.now();
    db.prepare("DELETE FROM model_route_leases WHERE until<=?").run(now);
    const used=db.prepare("SELECT count(*) AS n FROM model_route_leases WHERE purpose=?").get(purpose);
    if(Number(used?.n)>=limit)throw Error("该模型分工并发已满，请稍后重试");
    db.prepare("INSERT INTO model_route_leases VALUES(?,?,?)").run(id,purpose,now+120000);
    db.exec("COMMIT");
  }finally{db.close();}
  return ()=>{
    const release=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
    try{release.exec("PRAGMA busy_timeout=5000");release.prepare("DELETE FROM model_route_leases WHERE id=?").run(id);}finally{release.close();}
  };
}
