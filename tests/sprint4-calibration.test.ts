import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {productionDb,entities} from "../src/studio/production-db";
import {articleStateInTransaction} from "../src/studio/article-store";
import {seedCalibrationDemo,demonstrationAccount as account} from "../src/studio/calibration-demo";
import {appendRetro,applyProposal,checkRubric,createProposal,duePublications,getPrediction,getPublication,lockPrediction,samplePool} from "../src/studio/calibration";
import {extractArticleBrick,extractReferenceBrick,freezeBricks,searchBricks} from "../src/studio/atomic-bricks";
import {importCase,removeReference} from "../src/studio/library";
import {dryRunRoutes,reserveRoute,routePlan} from "../src/studio/model-routing";
import {mockAuthor,mockTransport,notify} from "../src/studio/feishu-cards";

const key={task:"db4f1600-c301-4148-af40-000000000006",version:7};
const metrics={reach:11500,likes:80,saves:20,comments:12,conversions:2};
beforeEach(()=>{
  const folder=mkdtempSync(join(tmpdir(),"sprint4-calibration-"));
  vi.stubEnv("STUDIO_DB",join(folder,"studio.sqlite"));
  vi.stubEnv("STUDIO_LIBRARY_DB",join(folder,"library.sqlite"));
  vi.stubEnv("STUDIO_DEMO_INSTANCE","1");
  vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
  vi.stubEnv("STUDIO_MODEL","fixture");
  vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:3919/chat");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function seeded(){
  const db=productionDb();
  db.exec("BEGIN IMMEDIATE");seedCalibrationDemo(db);db.exec("COMMIT");
  return db;
}
it("同版预测无法覆盖或删除，等待期间没有 T+3d 卡片，也没有模型调用",async()=>{
  const outbound=vi.fn();vi.stubGlobal("fetch",outbound);
  const db=seeded();
  try{
    const blind=getPrediction(db,key)!;
    const pub=getPublication(db,key)!;
    expect(blind.reviewVersion).toBe(6);
    expect(Date.parse(pub.publishedAt)).toBeGreaterThan(Date.parse(blind.lockedAt));
    expect(Date.parse(pub.dueAt)-Date.parse(pub.publishedAt)).toBe(72*3600000);
    expect(()=>db.prepare("UPDATE cal_predictions SET payload='invalid' WHERE task=?").run(key.task)).toThrow("append only");
    expect(()=>db.prepare("DELETE FROM cal_predictions WHERE task=?").run(key.task)).toThrow("append only");
    expect(()=>db.prepare("INSERT OR REPLACE INTO cal_predictions VALUES(?,?,?,'invalid')").run(key.task,key.version,account)).toThrow("append only");
    db.exec("BEGIN IMMEDIATE");
    expect(lockPrediction(db,key,articleStateInTransaction(db,key.task)).prediction).toEqual(blind);
    expect(()=>appendRetro(db,key,articleStateInTransaction(db,key.task),metrics,"模拟",new Date().toISOString())).toThrow("72 小时");
    db.exec("ROLLBACK");
    await notify("mock",mockAuthor,mockTransport());
    expect(db.prepare("SELECT count(*) AS n FROM fs_outbox WHERE json_extract(card,'$.kind')='retro'").get()?.n).toBe(0);
    db.prepare("INSERT INTO cal_demo_wake VALUES(?,?)").run(key.task,key.version);
    await notify("mock",mockAuthor,mockTransport());
    await notify("mock",mockAuthor,mockTransport());
    expect(db.prepare("SELECT count(*) AS n FROM fs_outbox WHERE json_extract(card,'$.kind')='retro' AND delivery='sent'").get()?.n).toBe(1);
    expect(outbound).not.toHaveBeenCalled();
    db.exec("BEGIN IMMEDIATE");
    const retro=appendRetro(db,key,articleStateInTransaction(db,key.task),metrics,"演练来源",new Date().toISOString());
    db.exec("COMMIT");
    expect(retro.authorDiff.after).toContain("步骤 6");
    expect(()=>db.prepare("DELETE FROM cal_retro WHERE id=?").run(retro.id)).toThrow("append only");
  }finally{db.close();}
});
it("全部配对重打、并列及样本变化不会绕过 80% 闸门",()=>{
  const db=seeded();
  try{
    const pool=samplePool(db,account);
    const good=createProposal(db,account,"结构"),bad=createProposal(db,account,"互动引导");
    expect(good).toMatchObject({agreement:1,comparable:10,aligned:10,passed:true});
    expect(bad).toMatchObject({agreement:0,comparable:10,passed:false});
    expect(bad.conflicts).toHaveLength(10);
    expect(checkRubric(pool.map(item=>({...item,retro:{...item.retro,metrics:{...item.retro.metrics,reach:1}}})),"结构").agreement).toBeNull();
    const altered=pool.map(item=>({...item,retro:{...item.retro,metrics:{...item.retro.metrics,reach:1_000_000-item.retro.metrics.reach}}}));
    expect(checkRubric(altered,"结构").samples.map(row=>row.score)).toEqual(good.samples.map(row=>row.score));
    db.exec("BEGIN IMMEDIATE");
    expect(()=>applyProposal(db,account,bad.id)).toThrow("80%");
    expect(applyProposal(db,account,good.id)).toBe(1);
    db.exec("COMMIT");
    const stale=createProposal(db,account,"结构");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO cal_demo_wake VALUES(?,?)").run(key.task,key.version);
    appendRetro(db,key,articleStateInTransaction(db,key.task),metrics,"演练来源",new Date().toISOString());
    expect(()=>applyProposal(db,account,stale.id)).toThrow("已变化");
    db.exec("COMMIT");
    const updated=createProposal(db,account,"结构");
    db.exec("BEGIN IMMEDIATE");expect(applyProposal(db,account,updated.id)).toBe(2);db.exec("COMMIT");
    expect(entities(db,"rule").filter(row=>row.account===account)).toHaveLength(1);
    expect(db.prepare("SELECT count(*) AS n FROM production_entities WHERE kind='rule'").get()?.n).toBe(2);
    expect(checkRubric(pool.slice(0,4),"结构").passed).toBe(false);
  }finally{db.close();}
});
it("素材冻结精确版本，隔离其他账号、撤权参考和无核验的真实案例",()=>{
  const db=seeded();
  try{
    const [brick]=searchBricks(db,account,"纸角");
    expect(brick).toMatchObject({kind:"Hook",version:1,winRate:1});
    expect(freezeBricks(db,account,[brick])).toEqual([brick]);
    expect(searchBricks(db,"another")).toEqual([]);
    expect(()=>freezeBricks(db,account,[{id:brick.id,version:2}])).toThrow("版本或授权");
    const source={task:brick.source.id,version:brick.source.version};
    expect(()=>extractArticleBrick(db,source,articleStateInTransaction(db,source.task),{account,kind:"真实案例",text:brick.text,tags:[]})).toThrow("来源核验");
    importCase({id:"bricks-fixture",version:1,source:"隔离样例",rights:"原创",createdAt:"2026-01-01T00:00:00Z",allowExternal:false,
      title:"纸角结构",content:"写作示范",format:"图文文章",goal:"示例",method:"从动作写起",applies:"写法",avoid:"不沿用旧事实",tags:["爆款","真实案例"],quality:["模拟"],synthetic:true,facts:"虚构事件"},"reference");
    expect(()=>extractReferenceBrick(db,"bricks-fixture",1,{account,kind:"真实案例",text:"虚构事件",tags:[]})).toThrow("真实案例");
    const ref=extractReferenceBrick(db,"bricks-fixture",1,{account,kind:"方法论",text:"从动作写起",tags:[]});
    expect(ref.winRate).toBeNull();
    removeReference("bricks-fixture",1);
    expect(()=>freezeBricks(db,account,[ref])).toThrow("版本或授权");
  }finally{db.close();}
});
it("模型路由预演零请求，并发按角色独立，已有云端使用原目标",()=>{
  const outbound=vi.fn();vi.stubGlobal("fetch",outbound);vi.stubEnv("STUDIO_DEMO_INSTANCE","0");
  vi.stubEnv("STUDIO_MODEL_ROUTES",JSON.stringify({research:{model:"reason",url:"http://127.0.0.1:5000/chat",concurrency:1},distribution:{model:"fast",url:"http://127.0.0.1:5001/chat",concurrency:1}}));
  expect(dryRunRoutes().find(route=>route.purpose==="research")).toMatchObject({model:"reason",concurrency:1,target:"http://127.0.0.1:5000"});
  const release=reserveRoute("research",1);
  expect(()=>reserveRoute("research",1)).toThrow("并发已满");
  reserveRoute("distribution",1)();release();reserveRoute("research",1)();
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  expect(routePlan("research")).toMatchObject({model:"fixture",cloud:true,configured:false});
  expect(outbound).not.toHaveBeenCalled();
});
