import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,writeFileSync,mkdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {saveEntity,entitySchema,saveProductionDraft,previewDraft,submitBatch,productionView,workerTick,queueAction} from "../src/studio/production";
import {productionDb} from "../src/studio/production-db";
import {flow} from "../src/studio/collaboration";
import {fromText} from "../src/studio/article-document";
import {readArticles,changeArticle} from "../src/studio/article-store";
import {callsFor} from "../src/studio/usage";
import {fixtureResponse} from "../scripts/production-fixture-response.mjs";
import {validateBody} from "../src/studio/production-schema";
import type {contentKind} from "../src/studio/production-schema";
import type {z} from "zod";
function setup(){
 const dir=mkdtempSync(join(tmpdir(),"v2-review-"));
 vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
 vi.stubEnv("STUDIO_MODEL","mock");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");vi.stubEnv("STUDIO_DEMO_INSTANCE","1");vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
 const rule=saveEntity("rule",entitySchema.parse({name:"显式关联规范",body:"保留事实边界",status:"启用"}));
 const account=saveEntity("account",entitySchema.parse({name:"演练账号",platform:"小红书",status:"启用",rules:[rule.id]}));
 return {account,rule};
}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function transport(){vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
 const call=JSON.parse(init.body),messages=call.messages;
 const output=fixtureResponse(messages[0].content,JSON.parse(messages[1].content));
 return Response.json({model:"mock",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
}));}
function submit(kind:z.infer<typeof contentKind>,topic:string,profile="local_extended"){
 const {account}=setup();const draft=saveProductionDraft({intent:"queued",id:randomUUID(),version:0,account:account.id,platform:"小红书",kind,topic,budgetProfile:profile,sources:[kind==="口播稿"?"kitchen-hook@1":kind==="分镜脚本"?"craft-turn@1":"scene-editing@1"]});
 submitBatch({id:randomUUID(),drafts:[draft],preview:[previewDraft(draft)],tokenLimit:profile==="protected"?20000:120000,requestLimit:profile==="protected"?6:32});
 transport();return productionView().queue[0].id;
}
async function run(){for(let i=0;i<45;i++){if(!productionView().queue.some(q=>q.status==="排队"))break;await workerTick("review-worker");}}
it("显式关联有效写作规范而质量标准为空时预检成功，停用与范围不匹配分别拦截",()=>{
 const {account,rule}=setup();const d=saveProductionDraft({id:randomUUID(),version:0,account:account.id,platform:"小红书",kind:"图文",topic:"演练"});
 expect(previewDraft(d).rules.map(r=>r.id)).toEqual([rule.id]);expect(previewDraft(d).standards).toEqual([]);
 const disabled=saveEntity("rule",{...rule,status:"停用"});expect(()=>previewDraft(d)).toThrow("停用或范围不匹配");
 saveEntity("rule",{...disabled,status:"启用",platform:"抖音"});expect(()=>previewDraft(d)).toThrow("停用或范围不匹配");
});
it("队列生成后接专业独立审核，无分歧跳过讨论；默认额度未扩大",async()=>{
 const id=submit("图文","无分歧的虚构观察","protected");await run();
 expect(productionView().queue[0].status).toBe("待人工审核");
 expect(flow(id)).toMatchObject({professional:true,queueManaged:true,state:"awaiting_acceptance",budget:{requests:6,tokens:20000}});
 expect(flow(id)!.panels![0].reviews.map(r=>r.role)).toEqual(["strategy","language"]);
 expect(flow(id)!.panels![0].discussion).toEqual([]);expect(callsFor(id)).toHaveLength(4);
});
it.each(["图文","口播稿","分镜脚本","自由文章"] as const)("队列 %s 的分歧定位、讨论裁决、定向修订与新版复审",async kind=>{
 const id=submit(kind,"分歧演练：虚构片段");await run();expect(flow(id),JSON.stringify(productionView().queue)).not.toBeNull();const f=flow(id)!;
 expect(f.state,f.reason).toBe("awaiting_acceptance");expect(f.rounds).toBe(1);
 expect(f.panels![0].discussion).toHaveLength(2);expect(f.panels![0].verdict).toBeDefined();
 const versions=readArticles(id).versions;expect(versions).toHaveLength(2);
 expect(versions[0].body).toBe(versions[1].body.replace("她停下来。她停下来。","她停下来。"));
 expect(versions[0].revisionReviewId).toBe(f.panels![0].id);
 expect(f.panels![1].articleVersion).toBe(versions[0].version);
 expect(f.panels![0].selected[0].issue.offset).toBe(versions[1].body.lastIndexOf("她停下来。"));
 expect(validateBody(kind,versions[0].body).length).toBeGreaterThan(0);
 expect(callsFor(id)).toHaveLength(10);
 mkdirSync("docs/evidence/production-v2-review",{recursive:true});
 writeFileSync("docs/evidence/production-v2-review/flow-"+kind+".json",JSON.stringify({flow:f,versions,calls:callsFor(id)},null,2));
});
it("队列事实缺口停止自动修订，保留事实意见和人工入口",async()=>{
 const id=submit("自由文章","核验演练：虚构纸张");await run();
 expect(productionView().queue[0].status).toBe("受阻");expect(flow(id),JSON.stringify(productionView().queue)).not.toBeNull();expect(flow(id)!.state).toBe("human");
 expect(flow(id)!.panels![0].roles).toContain("facts");
 expect(flow(id)!.panels![0].reason).toContain("关键事实或安全问题待核验");expect(flow(id)!.rounds).toBe(0);
});
it("长文栏目在生成、审核及版本存储中保持完整，本机输出上限按类型生效",async()=>{
 const id=submit("自由文章","长文演练：比较有限观察");await run();
 expect(flow(id)!.state,flow(id)!.reason).toBe("awaiting_acceptance");
 expect(readArticles(id).head.body.length).toBeGreaterThan(1800);
 expect(readArticles(id).head.body).toContain("第30段虚构观察");
 const requests=vi.mocked(fetch).mock.calls.map(c=>JSON.parse(String(c[1]?.body)));
 expect(requests.some(r=>r.max_tokens===6000)).toBe(true);
 expect(validateBody("自由文章",readArticles(id).head.body)).toHaveLength(1);
});
it("协作运行中重启未知结果不会重发，即使用量已经落盘",async()=>{
 const id=submit("图文","中断审核演练");
 for(let i=0;i<5;i++)await workerTick("review-worker");
 const f=flow(id)!;expect(f).not.toBeNull();
 f.state="running";f.revision++;f.executions.push({id:"orphan",role:"language",started:new Date().toISOString(),status:"running",callIds:[]});
 const db=productionDb();db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),id);
 db.prepare("UPDATE production_queue SET owner='dead',lease=1,status='审核' WHERE task=?").run(id);db.close();
 const before=callsFor(id).length;await workerTick("recovery-worker");
 expect(productionView().queue[0].status).toBe("受阻");expect(flow(id)!.state).toBe("unknown");expect(callsFor(id)).toHaveLength(before);
});
it("停止专业流程后不继续，已完成的审核不会因重试再次调用",async()=>{
 const id=submit("图文","重试演练");for(let i=0;i<5;i++)await workerTick("review-worker");
 const before=callsFor(id).length;let v=productionView();queueAction("stop",v.batches[0].id,v.batches[0].version,[id]);
 await workerTick("worker");expect(callsFor(id)).toHaveLength(before);
 v=productionView();queueAction("retry",v.batches[0].id,v.batches[0].version,[id]);await run();
 expect(flow(id)!.state).toBe("awaiting_acceptance");expect(callsFor(id)).toHaveLength(4);
});

