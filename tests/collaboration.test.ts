import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create} from "../src/studio/tasks";
import {control,tick,flow} from "../src/studio/collaboration";
import {readArticles,changeArticle} from "../src/studio/article-store";
import {fromText} from "../src/studio/article-document";
import {saveCall} from "../src/studio/usage";
vi.mock("../src/studio/agents",async original=>({...await original<typeof import("../src/studio/agents")>(),research:vi.fn(async()=>({version:2,status:"ready",evidence:[],questions:[],model:"mock"})),write:vi.fn(async(t)=>({title:"修订",body:"虚构修订",citations:["s"],version:t.revision+1,researchVersion:2,model:"mock"}))}));
vi.mock("../src/studio/eval",async original=>({...await original<typeof import("../src/studio/eval")>(),review:vi.fn()}));
import {review} from "../src/studio/eval";
import {write} from "../src/studio/agents";
beforeEach(()=>{const dir=mkdtempSync(path.join(tmpdir(),"collaboration-"));vi.stubEnv("STUDIO_DB",path.join(dir,"test.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.sqlite"));vi.stubEnv("STUDIO_MODEL","mock");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/chat");vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));vi.clearAllMocks();});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function seed(){const t=create({persona:"demoa",topic:"虚构",mode:"keyword"});t.revision=3;t.stage="done";t.research={version:2,status:"ready",evidence:[],questions:[],model:"mock"};t.article={version:3,researchVersion:2,title:"虚构",body:"虚构",citations:["s"],model:"mock"};const d=new DatabaseSync(process.env.STUDIO_DB!);d.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,3,JSON.stringify(t));d.close();return t.id;}
function result(id:string,version:number,status="pass") {return {id:"r"+version,taskId:id,articleVersion:version,version:1,createdAt:"",status,rules:[],sourceIds:[],result:{status,label:"普通" as const,dimensions:{内容策略:"",表达质量:"",内容结构:"",基础规范:""},disputed:false,issues:status==="revise"?[{field:"body" as const,quote:"虚构",offset:0,type:"表达" as const,severity:"明显" as const,reason:"重复",suggestion:"精简"}]:[],facts:{triggered:false,requestTriggered:false,requestClaims:[],checks:[],externalVerification:false}}};}
function mockReview(status="pass"){vi.mocked(review).mockImplementation(async(id,v)=>{const r=result(id,v,status);const d=new DatabaseSync(process.env.STUDIO_DB!);d.exec("CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,task TEXT,article INTEGER,version INTEGER,payload TEXT,UNIQUE(task,article,version))");d.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(r.id,id,v,1,JSON.stringify(r));d.close();return r;});}
it("passes into human acceptance, repeated requests do not execute twice",async()=>{const id=seed();mockReview();const f=control(id,"start");await Promise.all([tick(id,f.revision),tick(id,f.revision)]);expect(review).toHaveBeenCalledTimes(1);expect(flow(id)?.state).toBe("awaiting_acceptance");expect(control(id,"start").executions).toHaveLength(1);});
it("revision creates immutable new version and re-review reads it",async()=>{const id=seed();mockReview("revise");await tick(id,control(id,"start").revision);await tick(id,flow(id)!.revision);expect(readArticles(id).head).toMatchObject({origin:"ai-revision",parentVersion:3,researchVersion:2,version:4});mockReview();await tick(id,flow(id)!.revision);expect(review).toHaveBeenLastCalledWith(id,4);expect(flow(id)?.state).toBe("awaiting_acceptance");});
it("stopped late response is retained without advancing",async()=>{const id=seed();let resolve!:(r:ReturnType<typeof result>)=>void;vi.mocked(review).mockImplementation(()=>new Promise(r=>{resolve=r;}));const promise=tick(id,control(id,"start").revision);control(id,"stop",flow(id)!.revision);resolve(result(id,3));await promise;expect(flow(id)?.state).toBe("stopped");expect(flow(id)?.executions[0].status).toBe("retained");});
it("human draft changed during AI revision is never overwritten",async()=>{const id=seed();mockReview("revise");await tick(id,control(id,"start").revision);let resolve!:(a:Awaited<ReturnType<typeof write>>)=>void;vi.mocked(write).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));const p=tick(id,flow(id)!.revision);changeArticle({taskId:id,action:"draft",revision:0,baseVersion:3,title:"人工",document:fromText("人工内容")});resolve({title:"AI",body:"AI",citations:["s"],version:4,researchVersion:2,model:"mock"});await p;expect(flow(id)?.state).toBe("human");expect(readArticles(id).head.version).toBe(3);expect(readArticles(id).draft?.title).toBe("人工");expect(flow(id)?.executions.at(-1)?.candidate?.title).toBe("AI");});
it("failed step resumes without repeating completed work",async()=>{const id=seed();vi.mocked(review).mockRejectedValueOnce(Error("配置错误"));await tick(id,control(id,"start").revision);expect(flow(id)?.state).toBe("failed");mockReview();await tick(id,control(id,"resume",flow(id)!.revision).revision);expect(flow(id)?.state).toBe("awaiting_acceptance");});
it("unknown usage blocks automatic retries",async()=>{const id=seed();vi.mocked(review).mockImplementationOnce(async()=>{saveCall({id:"unknown",taskId:id,node:"eval",model:"mock",started:"",status:"failed",usage:"unknown"});throw Error("timeout");});await tick(id,control(id,"start").revision);expect(flow(id)?.state).toBe("unknown");expect(control(id,"resume",flow(id)!.revision).state).toBe("unknown");});
it("two revisions are the maximum",async()=>{const id=seed();mockReview("revise");control(id,"start");for(let i=0;i<5;i++)await tick(id,flow(id)!.revision);expect(flow(id)).toMatchObject({state:"human",rounds:2});expect(write).toHaveBeenCalledTimes(2);});
it("cloud revision is blocked before provider invocation",async()=>{const id=seed();mockReview("revise");await tick(id,control(id,"start").revision);vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");await tick(id,flow(id)!.revision);expect(flow(id)?.state).toBe("human");expect(write).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();});

it("isolated research → writing → review → revision → re-review",async()=>{
 const t=create({persona:"demoa",topic:"虚构全流程",mode:"keyword"});t.stage="research";t.revision=1;
 const d=new DatabaseSync(process.env.STUDIO_DB!);d.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,1,JSON.stringify(t));d.close();
 mockReview("revise");control(t.id,"start");for(let i=0;i<4;i++)await tick(t.id,flow(t.id)!.revision);
 mockReview();await tick(t.id,flow(t.id)!.revision);
 expect(flow(t.id)?.state).toBe("awaiting_acceptance");expect(flow(t.id)?.executions.map(e=>e.role)).toEqual(["research","write","eval","revision","eval"]);
 expect(readArticles(t.id).versions).toHaveLength(2);
});
it("budget failure stops the flow",async()=>{const id=seed();vi.mocked(review).mockResolvedValueOnce({...result(id,3),status:"failed",error:"预算阻止：请求次数已耗尽"});await tick(id,control(id,"start").revision);expect(flow(id)?.state).toBe("human");expect(flow(id)?.reason).toContain("预算");});
it("fact gaps do not trigger revision",async()=>{const id=seed();vi.mocked(review).mockResolvedValueOnce({...result(id,3),status:"blocked"});await tick(id,control(id,"start").revision);expect(flow(id)?.state).toBe("human");expect(write).not.toHaveBeenCalled();});
