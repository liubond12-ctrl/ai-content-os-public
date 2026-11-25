import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {chromium} from "playwright";

const base=process.env.STUDIO_SPRINT4_URL||"http://127.0.0.1:3748";
const folder=process.env.STUDIO_SPRINT4_EVIDENCE,dbPath=process.env.STUDIO_SPRINT4_DB;
if(!folder||!dbPath)throw Error("需要隔离 Demo 数据库和证据目录");
await mkdir(folder,{recursive:true});
const account="calibration-demo",path="/studio/settings/calibration";
const api=async (url,body)=>await fetch(base+url,body?{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)}:undefined);
const view=async()=>(await api("/api/calibration?account="+account)).json();
const countCalls=()=>{
  const db=new DatabaseSync(dbPath,{readOnly:true});
  try{return Number(db.prepare("SELECT count(*) AS count FROM model_calls").get().count);}
  finally{db.close();}
};
async function wait(read,ok,timeout=30000){
  const deadline=Date.now()+timeout;
  do{const value=await read();if(ok(value))return value;await new Promise(resolve=>setTimeout(resolve,350));}while(Date.now()<deadline);
  throw Error("未等到验收状态");
}
assert.equal((await view()).demo,true);
assert.equal((await view()).count,0,"请使用全新的离线数据目录");
const evidence={build:(await (await api("/api/version")).json()).build,base,viewports:[[1440,960],[390,844]]};
const browser=await chromium.launch({channel:"msedge",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960},timezoneId:"Asia/Shanghai"});
page.setDefaultTimeout(14000);
try{
  await page.goto(base+"/studio/settings");
  await page.getByRole("link",{name:"发布复盘与规则校准"}).click();
  await page.getByRole("button",{name:"载入离线校准样例"}).click();
  await page.getByText("calibration · 5 篇已复盘",{exact:true}).waitFor();
  const baseline=countCalls(),initial=await view(),pending=initial.items.find(item=>!item.retro.length);
  assert.equal(initial.items.length,6);
  assert.equal(Date.parse(pending.publication.dueAt)-Date.parse(pending.publication.publishedAt),72*3600000);
  assert(pending.prediction.lockedAt<pending.publication.publishedAt);
  assert.equal(initial.cards.length,0);
  await page.getByRole("button",{name:"预演模型路由"}).click();
  await page.getByRole("list",{name:"路由预演结果"}).waitFor();
  const routes=await (await api("/api/calibration?routes=1")).json();
  assert.equal(routes.length,5);
  assert.equal(countCalls(),baseline);
  await page.screenshot({path:folder+"/01-awaiting-and-routing.png",fullPage:true});

  await page.getByRole("button",{name:"生成并重打历史样本"}).click();
  await page.getByRole("heading",{name:"结构 通过"}).waitFor();
  await page.getByLabel("候选维度").selectOption("互动引导");
  await page.getByRole("button",{name:"生成并重打历史样本"}).click();
  await page.getByRole("heading",{name:"互动引导 拦截"}).waitFor();
  await page.getByText("查看 10 对冲突").click();
  const {proposals}=await view(),pass=proposals.find(p=>p.passed),blocked=proposals.find(p=>!p.passed);
  assert.equal(pass.agreement,1);assert.equal(blocked.agreement,0);
  const denied=await api("/api/calibration",{action:"apply",account,id:blocked.id});
  assert.equal(denied.status,409);
  await page.getByRole("button",{name:"合并到账号规则"}).click();
  await page.getByRole("heading",{name:"结构 已生效 v1"}).waitFor();
  assert.equal(countCalls(),baseline);
  await page.screenshot({path:folder+"/02-rubric-gate.png",fullPage:true});
  evidence.gate={pass:{pairs:pass.comparable,agreement:pass.agreement,id:pass.id},block:{pairs:blocked.comparable,agreement:blocked.agreement,status:denied.status,conflicts:blocked.conflicts}};

  await page.getByRole("button",{name:"模拟 T+3d 到期"}).click();
  await page.getByText(/T\+3d 复盘 · 离线新稿 · 纸张叠放 · 已模拟投递/).waitFor();
  const metrics={reach:12000,likes:210,saves:109,comments:33,conversions:8};
  const labels={reach:"播放或阅读",likes:"赞",saves:"藏",comments:"评论",conversions:"转化"};
  for(const [key,value] of Object.entries(metrics))await page.getByRole("spinbutton",{name:labels[key],exact:true}).fill(String(value));
  await page.getByRole("button",{name:"追加实绩"}).click();
  await page.getByText("calibration · 6 篇已复盘",{exact:true}).waitFor();
  await page.getByText("查看初稿与正式版本的改动").click();
  const finished=await wait(view,data=>data.cards.some(row=>row.result==="复盘已登记"));
  const stored=finished.items.find(row=>row.task===pending.task);
  assert.deepEqual(stored.retro[0].metrics,metrics);
  assert.deepEqual(stored.prediction,pending.prediction);
  assert.equal(countCalls(),baseline);
  evidence.retro={key:pending.task,version:pending.version,observed:stored.retro[0],card:"复盘已登记",modelCallsBeforeAndAfter:[baseline,countCalls()]};
  await page.screenshot({path:folder+"/03-retro.png",fullPage:true});

  await page.getByText("从爆款参考萃取积木").click();
  await page.getByLabel("参考来源").selectOption("demo-breakout");
  await page.getByRole("textbox",{name:"摘自来源的原句"}).fill("先写一个能看见的动作，再给改写方法。");
  await page.getByRole("button",{name:"保存参考积木"}).click();
  await page.getByRole("status").filter({hasText:"素材积木已保存"}).waitFor();
  const selectedBricks=await (await api("/api/calibration?bricks=1&account="+account+"&q=纸角")).json();
  assert.equal(selectedBricks.length,1);
  assert.deepEqual(await (await api("/api/calibration?bricks=1&account=other-account")).json(),[]);
  await page.goto(base+"/production/create");
  await page.getByRole("combobox",{name:"账号"}).fill("离线校准样例");
  await page.getByRole("option",{name:/离线校准样例/}).click();
  await page.getByRole("textbox",{name:"选题"}).fill("离线积木装配 · 纸角试写");
  await page.getByRole("textbox",{name:"这篇想怎么写？"}).fill("这是一篇虚构写法练习，写一个纸角动作并给出可执行的写法。");
  await page.getByRole("button",{name:"添加附件或引用"}).click();
  await page.getByRole("button",{name:"选用素材积木"}).click();
  const picker=page.getByRole("dialog",{name:"素材积木"});
  await picker.getByRole("textbox",{name:"搜索本账号素材积木"}).fill("纸角");
  await picker.getByRole("button",{name:"搜索素材积木"}).click();
  await picker.getByRole("checkbox",{name:/盯住纸角/}).check();
  await picker.getByRole("button",{name:"完成"}).click();
  await page.getByRole("button",{name:"素材积木 · 1"}).waitFor();
  await page.getByRole("button",{name:"发送",exact:true}).click();
  await page.getByRole("button",{name:"确认并开始这篇内容"}).click();
  await page.waitForURL(url=>url.pathname==="/studio"&&url.searchParams.has("taskId"));
  const taskId=new URL(page.url()).searchParams.get("taskId");
  const task=await (await api("/api/tasks?id="+taskId)).json();
  assert.deepEqual(task.input.production.bricks,selectedBricks);
  evidence.brick={taskId,id:selectedBricks[0].id,version:selectedBricks[0].version,source:selectedBricks[0].source};
  const editor=await wait(async()=>await (await api("/api/articles?taskId="+taskId)).json(),result=>!!result.head,90000);
  evidence.generatedVersion=editor.head.version;
  await wait(async()=>await (await api("/api/collaboration?taskId="+taskId)).json(),
    result=>result.flow?.panels?.some(panel=>panel.phase==="complete"),90000);
  const sourceVersion=editor.head.version;
  const derivation=await api("/api/derivations",{action:"generate",taskId,articleVersion:sourceVersion,variant:"xiaohongshu",revision:0,allowCloud:false});
  assert(derivation.ok,await derivation.text());
  const derivationLock=await (await api("/api/calibration?task="+taskId+"&version="+sourceVersion)).json();
  assert.equal(derivationLock.prediction.version,sourceVersion);
  const finalized=await api("/api/articles",{action:"publish",taskId,baseVersion:sourceVersion,revision:editor.draft?.revision??0,
    title:editor.head.title,document:editor.head.document});
  assert(finalized.ok,await finalized.clone().text());
  const finalVersion=(await finalized.json()).head.version;
  const finalLock=await (await api("/api/calibration?task="+taskId+"&version="+finalVersion)).json();
  assert.equal(finalLock.prediction.version,finalVersion);
  const beforePublishing=countCalls();
  const published=await api("/api/content",{action:"destination",task:taskId,version:finalVersion,status:"已发布",day:"",url:"",publishedAt:new Date().toISOString()});
  assert(published.ok,await published.text());
  const newlyDue=await (await api("/api/calibration?task="+taskId+"&version="+finalVersion)).json();
  assert.equal(newlyDue.due,false);
  assert(newlyDue.prediction.lockedAt<newlyDue.publication.publishedAt);
  assert.equal(countCalls(),beforePublishing);
  evidence.autolock={derivation:sourceVersion,finalized:finalVersion,reviewVersion:finalLock.prediction.reviewVersion,published:newlyDue.publication};
  await page.goto(base+path);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("combobox",{name:/账号/}).selectOption(account);
  await page.getByText("calibration · 6 篇已复盘",{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(await page.locator("article.cal-entry").evaluateAll(rows=>rows.map(row=>getComputedStyle(row).display)),["block","block"]);
  await page.screenshot({path:folder+"/04-narrow.png",fullPage:true});
  await writeFile(folder+"/acceptance.json",JSON.stringify(evidence,null,2)+"\n");
  console.log(JSON.stringify({build:evidence.build,evidence:folder,pass:pass.agreement,block:blocked.agreement,taskId,generated:evidence.generatedVersion}));
}finally{await browser.close();}
