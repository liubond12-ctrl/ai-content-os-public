import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {GET as preview} from "../src/app/api/safe-demo/eval/route";
import {GET,POST} from "../src/app/api/reviews/route";
import {localProvider} from "../src/studio/provider";
import {demoSubject,instruction} from "../src/studio/eval-demo";

// Test judgments are private to the test runner, not human Gold or runtime data.
const expected=[
  {id:"sample-01",status:"revise",issues:[
    {field:"body",quote:"请在这里插入一个吸引人的开头。",type:"规范",severity:"明显",reason:"正文保留了写作指令",suggestion:"从人物动作写起"},
    {field:"body",quote:"美好让生活更美好",type:"表达",severity:"明显",reason:"重复评价，缺少新信息",suggestion:"交代修补结果"}]},
  {id:"sample-02",status:"pass",issues:[]}
] as const;
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("固定 Eval 清单：旧审批、篡改消息和重复执行均被拒绝；两份模拟报告可按版本读取",async()=>{
  vi.stubEnv("STUDIO_DB",path.join(mkdtempSync(path.join(tmpdir(),"eval-demo-")),"reviews.db"));
  vi.stubEnv("STUDIO_MODEL","deepseek-flash");vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  vi.stubEnv("STUDIO_MODEL_KEY","test-only");
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256","c47cf9aaa07fdbb73058386de9ce4a1d18196642634b87f58f1051636fcda1c5");
  const manifest=await preview().json();
  const submit=(id:string)=>POST(new Request("http://localhost/api/reviews",{method:"POST",body:JSON.stringify({sampleId:id,articleVersion:1})}));
  const transport=vi.fn();vi.stubGlobal("fetch",transport);
  expect(manifest.approved).toBe(false);
  expect((await submit("sample-01")).status).toBe(403);expect(transport).not.toHaveBeenCalled();
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256",manifest.approvalHash);
  await expect(localProvider({task:demoSubject("sample-01",1).task,evalId:"test"}).json(instruction,{calibration:["测试答案"]})).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
  for(const item of expected){
    const sample=manifest.samples.find((s:{id:string})=>s.id===item.id);
    const article=JSON.parse(sample.messages[1].content);
    expect(article.sources).toEqual([]);expect(article.calibration).toEqual([]);
    const issues=item.issues.map(i=>({...i,offset:article.body.indexOf(i.quote)}));
    const output={label:issues.length?"不合格":"优秀",disputed:false,dimensions:{内容策略:"离线测试",表达质量:"离线测试",内容结构:"离线测试",基础规范:"离线测试"},issues,claims:[]};
    transport.mockResolvedValueOnce(Response.json({model:"deepseek-flash",choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}],
      usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150}}));
    const report=await (await submit(item.id)).json();
    expect(report.status).toBe(item.status);expect(report.result.issues).toEqual(issues);
    expect(report.result.facts.triggered).toBe(false);
    expect(JSON.parse(transport.mock.calls.at(-1)![1].body).messages).toEqual(sample.messages);
    const stored=await GET(new Request("http://localhost/api/reviews?taskId="+report.taskId+"&articleVersion=1")).json();
    expect(stored[0].id).toBe(report.id);expect(stored[0].call.usage.total_tokens).toBe(150);
    expect((await submit(item.id)).ok).toBe(false);
  }
  expect(transport).toHaveBeenCalledTimes(2);
});
