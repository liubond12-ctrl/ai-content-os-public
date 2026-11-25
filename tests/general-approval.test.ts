import {it,expect,vi,beforeEach,afterEach} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {POST as taskPost} from "../src/app/api/tasks/route";
import {GET,POST} from "../src/app/api/tasks/generation/route";
import {lookup,type Task} from "../src/studio/tasks";
import {references,importCase} from "../src/studio/library";
import {authorizedPayload} from "../src/studio/general-approval";
import {researchPrompt} from "../src/studio/agents";
import scopeFailure from "./scope-failure.json";
import {assess,requirementChecks} from "../src/studio/writability";
import {brief} from "../src/studio/tasks";
import type {Hit} from "../src/rag/search";

const url="http://localhost:3000/api/tasks/generation";
const req=(body:unknown,origin="http://localhost:3000")=>new Request(url,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(body)});
const submit=async(body:unknown)=>(await taskPost(req(body))).json() as Promise<Task>;
async function ready(overrides:Record<string,unknown>={}){
  let t=await submit({topic:"为什么 AI 写出来的内容有 AI 味",format:"图文文章",mode:"keyword",generate:false,...overrides});
  for(let i=0;i<2;i++)t=await submit({id:t.id,revision:t.revision});
  return t;
}
async function preview(t:Task){return (await GET(new Request(url+"?id="+t.id))).json();}
async function authorize(t:Task){const p=await preview(t);const r=await POST(req({id:t.id,revision:t.revision,hash:p.hash,approved:true}));expect(r.status).toBe(200);return r.json() as Promise<Task>;}
beforeEach(()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"general-consent-"));
  vi.stubEnv("STUDIO_DB",path.join(dir,"tasks.db"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.db"));
  vi.stubEnv("STUDIO_MODEL","offline-model");vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");vi.stubEnv("STUDIO_MODEL_KEY","offline-test-key");
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network allowed");}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it("最新真实失败完整输入与三轮决策回放，经授权接口、研究、写作、版本找回",async()=>{
  expect(scopeFailure.input).toEqual(scopeFailure.approvedInput);
  const input=brief.parse(scopeFailure.input);
  const checks=requirementChecks(input);expect(checks.required).toEqual([]);
  expect(checks.excluded.some(x=>x.includes("未经证实"))).toBe(true);
  let t=await authorize(await ready(input));let count=0;
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const payload=JSON.parse(JSON.parse(init.body).messages[1].content);
    expect(payload.input.writingScope).toBe("text-analysis");
    const decision=scopeFailure.decisions[count++];
    const {round:_round,availableIds:_ids,...reply}=decision??{round:0,availableIds:[]};
    void _round;void _ids;
    const output=decision?reply:{title:"离线回放草稿",body:"原创虚构示例：把‘效率显著提升’改成‘她删去三句重复的话’。前一句只给评价，后一句给读者一个可观察的动作。这是一种表达选择，不是对模型成因或效果的证明。",citations:[scopeFailure.evidence[0].id]};
    if(!decision){expect(payload.research.status).toBe("ready_with_limits");expect(payload.research.version).toBe(t.research?.version);}
    return Response.json({model:"offline-model",usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
  }));
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("write");
  expect(t.research?.handoff?.coreGaps).toEqual([]);expect(t.research?.status).toBe("ready_with_limits");
  const researchVersion=t.research!.version;
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("done");
  expect(lookup(t.id)?.article?.body).toContain("原创虚构示例");
  expect(t.article?.researchVersion).toBe(researchVersion);expect(t.article?.reviewLabel).toBe("限定范围草稿，待人工审核");
  expect(lookup(t.id,researchVersion)?.article).toBeUndefined();expect(fetch).toHaveBeenCalledTimes(4);
});
it.each(["必须提供官方考级报名日期","证明某方法必然导致销量提高","不要回避证明某方法必然导致效果","不编造数据，但必须证明某方法必然导致效果"])("否定约束不能取消另一项必要事实：%s",topic=>{
  const input=brief.parse({...scopeFailure.input,topic});const d=scopeFailure.decisions.at(-1)!;
  expect(assess(input,scopeFailure.evidence as Hit[],d.needsFacts,d.questions,d.coreGaps,d.limits).status).toBe("blocked");
});
it.each(["观点分析","虚构叙事","报名日期"])("真实接口链路 %s",async topic=>{
  let t=await authorize(await ready({topic,writingScope:"text-analysis"}));
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const p=JSON.parse(JSON.parse(init.body).messages[1].content);
    const result=p.research?{title:"离线文章",body:"原创虚构例子：把抽象评价换成一个具体动作。",citations:p.research.supported.map((x:{sourceId:string})=>x.sourceId)}:
      {action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],optionalQuestions:["是否存在效果研究"],limits:["不作效果保证"],sources:p.evidence.map((x:{id:string})=>x.id)};
    return Response.json({model:"offline-model",usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]});
  }));
  t=await submit({id:t.id,revision:t.revision});
  if(topic==="报名日期"){expect(t.stage).toBe("blocked");expect(fetch).toHaveBeenCalledTimes(1);return;}
  expect(t.stage).toBe("write");expect(t.research?.handoff?.optionalQuestions).toContain("是否存在效果研究");
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("done");
  expect(lookup(t.id)?.article?.body).toContain("原创虚构");expect(t.article?.reviewLabel).toContain("待人工审核");
});
it.each([{needsFacts:[]},{needsFacts:[true]},{needsFacts:undefined},{needsFacts:"false"},{needsFacts:null},{questions:"错误类型"},{optionalQuestions:true},{unexpected:true}])("非法研究输出失败可追溯、合法恢复不重复写作 %j",async invalid=>{
  let t=await authorize(await ready({writingScope:"text-analysis"}));let first=true;
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const p=JSON.parse(JSON.parse(init.body).messages[1].content);
    const result:unknown=p.research?{title:"恢复文章",body:"原创示例",citations:p.research.supported.map((x:{sourceId:string})=>x.sourceId)}:
      {action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],limits:["仅示例"],sources:p.evidence.map((x:{id:string})=>x.id),...(first?invalid:{})};first=false;
    return Response.json({model:"offline-model",usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]});
  }));
  t=await submit({id:t.id,revision:t.revision});expect(t.records.at(-1)?.error).toContain("RESEARCH_SCHEMA_VALIDATION_ERROR");
  expect(t.article).toBeUndefined();expect(t.modelCalls).toHaveLength(1);const failedVersion=t.revision;
  expect(t.modelCalls?.[0].status).toBe("failed");expect(t.modelCalls?.[0].error).toContain("research_schema");
  expect(t.modelCalls?.[0].usage).toMatchObject({total_tokens:120});
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("write");
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("done");
  expect(t.modelCalls).toHaveLength(3);expect(lookup(t.id,failedVersion)?.article).toBeUndefined();
  await submit({id:t.id,revision:t.revision});expect(fetch).toHaveBeenCalledTimes(3);
});
it("ready 预览不调用模型，未授权的直接生成被阻止",async()=>{
  const t=await ready(),p=await preview(t);
  expect(t.stage).toBe("ready");expect(lookup(t.id)?.generalConsent).toBeUndefined();
  expect(p.manifest.methods).toHaveLength(1);expect(p.manifest.instructions.research).toContain("search");
  expect(JSON.stringify(p)).not.toContain("offline-test-key");
  expect(JSON.stringify(p)).not.toContain(references().find(c=>c.id==="travel-conflict")!.content);
  let unapproved=await submit({...t.input,generate:true});
  for(let i=0;i<3;i++)unapproved=await submit({id:unapproved.id,revision:unapproved.revision});
  expect(unapproved.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
});
it("显式同源确认与任务绑定，拒绝过期预览、跨任务授权及重复确认",async()=>{
  const t=await ready(),p=await preview(t),body={id:t.id,revision:t.revision,hash:p.hash,approved:true};
  expect((await POST(req(body,"http://evil.example"))).status).toBe(403);
  expect((await POST(req({...body,approved:false}))).status).toBe(400);
  const other=await ready();expect((await POST(req({...body,id:other.id}))).status).toBe(409);
  expect((await POST(req(body))).status).toBe(200);expect((await POST(req(body))).status).toBe(409);
  expect(lookup(t.id,2)?.generalConsent).toBeUndefined();expect(fetch).not.toHaveBeenCalled();
});
it("授权后通过现有任务接口执行研究、追加检索和写作，保留用量与版本",async()=>{
  let t=await authorize(await ready());let n=0;
  const sent:unknown[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const body=JSON.parse(init.body);expect(init.redirect).toBe("error");expect(body.max_tokens).toBe(800);
    const p=JSON.parse(body.messages[1].content);sent.push(p);n++;
    const output=n===1?{action:"search",query:"具体场景",mode:"keyword",needsFacts:false,questions:[],sources:[]}:
      n===2?{action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],limits:["只作文本分析，不证明普遍性"],sources:p.evidence.map((h:{id:string})=>h.id)}:
      {title:"离线替身文章",body:"仅用于契约验证，不是真实模型生成。",citations:p.research.supported.map((h:{sourceId:string})=>h.sourceId)};
    return Response.json({model:"offline-model",usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
  }));
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("write");
  t=await submit({id:t.id,revision:t.revision});expect(t.stage).toBe("done");
  expect(t.tools?.[0].hits.every(h=>h.id.includes("scene-editing"))).toBe(true);
  expect(t.article?.researchVersion).toBe(t.research?.version);expect(t.modelCalls).toHaveLength(3);
  expect(t.modelCalls?.every(c=>c.usage!=="unknown" && c.usage?.total_tokens===120)).toBe(true);
  expect(lookup(t.id)?.article).toEqual(t.article);
  expect(lookup(t.id)?.research?.status).toBe("ready_with_limits");
  expect(t.article?.reviewLabel).toBe("限定范围草稿，待人工审核");
  expect(JSON.stringify(sent)).not.toMatch(/travel-conflict|retail-counter|示例甲|示例乙/);
});
it("资料或配置变化后授权失效，篡改证据与指令不能外发",async()=>{
  const t=await authorize(await ready());
  expect(()=>authorizedPayload(t,{evidence:[{id:"business",text:"private"}]},researchPrompt(true))).toThrow();
  expect(()=>authorizedPayload(t,{evidence:[]},"other prompt")).toThrow();
  const item=references().find(c=>c.id==="scene-editing")!;
  importCase({...item,version:2,method:"新版本方法"},"reference");
  const failed=await submit({id:t.id,revision:t.revision});
  expect(failed.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
});
it("模型失败保留授权、研究产物和失败调用，不自动重新执行",async()=>{
  let t=await authorize(await ready());
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const data=JSON.parse(JSON.parse(init.body).messages[1].content);
    if(data.research)return new Response("",{status:503});
    return Response.json({model:"offline-model",usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120},choices:[{finish_reason:"stop",message:{content:JSON.stringify({action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],sources:data.evidence.map((h:{id:string})=>h.id)})}}]});
  }));
  t=await submit({id:t.id,revision:t.revision});const version=t.research?.version;
  t=await submit({id:t.id,revision:t.revision});
  expect(t.records.at(-1)?.status).toBe("failed");expect(t.research?.version).toBe(version);
  expect(t.article).toBeUndefined();expect(t.modelCalls?.at(-1)?.status).toBe("failed");expect(fetch).toHaveBeenCalledTimes(2);
});
it("资料撤销外发许可后停止，不能回退未批准案例",async()=>{
  const t=await authorize(await ready());
  const item=references().find(c=>c.id==="scene-editing")!;
  importCase({...item,version:2,allowExternal:false},"reference");
  const stopped=await submit({id:t.id,revision:t.revision});
  expect(stopped.stage).toBe("blocked");expect(fetch).not.toHaveBeenCalled();
});
it("凭证内容不能进入预览，模型目标变化使原授权失效",async()=>{
  const t=await authorize(await ready());
  vi.stubEnv("STUDIO_MODEL","another-model");
  expect((await submit({id:t.id,revision:t.revision})).stage).toBe("blocked");
  let secret=await submit({topic:"offline-test-key",format:"图文文章",mode:"keyword"});
  for(let i=0;i<2;i++)secret=await submit({id:secret.id,revision:secret.revision});
  const response=GET(new Request(url+"?id="+secret.id));
  expect(response.status).toBe(400);expect(JSON.stringify(await response.json())).not.toContain("offline-test-key");
  expect(fetch).not.toHaveBeenCalled();
});

it("Next 内部 localhost URL 与浏览器 Host 不同仍严格按同源本机校验",async()=>{
  const base={host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000","content-type":"application/json",referer:"http://127.0.0.1:3000/studio","sec-fetch-site":"same-origin"};
  const send=(headers:Record<string,string>)=>POST(new Request(url,{method:"POST",headers,body:JSON.stringify({approved:false})}));
  expect((await send(base)).status).toBe(400);
  for(const patch of [{origin:"http://localhost:3000"},{host:"evil.test:3000"},{host:"127.0.0.1:3001"},{referer:"http://evil.test"},{"sec-fetch-site":"cross-site"},{origin:"null"},{host:"localhost@evil.test:3000"}]){
    expect((await send({...base,...patch})).status).toBe(403);
  }
  expect((await send({...base,origin:"http://evil.test","x-forwarded-host":"127.0.0.1:3000","x-forwarded-proto":"http"})).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
