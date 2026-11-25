import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {saveEntity,saveProductionDraft,submitBatch,previewDraft,queueAction,productionView,workerTick,entitySchema,type ProductionDraft} from "../src/studio/production";
import {productionDb} from "../src/studio/production-db";
import {lookup} from "../src/studio/tasks";
import {reserveCall,saveCall} from "../src/studio/usage";
import {validateBody,renderSections} from "../src/studio/production-schema";

function setup(){
  const dir=mkdtempSync(join(tmpdir(),"production-v2-"));
  vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
  vi.stubEnv("STUDIO_MODEL","fixture");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");vi.stubEnv("STUDIO_DEMO_INSTANCE","1");vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
  return saveEntity("account",entitySchema.parse({name:"虚构测试账号",status:"启用",platform:"小红书"}));
}
afterEach(()=>vi.unstubAllEnvs());
function draft(account:string,index=1){
  return saveProductionDraft({intent:"queued",id:randomUUID(),version:0,account,platform:"小红书",topic:"虚构选题 "+index,kind:"图文",sources:["scene-editing@1"]});
}
function submit(drafts:ProductionDraft[],tokenLimit=200000,requestLimit=72){
  const input={id:randomUUID(),drafts,tokenLimit,requestLimit,preview:drafts.map(previewDraft)};
  submitBatch(input);return input;
}
it("重复提交只建立一次批次，排序只修改未执行项，账号与规范固定版本",()=>{
  const account=setup(),rule=saveEntity("rule",entitySchema.parse({name:"演练规则",body:"保留一个动作",status:"启用"}));
  const drafts=Array.from({length:12},(_,i)=>draft(account.id,i));
  const input=submit(drafts);submitBatch(input);
  let view=productionView();expect(view.queue).toHaveLength(12);
  const ids=view.queue.map(q=>q.id);
  queueAction("reorder",input.id,1,[...ids].reverse());
  view=productionView();expect(view.queue[0].id).toBe(ids[11]);
  expect(()=>queueAction("reorder",input.id,1,ids)).toThrow("状态已改变");
  saveEntity("rule",{...rule,body:"新版表达"});saveEntity("account",{...account,name:"新名称"});
  expect(lookup(ids[0])!.input.production!.accountName).toBe("虚构测试账号");
  expect(lookup(ids[0])!.input.production!.rules[0].body).toBe("保留一个动作");
  expect(previewDraft(draft(account.id,99)).rules[0].version).toBe(2);
});
it("预检后规范变化、硬要求冲突、品牌与附件权限都阻止提交",()=>{
  const account=setup(),d=draft(account.id),preview=[previewDraft(d)];
  saveEntity("rule",entitySchema.parse({name:"硬要求1",body:"结尾为问题",status:"启用",hard:true,constraintKey:"结尾",constraintValue:"问题"}));
  expect(()=>submitBatch({id:randomUUID(),drafts:[d],preview,tokenLimit:20000,requestLimit:6})).toThrow("重新预检");
  saveEntity("rule",entitySchema.parse({name:"硬要求2",body:"结尾为陈述",status:"启用",hard:true,constraintKey:"结尾",constraintValue:"陈述"}));
  expect(()=>previewDraft(d)).toThrow("硬要求冲突");
  expect(()=>saveEntity("account",{...account,brand:"other"})).toThrow();
});
it("批次预算原子预留，未知与失败用量保守占额，停止后不再发出请求",()=>{
  const account=setup(),batch=submit([draft(account.id,1),draft(account.id,2)],1200);
  const ids=productionView().queue.map(q=>q.id),a=lookup(ids[0])!,b=lookup(ids[1])!;
  const call=reserveCall(a,"fixture",{},800).record;
  expect(()=>reserveCall(b,"fixture",{},800)).toThrow("批次预算不足");
  call.status="failed";saveCall(call);
  expect(()=>reserveCall(b,"fixture",{},800)).toThrow("批次预算不足");
  queueAction("stop",batch.id,1,[b.id]);
  expect(()=>reserveCall(b,"fixture",{},20)).toThrow("已停止");
});
it("过期未知请求进入受阻且旧回执不能启动新步骤，安全阶段恢复继续",async()=>{
  const account=setup();submit([draft(account.id),draft(account.id,2)]);
  const ids=productionView().queue.map(q=>q.id);
  reserveCall(lookup(ids[0])!,"fixture",{},800);
  const db=productionDb();
  db.prepare("UPDATE production_queue SET owner='dead-worker',lease=1,status='生成' WHERE task=?").run(ids[0]);db.close();
  await workerTick("recovery-worker");
  const view=productionView();
  expect(view.queue.find(t=>t.id===ids[0])!.status).toBe("受阻");
  expect(lookup(ids[1])!.revision).toBe(1);
  expect(lookup(ids[0])!.stage).toBe("blocked");
});
it("不同内容类型缺栏目不能定稿，结构编辑后导出仍可解析",()=>{
  const body=renderSections("图文",[{name:"封面文案",text:"封面"},{name:"正文",text:"修改后的正文"},{name:"配图计划",text:"第1页纸张"}]);
  expect(validateBody("图文",body)[1].text).toBe("修改后的正文");
  expect(()=>validateBody("分镜脚本",body)).toThrow("必要栏目");
});
it("已收到用量但执行结果尚未落盘，重启后仍不自动重发",async()=>{
  const account=setup();submit([draft(account.id)]);
  const id=productionView().queue[0].id,task=lookup(id)!;
  const call=reserveCall(task,"fixture",{},800).record;
  call.status="ok";call.usage={prompt_tokens:100,completion_tokens:100,total_tokens:200};saveCall(call);
  task.stage="research";task.lease=Date.parse(call.started)+240000;task.revision=1;
  const db=productionDb();
  db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,1,JSON.stringify(task));
  db.prepare("UPDATE production_queue SET owner='dead-worker',lease=1,status='整理资料' WHERE task=?").run(id);db.close();
  await workerTick("recovery-worker");
  expect(productionView().queue[0].status).toBe("受阻");
  expect(lookup(id)!.stage).toBe("blocked");
});
it("已开始任务不能重排，停止单条后下一条继续且重复领取只推进一个步骤",async()=>{
  const account=setup(),batch=submit([draft(account.id),draft(account.id,2),draft(account.id,3)]);
  await workerTick("first-worker");
  const view=productionView(),ids=view.queue.map(t=>t.id),version=view.batches[0].version;
  expect(view.queue[0].started).toBe(true);
  expect(()=>queueAction("reorder",batch.id,version,[...ids].reverse())).toThrow("尚未领取");
  queueAction("stop",batch.id,version,[ids[0]]);
  await workerTick("second-worker");
  expect(lookup(ids[1])!.revision).toBe(1);
  const db=productionDb();
  db.prepare("UPDATE production_queue SET owner='live-worker',lease=?,status='整理资料' WHERE task=?").run(Date.now()+60000,ids[1]);db.close();
  await workerTick("third-worker");
  expect(lookup(ids[1])!.revision).toBe(1);
  expect(lookup(ids[2])!.revision).toBe(0);
});


