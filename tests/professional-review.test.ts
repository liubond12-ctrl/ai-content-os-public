import {it,expect,afterEach,afterAll,vi} from "vitest";
import {mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create} from "../src/studio/tasks";
import {control,tick,flow} from "../src/studio/collaboration";
import {readArticles,changeArticle} from "../src/studio/article-store";
import {fromText} from "../src/studio/article-document";
import {callsFor,saveCall} from "../src/studio/usage";
import {reviewLocationHelp} from "../src/studio/review-location-help";
import {factTrigger,applyVerdict,type Panel} from "../src/studio/professional-review";
const body="虚构故事：小舟停在岸边。小舟停在岸边。",quote="小舟停在岸边。",offset=body.lastIndexOf(quote);
const records:unknown[]=[];
function output(action?:"retain"|"delete"|"replace",replacement="") {return {assessment:{label:"普通",disputed:false,dimensions:{内容策略:"回应虚构故事",表达质量:"检查重复",内容结构:"短段落",基础规范:"明确虚构"},issues:action?[{field:"body",quote,offset,before:quote,type:"表达",severity:"明显",reason:action==="retain"?"重复形成节奏":"同句重复",suggestion:action==="retain"?"保留节奏":"删除第二句"}]:[],claims:[]},actions:action?[{issueIndex:0,action,replacement,evidenceIds:[],blocking:true}]:[]};}
function setup(text=body){const dir=mkdtempSync(path.join(tmpdir(),"professional-"));vi.stubEnv("STUDIO_DB",path.join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.sqlite"));vi.stubEnv("STUDIO_MODEL","mock");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");vi.stubEnv("STUDIO_MODEL_KEY","");
 const t=create({persona:"demoa",topic:"虚构故事",mode:"keyword"});const seeded={...t,revision:3,stage:"done",context:{compiledContext:"账号要求：清晰，忠于用户需求"},research:{version:2,status:"ready",questions:[],evidence:[],model:"synthetic",handoff:{supported:[{sourceId:"fiction",quote:text}],coreGaps:[],limits:[],forbidden:[],scope:"虚构"}},article:{version:3,researchVersion:2,title:"虚构小舟",body:text,citations:["fiction"],model:"synthetic"}};
 const d=new DatabaseSync(process.env.STUDIO_DB!);d.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,3,JSON.stringify(seeded));d.close();control(t.id,"start",undefined,{professional:true});return t.id;}