it("保守额度发现分歧后安全停止，不暗中提高请求或输出上限",async()=>{
 const id=submit("图文","分歧演练：虚构片段","protected");await run();
 expect(flow(id)!.state).toBe("human");expect(productionView().queue[0].status).toBe("受阻");
 expect(callsFor(id).length).toBeLessThanOrEqual(6);
 expect(vi.mocked(fetch).mock.calls.every(c=>JSON.parse(String(c[1]?.body)).max_tokens<=800)).toBe(true);
});
it("模拟传输响应返回 length 时不把截断长文当完整产物，也不进入通过状态",async()=>{
 const id=submit("自由文章","长文演练：截断路径");
 const original=fetch;
 vi.stubGlobal("fetch",vi.fn(async(url,init)=>{
  const response=await original(url,init);const body=await response.json();
  if(JSON.parse(String(init?.body)).messages[0].content.includes("输出改为"))body.choices[0].finish_reason="length";
  return Response.json(body);
 }));
 await run();expect(productionView().queue[0].status).toBe("失败");
 expect(flow(id)).toBeNull();expect(()=>readArticles(id)).toThrow();
 expect(callsFor(id)).toHaveLength(2);
});

it("人工定稿不会继承 AI 修订归属或旧版通过结论",async()=>{
 const id=submit("图文","分歧演练：虚构片段");await run();const prior=readArticles(id).head;
 expect(prior.origin).toBe("ai-revision");
 const updated=changeArticle({taskId:id,action:"publish",revision:0,baseVersion:prior.version,title:prior.title,document:fromText(prior.body+"\n人工补充有限观察。")});
 expect(updated.head.origin).toBe("human");expect(updated.head.revisionReviewId).toBeUndefined();
 expect(updated.versions.find(v=>v.origin==="ai-revision")!.revisionReviewId).toBe(prior.revisionReviewId);
 expect(flow(id)!.panels!.at(-1)!.articleVersion).toBe(prior.version);
});
