// Real browser/data-flow acceptance using an isolated synthetic DB; no model calls.
import {chromium} from "playwright";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import assert from "node:assert/strict";
const directory=mkdtempSync(path.join(tmpdir(),"plate-acceptance-"));
const database=path.join(directory,"studio.sqlite"),id=randomUUID();
const body="第一段🪁。\n\n重复！重复！\n最后一段。";
const task={id,revision:3,stage:"done",input:{persona:"general",topic:"原创虚构编辑验收",format:"图文文章",mode:"keyword",audience:"",reference:""},records:[],
  research:{version:2,status:"ready_with_limits",questions:[],evidence:[],model:"offline-synthetic"},
  article:{version:3,researchVersion:2,title:"合上的窗",body,citations:["synthetic-only"],model:"offline-synthetic",reviewLabel:"限定范围草稿，待人工审核"}};
const db=new DatabaseSync(database);
db.exec("CREATE TABLE versions(id TEXT, rev INTEGER, payload TEXT, PRIMARY KEY(id,rev)); CREATE TABLE reviews(id TEXT PRIMARY KEY,task TEXT,article INTEGER,version INTEGER,payload TEXT,UNIQUE(task,article,version))");
db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,3,JSON.stringify(task));
const review={id:randomUUID(),taskId:id,articleVersion:3,version:1,createdAt:new Date().toISOString(),status:"revise",model:"模拟审核（仅界面验收）",rules:[],sourceIds:[],result:{label:"普通",dimensions:{表达质量:"虚构测试意见，不代表模型判断"},issues:[{field:"body",quote:"重复！",offset:body.lastIndexOf("重复！"),type:"表达",severity:"明显",reason:"重复出现",suggestion:"删去重复句"}],facts:{triggered:false,checks:[]}}};
db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(review.id,id,3,1,JSON.stringify(review));db.close();
const port=Number(process.env.EDITOR_TEST_PORT??3015),base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{
  cwd:process.cwd(),windowsHide:true,env:{...process.env,STUDIO_DB:database,STUDIO_LIBRARY_DB:path.join(directory,"library.sqlite"),
    STUDIO_MODEL:"",STUDIO_MODEL_KEY:"",STUDIO_MODEL_URL:"http://127.0.0.1:1/no-model",STUDIO_SAFE_DEMO_APPROVED_SHA256:"",STUDIO_SAFE_EVAL_APPROVED_SHA256:""},stdio:"pipe"});
