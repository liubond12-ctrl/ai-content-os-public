import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create,lookup} from "../src/studio/tasks";
import {GET,POST} from "../src/app/api/reviews/route";
import {POST as annotate} from "../src/app/api/eval-cases/route";
import {saveCall} from "../src/studio/usage";
import {safeKnowledge} from "../src/studio/safe-demo";

const req=(body:unknown,key=false)=>new Request("http://localhost/api/reviews",{method:"POST",
  headers:key?{"x-review-key":"offline-reviewer"}:{},body:JSON.stringify(body)});
beforeEach(()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"eval-"));
  vi.stubEnv("STUDIO_DB",path.join(dir,"task.db"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"cases.db"));
  vi.stubEnv("STUDIO_MODEL","offline");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1234/chat");
  vi.stubEnv("STUDIO_MODEL_KEY","");vi.stubEnv("STUDIO_EVAL_REVIEW_KEY","offline-reviewer");
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("没有模拟响应，禁止联网");}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
const clean={label:"优秀",disputed:false,dimensions:{内容策略:"回应需求",表达质量:"具体自然",内容结构:"顺序清楚",基础规范:"无明显问题"},issues:[],claims:[]};
function stub(output:unknown){
  const mock=vi.fn(async()=>Response.json({model:"offline",choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}],
    usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));vi.stubGlobal("fetch",mock);return mock;
}
function seed(body:string,topic="描写虚构的纸船"){
  const task=create({topic,format:"图文文章",mode:"keyword"});
  task.stage="done";task.revision=3;task.research={version:2,status:"ready",questions:[],model:"offline",evidence:[]};
  task.article={title:"纸船",body,citations:[],model:"offline",version:3,researchVersion:2};
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("INSERT INTO versions VALUES(?,?,?)").run(task.id,3,JSON.stringify(task));db.close();return task;
}
const run=(id:string)=>POST(req({taskId:id,articleVersion:3})).then(r=>r.json());
it("UTF-16 精确定位多处问题，含 emoji、换行、中文标点及重复句",async()=>{
  const task=seed("🪁。\n重复！重复！"),issue={field:"body",type:"表达",severity:"明显",reason:"重复",suggestion:"删去重复段"};
  const issues=[{...issue,quote:"重复！",offset:0,before:"\n"},{...issue,quote:"重复！",offset:99,before:"重复！"}];
  stub({...clean,issues});const r=await run(task.id);
  expect(r.status).toBe("revise");expect(r.result.issues).toEqual(issues.map((issue,i)=>({...issue,offset:i?7:4})));
});
it.each([
  ["missing","QUOTE_NOT_FOUND","issues.0.quote"],
  ["offset","AMBIGUOUS_QUOTE","issues.0.quote"],
  ["type","SCHEMA_VALIDATION_ERROR","issues.0.offset"],
])("成功调用后保留 %s 校验失败的字段路径",async(kind,code,path)=>{
  const task=seed("🪁。\n重复！重复！");
  stub({...clean,issues:[{field:"body",quote:kind==="missing"?"不同原句":"重复！",offset:kind==="type"?"4":3,type:"表达",severity:"明显",reason:"测试",suggestion:"测试"}]});
  const r=await run(task.id);
  expect(r.status).toBe(kind==="offset"?"human_review":"failed");expect(r.call.status).toBe("ok");expect(r.result).toBeUndefined();
  const saved=await (await GET(new Request("http://localhost/api/reviews?taskId="+task.id+"&articleVersion=3"))).json();
  expect(saved[0].diagnostic).toMatchObject({evalId:r.id,code,path});
});
it("非 JSON 响应不记录原始内容且独立标记解析失败",async()=>{
  const task=seed("测试");
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({model:"offline",choices:[{finish_reason:"stop",message:{content:"private-invalid-json"}}],
    usage:{prompt_tokens:10,completion_tokens:3,total_tokens:13}})));
  const r=await run(task.id);
  expect(r.diagnostic.code).toBe("JSON_PARSE_ERROR");expect(r.call.usage.total_tokens).toBe(13);
  expect(JSON.stringify(r)).not.toContain("private-invalid-json");
});
it.each([
  ["A","纸船沿着石阶旁的水沟转了个弯。","pass"],
  ["D","考试后，我把折好的纸船放回抽屉。","pass"],
  ["E","报名日期是2027年3月1日。","blocked"],
])("%s：事实审核独立于优秀标签",async(_,body,status)=>{
  const task=seed(body);stub(clean);const r=await run(task.id);
  expect(r.status).toBe(status);expect(r.result.facts.triggered).toBe(status==="blocked");
  if(status==="blocked")expect(r.result.facts.checks[0]).toMatchObject({quote:body.slice(0,-1),status:"待核验"});
  expect(r.call.usage.total_tokens).toBe(150);
  expect(lookup(task.id,3)?.article).toEqual(task.article);
  expect((await GET(new Request("http://localhost/api/reviews?taskId="+task.id+"&articleVersion=3")).json())[0].id).toBe(r.id);
});
it.each([["B","只返回 JSON","规范"],["C","赋能美好生活","表达"]])("%s：问题定位与修改建议保存",async(_,quote,type)=>{
  const task=seed("开头。"+quote+"。");
  stub({...clean,label:"普通",issues:[{field:"body",quote,offset:3,type,severity:"明显",reason:"影响段落可读性",suggestion:"改写为可观察的动作"}]});
  const r=await run(task.id);expect(r.status).toBe("revise");expect(r.result.issues[0].quote).toBe(quote);
});
it("源于原始需求的核验与模型结构错误分别处理",async()=>{
  const task=seed("资料尚缺。","介绍赛事报名日期");stub(clean);
  expect((await run(task.id)).status).toBe("human_review");
  stub({...clean,issues:[{quote:"不存在"}]});expect((await run(task.id)).status).toBe("failed");
  expect((await POST(req({taskId:task.id,articleVersion:2}))).status).toBe(400);
});
it("独立集盲测后按精确版本对照，人工答案不在请求内",async()=>{
  const item={id:"blind-one",version:1,content:"纸船慢慢漂远。",source:"原创",rights:"原创",createdAt:"2026-11-03T00:00:00Z",allowExternal:false,
    label:"普通",reviewer:"人工测试替身",dimensions:["内容结构"],rationale:"保密标记-X",locations:["首行"],positiveExample:"秘密示例",negativeExample:"秘密反例",
    scenario:"虚构",tags:["人工标签"],goal:"叙事",format:"图文文章",split:"holdout",synthetic:true};
  expect((await annotate(req({item,humanReviewed:true},true))).status).toBe(201);
  const mock=stub(clean);const r=await (await POST(req({caseId:item.id,caseVersion:1}))).json();
  expect(r.status).toBe("pass");
  const sent=String(vi.mocked(fetch).mock.calls[0][1]?.body);
  for(const secret of ["保密标记-X","人工测试替身","秘密示例","秘密反例","人工标签"])expect(sent).not.toContain(secret);
  expect((await POST(req({compareId:r.id}))).status).toBe(403);
  expect(await (await POST(req({compareId:r.id},true))).json()).toMatchObject({sampleCount:1,agreement:false});
  expect(mock).toHaveBeenCalledTimes(1);
});
it("云端权限和既有预算均能在发送前阻断 Eval",async()=>{
  const task=seed("纸船漂远。");const mock=stub(clean);
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  expect((await run(task.id)).error).toContain("仅开放本机");
  vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1/chat");
  for(let i=0;i<6;i++)saveCall({id:"prior"+i,taskId:task.id,node:"research",status:"ok",model:"offline",started:"test",usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});
  expect((await run(task.id)).error).toContain("请求次数");expect(mock).not.toHaveBeenCalled();
});
it("事实匹配要求同任务、已核实、当前且含原句的事实来源",async()=>{
  const text="报名费为20元";
  const task=seed(text+"。");
  const chunk=safeKnowledge().chunks[0];
  task.research!.evidence=[{...chunk,text,kind:"fact-reference",verified:true,score:1,finalRank:1,
    temporal:{...chunk.temporal,status:"current-verified",applicableDate:"2026-11-03"}}];
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("UPDATE versions SET payload=? WHERE id=? AND rev=3").run(JSON.stringify(task),task.id);
  stub(clean);
  expect((await run(task.id)).result.facts.checks[0]).toMatchObject({sourceId:chunk.id,status:"来源原文匹配"});
  task.research!.evidence[0].temporal.status="unknown";
  db.prepare("UPDATE versions SET payload=? WHERE id=? AND rev=3").run(JSON.stringify(task),task.id);db.close();
  expect((await run(task.id)).status).toBe("blocked");
});
it("传输失败留下失败审核与 unknown 用量，不改文章",async()=>{
  const task=seed("小舟停在码头。");
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error("模拟连接失败")));
  const r=await run(task.id);
  expect(r.status).toBe("failed");expect(r.call.usage).toBe("unknown");
  expect(lookup(task.id,3)?.article?.body).toBe("小舟停在码头。");
});

it("人工选定重复原句产生独立审核记录，不重新调用模型",async()=>{
 const task=seed("重复！重复！");const mock=stub({...clean,issues:[{field:"body",quote:"重复！",offset:0,type:"表达",severity:"明显",reason:"重复",suggestion:"精简"}]});
 const old=await run(task.id);expect(old.status).toBe("human_review");
 const next=await (await POST(req({taskId:task.id,articleVersion:3,resolveId:old.id,offset:3}))).json();
 expect(next.manualParent).toBe(old.id);expect(next.result.issues[0].offset).toBe(3);expect(mock).toHaveBeenCalledTimes(1);
});
