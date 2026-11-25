// Isolated local transport simulation. No production model or task is used.
import {chromium} from "playwright";
import {createServer} from "node:http";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
const dir=mkdtempSync(path.join(tmpdir(),"professional-browser-")),database=path.join(dir,"studio.sqlite");
const body="虚构故事：小舟停在岸边。小舟停在岸边。",quote="小舟停在岸边。";
const db=new DatabaseSync(database);db.exec("CREATE TABLE versions(id TEXT,rev INTEGER,payload TEXT,PRIMARY KEY(id,rev))");
const ids={};for(const kind of ["conflict","clean","facts"]){const id=randomUUID();ids[kind]=id;const text=kind==="facts"?"考试报名日期为2027年5月1日。":body;const t={id,revision:3,stage:"done",input:{persona:"demoa",topic:kind,audience:"",reference:"",mode:"keyword"},records:[],context:{compiledContext:"原创虚构验收；清晰简洁"},research:{version:2,status:"ready",questions:[],evidence:[],model:"synthetic",handoff:{supported:[{sourceId:"fiction",quote:text}],coreGaps:[],limits:[],forbidden:[],scope:"虚构"}},article:{version:3,researchVersion:2,title:"虚构小舟",body:text,citations:["fiction"],model:"synthetic"}};db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,3,JSON.stringify(t));}db.close();
const receipts=[];
function assessment(action){return {assessment:{label:"普通",disputed:false,dimensions:{内容策略:"回应目标",表达质量:"清晰",内容结构:"合理",基础规范:"虚构"},issues:action?[{field:"body",quote,offset:body.lastIndexOf(quote),type:"表达",severity:"明显",reason:action==="retain"?"保留节奏":"无信息重复",suggestion:action==="retain"?"保留":"删除重复"}]:[],claims:[]},actions:action?[{issueIndex:0,action,replacement:"",evidenceIds:[],blocking:true}]:[]};}
const mock=createServer(async(req,res)=>{try{let raw="";for await(const chunk of req)raw+=chunk;const payload=JSON.parse(raw),instruction=payload.messages[0].content,data=JSON.parse(payload.messages[1].content);let answer;
 if(instruction.startsWith("你是独立"))answer=assessment(data.request.topic==="conflict"&&data.articleVersion===3?(instruction.includes("回应需求")?"retain":"delete"):undefined);
 else if(instruction.startsWith("你是Judge"))answer={decisions:[{opinionIds:data.opinions.map(o=>o.id),action:"accept",selectedIds:data.opinions.filter(o=>o.action==="delete").map(o=>o.id),reason:"按用户简洁要求删除重复句",evidenceIds:[]}]};
 else if(instruction.includes("审核者。只回应"))answer={responses:data.respondTo.map(opinionId=>({opinionId,position:"maintain",reason:"基于用户要求和原文",evidenceIds:[]}))};
 else answer={title:"虚构小舟",body:"虚构故事：小舟停在岸边。",citations:["fiction"]};
 receipts.push({role:instruction.slice(0,50),articleVersion:data.articleVersion,simulation:true});res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify({model:"offline-browser-mock",usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:"stop",message:{content:JSON.stringify(answer)}}]}));
 }catch{res.writeHead(500);res.end();}});
await new Promise(r=>mock.listen(0,"127.0.0.1",r));const mockPort=mock.address().port;
const port=3018,base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{cwd:process.cwd(),windowsHide:true,env:{...process.env,STUDIO_DB:database,STUDIO_LIBRARY_DB:path.join(dir,"library.sqlite"),STUDIO_MODEL:"offline-browser-mock",STUDIO_MODEL_URL:`http://127.0.0.1:${mockPort}/mock`,STUDIO_MODEL_KEY:"",STUDIO_SAFE_DEMO_APPROVED_SHA256:"",STUDIO_SAFE_EVAL_APPROVED_SHA256:""},stdio:"pipe"});
let logs="";server.stdout.on("data",b=>logs+=b);server.stderr.on("data",b=>logs+=b);
async function until(fn){let error;for(let n=0;n<200;n++){try{const v=await fn();if(v)return v;}catch(e){error=e;}await new Promise(r=>setTimeout(r,100));}throw error??Error("Timeout: "+logs);}
let browser;const results=[],errors=[];
try{await until(async()=>(await fetch(base+"/api/version")).ok);browser=await chromium.launch({channel:"msedge",headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
 for(const kind of Object.keys(ids)){await page.goto(base+"/studio/editor?taskId="+ids[kind]);await page.getByRole("button",{name:"启动协作流程",exact:true}).click();const f=await until(async()=>{const d=await fetch(base+"/api/collaboration?taskId="+ids[kind]).then(r=>r.json());return ["awaiting_acceptance","human","failed","unknown"].includes(d.flow?.state)?d.flow:null;});assert.equal(f.state,kind==="facts"?"human":"awaiting_acceptance");await page.reload();await page.getByRole("heading",{name:/专业审核/}).first().waitFor();
 if(kind==="conflict"){await page.getByRole("heading",{name:"Judge 裁决"}).waitFor();assert.equal(f.panels[0].discussion.length,2);assert.equal(f.rounds,1);const articles=await fetch(base+"/api/articles?taskId="+ids[kind]).then(r=>r.json());assert.equal(articles.head.body,"虚构故事：小舟停在岸边。");assert.equal(articles.head.parentVersion,3);assert.equal(articles.head.revisionReviewId,f.panels[0].id);await page.screenshot({path:"docs/evidence/phase3.5-professional-browser.png",fullPage:true});}
 if(kind==="clean")assert.equal(f.panels[0].discussion.length,0);
 if(kind==="facts")assert.equal(f.panels[0].roles.includes("facts"),true);
 results.push({kind,flow:f});}
 assert.deepEqual(errors,[]);const d=new DatabaseSync(database,{readOnly:true});const calls=d.prepare("SELECT payload FROM model_calls").all().map(r=>JSON.parse(r.payload));d.close();assert.equal(calls.length,13);assert.equal(receipts.length,13);writeFileSync("docs/evidence/phase3.5-professional-browser.json",JSON.stringify({date:new Date().toISOString(),build:await fetch(base+"/api/version").then(r=>r.json()),browser:"Edge headless",simulation:true,externalModelCalls:0,database,results,calls,receipts,errors},null,2));console.log(JSON.stringify({passed:results.map(r=>r.kind),calls:calls.length,externalModelCalls:0,errors,database}));
}finally{await browser?.close();server.kill();await new Promise(r=>mock.close(r));}
