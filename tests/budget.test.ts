import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {localProvider} from "../src/studio/provider";
import {advance,create,type Task} from "../src/studio/tasks";
import {callsFor,saveCall} from "../src/studio/usage";

beforeEach(()=>{
  vi.stubEnv("STUDIO_DB",path.join(mkdtempSync(path.join(tmpdir(),"budget-")),"tasks.db"));
  vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1234/test");
  vi.stubEnv("STUDIO_MODEL","budget-test");
  vi.stubEnv("STUDIO_MODEL_KEY","");
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("no network");}));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
function task(){
  return create({persona:"demoa",topic:"预算测试",reference:"",mode:"keyword",audience:"",generate:true});
}
function receipt(input=20){
  return Response.json({model:"budget-test",choices:[{finish_reason:"stop",message:{content:JSON.stringify({action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],sources:[]})}}],
    usage:{prompt_tokens:input,completion_tokens:10,total_tokens:input+10,prompt_cache_hit_tokens:5}});
}
it("恢复后研究和写作竞争第六个名额，第七次无法发送",async()=>{
  const t=task();
  const mock=vi.fn(async()=>receipt());vi.stubGlobal("fetch",mock);
  const send=(stage:Task["stage"])=>localProvider({task:{...t,stage}}).json("测试",{});
  for(let i=0;i<5;i++)await send("research");
  const concurrent=await Promise.allSettled([send("write"),send("research")]);
  expect(concurrent.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(mock).toHaveBeenCalledTimes(6);
  await expect(send("write")).rejects.toThrow("剩余请求 0");
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).max_tokens).toBe(800);
  expect(callsFor(t.id)).toHaveLength(6);
  expect(callsFor(t.id)[5].usage).toMatchObject({total_tokens:30,prompt_cache_hit_tokens:5});
});
it("预留输入和输出超过剩余额度时保留已完成研究",async()=>{
  const t=task();
  t.stage="write";t.research={version:1,model:"budget-test",status:"ready",questions:[],evidence:[]};
  t.context={compiledContext:"测试规则"} as Task["context"];
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("UPDATE versions SET payload=? WHERE id=?").run(JSON.stringify(t),t.id);db.close();
  saveCall({id:"previous",taskId:t.id,node:"research",model:"budget-test",started:"offline",status:"ok",
    usage:{prompt_tokens:19000,completion_tokens:500,total_tokens:19500}});
  const stopped=await advance(t.id,t.revision);
  expect(stopped?.stage).toBe("blocked");expect(stopped?.research).toEqual(t.research);
  expect(stopped?.records.at(-1)?.error).toContain("剩余 Tokens 500");
  expect(fetch).not.toHaveBeenCalled();
});
it("成功响应但缺少 usage 时冻结下一次调用",async()=>{
  const t=task();
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({model:"budget-test",choices:[{finish_reason:"stop",message:{content:"{}"}}]})));
  await localProvider({task:t}).json("测试",{});
  expect(callsFor(t.id)[0].usage).toBe("unknown");
  await expect(localProvider({task:t}).json("测试",{})).rejects.toThrow("剩余 Tokens unknown");
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("输入本身超过预算，首次请求即阻止",async()=>{
  await expect(localProvider({task:task()}).json("测试","字".repeat(8000))).rejects.toThrow("剩余额度不足");
  expect(fetch).not.toHaveBeenCalled();
});
it("超时消耗一次名额，恢复后不重发未结算请求",async()=>{
  const t=task();
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new DOMException("测试超时","TimeoutError")));
  await expect(localProvider({task:t}).json("测试",{})).rejects.toThrow("模型调用超时");
  await expect(localProvider({task:t}).json("恢复",{})).rejects.toThrow("未结算或用量未知");
  expect(callsFor(t.id)).toHaveLength(1);expect(fetch).toHaveBeenCalledTimes(1);
});