let output="";server.stdout.on("data",b=>{output+=b;});server.stderr.on("data",b=>{output+=b;});
async function eventually(fn){let last;for(let n=0;n<100;n++){try{const value=await fn();if(value)return value;}catch(e){last=e;}await new Promise(r=>setTimeout(r,100));}throw last??Error("等待超时");}
const results=[],errors=[];let browser;
try{
  await eventually(async()=>{if(server.exitCode!==null)throw Error(output);return (await fetch(base+"/api/articles?taskId="+id)).ok;});
  browser=await chromium.launch({channel:"msedge",headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  await context.route("**/*",route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
  const url=base+"/studio/editor?taskId="+id;
  const data=()=>fetch(base+"/api/articles?taskId="+id).then(r=>r.json());
  await page.goto(url);await page.getByLabel("文章标题",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("文章标题",{exact:true}).inputValue(),"合上的窗");
  assert.equal((await data()).head.body,body);results.push("旧文章完整读取，原正式版本未变");
  await page.getByRole("button",{name:"定位原文",exact:true}).click();
  assert.equal(await page.locator(".article-location mark").textContent(),"重复！");
  mkdirSync("docs/evidence",{recursive:true});await page.screenshot({path:"docs/evidence/phase3.4-review.png",fullPage:true});
  results.push("模拟审核 UTF-16 引用准确定位第二处重复句");
  await page.getByLabel("文章标题",{exact:true}).fill("编辑后的窗🪁");
  await eventually(async()=>(await data()).draft?.title==="编辑后的窗🪁");
  assert.match(await page.getByText("草稿已有修改",{exact:false}).textContent(),/正式版本 v3/);
  await page.reload();await page.getByLabel("文章标题",{exact:true}).waitFor();
  assert.equal(await page.getByLabel("文章标题",{exact:true}).inputValue(),"编辑后的窗🪁");
  results.push("自动保存并刷新恢复；旧审核标记过时");
  const editable=page.getByLabel("文章正文",{exact:true});await editable.click();await editable.press("Control+End");await page.keyboard.insertText("新写的一句。");
  for(const [label,type] of [["一级标题","h1"],["二级标题","h2"],["引用","blockquote"],["段落","p"]]){
    await page.getByRole("button",{name:label,exact:true}).click();
    await eventually(async()=>(await data()).draft?.document.at(-1)?.type===type);
  }
  await page.getByRole("button",{name:"加粗",exact:true}).click();await page.keyboard.insertText("加粗测试");
  await eventually(async()=>(await data()).draft?.document.at(-1)?.children.some(l=>l.bold&&l.text.includes("加粗测试")));
  await page.getByRole("button",{name:"列表",exact:true}).click();
  await eventually(async()=>(await data()).draft?.document.some(b=>b.type==="li"));
  assert.match((await data()).draft.document.map(b=>b.children.map(l=>l.text).join("")).join("\n"),/新写的一句/);
  results.push("Plate 正文编辑、两级标题、引用、段落、加粗及列表转换保存");
  await page.getByRole("button",{name:"保存正式版本",exact:true}).click();
  await eventually(async()=>(await data()).head.version===4);
  assert.equal((await data()).versions.find(v=>v.version===3).body,body);
  results.push("正式保存 v4，保留 v3 原文与研究 v2");
  await page.route("**/api/articles",route=>route.request().method()==="POST"?route.abort("failed"):route.continue());
  await page.getByLabel("文章标题",{exact:true}).fill("失败后保留的输入");
  await page.getByRole("status").filter({hasText:"保存失败"}).waitFor();
  assert.equal(await page.getByLabel("文章标题",{exact:true}).inputValue(),"失败后保留的输入");
  await page.unroute("**/api/articles");await page.getByRole("button",{name:"重试保存草稿",exact:true}).click();
  await eventually(async()=>(await data()).draft?.title==="失败后保留的输入");results.push("网络失败保留输入，显式重试成功");
  const tab=await context.newPage();await tab.goto(url);await tab.getByLabel("文章标题",{exact:true}).waitFor();
  await page.getByLabel("文章标题",{exact:true}).fill("先保存的窗口");await eventually(async()=>(await data()).draft?.title==="先保存的窗口");
  await tab.getByLabel("文章标题",{exact:true}).fill("过期窗口保留输入");await tab.getByRole("alert").filter({hasText:"其他窗口"}).waitFor();
  assert.equal((await data()).draft.title,"先保存的窗口");assert.equal(await tab.getByLabel("文章标题",{exact:true}).inputValue(),"过期窗口保留输入");await tab.close();
  results.push("多标签页过期保存返回冲突，未覆盖较新草稿");
  await page.getByLabel("历史版本",{exact:false}).selectOption("3");await page.getByText("版本差异（纯文本，包含标题）",{exact:true}).click();
  await page.getByLabel("比较基准",{exact:false}).selectOption("4");assert.ok(await page.locator("del").textContent());
  page.once("dialog",dialog=>dialog.accept());await page.getByRole("button",{name:"恢复此版本为新版本",exact:true}).click();
  await eventually(async()=>(await data()).head.version===5);const final=await data();
  assert.equal(final.head.body,body);assert.equal(final.head.origin,"restore");assert.equal(final.head.restoredFrom,3);assert.equal(final.versions.length,3);
  assert.equal(final.head.researchVersion,2);assert.equal(await page.locator("aside").getByText("模拟审核",{exact:false}).count(),0);
  results.push("历史差异、恢复创建 v5、新版本不继承旧审核");
  assert.deepEqual(errors,[]);
  mkdirSync("docs/evidence",{recursive:true});await page.screenshot({path:"docs/evidence/phase3.4-editor.png",fullPage:true});
  const check=new DatabaseSync(database,{readOnly:true});assert.equal(check.prepare("SELECT COUNT(*) AS n FROM versions").get().n,1);
  const callTable=check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='model_calls'").get();
  assert.equal(callTable?check.prepare("SELECT COUNT(*) AS n FROM model_calls").get().n:0,0);check.close();
  const build=await fetch(base+"/api/version").then(r=>r.json());
  const report={date:new Date().toISOString(),browser:"Microsoft Edge headless",build,taskId:id,database,results,consoleErrors:errors,modelCalls:0,synthetic:true};
  writeFileSync("docs/evidence/phase3.4-browser.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser?.close();server.kill();}
