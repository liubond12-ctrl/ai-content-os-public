import {DatabaseSync} from "node:sqlite";
import {chromium} from "playwright";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import assert from "node:assert/strict";
const root="http://127.0.0.1:3286",dir="docs/evidence/workbench";
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:"msedge",headless:true});
try{
  const page=await browser.newPage(),title="慢了七分钟的表";
  await page.goto(root);await page.getByLabel("文章需求").fill(title);
  await page.getByText("生成离线初稿").click();await page.getByRole("alert").filter({hasText:"资料不足"}).waitFor();
  await page.getByLabel("文章需求").fill(title);await page.getByLabel("选择资料").selectOption("clock");
  await page.getByText("生成离线初稿").click();await page.getByText("定位原文").click();
  await page.locator(".article-location mark").waitFor();
  await page.waitForFunction(()=>getSelection()?.toString()==="她没有拧发条。",{},{timeout:3000});
  const selection=await page.evaluate(()=>({text:getSelection().toString(),offset:getSelection().anchorOffset}));
  assert.equal(selection.text,"她没有拧发条。");assert.equal(selection.offset,7);
  const second=await browser.newPage();await second.goto(page.url());await second.getByLabel("文章标题",{exact:true}).waitFor();
  let prompts=0;page.on("dialog",d=>d.accept(++prompts===1?"":"第二次动作没有推进，保留一次。"));
  await page.getByText("处理建议").click();await page.getByText(/处理理由：第二次/).waitFor();
  await second.getByLabel("文章标题",{exact:true}).fill("冲突草稿");await second.getByRole("alert").filter({hasText:"其他窗口更新"}).waitFor();await second.close();
  const editor=page.getByLabel("文章正文",{exact:true});await editor.click();await editor.press("Control+End");await page.keyboard.insertText("她合上抽屉，锁舌轻轻响了一声。");
  await page.getByText("确认定稿",{exact:true}).click();await page.getByText("已确认定稿",{exact:true}).waitFor();
  const url=page.url();await page.goto(root);await page.reload();await page.getByLabel("按文章标题查找").fill(title);await page.getByText("查找文章").click();await page.getByRole("link",{name:title,exact:true}).first().click();
  const version=page.getByLabel("历史版本");await version.waitFor();const v=await version.inputValue();const body=await page.locator('[data-slate-editor] [data-slate-node="element"]').allTextContents();
  const downloading=page.waitForEvent("download");await page.getByRole("button",{name:"导出 v"+v+" Markdown"}).click();const download=await downloading;const file=dir+"/慢了七分钟的表.md";await download.saveAs(file);
  const actual=await readFile(file,"utf8");assert.equal(actual,body.join("\n"));assert.ok(actual.endsWith("她合上抽屉，锁舌轻轻响了一声。"));assert.equal(actual.split("她没有拧发条。").length,2);
  // Exercise the real timeout reader with an isolated, synthetic execution.
  const interrupted=crypto.randomUUID(),db=new DatabaseSync("data/studio.sqlite");
  try{
    db.prepare("INSERT INTO collaboration VALUES(?,?)").run(interrupted,JSON.stringify({taskId:interrupted,revision:1,state:"running",step:"eval",rounds:0,reason:"",executions:[{id:"fixture",role:"eval",started:new Date(Date.now()-360000).toISOString(),status:"running",callIds:[]}]}));
    const check=await browser.newPage();await check.goto(root+"/studio/editor?taskId="+interrupted);
    await check.getByText("协作执行记录",{exact:true}).click();
    await check.getByText(/执行超过五分钟，可能中断或请求结果未知/).waitFor();
    assert.equal(await check.getByText("重试未完成步骤",{exact:true}).count(),0);
    await check.close();
  }finally{db.prepare("DELETE FROM collaboration WHERE task=?").run(interrupted);db.close();}
  await writeFile(dir+"/browser.json",JSON.stringify({title,url,version:v,selection,export:file,exact:true,interrupted:true,missing:true,conflict:true},null,2));console.log(url);
}finally{await browser.close();}
