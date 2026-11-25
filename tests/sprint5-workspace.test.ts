import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {storyboardCards} from "../src/studio/storyboard";
import {geoReport} from "../src/studio/geo";
import {matrixMatches,matrixSignals} from "../src/studio/matrix";
import {chapterDocument,plainText,quoteRange,stabilizeBlocks} from "../src/studio/article-document";
import {previewDraft,saveEntity,saveProductionDraft,submitBatch} from "../src/studio/production";
import {productionDb} from "../src/studio/production-db";
import {assembleProduction} from "../src/context/assembler";
import {produceChapters} from "../src/studio/chapters";
import {lookup} from "../src/studio/tasks";

beforeEach(()=>{
  const dir=mkdtempSync(join(tmpdir(),"sprint5-test-"));
  vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
  vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:3829/chat");vi.stubEnv("STUDIO_MODEL","fixture");
  vi.stubEnv("STUDIO_DEMO_INSTANCE","1");vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
});
afterEach(()=>vi.unstubAllEnvs());
it("分镜映射全图位，三个比例对应不同预览并携带已给叠字",()=>{
  const body="## 正文\n样稿\n\n## 配图计划\n1. 窗边折纸，叠字：纸角\n2. 手部细节\n";
  for(const [platform,ratio] of [["小红书","3:4"],["抖音","9:16"],["公众号","2.35:1"]] as const){
    const rows=storyboardCards("task",7,"标题",body,platform);
    expect(rows.map(r=>r.slot)).toEqual([1,2]);
    expect(rows[0]).toMatchObject({articleVersion:7,ratio,overlayText:"纸角"});
    expect(rows[1].prompt).toContain("手部细节");
  }
});
it("章和块标识不影响 UTF-16 定位，新增块获得唯一身份",()=>{
  const body="## 正文\n### 第一次\n😀原句\n\n### 第二次\n新段";
  const chapters=[{id:"first",heading:"第一次",paragraphs:[]},{id:"second",heading:"第二次",paragraphs:[]}];
  const doc=chapterDocument(body,chapters);
  expect(plainText(doc)).toBe(body);
  expect(quoteRange(doc,"原句",body.indexOf("原句"))?.anchor.offset).toBe(2);
  const after=stabilizeBlocks([...doc.slice(0,3),{type:"p",children:[{text:"插入"}]},...doc.slice(3)],doc);
  expect(after[3].sectionId).toBe("first");
  expect(after[3].blockId).toBeTruthy();
  expect(after.at(-1)).toEqual(doc.at(-1));
});
it("矩阵复核同批次、在途与排期， stale 预检的第二个批次被挡",()=>{
  for(const id of ["red","blue"])saveEntity("account",{id,name:id,status:"启用",platform:"小红书",version:0});
  const draft=(account:string,topic:string,options:object={})=>saveProductionDraft({id:randomUUID(),version:0,account,platform:"小红书",topic,kind:"图文",intent:"queued",...options});
  const title="把抽象描述改成可见动作";
  const first=draft("red",title),second=draft("blue",title),future=draft("red","排期专项说明",{plannedDay:"2027-01-09"});
  const db=productionDb();
  try{
    expect(matrixMatches(db,first,[first,second])[0].state).toBe("同批次");
    expect(matrixMatches(db,{...second,topic:future.topic,plannedDay:"2027-01-09"})[0].state).toBe("待发布排期草稿");
    expect(matrixSignals({title:"虚构选题 1"},{title:"虚构选题 10"})).toEqual([]);
  }finally{db.close();}
  const old=previewDraft(second);
  submitBatch({id:randomUUID(),drafts:[first],tokenLimit:60000,requestLimit:20,preview:[previewDraft(first)]});
  expect(()=>submitBatch({id:randomUUID(),drafts:[second],tokenLimit:60000,requestLimit:20,preview:[old]})).toThrow("可能撞车");
  const experiment=saveProductionDraft({...second,experiment:"比较两个账号的解释方式"});
  expect(submitBatch({id:randomUUID(),drafts:[experiment],tokenLimit:60000,requestLimit:20,preview:[previewDraft(experiment)]})).toBeTruthy();
});
it("装配为动态账号按哈希记重复与约束，GEO 只列出可检测特征",()=>{
  saveEntity("account",{id:"acct",name:"写作账号",status:"启用",platform:"小红书",version:0});
  const draft=saveProductionDraft({id:randomUUID(),version:0,account:"acct",platform:"小红书",topic:"离线校样",kind:"图文"});
  const input=previewDraft(draft);
  const a={id:"a",name:"相同语句",version:1,body:"用一条正文界限",hard:false,reason:"",hash:"fake",constraint:{key:"正文",value:"长"}};
  const b={...a,id:"b"},c={...a,id:"c",hard:true,constraint:{key:"正文",value:"短"}};
  const {trace}=assembleProduction("基础",{...input,mode:"离线示例",rules:[a,b,c]},["scene-editing@1"]);
  expect(trace.accountVersion).toBe(1);
  expect(trace.modules.find(m=>m.source==="rule/b@1")?.duplicateOf).toBe("rule/a@1");
  expect(trace.conflicts[0].resolution).toContain("硬约束优先");
  expect(geoReport("纸角训练是指练习表达可观察动作。方案 A 和 B 对比需核对 10 分钟。来源 https://example.invalid/report。问：适合谁？答：作者。").every(row=>row.met)).toBe(true);
});
it("分章中断保留已完成章，安全重跑从下一章续接",async()=>{
  saveEntity("account",{id:"resume",name:"分章测试",status:"启用",platform:"公众号",version:0});
  const draft=saveProductionDraft({id:randomUUID(),version:0,account:"resume",platform:"公众号",topic:"中断后的分章测试",kind:"图文",intent:"queued",
    budgetProfile:"local_extended",sources:["scene-editing@1"],chapters:[{id:"first",heading:"开始"},{id:"second",heading:"续写"},{id:"third",heading:"结束"}]});
  const id=randomUUID();
  submitBatch({id,drafts:[draft],requestLimit:32,tokenLimit:120000,preview:[previewDraft(draft)]});
  const db=productionDb(),taskId=String(db.prepare("SELECT task FROM production_queue WHERE batch=?").get(id)?.task);
  db.close();
  const task=lookup(taskId)!;
  task.research={version:2,status:"ready",model:"fixture",questions:[],evidence:[]};
  const paragraph={paragraphs:[{text:"可观察的虚构动作。",sources:[]}]};
  const broken=vi.fn().mockResolvedValueOnce(paragraph).mockRejectedValueOnce(Error("模拟已确认失败"));
  await expect(produceChapters(task,{model:"fixture",json:broken})).rejects.toThrow("已确认失败");
  const resumed=vi.fn().mockResolvedValue(paragraph);
  const result=await produceChapters(task,{model:"fixture",json:resumed});
  expect(result.map(row=>row.id)).toEqual(["first","second","third"]);
  expect(resumed.mock.calls.map(call=>call[1].chapter.id)).toEqual(["second","third"]);
});
