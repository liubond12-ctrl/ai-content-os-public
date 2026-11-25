import {callbackDispatcher} from "./feishu-card-socket.mjs";
import {chromium} from "playwright";
import {spawn,spawnSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
const folder=mkdtempSync(join(tmpdir(),"feishu-card-browser-")),file=join(folder,"studio.sqlite");
if(process.argv[2])copyFileSync(process.argv[2],file);
else{
 const generated=spawnSync(process.execPath,["node_modules/vitest/vitest.mjs","run","tests/feishu-cards.test.ts","-t","个人方案 A"],{env:{...process.env,FS_CAPTURE_DB_FILE:file},windowsHide:true,encoding:"utf8"});
 if(generated.status!==0)throw Error(generated.stdout+generated.stderr);
}
const base="http://127.0.0.1:39252",key=randomUUID(),env={...process.env,STUDIO_DB:file,STUDIO_LIBRARY_DB:join(folder,"library.sqlite"),STUDIO_NEXT_DIST_DIR:".next",FEISHU_CARD_LIVE_APPROVED:"0",FEISHU_CARD_WORKER_KEY:key,FEISHU_CARD_WORKBENCH:base};
const db=new DatabaseSync(file);const start=args=>spawn(process.execPath,args,{env,stdio:"ignore",windowsHide:true});
const server=start(["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","39252"]);
let browser,worker;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const wait=async fn=>{for(let i=0;i<100;i++){if(await fn())return;await pause(150);}throw Error("等待超时");};
try{
 await wait(async()=>{try{return (await fetch(base)).ok;}catch{return false;}});
 const before=db.prepare("SELECT count(*) n FROM model_calls").get().n;
 const row=db.prepare("SELECT * FROM fs_outbox WHERE json_extract(card,'$.kind')='choice'").get(),c=JSON.parse(row.card);
 const body={mode:"mock",action:"callback",event:{operator:{open_id:"local-preview-author"},context:{open_message_id:row.message},action:{value:{decision:row.id,action:"B"}}}};
 const call=()=>fetch(base+"/api/feishu-cards/worker",{method:"POST",headers:{authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await fetch(base+"/api/feishu-cards/worker",{method:"POST"})).status,403);
 const startMs=performance.now(),r=await call();assert.equal((await r.json()).message,"决定已接收");const ackMs=performance.now()-startMs;assert.ok(ackMs<3000);
 const dispatcher=callbackDispatcher(async(data,timeout)=>{
    const res=await fetch(base+"/api/feishu-cards/worker",{method:"POST",headers:{authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({mode:"mock",...data}),signal:AbortSignal.timeout(timeout)});assert.ok(res.ok);return res.json();
  });
  const sdkAck=await dispatcher.invoke({schema:"2.0",header:{event_type:"card.action.trigger",event_id:"fixture-event",app_id:"cli_fixture"},event:body.event},{needCheck:false});
  assert.equal(sdkAck.toast.content,"决定已接收");
 worker=start(["scripts/feishu-notifier.mjs"]);
 await wait(()=>db.prepare("SELECT status FROM fs_inbox WHERE id=?").get(row.id)?.status==="closed");
 browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});
 await page.goto(base+"/studio/settings");await page.getByRole("link",{name:"通知设置与卡片预览 →"}).click();
 await page.getByText(/通知进程在线/).waitFor();await page.getByText(/已完成 · 正文 v/).waitFor();
 const samples=page.getByRole("heading",{name:"隔离样例预览"});await samples.scrollIntoViewIfNeeded();await page.locator(".fs-previews").screenshot({path:"docs/evidence/feishu-cards-preview.png"});
 await page.getByLabel("批次汇总",{exact:true}).uncheck();await page.getByRole("button",{name:"保存通知设置"}).click();
 await wait(()=>!JSON.parse(db.prepare("SELECT settings FROM fs_notify WHERE mode='mock'").get().settings).batch);
 await page.reload();assert.equal(await page.getByLabel("批次汇总",{exact:true}).isChecked(),false);
 await page.getByRole("heading",{name:"最近通知"}).scrollIntoViewIfNeeded();await page.screenshot({path:"docs/evidence/feishu-cards-result.png"});
 const ended=new Promise(ok=>worker.once("exit",ok));worker.kill();await ended;worker=start(["scripts/feishu-notifier.mjs"]);assert.match((await (await call()).json()).message,/已完成/);
 assert.equal(db.prepare("SELECT count(*) n FROM model_calls").get().n,before);assert.equal(db.prepare("SELECT count(*) n FROM fs_sim_messages").get().n,3);
 const article=JSON.parse(db.prepare("SELECT payload FROM article_snapshots WHERE task_id=? ORDER BY version DESC LIMIT 1").get(c.task).payload);
 assert.equal(article.version,c.version+1);assert.equal(article.confirmed,false);
 const queue=db.prepare("SELECT status,reason FROM production_queue WHERE task=?").get(c.task);assert.equal(queue.status,"待人工审核");
 writeFileSync("docs/evidence/feishu-cards-acceptance.json",JSON.stringify({build:readFileSync(".next/BUILD_ID","utf8"),transport:"local mock",httpAckMs:+ackMs.toFixed(1),tasks:2,sentMessages:3,modelCallsBefore:before,modelCallsAfter:before,articleBefore:c.version,articleAfter:article.version,confirmed:article.confirmed,queue,sdkCallbackReplay:true,realMessages:0},null,2));
}finally{await browser?.close();worker?.kill();server.kill();db.close();}
