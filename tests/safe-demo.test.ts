import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {POST as createSafe,GET as preview} from "../src/app/api/safe-demo/route";
import {POST as taskPost,GET as taskGet} from "../src/app/api/tasks/route";
import {approvalHash,safeKnowledge,safeRetrieve,checkOutbound} from "../src/studio/safe-demo";
import type {Task} from "../src/studio/tasks";
import * as business from "../src/rag/search";
import * as assembler from "../src/context/assembler";

const post=(data:unknown)=>new Request("http://localhost/api/tasks",{method:"POST",body:JSON.stringify(data)});
async function start(scenario="expression"){
  return await (await createSafe(post({scenario}))).json() as Task;
}
async function step(t:Task){return await (await taskPost(post({id:t.id,revision:t.revision}))).json() as Task;}
async function prepared(scenario="expression"){return step(await step(await start(scenario)));}
beforeEach(()=>{
  vi.stubEnv("STUDIO_DB",path.join(mkdtempSync(path.join(tmpdir(),"safe-demo-")),"tasks.db"));
  vi.stubEnv("STUDIO_MODEL","test-model");
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  vi.stubEnv("STUDIO_MODEL_KEY","test-key-never-log");
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256",approvalHash);
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("未配置测试响应，禁止联网");}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function response(content:unknown,usage=true){
  return Response.json({model:"test-model",...(usage?{usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30,prompt_cache_hit_tokens:5}}:{}),
    choices:[{finish_reason:"stop",message:{content:JSON.stringify(content)}}]});
}
const finish={action:"finish",mode:"keyword",query:"",sources:["safe-demo:actions"],questions:[],needsFacts:false};
it.each([true,false])("limited-writing 使用真实初检；研究是否引用便笺 %s 决定放行",async includeNotebook=>{
  const p=await prepared("limited-writing");
  expect(p.result?.retrieval.hits.map(h=>h.id)).toEqual(["safe-demo:workshop","safe-demo:notebook","safe-demo:actions"]);
  const sources=["safe-demo:workshop",...(includeNotebook?["safe-demo:notebook"]:[])];
  const mock=vi.fn().mockResolvedValueOnce(response({...finish,sources}));
  vi.stubGlobal("fetch",mock);
  const r=await step(p);
  expect(r.research?.status).toBe(includeNotebook?"ready_with_limits":"blocked");
  if(includeNotebook){
    mock.mockResolvedValueOnce(response({segments:r.research!.handoff!.supported}));
    const done=await step(r);
    expect(done.article?.reviewLabel).toBe("限定范围草稿，待人工审核");
    expect(done.article?.researchVersion).toBe(r.research!.version);
  }else expect(r.article).toBeUndefined();
});
it("新增场景不能沿用此前 safe-demo-v2 审批",async()=>{
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256","22ea922f3e1dfde2f80cfcab0fe5823495e02ba83e861ead62f2f96c60a7f152");
  expect((await step(await prepared("limited-writing"))).stage).toBe("blocked");
  expect(fetch).not.toHaveBeenCalled();
});
it("followup 真实索引先命中线索，离线替身按所见证据决定补查及停止",async()=>{
  const businessRead=vi.spyOn(business,"knowledge").mockRejectedValue(Error("禁止回退"));
  const fetcher=vi.fn(async (_url:unknown,options:RequestInit)=>{
    const messages=JSON.parse(String(options.body)).messages;
    const payload=JSON.parse(messages[1].content);
    if(payload.research){
      expect(JSON.stringify(payload.research)).not.toContain("考试报名公告");
      return response({segments:payload.research.supported});
    }
    const evidence=payload.evidence as {id:string;text:string}[];
    const ids=evidence.map(h=>h.id);
    if(ids.includes("safe-demo:notebook"))return response({...finish,sources:ids,reason:"已找到部件改动和复试观察",
      questions:["一次观察不能证明问题已彻底解决"],limits:["一次观察不能证明问题已彻底解决"]});
    const clue=evidence.map(h=>h.text).join("").match(/另存于《([^》]+)》/);
    if(!clue)return response({...finish,sources:[],questions:["缺少复试记录"],reason:"无线索"});
    return response({...finish,action:"search",query:clue[1],sources:ids,reason:"目录缺改动及复试详情"});
  });
  vi.stubGlobal("fetch",fetcher);
  const p=await prepared("followup");
  const initial=p.result!.retrieval.hits.map(h=>h.id);
  expect(initial[0]).toBe("safe-demo:workshop");
  expect(initial).not.toContain("safe-demo:notebook");
  const r=await step(p);
  expect(r.stage).toBe("write");
  expect(r.decisions?.map(d=>[d.action,d.availableIds])).toEqual([
    ["search",initial],["finish",[...initial,"safe-demo:notebook"]]
  ]);
  expect(r.tools?.[0]).toMatchObject({round:1,query:"蓝格便笺",mode:"keyword"});
  expect(r.tools?.[0].hits.map(h=>h.id)).toContain("safe-demo:notebook");
  expect(r.research?.status).toBe("ready_with_limits");
  expect(r.research?.handoff?.coreGaps).toEqual([]);
  const written=await step(r);
  expect(written.stage).toBe("done");
  expect(written.article?.reviewLabel).toBe("限定范围草稿，待人工审核");
  expect(written.article?.researchVersion).toBe(r.research?.version);
  expect(written.article?.body).toContain("尾带移向右侧");
  expect(written.article?.body).not.toContain("报名");
  expect(businessRead).not.toHaveBeenCalled();
  console.log(JSON.stringify({dataset:"safe-demo-v2",approvalHash,decisions:r.decisions,toolHits:r.tools?.[0].hits.map(h=>h.id)}));
});
it("旧目录审批不能授权新版 followup",async()=>{
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256","38b455148dc2ffacc8c912a777c08e1825107991fed445fb2886fd59dbe694e3");
  const r=await step(await prepared("followup"));
  expect(r.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
});
it("真实路由贯通独立装配、补查与写作，保存 usage，重复提交不重复调用",async()=>{
  const source=vi.spyOn(business,"knowledge").mockRejectedValue(Error("不应读取业务库"));
  const rules=vi.spyOn(assembler,"assembleContext").mockRejectedValue(Error("不应加载业务规则"));
  const fetcher=vi.fn()
    .mockResolvedValueOnce(response({...finish,action:"search",query:"具体动作",mode:"hybrid"}))
    .mockResolvedValueOnce(response(finish))
    .mockResolvedValueOnce(response({title:"测试替身文章",body:"虚构纸偶记录动作。",citations:["safe-demo:actions"]}));
  vi.stubGlobal("fetch",fetcher);
  const p=await prepared();
  expect(p.context?.compiledContext).toContain("纸飞机观察员");
  const r=await step(p);
  expect(r.tools?.[0].hits.every(h=>h.id.startsWith("safe-demo:"))).toBe(true);
  expect(r.research?.status).toBe("ready");
  const done=await step(r);
  await step(r);
  const reopened=await (await taskGet(new Request("http://localhost/api/tasks?id="+done.id))).json();
  expect(done.stage).toBe("done");
  expect(reopened.usageSummary).toMatchObject({requests:3,totalTokens:90,knownInputTokens:60});
  expect(reopened.modelCalls[0].usage.prompt_cache_hit_tokens).toBe(5);
  expect(fetcher).toHaveBeenCalledTimes(3);
  const payloads=fetcher.mock.calls.map(c=>JSON.parse(c[1].body));
  expect(JSON.stringify(payloads)).not.toContain("resources/source-pack");
  expect(JSON.stringify(payloads)).not.toContain("test-key-never-log");
  expect(source).not.toHaveBeenCalled();expect(rules).not.toHaveBeenCalled();
});
it("业务任务生成被服务端阻止；测试接口拒绝任意参考或来源路径",async()=>{
  const input={persona:"demoa",topic:"业务主题",audience:"",reference:"",mode:"keyword",generate:true};
  let t=await (await taskPost(post(input))).json();
  t=await step(await step(t));
  t=await step(t);
  expect(t.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
  expect((await createSafe(post({scenario:"expression",filePath:"data/knowledge.json"}))).status).toBe(400);
  expect((await taskPost(post({...input,environment:"safe-demo",scenario:"expression"}))).status).toBe(403);
});
it.each(["HTTPS://api.deepseek.com/chat/completions"," https://api.deepseek.com/chat/completions ","https://API.DEEPSEEK.COM:443/chat/completions"])("云端变体 %s 拦截业务资料且零调用",async url=>{
  vi.stubEnv("STUDIO_MODEL_URL",url);
  const input={persona:"demoa",topic:"业务主题",audience:"",reference:"",mode:"keyword",generate:true};
  const t=await (await taskPost(post(input))).json();
  const result=await step(await step(await step(t)));
  expect(fetch).not.toHaveBeenCalled();
  expect(result.stage).toBe("blocked");
});
it("未人工审核时预检可看来源，但模型被阻止",async()=>{
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256","");
  const p=await prepared();
  const review=await (await preview(new Request("http://localhost/api/safe-demo?id="+p.id))).json();
  expect(review.approved).toBe(false);expect(review.sources).toHaveLength(5);
  expect((await step(p)).stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
});
it("未知来源、篡改片段和原始 compiledContext 均拒绝外发",async()=>{
  const p=await prepared();
  const payload={input:p.input,lastRound:false,evidence:p.result!.retrieval.hits};
  expect(()=>checkOutbound(p,payload)).not.toThrow();
  expect(()=>checkOutbound(p,{...payload,evidence:[{id:"unknown"}]})).toThrow();
  expect(()=>checkOutbound(p,{...payload,evidence:[{...payload.evidence[0],text:"未经批准资料"}]})).toThrow();
  p.context!.compiledContext="业务上下文";
  expect(()=>checkOutbound(p,payload)).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("零结果不回退，资料不足在真实路由被标记 blocked",async()=>{
  const source=vi.spyOn(business,"knowledge").mockRejectedValue(Error("禁止业务回退"));
  expect((await safeRetrieve("zyxunicorn987","keyword")).hits).toHaveLength(0);
  const p=await prepared("missing");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(response({...finish,sources:[],needsFacts:true})));
  const r=await step(p);
  expect(r.stage).toBe("blocked");expect(r.article).toBeUndefined();
  expect(source).not.toHaveBeenCalled();
});
it("失败未返回 usage 时按 unknown 计数，重试被预算门槛阻止",async()=>{
  const fetcher=vi.fn().mockRejectedValueOnce(Error("敏感错误 test-key-never-log"))
    .mockResolvedValueOnce(response(finish,false));
  vi.stubGlobal("fetch",fetcher);
  const p=await prepared();
  const failed=await step(p);
  expect(JSON.stringify(failed)).not.toContain("test-key-never-log");
  const retried=await step(failed);
  expect(retried.stage).toBe("blocked");
  expect(retried.usageSummary).toMatchObject({requests:1,totalTokens:"unknown",unknownUsageCalls:1});
  await step(failed);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("独立索引不包含现实已核实考试资料",()=>{
  expect(safeKnowledge().chunks.every(c=>!c.verified && c.path.startsWith("safe-demo/v2/"))).toBe(true);
});
it("旧任务的无 usage 调用记录兼容保留",async()=>{
  const t=await start();
  t.modelCalls=[{node:"research",model:"historical",started:"2026-01-01T00:00:00Z",status:"ok"}];
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("UPDATE versions SET payload=? WHERE id=? AND rev=0").run(JSON.stringify(t),t.id);db.close();
  const loaded=await (await taskGet(new Request("http://localhost/api/tasks?id="+t.id))).json();
  expect(loaded.modelCalls[0].model).toBe("historical");
  expect(loaded.modelCalls[0].usage).toBe("unknown");
  expect(loaded.usageSummary).toMatchObject({requests:1,totalTokens:"unknown"});
});