const requests:Array<{instruction:string;data:Record<string,unknown>}>=[];
it("ambiguous professional response exposes only exact-version candidates from its failed call, without another request",async()=>{
 const id=setup();mock(()=>{const raw=output("delete");delete (raw.assessment.issues[0] as {before?:string}).before;return raw;});
 const f=await run(id);expect(f.state).toBe("human");
 const help=reviewLocationHelp(f)!;expect(help.articleVersion).toBe(3);expect(help.quote).toBe(quote);expect(help.candidates).toHaveLength(2);
 expect(help.candidates.map(c=>c.offset)).toEqual([body.indexOf(quote),body.lastIndexOf(quote)]);
 expect(callsFor(id)).toHaveLength(1);expect(readArticles(id).head.body).toBe(body);
 expect(reviewLocationHelp({...f,taskId:"another-task"})).toBeNull();
 const d=new DatabaseSync(process.env.STUDIO_DB!);d.prepare("UPDATE review_responses SET version=4").run();d.close();
 expect(reviewLocationHelp(f)).toBeNull();expect(callsFor(id)).toHaveLength(1);
});
function mock(respond:(instruction:string,data:Record<string,unknown>)=>unknown|Promise<unknown>){requests.length=0;vi.stubGlobal("fetch",vi.fn(async(url,init)=>{expect(String(url)).toBe("http://127.0.0.1:1/mock");const m=JSON.parse(init.body).messages;const instruction=m[0].content,data=JSON.parse(m[1].content);requests.push({instruction,data});const response=await respond(instruction,data);return Response.json({model:"mock",usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:"stop",message:{content:JSON.stringify(response)}}]});}));}
async function run(id:string){for(let i=0;i<35&&flow(id)?.state==="ready";i++)await tick(id,flow(id)!.revision);return flow(id)!;}
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});afterAll(()=>writeFileSync("docs/evidence/phase3.5-professional-tests.json",JSON.stringify(records,null,2)));
it("independent qualified roles skip discussion/Judge and persist separate receipts",async()=>{const id=setup();mock(()=>output());const f=await run(id);expect(f.state).toBe("awaiting_acceptance");expect(requests).toHaveLength(2);expect(requests[0].data).toEqual(requests[1].data);expect(requests.every(r=>!('opinions' in r.data))).toBe(true);expect(f.panels![0].verdict).toBeUndefined();expect(callsFor(id)).toHaveLength(2);records.push({case:"合格无讨论",flow:f,calls:callsFor(id),requests:[...requests]});});
it("fact triggering ignores fiction label when reality claim exists; plain opinion skips",async()=>{expect(factTrigger("我认为结尾更好")).toBe(false);expect(factTrigger("明确虚构小舟")).toBe(false);expect(factTrigger("虚构故事。考试报名日期为2027年5月1日。")).toBe(true);const id=setup("虚构故事。考试报名日期为2027年5月1日。");mock(()=>output());const f=await run(id);expect(f.panels![0].reviews.map(r=>r.role)).toEqual(["strategy","language","facts"]);expect(f.state).toBe("human");expect(requests).toHaveLength(3);expect(f.panels![0].verdict).toBeUndefined();records.push({case:"事实硬阻断",flow:f,calls:callsFor(id)});});
it("substantive conflict gets one discussion per role, Judge and directed revision",async()=>{const id=setup();mock((instruction,data)=>{
 if(instruction.startsWith("你是独立")){if(data.articleVersion===4)return output();return output(instruction.includes("回应需求")?"retain":"delete");}
 if(instruction.startsWith("你是Judge")){const opinions=data.opinions as Array<{id:string;action:string}>;return {decisions:[{opinionIds:opinions.map(o=>o.id),action:"accept",selectedIds:opinions.filter(o=>o.action==="delete").map(o=>o.id),reason:"用户需要精简，删除无信息重复",evidenceIds:[]}]};}
 if(instruction.includes("审核者。只回应"))return {responses:(data.respondTo as string[]).map(opinionId=>({opinionId,position:"maintain",reason:"依据原文和需求",evidenceIds:[]}))};
 return {title:"虚构小舟",body:"虚构故事：小舟停在岸边。",citations:["fiction"]};
 });const f=await run(id);expect(f.state).toBe("awaiting_acceptance");expect(f.rounds).toBe(1);expect(f.panels![0].discussion).toHaveLength(2);expect(f.panels![0].verdict).toBeDefined();expect(f.panels![1].reviews.every(r=>r.articleVersion===4)).toBe(true);expect(readArticles(id).head).toMatchObject({version:4,parentVersion:3,revisionReviewId:f.panels![0].id});expect(callsFor(id)).toHaveLength(8);records.push({case:"讨论裁决修订复审",flow:f,articles:readArticles(id).versions,calls:callsFor(id),requests:[...requests]});});
