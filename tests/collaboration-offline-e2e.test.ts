import {it,expect,afterAll,afterEach,vi} from "vitest";
import {mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create} from "../src/studio/tasks";
import {control,tick,flow} from "../src/studio/collaboration";
import {readArticles} from "../src/studio/article-store";
import {readReviews} from "../src/studio/eval";
import {callsFor,summarizeUsage} from "../src/studio/usage";
const reports:unknown[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
afterAll(()=>writeFileSync("docs/evidence/phase3.5-offline-cases.json",JSON.stringify(reports,null,2)));
const original="虚构故事：小舟停在岸边。小舟停在岸边。";
const revised="虚构故事：小舟停在岸边。";
function assessment(disputed=false,issue=false){return {label:"普通",disputed,dimensions:{内容策略:"围绕虚构叙事",表达质量:"检查重复",内容结构:"短段落",基础规范:"明确虚构"},issues:issue?[{field:"body",quote:"小舟停在岸边。",before:"小舟停在岸边。",offset:original.lastIndexOf("小舟停在岸边。"),type:"表达",severity:"明显",reason:"同一句重复",suggestion:"删除第二次出现的句子"}]:[],claims:[]};}
async function scenario(name:string,outputs:unknown[],body=original,expected="awaiting_acceptance",professional=false){
 const dir=mkdtempSync(path.join(tmpdir(),"phase35-transport-"));vi.stubEnv("STUDIO_DB",path.join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.sqlite"));vi.stubEnv("STUDIO_MODEL","offline-transport-mock");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");vi.stubEnv("STUDIO_MODEL_KEY","");
 const requests:unknown[]=[];vi.stubGlobal("fetch",vi.fn(async(url,init)=>{expect(String(url)).toBe("http://127.0.0.1:1/mock");requests.push(JSON.parse(init.body));const output=outputs.shift();if(!output)throw Error("Unexpected model call");return Response.json({model:"offline-transport-mock",usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});}));
 const t=create({persona:"demoa",topic:"独立虚构离线验收",mode:"keyword"});
 const seeded={...t,revision:3,stage:"done",context:{compiledContext:"只写明确虚构内容"},research:{version:2,status:"ready",questions:[],evidence:[],model:"synthetic",handoff:{supported:[{sourceId:"fiction",quote:body}],coreGaps:[],limits:[],forbidden:[],scope:"原创虚构"}},article:{version:3,researchVersion:2,title:"虚构小舟",body,citations:["fiction"],model:"synthetic"}};
 const db=new DatabaseSync(process.env.STUDIO_DB!);db.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,3,JSON.stringify(seeded));db.close();
 control(t.id,"start",undefined,{professional});for(let i=0;i<8&&flow(t.id)?.state==="ready";i++)await tick(t.id,flow(t.id)!.revision);
 const f=flow(t.id)!,articles=readArticles(t.id),calls=callsFor(t.id);expect(f.state).toBe(expected);expect(outputs).toHaveLength(0);expect(calls).toHaveLength(requests.length);expect(calls.every(c=>c.status==="ok")).toBe(true);
 const reviews=articles.versions.flatMap(a=>readReviews(t.id,a.version));expect(f.executions.flatMap(e=>e.callIds).sort()).toEqual(calls.map(c=>c.id).sort());
 const before=calls.length;await tick(t.id,0);control(t.id,"start");expect(callsFor(t.id)).toHaveLength(before);
 reports.push({name,database:process.env.STUDIO_DB,taskId:t.id,simulation:"Only fetch response mocked; real controller, Eval, Writing, provider, budget and SQLite",flow:f,articles:articles.versions,reviews,calls,usage:summarizeUsage(calls),requests});return {f,articles,reviews,calls};
}
it("disputed single Eval routes to human; no discussion or Judge exists",async()=>{const {f,articles}=await scenario("存在争议",[assessment(true)],original,"human");expect(f.rounds).toBe(0);expect(articles.versions).toHaveLength(1);});
it("qualified single Eval skips revision",async()=>{const {f,articles}=await scenario("文章合格",[assessment()]);expect(f.executions).toHaveLength(1);expect(articles.versions).toHaveLength(1);});
it("critical unverified fact blocks even when model reports no issues",async()=>{await scenario("关键事实未核实",[assessment()],"考试报名日期为2027年5月1日。","human");});
it("real revision pipeline preserves parent and exact review version",async()=>{const {f,articles,reviews}=await scenario("表达问题修订复审",[assessment(false,true),{title:"虚构小舟",body:revised,citations:["fiction"]},assessment()]);expect(f.executions.map(e=>e.role)).toEqual(["eval","revision","eval"]);expect(articles.head).toMatchObject({body:revised,version:4,parentVersion:3,researchVersion:2,origin:"ai-revision"});expect(reviews.map(r=>r.articleVersion).sort()).toEqual([3,4]);expect(articles.versions[1].body).toBe(original);});

it("固定初稿和需求的单审核与多角色模拟对照",async()=>{
 const revisedOutput={title:"虚构小舟",body:revised,citations:["fiction"]};
 const panelReview=(issue=false)=>({assessment:assessment(false,issue),actions:issue?[{issueIndex:0,action:"delete",replacement:"",evidenceIds:[],blocking:false}]:[]});
 const single=await scenario("同条件单审核",[assessment(false,true),revisedOutput,assessment()]);
 const multi=await scenario("同条件专业审核",[panelReview(),panelReview(true),revisedOutput,panelReview(),panelReview()],original,"awaiting_acceptance",true);
 const summary=[single,multi].map(({f,articles,calls},index)=>({
  approach:index?"多角色":"单审核",tasks:1,delivered:Number(f.state==="awaiting_acceptance"),blocked:0,unknown:0,
  initialReviewRequests:f.executions.filter(e=>e.inputArticleVersion===3&&e.role!=="revision").flatMap(e=>e.callIds).length,
  completeFlow:summarizeUsage(calls),requestsSucceeded:calls.filter(c=>c.status==="ok").length,
  durationMs:calls.reduce((n,c)=>n+(c.durationMs??0),0),finalText:articles.head.body,sameExpectedRevision:articles.head.body===revised,
  humanPreference:null,estimatedProviderCharge:0,simulation:true
 }));
 expect(single.articles.head.body).toBe(multi.articles.head.body);
 writeFileSync("docs/evidence/workbench/paired-flow.json",JSON.stringify(summary,null,2));
});
