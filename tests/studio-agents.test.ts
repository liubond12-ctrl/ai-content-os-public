import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create,advance,lookup} from "../src/studio/tasks";
import {bounded,valid} from "../src/studio/agents";
import * as providers from "../src/studio/provider";
beforeEach(()=>vi.stubEnv("STUDIO_DB",path.join(mkdtempSync(path.join(tmpdir(),"agent-")),"tasks.db")));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
it("独立虚构事实来源经实际状态机研究、写作、持久化（非云端事实库接入）",async()=>{
  let t=create({persona:"general",topic:"介绍测试活动报名日期",format:"图文文章",mode:"keyword",generate:true});
  t=(await advance(t.id,t.revision))!;t=(await advance(t.id,t.revision))!;
  const source={...t.result!.retrieval.hits[0],id:"fixture:official",text:"原创虚构测试公告：报名日期为虚构历元一日。",kind:"fact-reference" as const,verified:true,temporal:{...t.result!.retrieval.hits[0].temporal,status:"current-verified" as const}};
  t.result!.retrieval.hits=[source];t.revision++;
  const db=new DatabaseSync(process.env.STUDIO_DB!);db.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,t.revision,JSON.stringify(t));db.close();
  const json=vi.fn().mockResolvedValueOnce({action:"finish",query:"",mode:"keyword",needsFacts:true,questions:[],sources:[source.id]})
    .mockResolvedValueOnce({title:"测试公告",body:source.text,citations:[source.id]});
  vi.spyOn(providers,"localProvider").mockReturnValue({model:"offline",json});
  t=(await advance(t.id,t.revision))!;expect(t.stage).toBe("write");
  t=(await advance(t.id,t.revision))!;expect(t.stage).toBe("done");expect(lookup(t.id)?.article?.citations).toEqual([source.id]);
});
async function prepared(persona:"demoa"|"demob",topic="统一写作习惯"){
  const t=create({persona,topic,reference:"",audience:"家长",mode:"keyword",generate:true});
  await advance(t.id,0);
  return (await advance(t.id,1))!;
}
for(const persona of ["demoa","demob"] as const)it(persona+"：真实工具、测试模型和版本交接",async()=>{
  const t=await prepared(persona);
  const id=t.result!.retrieval.hits[0].id;
  const json=vi.fn().mockResolvedValueOnce({action:"search",mode:"semantic",query:"统一写作习惯",questions:[],sources:[],needsFacts:false})
    .mockResolvedValueOnce({action:"finish",mode:"keyword",query:"",questions:[],sources:[id],needsFacts:false})
    .mockResolvedValueOnce({title:"测试替身",body:"仅用于流程断言",citations:[id]});
  vi.spyOn(providers,"localProvider").mockReturnValue({model:"test-only",json});
  const r=(await advance(t.id,t.revision))!;
  expect(r.tools?.[0].hits.length).toBeGreaterThan(0);
  expect(r.tools?.[0].hits.every(h=>h.persona===persona||h.persona==="shared")).toBe(true);
  const a=(await advance(t.id,r.revision))!;
  expect(a.stage).toBe("done");expect(valid(a.article!,a.research!)).toBe(true);
  expect(json).toHaveBeenCalledTimes(3);
  expect(a.decisions?.map(d=>d.action)).toEqual(["search","finish"]);
  expect(a.research?.sourceAssessments?.[0].verified).toBe(false);
  expect(valid(a.article!,{...a.research!,version:999})).toBe(false);
  expect(json.mock.calls[2][1].research.version).toBe(r.revision);
});
it("日期缺乏已核实事实，程序阻止写作",async()=>{
  const t=await prepared("demoa","2027 GESP 报名日期");
  vi.spyOn(providers,"localProvider").mockReturnValue({model:"test-only",json:async()=>({action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],sources:t.result!.retrieval.hits.map(h=>h.id)})});
  const blocked=await advance(t.id,t.revision);
  expect(blocked?.stage).toBe("blocked");
  expect(blocked?.records.at(-1)?.status).toBe("blocked");
});
it("模型缺失，保留检查点并恢复研究阶段",async()=>{
  vi.stubEnv("STUDIO_MODEL","");
  const t=await prepared("demob");
  const f=(await advance(t.id,t.revision))!;
  expect(f.records.at(-1)?.error).toContain("模型未配置");
  expect(lookup(t.id)?.result).toEqual(t.result);
  vi.spyOn(providers,"localProvider").mockReturnValue({model:"test-only",json:async()=>({action:"finish",mode:"keyword",query:"",sources:[t.result!.retrieval.hits[0].id],needsFacts:false,questions:[]})});
  expect((await advance(t.id,f.revision))?.stage).toBe("write");
});
it("挂起工具达到时限后返回错误",async()=>{await expect(bounded(new Promise(()=>{}),5)).rejects.toThrow("超时");});
it("进程在领取研究阶段后退出，过期租约允许从最近版本继续",async()=>{
  const t=await prepared("demob");
  t.lease=Date.now()-1;t.revision++;
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,t.revision,JSON.stringify(t));db.close();
  const json=vi.fn().mockResolvedValue({action:"finish",mode:"keyword",query:"",sources:[t.result!.retrieval.hits[0].id],needsFacts:false,questions:[]});
  vi.spyOn(providers,"localProvider").mockReturnValue({model:"test-only",json});
  const resumed=(await advance(t.id,t.revision))!;
  expect(resumed.stage).toBe("write");expect(json).toHaveBeenCalledTimes(1);
  expect(resumed.records.some(r=>r.error?.includes("任务中断"))).toBe(true);
});
