import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const base = process.env.STUDIO_PHASE1_URL || "http://127.0.0.1:3688";
const evidence = process.env.STUDIO_PHASE1_EVIDENCE;
if (!evidence) throw Error("请用 STUDIO_PHASE1_EVIDENCE 指定本地验收目录。");
await mkdir(evidence,{recursive:true});
const report = {build:(await (await fetch(base+"/api/version")).json()).build,checks:[]};
const production = await (await fetch(base+"/api/production")).json();
assert.equal(production.mode,"离线示例");
assert.equal(production.workerOnline,true);
for(const mode of ["keyword","semantic","hybrid"]){
  const response=await fetch(base+"/api/rag",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({query:"GESP",persona:"demoa",mode})});
  assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();
  assert.equal(result.retrieval.mode,mode);
  assert.deepEqual(result.index,{files:[],chunks:0});
  assert.deepEqual(result.retrieval.hits,[]);
}
report.checks.push({isolatedRagModes:["keyword","semantic","hybrid"]});
async function productionPost(body){
  const r=await fetch(base+"/api/production",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)});
  const result=await r.json();
  if (!r.ok) throw Error(JSON.stringify(result));
  return result;
}
async function until(fn){
  for(let n=0;n<220;n++){
    const result=await fn();
    if(result)return result;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error("等候演示队列超时");
}
const account=await productionPost({action:"entity",kind:"account",value:{id:"phase1-"+randomUUID(),name:"会诊虚构样例账号",status:"启用",platform:"小红书",version:0}});
async function seed(topic){
  const draft=await productionPost({action:"draft",value:{
    id:randomUUID(),version:0,account:account.id,platform:"小红书",topic,kind:"图文",goal:"品宣",budgetProfile:"local_extended",experiment:"离线复验重复使用已获准的虚构选题",
    brief:{note:"以虚构校样为背景，面向练习写作的读者，用一组动作演示如何精修句子。",adjust:{},materials:[],articleRefs:[],failed:[]}
  }});
  const preview=await productionPost({action:"preview",drafts:[draft]});
  const {firstTask}=await productionPost({action:"single",id:randomUUID(),drafts:[draft],preview,tokenLimit:120000,requestLimit:32});
  await until(async()=>{
    const flow=await (await fetch(base+"/api/collaboration?taskId="+firstTask)).json();
    return flow.flow?.panels?.some(p=>p.phase==="complete");
  });
  return firstTask;
}
const article=async id=>(await (await fetch(base+"/api/articles?taskId="+id)).json());
async function writeDraft(taskId,state,document){
  const response=await fetch(base+"/api/articles",{method:"POST",headers:{origin:base,"content-type":"application/json"},
    body:JSON.stringify({action:"draft",taskId,revision:state.draft?.revision??0,baseVersion:state.head.version,title:state.draft?.title??state.head.title,document})});
  assert.equal(response.status,200,await response.clone().text());
  return response.json();
}
const editorUrl=id=>base+"/studio/editor?taskId="+id+"&review=1";
const browser=await chromium.launch({channel:"msedge",headless:true});
const page=await browser.newPage({viewport:{width:1500,height:1000}});
page.on("dialog",dialog=>void dialog.accept());
page.setDefaultTimeout(9000);
try{
 const id=await seed("会诊演练｜蓝笔与纸角");
 report.url=editorUrl(id);
 const collaborationResponse=await fetch(base+"/api/collaboration?taskId="+id);
 assert.equal(collaborationResponse.status,200);
 const {flow}=await collaborationResponse.json();
 const panel=flow.panels.find(candidate=>candidate.phase==="complete");
 assert.deepEqual(panel.reviews.map(review=>review.role),["strategy","language"]);
 assert.equal(panel.conflicts.length,2);
 for(const group of panel.conflicts){
   const alternatives=panel.reviews.flatMap(review=>review.opinions).filter(opinion=>group.includes(opinion.id));
   assert.equal(alternatives.length,2);
   assert(alternatives.every(opinion=>opinion.action==="replace"&&opinion.replacement.length>0));
   assert.notEqual(alternatives[0].replacement,alternatives[1].replacement);
 }
 assert.equal(panel.discussion.flatMap(entry=>entry.responses).length,4);
 const initial=await article(id),formatted=structuredClone(initial.head.document);
 const blueBlock=formatted.find(b=>b.children.some(n=>n.text.includes("蓝笔落在了桌上。")));
 const line=blueBlock.children[0].text,at=line.indexOf("蓝笔落在了桌上。");
 blueBlock.type="blockquote";
 blueBlock.children=[{text:line.slice(0,at),bold:true},{text:line.slice(at)}];
 const beforeConflict=await writeDraft(id,initial,formatted);
 await page.goto(report.url);
 const consultation=page.locator(".review-consultation");
 await consultation.waitFor({timeout:20000});
 const groups=consultation.locator(".creator-collapse[data-collapsed=false] .consult-conflict");
 assert.equal(await groups.count(),2);
 const score=consultation.locator(".consult-score");
 const initialScore=Number((await score.innerText()).match(/\d+/)[0]);
 assert(initialScore<65);
 assert.equal(await consultation.locator(".consult-expert-toggle[aria-expanded=true]").count(),1);
 const opening=await consultation.locator(".consult-expert").filter({has:page.locator(".consult-expert-toggle[aria-expanded=true]")}).getAttribute("data-role");
 const first=groups.filter({hasText:"蓝笔落在了桌上。"});
 const second=groups.filter({hasText:"她看了很久。"});
 const option=first.locator(".consult-options article").first();
 await option.getByRole("button",{name:"定位原文"}).click();
 await page.waitForFunction(()=>window.getSelection()?.toString()==="蓝笔落在了桌上。");
 await page.locator(".consult-overview").scrollIntoViewIfNeeded();
 await page.screenshot({path:evidence+"/01-consultation-desktop.png"});
 assert.equal(await first.locator(".consult-options").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),2);
 const discussion=consultation.locator(".consult-discussion");
 if(await discussion.getAttribute("open")===null)await discussion.locator("summary").click();
 assert.equal(await discussion.locator("li").count(),3);
 await discussion.getByRole("button",{name:/展开全部/}).click();
 assert.equal(await discussion.locator("li").count(),4);
 assert((await discussion.innerText()).includes("撤回意见"));
 assert(!(await discussion.innerText()).includes("赞同"));
 const replacement=await option.locator(".consult-option-text").innerText();
 await writeDraft(id,beforeConflict,formatted);
 await option.getByRole("button",{name:"替换原文"}).click();
 await consultation.getByRole("alert").filter({hasText:"其他窗口"}).waitFor();
 assert.equal((await article(id)).draft.reviewEdits.length,0);
 assert(await page.locator(".article-body").innerText().then(text=>text.includes("蓝笔落在了桌上。")));
 await page.reload();
 await option.getByRole("button",{name:"替换原文"}).click();
 await consultation.getByText(/查看已处理的分歧/).waitFor();
 await consultation.locator(".creator-collapse[data-collapsed=true]").filter({hasText:"蓝笔落在了桌上。"}).waitFor({state:"hidden"});
 await second.getByRole("button",{name:"自定义合并"}).click();
 await second.getByRole("textbox").fill("她把校样转向灯下，将那一行重新读了一遍。");
 await second.getByRole("button",{name:"替换为合并文字"}).click();
 await consultation.getByText("查看已处理的分歧 · 2 处",{exact:true}).waitFor();
 const revisedBefore=await article(id);
 assert.equal(revisedBefore.draft.reviewEdits.length,2);
 const editedBlock=revisedBefore.draft.document.find(b=>b.children.some(n=>n.text.includes(replacement)));
 assert.equal(editedBlock.type,"blockquote");
 assert.deepEqual(editedBlock.children[0],blueBlock.children[0]);
 assert(!editedBlock.children.find(leaf=>leaf.text.includes(replacement)).bold);
 if(await consultation.locator(".consult-overview").getAttribute("open")===null)await consultation.locator(".consult-overview summary").click();
 const finalScore=Number((await score.innerText()).match(/\d+/)[0]);assert(finalScore>initialScore);
 await page.reload();
 await consultation.getByText(/查看已处理的分歧/).waitFor();
 await consultation.locator(".creator-collapse[data-collapsed=true]").filter({hasText:"蓝笔落在了桌上。"}).waitFor({state:"hidden"});
 await consultation.getByText("查看已处理的分歧 · 2 处",{exact:true}).waitFor();
 if(await consultation.locator(".consult-overview").getAttribute("open")===null)await consultation.locator(".consult-overview summary").click();
 const experts=consultation.locator(".consult-experts");
 if(await experts.getAttribute("open")===null)await experts.locator("summary").click();
 let rewrite=consultation.getByRole("button",{name:"一键改写"});
 if(!await rewrite.isVisible())await consultation.locator('[data-role="strategy"] > .consult-expert-toggle').click();
 const generated=page.waitForResponse(response=>response.url()===base+"/api/articles"&&response.request().method()==="POST"&&response.request().postDataJSON().action==="generate-edit");
 await rewrite.click();
 const generatedResponse=await generated;
 assert.equal(generatedResponse.status(),200);
 assert.deepEqual(await generatedResponse.json(),{text:"她把纸角压平，指尖沿着折痕缓慢滑过。"});
 await consultation.getByText("已修改",{exact:true}).waitFor();
 await page.getByRole("button",{name:"一键生成并插入"}).click();
 await page.getByText("查看已处理的建议",{exact:true}).click();
 await page.getByText(/已插入正文$/).waitFor();
 const version=await article(id),body=version.draft.document.map(b=>b.children.map(n=>n.text).join("")).join("\n");
 assert(body.includes(replacement));
 assert(body.includes("她把校样转向灯下，将那一行重新读了一遍。"));
 assert(body.includes("她把纸角压平，指尖沿着折痕缓慢滑过。"));
 const added="如果是你，会用哪个动作表现她的犹豫？";
 assert.equal(body.split(added).length,2);
 assert(body.indexOf(added)<body.indexOf("## 配图计划"));
 assert.equal(version.head.version,revisedBefore.head.version);
 assert.notEqual(version.head.confirmed,true);
 await page.reload();await page.getByText("查看已处理的建议",{exact:true}).click();
 await page.getByText(/已插入正文$/).waitFor();
 assert.equal(await page.getByRole("button",{name:"一键生成并插入"}).count(),0);
 assert.deepEqual((await article(id)).draft,version.draft);
 await page.setViewportSize({width:390,height:844});
 await consultation.getByText("查看已处理的分歧 · 2 处",{exact:true}).click();
 const handled=consultation.locator("details .consult-conflict").filter({hasText:"蓝笔落在了桌上。"});
 await handled.scrollIntoViewIfNeeded();
 assert.equal(await handled.locator(".consult-options").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:evidence+"/02-consultation-390.png"});
 report.checks.push({id,version:version.head.version,opening,initialScore,finalScore,expanded:4,operations:version.draft.reviewEdits.length,endingInsertedOnce:true,formatPreserved:true,staleSaveRejected:true});
 const legacy=await seed("分歧演练｜旧流程回归");
 const history=await until(async()=>{const a=await article(legacy);return a.versions?.length>1&&a;});
 assert(history.head.body.includes("她停下来。"));
 assert.equal(history.head.body.split("她停下来。").length,2);
 report.checks.push({legacy,versions:history.versions.map(v=>v.version)});
 report.demoUrl=editorUrl(await seed("会诊演练｜从原句开始"));
 await writeFile(evidence+"/acceptance.json",JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
