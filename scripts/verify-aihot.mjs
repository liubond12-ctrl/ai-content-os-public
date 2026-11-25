import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {mkdtempSync,writeFileSync,readFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
const root=mkdtempSync(join(tmpdir(),"hot-browser-")),file=join(root,"studio.sqlite"),base="http://127.0.0.1:39226";
const server=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","39226"],{windowsHide:true,env:{...process.env,STUDIO_NEXT_DIST_DIR:process.env.STUDIO_NEXT_DIST_DIR||".next",STUDIO_DB:file,STUDIO_LIBRARY_DB:join(root,"library.sqlite")},stdio:"pipe"});
server.stdout.resume();server.stderr.on("data",d=>console.error(String(d)));
let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({channel:"msedge",headless:true});const page=await browser.newPage({viewport:{width:1440,height:960}});
  await page.goto(base);await page.locator(".ck-hot").waitFor();await page.screenshot({path:"docs/evidence/hot-home-wide.png"});assert.equal(await page.getByRole("link",{name:"今日热点",exact:true}).count(),2);await page.locator(".ck-hot").click();
  await page.locator("article h3").first().waitFor();const latest=await page.locator("article").count();
  await page.waitForURL("**/hot");assert.equal(await page.locator(".hot-ranks li").count(),5);const dates=await page.locator(".hot-day>h2").allTextContents();assert.ok(dates.length>1);await page.screenshot({path:"docs/evidence/hot-reader-wide.png"});
  await page.locator(".hot-ranks li a").first().click();await page.waitForURL(/story=/);await page.locator(".hot-report").first().waitFor();await page.goto(base+"/hot");await page.getByText("继续阅读较早报道").click();await page.waitForURL(/cursor=/);assert.ok(await page.locator("article").count());await page.goto(base+"/hot");
  const first=page.locator("article").first(),needle=(await first.locator("h3").innerText()).slice(0,8);await page.getByRole("searchbox").fill(needle);await page.getByRole("button",{name:"筛选"}).click();await page.waitForURL(/q=/);await first.getByText("摘要与来源").click();await first.getByRole("button",{name:"标为已读"}).click();await first.locator(".hot-byline").getByText("已读").waitFor();await page.getByLabel("仅未读").check();await page.getByRole("button",{name:"筛选"}).click();await page.waitForURL(/unread=/);assert.equal(await page.locator(".hot-byline").getByText("已读",{exact:true}).count(),0);
  await page.setViewportSize({width:390,height:844});await page.goto(base);await page.locator(".ck-hot").waitFor();await page.screenshot({path:"docs/evidence/hot-home-narrow.png"});await page.locator(".ck-hot").click();await page.waitForURL("**/hot");await page.locator(".hot-ranks").waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:"docs/evidence/hot-reader-narrow.png"});await page.locator(".hot-day").first().scrollIntoViewIfNeeded();await page.screenshot({path:"docs/evidence/hot-stream-narrow.png"});await page.setViewportSize({width:1440,height:960});
  await page.getByRole("link",{name:"日报",exact:true}).click();await page.waitForURL("**/hot?tab=daily");await page.locator("article h3").first().waitFor();
  await page.getByRole("link",{name:"事件榜",exact:true}).click();await page.waitForURL("**/hot?tab=events");const card=page.locator("article").first();await card.waitFor();
  const titles=await page.locator("article h3").allTextContents();assert.equal(new Set(titles).size,titles.length);
  await page.reload();assert.deepEqual(await page.locator("article h3").allTextContents(),titles);
  await card.getByText("摘要与来源").click();const href=await card.getByRole("link",{name:"打开原始来源"}).getAttribute("href");
  const popup=page.waitForEvent("popup");await card.getByRole("link",{name:"打开原始来源"}).click();const external=await popup;await external.waitForURL(url=>url.protocol==="https:",{waitUntil:"commit",timeout:15000}).catch(()=>{});const opened=external.url();const originStatus=(await fetch(href,{signal:AbortSignal.timeout(10000)})).status;assert.ok(originStatus>=200&&originStatus<400);await external.close();
  await card.getByRole("link",{name:"查看事件进展"}).click();await page.waitForURL(/story=/);await page.locator("article h3").first().waitFor();const reports=await page.locator("article").count();
  await page.screenshot({path:"docs/evidence/aihot-timeline.png"});
  await page.getByRole("link",{name:"事件榜",exact:true}).click();await page.waitForURL("**/hot?tab=events");await card.getByText("摘要与来源").click();await card.getByRole("button",{name:"标为已读"}).click();await card.getByText(/已读/).waitFor();
  await card.getByText("收藏",{exact:true}).click();await card.getByLabel("个人备注").fill("验收选题线索");await card.getByRole("button",{name:"保存收藏"}).click();await card.getByText("已收藏",{exact:true}).waitFor();
  await page.reload();await card.getByText(/已读/).waitFor();await card.getByText("已收藏",{exact:true}).waitFor();
  await page.goto(base+"/articles?q="+encodeURIComponent("验收选题线索"));await page.getByRole("link",{name:/在热点收藏中查找/}).click();await page.waitForURL(/tab=saved/);assert.equal(await page.locator("article").count(),1);
  await page.screenshot({path:"docs/evidence/aihot-bookmark.png"});await page.getByRole("button",{name:"作为选题"}).click();
  await page.waitForURL(/production\/create\?draft=/);await page.getByLabel("选题",{exact:true}).waitFor();
  const db=new DatabaseSync(file);try{const d=JSON.parse(db.prepare("SELECT payload FROM production_drafts").get().payload);assert.equal(d.intent,"draft");assert.ok(d.requirements.includes(href));assert.equal(db.prepare("SELECT count(*) n FROM production_queue").get().n,0);assert.equal(db.prepare("SELECT count(*) n FROM hot_saved").get().n,1);}finally{db.close();}
  writeFileSync("docs/evidence/aihot-browser.json",JSON.stringify({build:readFileSync(join(process.env.STUDIO_NEXT_DIST_DIR||".next","BUILD_ID"),"utf8"),latest,dates,events:titles.length,reports,href,opened,originStatus,readPersisted:true,bookmarkFound:true,draftWithSource:true,queued:0},null,2));
}finally{await browser?.close();server.kill();}