it("保存需求不授权生产；主动加入 B/C 后只提交 B/C，移出保留正文",()=>{
 const account=setup();
 const a=saveProductionDraft({id:randomUUID(),version:0,account:account.id,platform:"小红书",topic:"A 暂存",kind:"图文"});
 const b=draft(account.id,2),c=draft(account.id,3);
 expect(a.intent).toBe("draft");
 expect(()=>submit([a,b,c])).toThrow("尚未主动加入");
 expect(productionView().queue).toHaveLength(0);
 const moved=saveProductionDraft({...b,intent:"draft"});
 expect(moved.topic).toBe(b.topic);
 expect(()=>submit([moved,c])).toThrow("尚未主动加入");
 const readded=saveProductionDraft({...moved,intent:"queued"});
 submit([readded,c]);
 expect(productionView().queue.map(q=>q.topic)).toEqual([b.topic,c.topic]);
 expect(productionView().drafts.map(d=>d.id)).toEqual([a.id]);
});
it("历史草稿缺少意图字段时不会自动成为待生产",()=>{
 const account=setup(),d=draft(account.id);
 const legacy={...d} as Partial<ProductionDraft>;delete legacy.intent;
 const db=productionDb();db.prepare("UPDATE production_drafts SET payload=? WHERE id=?").run(JSON.stringify(legacy),d.id);db.close();
 const restored=productionView().drafts[0];expect(restored.intent).toBe("draft");
 expect(()=>submit([restored])).toThrow("尚未主动加入");
});
