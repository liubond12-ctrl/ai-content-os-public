import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createHash} from "node:crypto";
import {chromium} from "playwright";
const cfg=JSON.parse(readFileSync(process.argv[2]||join(tmpdir(),"discussion-fixture.json"),"utf8").replace(/^\uFEFF/,""));
const ids={clean:"70da2431-f982-4b64-b985-2e1bc126e5be",revised:"e5f3fe7b-d30c-46e2-9f49-9288911e7c15",facts:"4e27a2e4-1555-4431-a812-25f74f3785a7",judge:"1354c2e5-4d3b-4506-8003-bef56ec3dadb",deterministic:"9fa4ea7b-57ee-49d2-bb1e-29f5c83f9f47",author:cfg.authorTask,missing:cfg.missing};
function fingerprint(name){
 const db=new DatabaseSync(join(cfg.folder,name,"studio.sqlite"),{readOnly:true});
 try{
   const counts={},hash=createHash("sha256");
   for(const table of ["model_calls","versions","article_snapshots","collaboration","production_queue"]){
     counts[table]=db.prepare("SELECT count(*) n FROM "+table).get().n;
     for(const row of db.prepare("SELECT * FROM "+table+" ORDER BY rowid").iterate())hash.update(JSON.stringify(row));
   }
   return {counts,hash:hash.digest("hex")};
 }finally{db.close();}
}
const before={demo:fingerprint("demo"),real:fingerprint("real")},post=[];
const browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on("request",r=>{if(r.method()==="POST")post.push(r.url());});
const reader=page.locator(".discussion-reader"),demo="http://127.0.0.1:3591",real="http://127.0.0.1:3592";
async function task(base,id){
 await page.goto(base+"/studio?taskId="+id+"&discussion=1#task-discussion");await reader.waitFor();
}
async function round(version){const sel=reader.getByRole("combobox");const option=sel.locator("option").filter({hasText:"文章 v"+version+" ·"});await sel.selectOption(await option.getAttribute("value"));}
async function keyboardOpen(detail){const s=detail.locator(":scope > summary");await s.focus();await s.press("Enter");assert.equal(await detail.getAttribute("open"),"");}
async function screenshot(file){await reader.scrollIntoViewIfNeeded();await reader.evaluate(e=>e.scrollIntoView({block:"start"}));await page.screenshot({path:"docs/evidence/"+file});}
try{
 await page.goto(demo+"/production/tasks?q="+encodeURIComponent("无分歧：窗前便笺"));await page.getByRole("link",{name:/查看审核争议/}).click();await reader.getByText(/无实质分歧 · 已跳过讨论/).waitFor();await reader.getByRole("heading",{name:"本轮审核通过"}).waitFor();
 await task(demo,ids.revised);await round(6);const issue=reader.locator(".dr-issue").first();await keyboardOpen(issue);
 await issue.getByRole("heading",{name:"讨论回应"}).waitFor();await issue.getByText(/删除无信息重复，保留其余栏目/).waitFor();
 assert.match(await issue.innerText(),/新版|v7/);await issue.getByText(/已删除/).waitFor();await screenshot("discussion-wide.png");
 const spot=issue.getByRole("link",{name:"定位 v6 原句 →"}).first();await spot.click();await page.waitForURL(/\/studio\/editor/);
 const marked=page.locator("mark.history-anchor");await marked.waitFor();const loc=new URL(page.url()).searchParams;assert.equal(loc.get("version"),"6");
 assert.equal(await marked.innerText(),"她停下来。");const beforeMark=await marked.evaluate(e=>e.previousSibling.textContent);assert.equal(beforeMark.length,Number(loc.get("at")));assert.ok(beforeMark.endsWith("她停下来。"));await marked.evaluate(e=>e.scrollIntoView({block:"center",behavior:"instant"}));await page.screenshot({path:"docs/evidence/discussion-original.png"});
 await page.getByRole("button",{name:"查看协作审核"}).click();await round(6);const editorIssue=reader.locator(".dr-issue").first();await keyboardOpen(editorIssue);await editorIssue.getByRole("button",{name:"定位 v6 原句"}).first().click();assert.equal(await marked.innerText(),"她停下来。");
 await task(real,ids.facts);await reader.getByRole("heading",{name:"事实或安全检查受阻"}).waitFor();assert.ok(await reader.getByText(/补充可核实的依据/).count());const fact=reader.locator(".dr-issue").filter({hasText:"关键事实"}).first();await keyboardOpen(fact);await fact.getByRole("link",{name:/定位/}).waitFor();
 await task(real,ids.judge);await reader.getByText("历史审核 · v7").waitFor();await reader.getByRole("heading",{name:"Judge 未形成有效裁决"}).waitFor();
 await reader.getByText(/已到 v8/).waitFor();const disputes=reader.locator(".dr-issue").filter({has:page.locator("summary span").filter({hasText:"争议"})});assert.equal(await disputes.count(),1);await keyboardOpen(disputes.first());assert.equal(await disputes.getByText(/Judge 引用未知、重复或不相关意见/).count(),1);
 await page.setViewportSize({width:390,height:844});await screenshot("discussion-narrow.png");assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await task(real,ids.deterministic);await round(6);await reader.getByText(/确定性修订/).waitFor();const diff=reader.locator("details").filter({has:page.locator("summary").filter({hasText:"对照正式版本 v6 → v7"})}).last();await keyboardOpen(diff);assert.ok((await diff.locator("del").count())>0);
 await task(demo,ids.author);await reader.getByRole("heading",{name:"已记录作者决定"}).waitFor();await reader.getByText(/作者记录：删除无信息重复/).waitFor();const humanIssue=reader.locator(".dr-issue").first();await keyboardOpen(humanIssue);await humanIssue.getByText(/作者决定 · v7 · 采纳修改/).waitFor();
 await page.goto(demo+"/studio?taskId="+ids.missing+"&discussion=1");await page.getByText(/暂无协作记录 · 配置审核/).waitFor();assert.deepEqual(post,[]);
 const after={demo:fingerprint("demo"),real:fingerprint("real")};assert.deepEqual(after,before);
 writeFileSync("docs/evidence/discussion-reader-acceptance.json",JSON.stringify({build:readFileSync(".next/BUILD_ID","utf8"),ids,checks:["从全部任务打开无分歧审核","有效裁决、实际删除、v7 复审","历史原句两处重复，定位 v6 第二处","编辑器内部定位","关键事实阻断","无效 Judge 引用、两组冲突合一、作者新版 v8","真实云端确定性修订差异","作者选择与复审分开","缺少协作记录","键盘展开与窄屏无横向溢出"],before,after,post},null,2));
}finally{await browser.close();}
