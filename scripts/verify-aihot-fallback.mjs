import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {mkdtempSync,writeFileSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import assert from "node:assert/strict";
const folder=mkdtempSync(join(tmpdir(),"hot-fallback-")),mock=join(folder,"upstream.cjs"),url="http://127.0.0.1:39227";
writeFileSync(mock,`const real=global.fetch;
global.fetch=async(input,init)=>{const url=new URL(input.url||input);if(url.hostname!=="aihot.news")return real(input,init);
return url.pathname.endsWith("/dailies")?Response.json({items:[]}):new Response(null,{status:502});};`);
const child=spawn(process.execPath,["--require",mock,"node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p","39227"],{env:{...process.env,STUDIO_NEXT_DIST_DIR:process.env.STUDIO_NEXT_DIST_DIR||".next",STUDIO_DB:join(folder,"studio.sqlite"),STUDIO_LIBRARY_DB:join(folder,"library.sqlite")},stdio:"ignore",windowsHide:true});
let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break;}catch{}await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({channel:"msedge",headless:true});const p=await browser.newPage();
  await p.goto(url+"/hot");await p.getByText(/暂时无法确认最新内容/).first().waitFor();assert.ok(await p.getByRole("link",{name:"重试"}).isVisible());assert.equal(await p.getByRole("link",{name:"访问原站 ↗",exact:true}).getAttribute("href"),"https://aihot.news");
  await p.goto(url+"/hot?tab=daily");await p.getByText("当前没有条目。").waitFor();
  console.log("隔离上游 HTTP 502 与空日报均通过");
}finally{await browser?.close();child.kill();}
