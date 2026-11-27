import {it,expect,vi,afterEach} from "vitest";
import {mkdtempSync,mkdirSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";import {randomUUID} from "node:crypto";
import {saveProductionDraft,previewDraft,submitBatch,productionView,workerTick,createBlankArticle} from "../src/studio/production";
import {assertCloudTask} from "../src/studio/production-cloud";import {lookup} from "../src/studio/tasks";
import {callsFor} from "../src/studio/usage";import {readArticles} from "../src/studio/article-store";
import {professionalOutput} from "../src/studio/professional-review";
import {fixtureResponse} from "../scripts/production-fixture-response.mjs";
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function setup(){
 const root=mkdtempSync(join(tmpdir(),"cloud-scope-")),dir=join(root,"data-production-real-phase1");mkdirSync(dir);
 vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
 vi.stubEnv("STUDIO_MODEL","deepseek-flash");vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
 vi.stubEnv("STUDIO_PRODUCTION_SCOPE","phase1-original-fiction");vi.stubEnv("STUDIO_DEMO_INSTANCE","0");vi.stubEnv("STUDIO_MODEL_KEY","");vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
}
it("云端正式队列绑定快照、角色与模型，模拟传输验证全流程；不实际联网",async()=>{
 setup();const d=saveProductionDraft({id:randomUUID(),version:0,intent:"queued",kind:"自由文章",topic:"原创虚构的表达修改",sources:["scene-editing@1"]});
 const preview=[previewDraft(d)];submitBatch({id:randomUUID(),drafts:[d],preview,tokenLimit:120000,requestLimit:32});
 const id=productionView().queue[0].id;
 vi.stubGlobal("fetch",vi.fn(async(url,init)=>{expect(String(url)).toBe("https://api.deepseek.com/chat/completions");const m=JSON.parse(init.body).messages;
 return Response.json({model:"deepseek-flash",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(fixtureResponse(m[0].content,JSON.parse(m[1].content)))}}]});}));
 for(let i=0;i<15&&productionView().queue[0].status==="排队";i++)await workerTick("cloud-test");
 expect(productionView().queue[0].status).toBe("待人工审核");expect(callsFor(id)).toHaveLength(4);
 expect(callsFor(id).every(c=>c.estimatedUsd!>0&&c.pricing?.source.includes("api-docs.deepseek.com"))).toBe(true);
 const changed=lookup(id)!;changed.input.topic="不同输入";expect(()=>assertCloudTask(changed)).toThrow("已变化");
 vi.stubEnv("STUDIO_MODEL","different");expect(()=>assertCloudTask(lookup(id)!)).toThrow("已变化");
});
it("正式 DeepSeek 支持 v1 地址，需明确授权，按正式目录绑定任务并使用 Bearer",async()=>{
 setup();
 vi.stubEnv("STUDIO_DB",join(mkdtempSync(join(tmpdir(),"deepseek-production-")),"studio.sqlite"));
 vi.stubEnv("STUDIO_PRODUCTION_SCOPE","deepseek-production");
 vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/v1/chat/completions");
 vi.stubEnv("STUDIO_MODEL_KEY","fixture-credential");
 const d=saveProductionDraft({id:randomUUID(),version:0,intent:"queued",kind:"自由文章",topic:"虚构校样",sources:["scene-editing@1"]});
 const input={id:randomUUID(),drafts:[d],preview:[previewDraft(d)],tokenLimit:120000,requestLimit:32};
 expect(productionView()).toMatchObject({modelConfigured:true,mode:"真实云端"});
 expect(()=>submitBatch(input)).toThrow("明确授权");
 submitBatch({...input,authorizeText:true});
 const requests=vi.fn(async(url,init)=>{
   expect(String(url)).toBe("https://api.deepseek.com/v1/chat/completions");
   expect(init.headers.Authorization).toBe("Bearer fixture-credential");
   const m=JSON.parse(init.body).messages;
   return Response.json({model:"deepseek-flash",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(fixtureResponse(m[0].content,JSON.parse(m[1].content)))}}]});
 });
 vi.stubGlobal("fetch",requests);
 for(let i=0;i<15&&productionView().queue[0].status==="排队";i++)await workerTick("cloud-production-test");
 expect(productionView().queue[0].status,productionView().queue[0].reason).toBe("待人工审核");
 expect(requests).toHaveBeenCalled();
});
it("未选资料、未许可资料及附件不能混入云端预检",()=>{
 setup();const base={id:randomUUID(),version:0,kind:"自由文章",topic:"原创表达"};
 expect(()=>previewDraft(saveProductionDraft(base))).toThrow("选择一条允许外发的写法参考");
 expect(()=>previewDraft(saveProductionDraft({...base,id:randomUUID(),sources:["kitchen-hook@1"]}))).toThrow();
});
it("空白文章立即可编辑、无需模型请求、不进入执行队列",()=>{
 setup();const id=createBlankArticle("无模型自由草稿");
 expect(readArticles(id).head.body).toBe("");expect(productionView().queue[0].status).toBe("草稿");expect(callsFor(id)).toHaveLength(0);
});

it("云端选定意见按原句定向应用，新增版本重新独立审核，不产生伪造修订回执",async()=>{
 setup();const d=saveProductionDraft({id:randomUUID(),version:0,intent:"queued",kind:"自由文章",topic:"原创虚构的表达修改",sources:["scene-editing@1"]});
 submitBatch({id:randomUUID(),drafts:[d],preview:[previewDraft(d)],tokenLimit:120000,requestLimit:32});
 const id=productionView().queue[0].id;let issued=false;
 vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{const m=JSON.parse(init.body).messages,ins=m[0].content,data=JSON.parse(m[1].content);let out=fixtureResponse(ins,data);
 if(ins.startsWith("你是独立专业审核者")&&!issued){issued=true;const parsed=professionalOutput.parse(out);const quote="她把纸张铺平";parsed.assessment.issues=[{field:"body",quote,offset:0,type:"表达",severity:"轻微",reason:"措辞更具体",suggestion:"替换一个片段"}];parsed.actions=[{issueIndex:0,action:"replace",replacement:quote+"（观察）",evidenceIds:[],blocking:false}];out=parsed;}
 return Response.json({model:"deepseek-flash",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(out)}}]});}));
 for(let i=0;i<20&&productionView().queue[0].status==="排队";i++)await workerTick("cloud-revision-test");
 expect(productionView().queue[0].status).toBe("待人工审核");const articles=readArticles(id);expect(articles.versions).toHaveLength(2);expect(articles.head.body).toContain("（观察）");expect(callsFor(id)).toHaveLength(6);
});