it("complementary opinions do not discuss",async()=>{const id=setup();let n=0;mock(()=>{const o=output("delete");if(n++===0){o.assessment.issues[0].offset=5;o.assessment.issues[0].before="：";}return o;});await tick(id,flow(id)!.revision);await tick(id,flow(id)!.revision);expect(flow(id)!.panels![0].conflicts).toHaveLength(0);expect(flow(id)!.step).toBe("revision");});
it("Judge cannot bypass unverified fact even with accepted empty selection",()=>{const p={reviews:[{result:{facts:{checks:[{status:"待核验"}]},status:"blocked"},opinions:[]}],conflicts:[],selected:[]} as unknown as Panel;expect(applyVerdict(p,{decisions:[]}).status).toBe("human");});
it("partial role schema failure resumes only failed role",async()=>{const id=setup();let n=0;mock(()=>++n===2?{}:output());await run(id);expect(flow(id)!.state).toBe("failed");expect(flow(id)!.panels![0].reviews).toHaveLength(1);control(id,"resume",flow(id)!.revision);await run(id);expect(flow(id)!.state).toBe("awaiting_acceptance");expect(requests).toHaveLength(3);});
it("unknown receipts, budget headroom and unauthorized cloud never pass",async()=>{const id=setup();saveCall({id:"large",taskId:id,node:"research",model:"mock",started:"",status:"ok",usage:{prompt_tokens:119000,completion_tokens:0,total_tokens:119000}});mock(()=>output());expect((await run(id)).state).toBe("human");expect(fetch).not.toHaveBeenCalled();});
it("cloud professional roles refused before sending",async()=>{const id=setup();vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");mock(()=>output());const f=await run(id);expect(f.state).toBe("human");expect(fetch).not.toHaveBeenCalled();});
it("duplicate requests and stopping an in-flight specialist never progress",async()=>{const id=setup();let release!:(v:unknown)=>void;mock(()=>new Promise(r=>{release=r;}));const rev=flow(id)!.revision,p=tick(id,rev);await new Promise(r=>setTimeout(r,20));await tick(id,rev);control(id,"stop",flow(id)!.revision);release(output());await p;expect(flow(id)!.state).toBe("stopped");expect(callsFor(id)).toHaveLength(1);expect(flow(id)!.executions[0].status).toBe("retained");});
it("human edit during specialist review prevents automatic progression",async()=>{const id=setup();let release!:(v:unknown)=>void;mock(()=>new Promise(r=>{release=r;}));const p=tick(id,flow(id)!.revision);await new Promise(r=>setTimeout(r,20));changeArticle({taskId:id,action:"draft",revision:0,baseVersion:3,title:"人工",document:fromText("人工草稿")});release(output());await p;expect(flow(id)!.state).toBe("human");expect(readArticles(id).draft?.title).toBe("人工");});
it("professional revisions stop at two, re-review never inherits old pass",async()=>{const id=setup();mock((instruction,data)=>{if(instruction.startsWith("你是独立")){const text=String(data.body),o=output("replace",text+"。更清楚");Reflect.deleteProperty(o.assessment.issues[0],"before");o.assessment.issues[0].quote=text;o.assessment.issues[0].offset=0;return o;}const article=data.article as {body:string};return {title:"虚构小舟",body:article.body+"。更清楚",citations:["fiction"]};});const f=await run(id);expect(f).toMatchObject({state:"human",rounds:2});expect(f.panels).toHaveLength(3);expect(readArticles(id).versions).toHaveLength(3);expect(callsFor(id)).toHaveLength(8);});
it("unrelated Writing rewrite is rejected without creating a version",async()=>{const id=setup();mock(i=>i.startsWith("你是独立")?output("delete"):{title:"篡改标题",body:"虚构故事：小舟停在岸边。",citations:["fiction"]});const f=await run(id);expect(f.state).toBe("failed");expect(f.reason).toContain("超出最终确认");expect(readArticles(id).versions).toHaveLength(1);});
it("optional expression rules are off by default and version traceable",async()=>{const id=setup();mock(()=>output());await run(id);expect(requests.every(r=>!r.instruction.includes("可选本地表达规则"))).toBe(true);expect(flow(id)!.panels![0].reviews.every(r=>r.expressionRules===false)).toBe(true);});
it("explicit fictional numbers alone do not add fact role",()=>{expect(factTrigger("虚构故事：小舟转了3次。")).toBe(false);expect(factTrigger("虚构故事：考试报名日期为2027年5月1日。")).toBe(true);});
it("enabled local expression rules affect only language prompt and retain version",async()=>{const id=setup();const d=new DatabaseSync(process.env.STUDIO_DB!);const f=flow(id)!;f.expressionRules=true;d.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),id);d.close();mock(()=>output());await run(id);expect(requests[0].instruction).not.toContain("可选本地表达规则");expect(requests[1].instruction).toContain("local-expression-v1");expect(flow(id)!.panels![0].reviews[1].expressionRules).toBe("local-expression-v1");});
it("real Research and Writing transport join professional flow and cumulative budget",async()=>{const id=setup();const d=new DatabaseSync(process.env.STUDIO_DB!);const t=JSON.parse(String(d.prepare("SELECT payload FROM versions WHERE id=? AND rev=3").get(id)!.payload));delete t.article;delete t.research;t.stage="research";t.result={retrieval:{hits:[{id:"fiction",text:body,kind:"expression-rule",verified:false,temporal:{status:"unknown",applicableDate:"unknown"}}],evidenceStatus:{needsFacts:false}}};d.prepare("UPDATE versions SET payload=? WHERE id=? AND rev=3").run(JSON.stringify(t),id);const f=flow(id)!;f.step="prepare";delete f.articleVersion;d.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),id);d.close();mock(i=>i.startsWith("研究当前任务")?{action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],coreGaps:[],limits:[],sources:["fiction"]}:i.startsWith("你是独立")?output():{title:"虚构小舟",body,citations:["fiction"]});const done=await run(id);expect(done.state).toBe("awaiting_acceptance");expect(done.executions.map(e=>e.role)).toEqual(["research","write","strategy","language"]);expect(callsFor(id)).toHaveLength(4);expect(readArticles(id).head.researchVersion).toBe(5);records.push({case:"研究写作接入专业审核",flow:done,calls:callsFor(id)});});


