import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {experimentPreview,experimentState,approveExperiment,startExperiment,stopExperiment,tickExperiment,checkExperimentBudget,CONFIRMATION,ORIGINAL,EXPERIMENT_ID} from "../src/studio/deepseek-experiment";
import {GET,POST} from "../src/app/api/deepseek-experiment/route";
let dbfile:string;
beforeEach(()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-11-04T12:00:00+08:00"));
 dbfile=path.join(mkdtempSync(path.join(tmpdir(),"lamp-experiment-")),"isolated.sqlite");
 vi.stubEnv("STUDIO_EXPERIMENT_DB",dbfile);vi.stubEnv("STUDIO_MODEL_KEY","offline-test-key");
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("UNEXPECTED NETWORK");}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function approve(){approveExperiment(experimentPreview().hash,CONFIRMATION);startExperiment();}
function review(action?:"retain"|"delete",claims:unknown[]=[]){
 const quote="她在等敲门声。",offset=ORIGINAL.body.lastIndexOf(quote);
 return {assessment:{label:"普通",disputed:false,dimensions:{内容策略:"符合需求",表达质量:"克制",内容结构:"完整",基础规范:"虚构"},issues:action?[{field:"body",quote,offset,before:quote,type:"表达",severity:"轻微",reason:"讨论重复",suggestion:"删除或保留"}]:[],claims},actions:action?[{issueIndex:0,action,replacement:"",evidenceIds:[],blocking:false}]:[]};
}
function response(content:unknown,usage:unknown={prompt_tokens:1500,completion_tokens:300,total_tokens:1800}){return new Response(JSON.stringify({model:"deepseek-flash",usage,choices:[{finish_reason:"stop",message:{content:typeof content==="string"?content:JSON.stringify(content)}}]}));}
async function finish(){for(let i=0;i<12&&experimentState()?.state==="ready";i++)await tickExperiment(experimentState()!.revision);return experimentState()!;}
it("preview exposes exact fixed data and prompts, no consent or network; unapproved start/tick blocked",async()=>{
 const p=experimentPreview();expect(p.experiment).toBeNull();expect(p.manifest.article).toEqual(ORIGINAL);expect(p.manifest.prompts.strategy).toContain("只返回 JSON");
 expect(()=>startExperiment()).toThrow();await expect(tickExperiment(0)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it("rejects stale preview, wrong confirmation, repeated approval and second experiment",async()=>{
 expect(()=>approveExperiment("0".repeat(64),CONFIRMATION)).toThrow();expect(()=>approveExperiment(experimentPreview().hash,"yes")).toThrow();
 approve();expect(()=>approveExperiment(experimentPreview().hash,CONFIRMATION)).toThrow();stopExperiment();expect(()=>startExperiment()).toThrow();await expect(tickExperiment(0)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it("runs two independent no-conflict reviews with exact preview payload and leaves original unchanged",async()=>{
 approve();const requests:Record<string,unknown>[]=[];
 vi.stubGlobal("fetch",vi.fn(async(url,init)=>{expect(url).toBe("https://api.deepseek.com/chat/completions");requests.push(JSON.parse(init.body));return response(review());}));
 const result=await finish();expect(result.state).toBe("done");expect(result.calls).toHaveLength(2);expect(result.articles).toEqual([ORIGINAL]);
 const messages=requests.map(r=>r.messages as {content:string}[]);expect(messages[0][1]).toEqual(messages[1][1]);expect(JSON.parse(messages[0][1].content)).toEqual(experimentPreview().manifest.initialPayload);
 expect(JSON.stringify(requests)).not.toContain("offline-test-key");expect(requests[0].max_tokens).toBe(800);
});
it("real conflict leads to two responses, Judge, exact revision and independent re-review",async()=>{
 approve();let n=0;
 vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
  const messages=JSON.parse(init.body).messages,data=JSON.parse(messages[1].content);n++;
  if(n===1)return response(review("retain"));if(n===2)return response(review("delete"));
  if(n===3||n===4)return response({responses:data.respondTo.map((opinionId:string)=>({opinionId,position:"maintain",reason:"保留原观点供裁决",evidenceIds:[]}))});
  if(n===5)return response({decisions:[{opinionIds:data.conflicts.flat(),action:"accept",selectedIds:[data.opinions.find((o:{action:string})=>o.action==="delete").id],reason:"删除无信息重复，保留结尾复沓",evidenceIds:[]}]});
  if(n===6){const c=data.changes[0];return response({title:ORIGINAL.title,body:ORIGINAL.body.slice(0,c.offset)+ORIGINAL.body.slice(c.offset+c.quote.length)});}
  return response(review());
 }));
 const result=await finish();expect(result.state).toBe("done");expect(n).toBe(8);expect(result.articles).toHaveLength(2);expect(result.panels[1].articleVersion).toBe(2);expect(result.panels[0].verdict).toBeDefined();
});
it("fact claim stops without adding an unauthorized fact Agent",async()=>{
 approve();vi.stubGlobal("fetch",vi.fn(async()=>response(review(undefined,[{field:"body",quote:"以下人物、地点与事件均为虚构。",offset:0,critical:true,sourceId:null}]))));
 const e=await finish();expect(e.state).toBe("human");expect(e.calls).toHaveLength(1);expect(e.articles).toHaveLength(1);
});
it("malformed JSON retains known usage and forbids automatic retry",async()=>{
 approve();vi.stubGlobal("fetch",vi.fn(async()=>response("{bad")));
 const e=await finish();expect(e.state).toBe("failed");expect(e.calls[0].usage?.total_tokens).toBe(1800);await expect(tickExperiment(e.revision)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
it("unknown usage and failed HTTP consume reservation and block retry",async()=>{
 approve();vi.stubGlobal("fetch",vi.fn(async()=>new Response("error",{status:500})));
 const e=await finish();expect(e.state).toBe("unknown");expect(e.calls[0].reservedTokens).toBeGreaterThan(0);await expect(tickExperiment(e.revision)).rejects.toThrow();expect(fetch).toHaveBeenCalledTimes(1);
});
it("duplicate ticks claim one request; stop retains receipt but does not publish results",async()=>{
 approve();let release!:(r:Response)=>void;
 vi.stubGlobal("fetch",vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;})));
 const rev=experimentState()!.revision,pending=tickExperiment(rev);await expect(tickExperiment(rev)).rejects.toThrow();stopExperiment();release(response(review()));await pending;
 const e=experimentState()!;expect(e.state).toBe("stopped");expect(e.calls[0].usage).toBeDefined();expect(e.panels[0].reviews).toHaveLength(0);expect(fetch).toHaveBeenCalledTimes(1);
});
it("request, conservative tokens, RMB estimate and unknown-use budgets are separate gates",()=>{
 const c={id:"a",role:"strategy",at:"",status:"ok" as const,reservedTokens:5000,reservedMicros:15000,usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2},messages:[]};
 expect(()=>checkExperimentBudget(Array(12).fill(c),[])).toThrow("请求");
 expect(()=>checkExperimentBudget([{...c,reservedTokens:59000}],[])).toThrow("Token");
 expect(()=>checkExperimentBudget([{...c,reservedMicros:999999}],[])).toThrow("人民币");
 expect(()=>checkExperimentBudget([{...c,usage:undefined}],[])).toThrow("未知");
});
it("a changed authorized hash blocks execution even after approval",async()=>{
 approve();const d=new DatabaseSync(dbfile);const e=experimentState()!;e.hash="0".repeat(64);d.prepare("UPDATE experiment SET payload=? WHERE id=?").run(JSON.stringify(e),EXPERIMENT_ID);d.close();
 await expect(tickExperiment(e.revision)).rejects.toThrow("变化");expect(fetch).not.toHaveBeenCalled();
});
it("API refuses cross-origin mutations and extra business data fields; GET has no effects",async()=>{
 const req=(body:unknown,origin="http://127.0.0.1:3000")=>new Request("http://127.0.0.1:3000/api/deepseek-experiment",{method:"POST",headers:{host:"127.0.0.1:3000",origin,"content-type":"application/json"},body:JSON.stringify(body)});
 expect((await POST(req({action:"start"},"https://evil.example"))).status).toBe(403);
 expect((await POST(req({action:"approve",hash:experimentPreview().hash,confirmation:CONFIRMATION,article:"business"}))).status).toBe(400);
 expect((await GET(new Request("http://127.0.0.1:3000/api/deepseek-experiment"))).status).toBe(200);expect(experimentState()).toBeNull();expect(fetch).not.toHaveBeenCalled();
});
it("expired price blocks approval, and stale in-flight claims become unknown without resend",async()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-07T00:00:00+08:00"));
 expect(()=>approveExperiment(experimentPreview().hash,CONFIRMATION)).toThrow("过期");
 vi.setSystemTime(new Date("2026-11-04T12:00:00+08:00"));approve();
 const e=experimentState()!;e.state="running";e.calls.push({id:"stale",role:"strategy",at:new Date(Date.now()-100000).toISOString(),status:"running",reservedTokens:4000,reservedMicros:10000,messages:[]});
 const d=new DatabaseSync(dbfile);d.prepare("UPDATE experiment SET payload=? WHERE id=?").run(JSON.stringify(e),EXPERIMENT_ID);d.close();
 expect(experimentState()?.state).toBe("unknown");await expect(tickExperiment(e.revision)).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
});
it("only one revision is allowed; persistent issues after re-review go to human",async()=>{
 approve();let n=0;
 vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
  n++;const data=JSON.parse(JSON.parse(init.body).messages[1].content);
  if(n===1)return response(review("delete"));if(n===2)return response(review());
  if(n===3){const c=data.changes[0];return response({title:ORIGINAL.title,body:ORIGINAL.body.slice(0,c.offset)+ORIGINAL.body.slice(c.offset+c.quote.length)});}
  const a=review();a.assessment.label="不合格";return response(a);
 }));
 const e=await finish();expect(e.state).toBe("human");expect(e.articles).toHaveLength(2);expect(n).toBe(5);
});
it("unrelated rewriting is rejected while known billable usage is kept",async()=>{
 approve();let n=0;vi.stubGlobal("fetch",vi.fn(async()=>{n++;return response(n===1?review("delete"):n===2?review():{title:"擅自修改标题",body:ORIGINAL.body});}));
 const e=await finish();expect(e.state).toBe("failed");expect(e.articles).toHaveLength(1);expect(e.calls[2].usage).toBeDefined();
});
