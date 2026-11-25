import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {budgetDay,budgetSnapshot,reserveDaily,setAutomationPolicy} from "../src/studio/readiness-budget";
import {productionDb} from "../src/studio/production-db";
import {seriesSources,claimSeries} from "../src/studio/production-series";
import {ensureArticleTables} from "../src/studio/article-store";
import {matrixMatches} from "../src/studio/matrix";
import {readinessEvaluation} from "../src/studio/readiness-evaluation";
import {systemDoctor} from "../src/studio/doctor";
import {dispatchFastlane,enqueueFastlane} from "../src/studio/fastlane";
import {randomUUID} from "node:crypto";

beforeEach(()=>{
  const dir=mkdtempSync(join(tmpdir(),"readiness-"));
  vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
  vi.stubEnv("STUDIO_DEMO_INSTANCE","0");vi.stubEnv("STUDIO_MODEL","main");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:3890/chat");
  vi.stubEnv("STUDIO_AUTOMATION_PRICES",'{"main":{"input":1,"output":1},"light":{"input":1,"output":0}}');
  vi.stubEnv("STUDIO_PYTHON_BGE_HEALTH","");
  vi.stubEnv("STUDIO_LIGHT_MODEL_ROUTE","");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
it("每日预留跨北京时间午夜，在途未知保留，80% 降级，100% 仅记一条告警",()=>{
  setAutomationPolicy({matchMin:75,dailyMicros:1000});
  const now=new Date("2026-11-25T16:01:00.000Z");
  const common={normal:{model:"main"},light:{model:"light"},canDowngrade:true,now};
  const first=reserveDaily({...common,inputTokens:800,outputTokens:0});
  expect(first.target.model).toBe("main");
  first.finish(true);
  const second=reserveDaily({...common,inputTokens:200,outputTokens:200});
  expect(second.target.model).toBe("light");
  expect(()=>reserveDaily({...common,inputTokens:1,outputTokens:0})).toThrow("100%");
  second.finish(true,{model:"light",status:200,usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}});
  const db=productionDb();try{
    expect(budgetSnapshot(db,budgetDay(now))).toMatchObject({spent:100,pending:800,light:true,paused:false});
    expect(budgetSnapshot(db,budgetDay(new Date("2026-11-25T15:59:00.000Z"))).total).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM daily_model_alert").get()?.n).toBe(1);
  }finally{db.close();}
});
it("价格未知和轻量未配置都阻断，发送前拒绝释放预留",()=>{
  const common={inputTokens:30,outputTokens:5,normal:{model:"main"}};
  expect(()=>reserveDaily({...common,normal:{model:"unknown"}})).toThrow("单价未知");
  expect(()=>reserveDaily({...common,forceLight:true})).toThrow("轻量模型未配置");
  const slot=reserveDaily(common);slot.finish(false);
  const db=productionDb();try{expect(budgetSnapshot(db).total).toBe(0);}finally{db.close();}
});
it("合法续集只免前序标题，保留无关账号撞车与冻结版本",()=>{
  const db=productionDb(),prior=randomUUID(),other=randomUUID(),batch=randomUUID();
  const title="如何写出让人看得见的纸张动作";
  try{
    ensureArticleTables(db);db.exec("BEGIN IMMEDIATE");
    claimSeries(db,"author",{label:"纸张练习",episode:1},prior);
    db.prepare("INSERT INTO article_snapshots VALUES(?,7,?)").run(prior,JSON.stringify({confirmed:true,version:7,title,body:"## 正文\n前序摘要"}));
    for(const [id,account] of [[prior,"author"],[other,"other"]]){
      db.prepare("INSERT INTO production_queue VALUES(?,?,0,'排队','',NULL,NULL,'')").run(id,batch);
      db.prepare("INSERT INTO versions VALUES(?,0,?)").run(id,JSON.stringify({input:{topic:title,production:{account,accountName:account}}}));
    }
    const series={label:"纸张练习",episode:2};
    const sources=seriesSources(db,"author",series);
    expect(sources).toMatchObject([{task:prior,version:7,summary:"前序摘要"}]);
    const hits=matrixMatches(db,{id:randomUUID(),topic:title,account:"author",series} as Parameters<typeof matrixMatches>[1]);
    expect(hits.map(row=>row.id)).toEqual([other]);
    expect(()=>seriesSources(db,"other",series)).toThrow("集数");
    db.exec("COMMIT");
  }finally{db.close();}
});
it("Doctor 不访问云端或发飞书凭证，BGE 模拟回执单列",async()=>{
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  const request=vi.fn<typeof fetch>();
  const results=await systemDoctor(request);
  expect(request).not.toHaveBeenCalled();
  expect(results.find(row=>row.name==="主模型")?.status).toBe("待授权验证");
  expect(results.find(row=>row.name==="im:message:update")?.status).toBe("待授权验证");
});
it("治理基准披露分母，快车道重放不重复建单",async()=>{
  const result=readinessEvaluation();
  expect(result.metrics[0].full.total).toBe(3);
  expect(result.metrics[2].full).toMatchObject({count:3,total:3});
  const db=productionDb(),id=randomUUID();
  try{
    db.exec("BEGIN IMMEDIATE");enqueueFastlane(db,id,7);enqueueFastlane(db,id,7);db.exec("COMMIT");
    expect(db.prepare("SELECT count(*) AS n FROM distribution_outbox").get()?.n).toBe(4);
    await dispatchFastlane();
    expect(db.prepare("SELECT count(*) AS n FROM distribution_outbox WHERE state='verify'").get()?.n).toBe(1);
  }finally{db.close();}
});