it("暂停后不重复模型步骤，允许继续已完成步骤之后的工作",async()=>{
 const id=setup();let release!:(o:unknown)=>void;mock(()=>new Promise(r=>{release=r;}));const running=tick(id,flow(id)!.revision);
 await new Promise(r=>setTimeout(r,20));control(id,"pause",flow(id)!.revision);release(output());await running;
 expect(flow(id)!.state).toBe("paused");await tick(id,flow(id)!.revision);expect(callsFor(id)).toHaveLength(1);
 control(id,"resume",flow(id)!.revision);mock(()=>output());await run(id);expect(callsFor(id)).toHaveLength(2);
});

it("同一组虚构正文的表达规则开关对照，记录误改与改善的模拟口径",async()=>{
 const cases=[{name:"动作重复",text:body,change:true},{name:"有意复沓",text:"她在等。天亮了。她在等。",change:false}];
 const rows=[];
 for(const sample of cases)for(const enabled of [false,true]){
  const id=setup(sample.text);
  if(enabled){const d=new DatabaseSync(process.env.STUDIO_DB!);const f=flow(id)!;f.expressionRules=true;d.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),id);d.close();}
  mock((instruction,data)=>instruction.startsWith("你是独立")?(instruction.includes("清晰度、重复")&&sample.change&&data.articleVersion===3?output("delete"):output()):{title:"虚构小舟",body:body.slice(0,-quote.length),citations:["fiction"]});
  const f=await run(id),a=readArticles(id),calls=callsFor(id);
  expect(f.state).toBe("awaiting_acceptance");
  expect(a.head.body).toBe(sample.change?body.slice(0,-quote.length):sample.text);
  rows.push({sample:sample.name,task:id,sourceVersion:3,rules:f.panels![0].reviews.map(r=>[r.role,r.rulesVersion,r.expressionRules]),enabled,simulation:true,state:f.state,requests:calls.length,failed:calls.filter(c=>c.status!=="ok").length,unknown:calls.filter(c=>c.usage==="unknown").length,changed:a.head.body!==sample.text,expectedChange:sample.change,atExpectedOutput:a.head.body===(sample.change?body.slice(0,-quote.length):sample.text)});
 }
 writeFileSync("docs/evidence/workbench/style-control.json",JSON.stringify(rows,null,2));
});

it("基础质量对照：同一原文版本和需求，单审核与双独立审核分别记账，不推断业务效果",async()=>{
 const {review}=await import("../src/studio/eval");const id=setup("原创虚构：小舟停在岸边。");mock(i=>i.startsWith("你是独立")?output():output().assessment);
 const single=await review(id,3);const singleCalls=callsFor(id);expect(single.status).toBe("pass");expect(singleCalls).toHaveLength(1);
 const result=await run(id);const multiCalls=callsFor(id).filter(c=>!singleCalls.some(s=>s.id===c.id));expect(result.state).toBe("awaiting_acceptance");expect(multiCalls).toHaveLength(2);expect(readArticles(id).head.version).toBe(3);
 records.push({case:"同版本基础对照",scope:"模拟模型，仅证明流程与记账可比，无业务Gold",taskId:id,articleVersion:3,single,multi:result,singleCalls,multiCalls});
});
