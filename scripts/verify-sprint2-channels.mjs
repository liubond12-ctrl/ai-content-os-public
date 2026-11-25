import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {chromium} from "playwright";

const base=process.env.STUDIO_SPRINT2_URL||"http://127.0.0.1:3698";
const folder=process.env.STUDIO_SPRINT2_EVIDENCE;
if(!folder)throw Error("需要 STUDIO_SPRINT2_EVIDENCE。");
await mkdir(folder,{recursive:true});
const evidence={build:(await (await fetch(base+"/api/version")).json()).build,channels:[],scroll:[]};
const production=await (await fetch(base+"/api/production")).json();
assert.equal(production.mode,"离线示例");assert(production.workerOnline);
async function post(body){
  const response=await fetch(base+"/api/production",{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(JSON.stringify(result));return result;
}
const account=await post({action:"entity",kind:"account",value:{id:"channels-"+randomUUID(),name:"公开演示｜三端虚构账号",platform:"公众号",status:"启用",version:0}});
async function seed(topic){
  const draft=await post({action:"draft",value:{id:randomUUID(),version:0,account:account.id,platform:"公众号",topic,kind:"图文",goal:"品宣",budgetProfile:"local_extended",experiment:"离线会诊与三端回归允许复用同题样稿",
    brief:{note:"用虚构的校样演示动作描写。",adjust:{},materials:[],articleRefs:[],failed:[]}}});
  const preview=await post({action:"preview",drafts:[draft]});
  const {firstTask}=await post({action:"single",id:randomUUID(),drafts:[draft],preview,tokenLimit:120000,requestLimit:32});
  for(let i=0;i<240;i++){
    const result=await (await fetch(base+"/api/collaboration?taskId="+firstTask)).json();
    if(result.flow?.panels?.some(p=>p.phase==="complete"))return firstTask;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw Error("未等到会诊完成："+firstTask);
}
const article=async taskId=>(await (await fetch(base+"/api/articles?taskId="+taskId)).json());
const editor=id=>base+"/studio/editor?taskId="+id+"&review=1";
const short=await seed("会诊演练｜三端分发蓝笔与纸角");
const long=await seed("会诊演练｜长文演练的末段定位");
const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({viewport:{width:1500,height:960},permissions:["clipboard-read","clipboard-write"]});
const page=await context.newPage();
page.on("dialog",dialog=>void dialog.accept());
page.setDefaultTimeout(12000);
try{
  await page.goto(editor(short));
  const initial=await article(short);
  await page.getByRole("button",{name:"三端一键分发"}).click();
  const drawer=page.getByRole("dialog",{name:"三端一键分发"});
  const generate=async()=>{
    await drawer.getByRole("button",{name:"生成渠道稿",exact:true}).click();
    await drawer.getByText("渠道稿已生成并保存。",{exact:true}).waitFor({timeout:20000});
  };
  const clipboard=()=>page.evaluate(async()=>{
    const items=await navigator.clipboard.read();
    const data={};
    for(const item of items)for(const type of item.types)data[type]=await (await item.getType(type)).text();
    return data;
  });
  await generate();await drawer.locator("mark").filter({hasText:"加我微信"}).waitFor();
  assert.equal(await drawer.getByRole("textbox",{name:/^标题 \d$/}).count(),3);
  assert.equal(await drawer.getByRole("textbox",{name:/^标签 \d$/}).count(),8);
  assert.equal(await drawer.getByRole("textbox",{name:/^作者回答 \d$/}).count(),3);
  await drawer.getByRole("textbox",{name:"标题 1",exact:true}).fill("改后标题｜蓝笔与纸角");
  await drawer.getByRole("button",{name:"保存渠道稿",exact:true}).click();
  await drawer.getByText("渠道稿已保存。",{exact:true}).waitFor();
  await drawer.getByRole("button",{name:"复制渠道稿",exact:true}).click();
  assert((await clipboard())["text/plain"].includes("改后标题｜蓝笔与纸角"));
  evidence.channels.push({variant:"xiaohongshu",risk:"加我微信",revision:2});
  await page.screenshot({path:folder+"/01-xiaohongshu.png"});
  await drawer.getByRole("button",{name:"抖音",exact:true}).click();
  await generate();
  await drawer.locator("mark").filter({hasText:"绝对有效"}).waitFor();
  assert.equal(await drawer.getByRole("textbox",{name:/^钩子 \d$/}).count(),3);
  const script=drawer.getByRole("textbox",{name:"口播逐字稿",exact:true});
  assert.match(await script.inputValue(),/\[画面提示\][\s\S]+\[重音停顿\]/);
  await script.fill((await script.inputValue())+"\n口播独立编辑。");
  await drawer.getByRole("button",{name:"短图文",exact:true}).click();
  await generate();
  await drawer.getByRole("textbox",{name:"第 2 页",exact:true}).waitFor();
  await drawer.getByRole("button",{name:"口播逐字稿",exact:true}).click();
  assert.match(await script.inputValue(),/口播独立编辑/);
  await drawer.getByRole("button",{name:"保存渠道稿",exact:true}).click();
  await drawer.getByText("渠道稿已保存。",{exact:true}).waitFor();
  evidence.channels.push({variant:"douyin-script",risk:"绝对有效",revision:2});
  evidence.channels.push({variant:"douyin-post",revision:1});
  await drawer.getByRole("button",{name:"公众号",exact:true}).click();
  await generate();await drawer.locator("mark").filter({hasText:"稳赚不赔"}).waitFor();
  await drawer.getByRole("textbox",{name:"内容块 2",exact:true}).fill("<img src=x onerror=alert(1)> & 校样");
  await drawer.getByRole("button",{name:"保存渠道稿",exact:true}).click();
  await drawer.getByText("渠道稿已保存。",{exact:true}).waitFor();
  await drawer.getByRole("button",{name:"复制公众号富文本"}).click();
  await drawer.getByText("已复制富文本和纯文本。",{exact:true}).waitFor();
  const clip=await clipboard();
  assert(clip["text/html"].includes("<blockquote"));
  assert.match(clip["text/html"],/&lt;img src=x onerror=alert\(1\)&gt; &amp; 校样/);
  assert(!clip["text/html"].includes("<img"));
  assert(clip["text/plain"].includes("<img src=x onerror=alert(1)> & 校样"));
  evidence.channels.push({variant:"wechat",revision:2,clipboard:Object.keys(clip).sort(),risk:"稳赚不赔"});
  await page.screenshot({path:folder+"/02-wechat.png"});
  await page.reload();
  await page.getByRole("button",{name:"三端一键分发"}).click();
  await drawer.getByRole("button",{name:"公众号",exact:true}).click();
  assert.match(await drawer.getByRole("textbox",{name:"内容块 2",exact:true}).inputValue(),/onerror/);
  await drawer.getByRole("button",{name:"关闭分发"}).click();
  assert.deepEqual(await article(short),initial);
  evidence.motherUnchanged=true;

  for(const [label,id,reduced] of [["短稿",short,false],["长稿",long,true]]){
    await page.emulateMedia({reducedMotion:reduced?"reduce":"no-preference"});
    if(page.url()!==editor(id))await page.goto(editor(id));
    const right=page.locator(".editor-review-panel");
    const group=right.locator(".consult-conflict").filter({hasText:"蓝笔落在了桌上。"});
    await group.waitFor();
    const initialDocumentScroll=await page.evaluate(()=>scrollY);
    await right.evaluate(el=>el.scrollTop=el.querySelector(".consult-conflict-list").offsetTop-180);
    const offset=await right.evaluate(el=>{
      const top=el.getBoundingClientRect().top;
      const score=el.querySelector(".consult-score").getBoundingClientRect();
      const banner=el.querySelector(".consult-sticky").getBoundingClientRect();
      return {panelTop:top,scoreTop:score.top,stickyTop:banner.top,internal:el.scrollTop,document:scrollY,sticky:getComputedStyle(el).position,overflow:getComputedStyle(el).overflowY};
    });
    assert(offset.internal>0&&offset.sticky==="sticky"&&offset.overflow==="auto");
    assert.equal(offset.document,initialDocumentScroll);
    assert(offset.scoreTop>=offset.panelTop-2&&offset.scoreTop-offset.panelTop<70,JSON.stringify(offset));
    assert(Math.abs(offset.stickyTop-offset.panelTop)<=2,JSON.stringify(offset));
    await group.getByRole("button",{name:"定位原文"}).first().click();
    await page.waitForFunction(()=>window.getSelection()?.toString()==="蓝笔落在了桌上。");
    await page.waitForFunction(()=>{
      const selection=window.getSelection();if(!selection?.rangeCount)return false;
      const rect=selection.getRangeAt(0).getBoundingClientRect(),distance=Math.abs(rect.top+rect.height/2-innerHeight/2);
      return distance<80||scrollY===0||scrollY+innerHeight>=document.documentElement.scrollHeight-2;
    });
    const aligned=await page.evaluate(()=>{
      const mark=window.getSelection().getRangeAt(0).getBoundingClientRect();
      const aside=document.querySelector(".editor-review-panel");
      return {scrollY,center:Math.round(mark.top+mark.height/2),height:innerHeight,asideTop:Math.round(aside.getBoundingClientRect().top),internal:aside.scrollTop};
    });
    if(label==="长稿"){assert(aligned.scrollY>500);assert(Math.abs(aligned.center-aligned.height/2)<80);}
    const bottom=await right.evaluate(el=>{
      const current=el.scrollTop;
      el.scrollTop=el.scrollHeight;
      const last=el.querySelector(".editor-audit-evidence").getBoundingClientRect();
      const frame=el.getBoundingClientRect();
      const result={visible:last.bottom<=Math.min(frame.bottom,innerHeight)+2&&last.top>=frame.top,viewport:innerHeight,panelBottom:frame.bottom};
      el.scrollTop=current;
      return result;
    });
    assert(bottom.visible,JSON.stringify(bottom));
    evidence.scroll.push({label,reduced,offset,aligned,bottom});
    await page.screenshot({path:folder+"/"+(label==="短稿"?"03-short-locate":"04-long-locate")+".png"});
  }
  await page.setViewportSize({width:390,height:844});
  await page.reload();
  const right=page.locator(".editor-review-panel");
  const group=right.locator(".consult-conflict").filter({hasText:"蓝笔落在了桌上。"});
  await group.waitFor();
  assert.equal(await right.evaluate(el=>getComputedStyle(el).overflowY),"visible");
  assert.equal(await group.locator(".consult-options").evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(" ").length),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({path:folder+"/05-mobile-review.png"});
  await page.getByRole("button",{name:"三端一键分发"}).click();
  await drawer.getByRole("button",{name:"生成渠道稿",exact:true}).waitFor();
  assert.equal(await drawer.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
  await page.screenshot({path:folder+"/06-mobile-channel.png"});
  evidence.entries={short:editor(short),long:editor(long)};
  await writeFile(folder+"/acceptance.json",JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence,null,2));
}finally{await browser.close();}
