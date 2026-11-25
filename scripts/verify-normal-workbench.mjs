import {createServer} from "node:http";
import {spawn} from "node:child_process";
import {mkdtemp,readFile,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {chromium} from "playwright";
import assert from "node:assert/strict";

const dir=await mkdtemp(path.join(tmpdir(),"content-normal-")),database=path.join(dir,"studio.sqlite"),receipts=[];
const quote="她把夹子松开。",title="最后一张校样",body="印刷室只剩一盏灯。阿禾把最后一张校样压在玻璃下。\n她把夹子松开。她把夹子松开。纸角慢慢翘起，露出底下一枚倒着的铅字。\n她没有喊住已经下楼的师傅，只把那个字转过来，又印了一张。";
const model=createServer(async(req,res)=>{
 try{
  let raw="";for await(const chunk of req)raw+=chunk;
  const {messages}=JSON.parse(raw),data=JSON.parse(messages[1].content);
  let output,role;
  if(Array.isArray(data.evidence)){role="research";assert.ok(data.evidence.length);assert.ok(data.evidence.every(e=>e.id.includes("scene-editing")));output={action:"finish",mode:"keyword",query:"",sources:[data.evidence[0].id],questions:[],needsFacts:false};}
  else if(data.research){role="writing";output={title,body,citations:[data.research.supported[0].sourceId]};}
  else if(data.body===body){role="review";output={label:"普通",disputed:false,dimensions:{内容策略:"用动作刻画校对者",表达质量:"一处重复",内容结构:"发现铅字后重印",基础规范:"标点完整"},issues:[{field:"body",quote,before:quote,offset:0,type:"表达",severity:"轻微",reason:"同一动作相邻出现两次",suggestion:"删除第二次重复"}],claims:[]};}
  else throw Error("unexpected mock input");
  receipts.push(role);res.setHeader("content-type","application/json");res.end(JSON.stringify({model:"local-fixture",usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]}));
 }catch(e){res.statusCode=422;res.end(String(e));}
});
await new Promise(r=>model.listen(0,"127.0.0.1",r));
const port=3297,root="http://127.0.0.1:"+port;
const app=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",String(port)],{windowsHide:true,stdio:"ignore",env:{...process.env,STUDIO_DB:database,STUDIO_LIBRARY_DB:path.join(dir,"library.sqlite"),STUDIO_MODEL:"local-fixture",STUDIO_MODEL_URL:"http://127.0.0.1:"+model.address().port+"/chat",STUDIO_MODEL_KEY:""}});
const browser=await chromium.launch({channel:"msedge",headless:true});
try{
 for(let i=0;i<100;i++){if(app.exitCode!==null)throw Error("isolated app failed");if(await fetch(root).then(r=>r.ok).catch(()=>false))break;await new Promise(r=>setTimeout(r,150));}
 const p=await browser.newPage();await p.goto(root);await p.getByLabel("创作需求").fill("虚构印刷室");await p.getByRole("button",{name:/新建创作/}).click();await p.getByLabel("受众要求").fill("短篇读者");
 await p.getByLabel("内容主题").fill("校样上的一处改动：具体场景与自然表达");await p.getByText("更多创作要求与检索设置").click();await p.getByLabel("创作目标").fill("解释表达");
 await p.getByText(/选择参考资料 ·/).click();await p.getByLabel("从一句空话开始修改").check();
 await p.getByLabel("检索方式").selectOption("keyword");
 await p.getByText("准备资料",{exact:true}).click();await p.getByText("开始写初稿 · 本机模型").click();await p.getByText("编辑文章与版本（含最新人工版本）").click();
 await p.getByText("开始审核",{exact:true}).click();await p.getByText("定位原文",{exact:true}).click();
 await p.waitForFunction(q=>getSelection()?.toString()===q,quote);assert.equal(await p.evaluate(()=>getSelection().anchorOffset),quote.length);

 await p.getByText("处理建议",{exact:true}).click();await p.getByLabel("处理方式").selectOption("delete");await p.getByLabel("决定理由").fill("重复动作已在前句写明。");await p.getByText("确认处理",{exact:true}).click();await p.getByText(/处理理由：重复动作/).waitFor();
 const editor=p.getByLabel("文章正文",{exact:true});await editor.click();await editor.press("Control+End");await p.keyboard.insertText("油墨还湿着。");
 await p.getByText("确认定稿",{exact:true}).click();await p.getByText("已确认定稿",{exact:true}).waitFor();
 const id=new URL(p.url()).searchParams.get("taskId");await p.goto(root);await p.reload();await p.getByLabel("按文章标题查找").fill(title);await p.getByRole("button",{name:"查找",exact:true}).click();await p.getByRole("link",{name:title,exact:true}).click();
 const version=await p.getByLabel("历史版本").inputValue(),down=p.waitForEvent("download");await p.getByText("导出正文 · v"+version+" Markdown",{exact:true}).click();
 const filename="docs/evidence/workbench/最后一张校样.md";await (await down).saveAs(filename);const exported=await readFile(filename,"utf8");
 const db=new DatabaseSync(database,{readOnly:true});let published;
 try{
  const row=db.prepare("SELECT payload FROM article_snapshots WHERE task_id=? AND version=?").get(id,Number(version));
  published=JSON.parse(row.payload);assert.equal(published.confirmed,true);assert.equal(published.body,exported);assert.equal(exported,body.replace(quote+quote,quote)+"油墨还湿着。");
 }finally{db.close();}
 assert.deepEqual(receipts,["research","writing","review"]);
 // Install only this freshly created example and its dependent records, preserving IDs and receipts.
 const live=new DatabaseSync("data/studio.sqlite");
 try{
  live.prepare("ATTACH DATABASE ? AS fixture").run(database);live.exec("BEGIN IMMEDIATE");
  for(const [table,column] of [["versions","id"],["reviews","task"],["article_snapshots","task_id"],["article_drafts","task_id"],["model_calls","task_id"]]){
   live.prepare("INSERT INTO main."+table+" SELECT * FROM fixture."+table+" WHERE "+column+"=?").run(id);
  }
  live.exec("COMMIT");
 }finally{live.close();}
 await writeFile("docs/evidence/workbench/normal.json",JSON.stringify({id,title,version,simulation:"仅本机模型 HTTP 响应模拟；普通工作台页面、研究写作审核、额度与回执使用生产实现",receipts,source:published.citations,exportExact:true},null,2));console.log(id);
}finally{await browser.close();app.kill();model.closeAllConnections();model.close();}

