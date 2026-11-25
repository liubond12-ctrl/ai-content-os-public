import {chromium} from "playwright";
import {spawn,execFileSync} from "node:child_process";
import {mkdtemp,readdir,readFile,writeFile,stat} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import assert from "node:assert/strict";
const folder=await mkdtemp(path.join(tmpdir(),"content-completion-")),dest=path.join(folder,"restored"),lines=[];
for(const [mode,src,target] of [["backup","data",folder+"/backup"],["restore",folder+"/backup",dest]])execFileSync(process.execPath,["scripts/archive-workbench.mjs",mode,src,target]);
const sample=JSON.parse(await readFile("docs/evidence/workbench/normal.json","utf8"));
const cases=JSON.parse(await readFile("docs/evidence/phase3.5-professional-tests.json","utf8")).slice(0,3);
const d=new DatabaseSync(path.join(dest,"studio.sqlite"));
try{
 const dirs=await Promise.all((await readdir(tmpdir())).filter(x=>x.startsWith("professional-")).map(async x=>({x,time:(await stat(path.join(tmpdir(),x))).mtimeMs})));
 const found=new Set();
 for(const {x} of dirs.sort((a,b)=>b.time-a.time)){
  const file=path.join(tmpdir(),x,"studio.sqlite");if(!await stat(file).catch(()=>null))continue;
  d.prepare("ATTACH DATABASE ? AS fixture").run(file);
  try{
   const row=d.prepare("SELECT task FROM fixture.collaboration LIMIT 1").get(),id=row?.task;
   if(found.has(id)||!cases.some(c=>c.flow.taskId===id))continue;
   for(const [table,col] of [["versions","id"],["article_snapshots","task_id"],["collaboration","task"],["reviews","task"],["model_calls","task_id"]])d.prepare("INSERT INTO main."+table+" SELECT * FROM fixture."+table+" WHERE "+col+"=?").run(id);
   found.add(id);
  }finally{d.exec("DETACH fixture");}
  if(found.size===3)break;
 }
 assert.equal(found.size,3);
}finally{d.close();}
const root="http://127.0.0.1:3298",app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3298","-H","127.0.0.1"],{windowsHide:true,stdio:"ignore",env:{...process.env,STUDIO_DB:dest+"/studio.sqlite",STUDIO_LIBRARY_DB:dest+"/content-library.sqlite",STUDIO_MODEL_KEY:"",STUDIO_MODEL_URL:"http://127.0.0.1:1/mock"}});
const browser=await chromium.launch({channel:"msedge",headless:true});
try{
 for(let i=0;i<80;i++){if(await fetch(root).then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,150));}
 const p=await browser.newPage();
 await p.goto(root);await p.getByLabel("按文章标题查找").fill(sample.title);await p.getByRole("button",{name:"查找",exact:true}).click();await p.locator('a[href*="'+sample.id+'"]').filter({hasText:sample.title}).first().click();
 const download=p.waitForEvent("download");await p.getByText("导出正文 · v"+sample.version+" Markdown").click();assert.equal(await readFile(await (await download).path(),"utf8"),await readFile("docs/evidence/workbench/最后一张校样.md","utf8"));lines.push("从恢复实例首页按标题找回定稿，下载文件与交付正文逐字相同。");
 for(const c of cases){
  await p.goto(root+"/studio/editor?taskId="+c.flow.taskId);await p.getByText(c.flow.panels[0].reason,{exact:false}).first().waitFor();
  if(c.case==="讨论裁决修订复审"){
   await p.getByText(/不同意见 ·/).first().waitFor();await p.getByText(/裁决 ·/).first().waitFor();await p.getByText(/查看 v3 原句/).first().click();await p.locator(".article-location mark").waitFor();
   assert.equal(await p.locator(".article-location mark").textContent(),c.flow.panels[0].reviews[0].opinions[0].issue.quote);
  }else if(c.case==="合格无讨论"){assert.equal(await p.getByText(/裁决 ·/).count(),0);}
  else await p.getByText(/事实核对 ·/).first().waitFor();
  lines.push(c.case+"：浏览器与模拟执行记录吻合；任务 "+c.flow.taskId);
 }
 // Synthetic running step exists only in the restored copy. The timeout transition uses the real controller.
 const fixtureId=cases[0].flow.taskId,db=new DatabaseSync(path.join(dest,"studio.sqlite"));
 const seed=(age)=>{const f=structuredClone(cases[0].flow);f.state="running";f.executions.at(-1).started=new Date(Date.now()-age).toISOString();db.prepare("UPDATE collaboration SET payload=? WHERE task=?").run(JSON.stringify(f),fixtureId);};
 try{
  seed(1000);await p.goto(root+"/studio/editor?taskId="+fixtureId);
  await p.getByRole("button",{name:"停止协作"}).click();await p.getByRole("status").filter({hasText:"已停止"}).waitFor();
  await p.reload();await p.getByRole("status").filter({hasText:"已停止"}).waitFor();
  assert.equal(await p.getByRole("button",{name:"继续下一步"}).count(),0);
  seed(360000);await p.reload();await p.getByRole("status").filter({hasText:"请求结果未知"}).waitFor();
  assert.equal(await p.getByRole("button",{name:"重试未完成步骤"}).count(),0);lines.push("恢复副本中的停止、刷新找回、过期执行和未知结果不重发通过；重复调度及在途回执另由控制器测试覆盖。");
 }finally{db.close();}
 await p.setViewportSize({width:390,height:844});await p.goto(root);await p.getByRole("heading",{name:"创作工作台"}).waitFor();
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.getByLabel("创作需求").focus();await p.keyboard.type("sample");await p.keyboard.press("Enter");await p.getByLabel("内容主题").waitFor();lines.push("390px 首页无横向溢出；键盘提交创作需求进入普通表单。");
 await writeFile("docs/evidence/workbench/completion-checks.txt",lines.join("\n")+"\n");console.log(lines);
}finally{await browser.close();app.kill();}

