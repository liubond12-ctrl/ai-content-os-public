import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {chromium} from "playwright";

const base=process.env.STUDIO_SPRINT3_URL||"http://127.0.0.1:3708";
const folder=process.env.STUDIO_SPRINT3_EVIDENCE;
const database=process.env.STUDIO_SPRINT3_DB;
if(!folder||!database)throw Error("请设置离线证据目录与本次演练数据库路径。");
await mkdir(folder,{recursive:true});
const api=async path=>(await fetch(base+path)).json();
const view=()=>api("/api/autopilot");
const post=body=>fetch(base+"/api/autopilot",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)});
const evidence={build:(await api("/api/version")).build,base,mode:"离线示例",viewport:{desktop:[1500,960],narrow:[390,844]}};
assert.equal((await api("/api/production")).mode,evidence.mode);
assert.equal((await view()).demo,true);
assert.equal((await view()).run,null,"请用一个新的演练数据目录运行");

async function waitFor(read,predicate){
  const deadline=Date.now()+160000;
  while(Date.now()<deadline){
    const value=await read();
    if(predicate(value))return value;
    await new Promise(resolve=>setTimeout(resolve,600));
  }
  throw Error(JSON.stringify(await read()));
}
function record(task){
  const db=new DatabaseSync(database,{readOnly:true});
  try{return db.prepare("SELECT id,payload FROM ledger_mock_records WHERE task=?").get(task);}
  finally{db.close();}
}
const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1500,height:960},timezoneId:"Asia/Shanghai"});
const page=await context.newPage();
page.setDefaultTimeout(15000);
page.on("dialog",dialog=>void dialog.accept());
const morning=page.getByRole("region",{name:"飞书早报预览"});
const candidate=title=>morning.locator("article.cruise-candidate").filter({hasText:title});
const ledger=page.getByRole("region",{name:"发布台账"});
try{
  await page.goto(base+"/");
  await page.getByRole("link",{name:/模拟夜间巡航与飞书早报预览/}).click();
  await page.getByRole("button",{name:"模拟夜间巡航"}).click();
  const ready=await waitFor(view,data=>data.cards.some(card=>card.card.kind==="morning"&&card.delivery==="sent"));
  assert.equal(ready.run.policy.minScore,70);
  assert.equal(ready.items.length,4);
  const passed=ready.items.filter(item=>item.candidate);
  assert.equal(passed.length,2,JSON.stringify(ready.items));
  const low=ready.items.find(item=>item.title.includes("低分"));
  const blocked=ready.items.find(item=>item.title.includes("硬阻断"));
  assert(low&&low.score<70&&!low.candidate&&low.reason.includes("低于"));
  assert(blocked&&!blocked.candidate&&/硬阻断|未核|事实|核验/.test(blocked.reason),JSON.stringify(blocked));
  const blue=passed.find(item=>item.title.includes("蓝笔"));
  const paper=passed.find(item=>item.source==="模拟飞书灵感");
  assert(blue&&paper&&blue.taskId!==paper.taskId);
  assert(paper.candidate.disagreements.some(text=>text.includes("内容策略")&&text.includes("语言表达")));
  const digest=ready.cards.find(item=>item.card.kind==="morning");
  assert(digest.card.text.includes(blue.title)&&digest.card.text.includes(paper.title));
  assert.equal((await post({action:"run"})).status,200);
  assert.equal((await view()).items.length,4);
  await morning.getByText("查看多篇摘要卡片").click();
  await morning.getByText(/尚未入选/).click();
  await page.screenshot({path:folder+"/01-morning.png",fullPage:true});
  evidence.run={date:ready.day,...ready.run,items:ready.items,cards:ready.cards.map(({id,delivery,card})=>({id,delivery,kind:card.kind}))};

  await candidate(blue.title).getByRole("button",{name:"模拟通过"}).click();
  const card=ready.cards.find(item=>item.card.kind==="morning-item"&&item.card.task===blue.taskId);
  await candidate(blue.title).getByRole("link",{name:"进入三端分发"}).waitFor();
  await waitFor(view,data=>data.ledger.some(item=>item.record.articleId===blue.taskId&&item.state==="sent"));
  const first=record(blue.taskId);
  assert(first?.id.startsWith("mock-rec-"));
  await post({action:"decision",card:card.id,message:card.message,decision:"approve"});
  assert.equal((await view()).ledger.filter(item=>item.record.articleId===blue.taskId).length,1);
  assert.equal(record(blue.taskId).id,first.id);
  await candidate(paper.title).getByRole("button",{name:"模拟打回重跑"}).click();
  const rerun=await waitFor(view,data=>data.reruns.some(item=>item.status==="submitted")&&data.items.length===5);
  const retry=rerun.items.find(item=>!ready.items.some(old=>old.taskId===item.taskId));
  assert(retry&&retry.taskId!==paper.taskId);
  evidence.approval={id:blue.taskId,version:blue.candidate.articleVersion,record:first.id};
  evidence.rerun={original:paper.taskId,newTask:retry.taskId,...rerun.reruns[0]};

  const original=await api("/api/articles?taskId="+blue.taskId);
  await candidate(blue.title).getByRole("link",{name:"进入三端分发"}).click();
  const drawer=page.getByRole("dialog",{name:"三端一键分发"});
  await drawer.getByRole("button",{name:"生成渠道稿",exact:true}).click();
  await drawer.getByText("渠道稿已生成并保存。",{exact:true}).waitFor({timeout:30000});
  assert.deepEqual(await api("/api/articles?taskId="+blue.taskId),original);
  evidence.editorUrl=page.url();
  await page.screenshot({path:folder+"/02-distribution.png"});
  await drawer.getByRole("button",{name:"关闭分发"}).click();
  await page.getByRole("link",{name:"返回巡航与早报"}).click();
  const row=ledger.locator("article").filter({hasText:blue.title});
  await row.getByText(/小红书 1/).waitFor();
  const schedule=ready.day+"T21:30";
  await row.getByLabel("排期（本机时区）").fill(schedule);
  await row.getByRole("button",{name:"保存排期"}).click();
  const due=new Date(schedule+"+08:00").toISOString();
  const synced=await waitFor(view,data=>data.ledger.some(item=>item.record.articleId===blue.taskId&&item.state==="sent"&&item.record.scheduledAt===due));
  const final=record(blue.taskId);
  assert.equal(final.id,first.id);
  assert.equal(JSON.parse(final.payload).scheduledAt,due);
  evidence.ledger=synced.ledger.find(item=>item.record.articleId===blue.taskId);
  evidence.motherUnchanged=true;
  await page.screenshot({path:folder+"/03-ledger.png",fullPage:true});
  const secondCard=(await waitFor(view,data=>data.cards.some(row=>row.card.task===retry.taskId&&row.delivery==="sent")))
    .cards.find(row=>row.card.task===retry.taskId&&row.card.kind==="morning-item");
  await morning.getByRole("link",{name:"查看母稿"}).filter({visible:true}).click();
  await page.waitForURL(url=>url.pathname==="/studio/editor"&&url.searchParams.get("taskId")===retry.taskId);
  await page.getByRole("button",{name:"采纳此方案替换",exact:true}).first().click();
  await page.getByText("已保存修改",{exact:true}).waitFor();
  await waitFor(view,data=>data.cards.some(row=>row.id===secondCard.id&&row.result==="已在工作台处理"&&row.delivery==="sent"));
  assert.equal((await post({action:"decision",card:secondCard.id,message:secondCard.message,decision:"approve"})).status,409);
  const db=new DatabaseSync(database,{readOnly:true});
  try{
    const row=db.prepare("SELECT body FROM fs_sim_messages WHERE id=?").get(secondCard.message);
    const rendered=JSON.parse(String(row?.body));
    assert.deepEqual(rendered.elements.map(element=>element.tag),["div"]);
    assert.match(rendered.elements[0].text.content,/已在工作台处理/);
    const lineage=db.prepare("SELECT root FROM autopilot_lineage WHERE task=?").get(retry.taskId);
    assert.equal(lineage.root,paper.taskId);
    const hops=db.prepare("SELECT phase,version,task FROM autopilot_hops WHERE root=? ORDER BY rowid").all(lineage.root);
    assert(hops.some(hop=>hop.task===retry.taskId&&hop.phase==="review"));
    evidence.resolve={task:retry.taskId,message:secondCard.message,status:"已在工作台处理",replay:409,remainingButtons:0};
    evidence.hops={root:lineage.root,count:hops.length,stages:hops};
  }finally{db.close();}
  await page.getByRole("link",{name:"返回巡航与早报"}).click();
  await morning.getByText(/尚未入选/).click();
  await morning.getByText(/已在工作台处理/).waitFor();
  await page.screenshot({path:folder+"/04-resolved.png",fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:folder+"/05-narrow.png",fullPage:true});
  await writeFile(folder+"/acceptance.json",JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({build:evidence.build,run:ready.run.id,editor:evidence.editorUrl,ledger:evidence.ledger,evidence:folder}));
}finally{await browser.close();}
