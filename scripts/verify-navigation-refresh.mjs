import assert from "node:assert/strict";
import {mkdir,writeFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {chromium} from "playwright";

const base=process.env.STUDIO_NAV_URL||"http://127.0.0.1:3958";
const folder=process.env.STUDIO_NAV_EVIDENCE;
if(!folder||new URL(base).hostname!=="127.0.0.1")throw Error("需要本机演练地址和证据目录");
await mkdir(folder,{recursive:true});
const api=async(path,body)=>{
  const response=await fetch(base+path,body?{method:"POST",headers:{origin:base,"content-type":"application/json"},body:JSON.stringify(body)}:undefined);
  assert(response.ok,await response.clone().text());
  return response.json();
};
const data=await api("/api/production");
assert.equal(data.mode,"离线示例");
assert.equal(data.workerOnline,true);
const account=data.accounts.find(item=>item.status==="启用");
assert(account,"需要一个已启用的演练账号");
const queryTask=data.queue.find(row=>row.topic.includes("长文演练"))??data.queue.find(row=>row.topic);
assert(queryTask,"需要有已进入队列的示例稿");
const topic="导航演练草稿 "+randomUUID().slice(0,8);
await api("/api/production",{action:"draft",value:{id:randomUUID(),version:0,account:account.id,
  platform:account.platform,topic,kind:"图文",intent:"draft"}});
const counts=await api("/api/readiness");
const cards=["篇早报待拍板","篇成品待发布","篇待填数据","条新经验待启用"];
const menuNames=["今日待办","写稿与精修","历史文章","热点与巡航","账号与素材"];
assert.equal(counts.length,cards.length);
const browser=await chromium.launch({channel:"msedge",headless:true});
const context=await browser.newContext({serviceWorkers:"block"});
const blocked=[];
await context.route("**/*",route=>{
  if(new URL(route.request().url()).hostname==="127.0.0.1")return route.continue();
  blocked.push(route.request().resourceType());
  return route.abort();
});
const page=await context.newPage();
page.setDefaultTimeout(10000);
const pageErrors=[];
page.on("pageerror",error=>pageErrors.push({path:new URL(page.url()).pathname,message:error.message}));
const menu=page.getByRole("button",{name:"工作空间菜单"});
const mainNav=page.getByRole("navigation",{name:"工作空间",exact:true});
const room=page.getByRole("navigation",{name:"设置与体检"}).getByRole("link",{name:"系统机房",exact:true});
const overview=page.getByRole("region",{name:"今日概览"});
const result={build:(await api("/api/version")).build,base,counts,viewports:[],screens:[]};

async function openMenu(){
  if(await menu.isVisible()&&await menu.getAttribute("aria-expanded")==="false")await menu.click();
}
async function viaNav(name){
  await openMenu();
  await mainNav.getByRole("link",{name,exact:true}).click();
}
async function screenshot(name){
  const bounds=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth}));
  assert(bounds.scrollWidth<=bounds.width+1,JSON.stringify({name,...bounds}));
  const file=name+"-"+bounds.width+".png";
  await page.screenshot({path:folder+"/"+file});
  result.screens.push({file,...bounds});
}
function destination(href){
  const expected=new URL(href,base);
  return url=>url.pathname===expected.pathname&&url.hash===expected.hash&&
    expected.searchParams.size===url.searchParams.size&&[...expected.searchParams].every(([key,value])=>url.searchParams.get(key)===value);
}
async function hit(locator){
  return locator.evaluate(element=>{
    const rect=element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2));
  });
}
try{
  for(const {width,height,columns} of [{width:1440,height:900,columns:4},{width:390,height:844,columns:2}]){
    await page.setViewportSize({width,height});
    await page.goto(base);
    const links=overview.getByRole("link");
    await links.last().waitFor();
    assert.equal(await links.count(),4);
    assert.equal(await page.locator(".ck-footer").count(),0);
    assert.equal(await page.getByRole("heading",{name:"今日待办",exact:true}).count(),1);
    assert.equal(await page.getByText(/作战台/).count(),0);
    const positions=await links.evaluateAll(items=>items.map(item=>{
      const rect=item.getBoundingClientRect();return {x:rect.x,y:rect.y,w:rect.width,h:rect.height};
    }));
    assert.equal(new Set(positions.map(rect=>rect.x)).size,columns);
    assert.equal(new Set(positions.map(rect=>rect.y)).size,4/columns);
    assert(positions.every(rect=>rect.x+rect.w<=width&&rect.y+rect.h<=height));
    await screenshot("home");
    await openMenu();
    assert.deepEqual(await mainNav.getByRole("link").allTextContents(),menuNames);
    assert.equal(await mainNav.getByRole("link",{name:"今日待办"}).getAttribute("aria-current"),"page");
    if(width===390){await screenshot("menu");await menu.press("Escape");assert.equal(await menu.getAttribute("aria-expanded"),"false");assert(await menu.evaluate(element=>element===document.activeElement));}
    const visited=[];
    for(const [index,target] of counts.entries()){
      const link=overview.getByRole("link",{name:target.count+" "+cards[index],exact:true});
      assert(destination(target.href)(new URL(await link.getAttribute("href"),base)));
      assert.equal(await link.locator("strong").innerText(),String(target.count));
      if(index===0){
        await link.focus();await page.keyboard.press("Tab");await page.keyboard.press("Shift+Tab");
        assert(await link.evaluate(element=>element.matches(":focus-visible")));
        if(width===1440){
          await link.hover();assert(await link.evaluate(element=>element.matches(":hover")));
          await page.mouse.down();
          await page.waitForFunction(()=>new DOMMatrix(getComputedStyle(document.querySelector(".readiness-card")).transform).a<.999);
          await page.mouse.up();
        }else await link.press("Enter");
      }else{
        const rect=await link.boundingBox();
        await link.click({position:{x:rect.width-10,y:rect.height-10}});
      }
      await page.waitForURL(destination(target.href));
      visited.push(target.href);
      await page.goto(base);
      await overview.getByRole("link").last().waitFor();
    }
    assert.equal(await page.getByText("显示设置",{exact:true}).count(),0);
    await page.getByText("查看稿件进度",{exact:true}).scrollIntoViewIfNeeded();
    assert(await hit(page.getByText("查看稿件进度",{exact:true})));
    assert(await page.evaluate(()=>scrollY>100));
    await openMenu();
    await room.scrollIntoViewIfNeeded();
    assert(await hit(room));
    await screenshot("room-from-bottom");
    await room.click();
    await page.waitForURL(base+"/studio/system");
    if(width===390)assert.equal(await menu.getAttribute("aria-expanded"),"false");
    await page.getByRole("link",{name:/巡航费用与暂停上限/}).click();
    await page.getByLabel("每日估算上限（元）").waitFor();
    await screenshot("budget");
    await openMenu();
    await room.click();
    await page.getByRole("link",{name:/显示设置/}).click();
    await page.getByLabel("静态阅读模式",{exact:true}).check();
    await page.reload();
    assert(await page.getByLabel("静态阅读模式",{exact:true}).isChecked());
    await screenshot("display-settings");
    const operatorLinks=[
      {name:/检查运行状态/,path:"/studio/settings/doctor",target:()=>page.getByRole("button",{name:"运行本机探活"})},
      {name:/查看治理效果/,path:"/studio/settings/governance",target:()=>page.getByRole("heading",{name:"事实幻觉拦截"})},
      {name:/规则提案存档与模型分工/,path:"/studio/system/rules",target:()=>page.getByRole("button",{name:"预演模型路由"})},
    ];
    for(const check of operatorLinks){
      await openMenu();
      await room.click();
      await page.getByRole("link",{name:check.name}).click();
      await page.waitForURL(base+check.path);
      await check.target().waitFor();
    }
    await viaNav("历史文章");
    const history=page.getByRole("navigation",{name:"历史文章",exact:true});
    await page.getByRole("heading",{name:"历史文章",exact:true}).waitFor();
    await history.getByRole("link",{name:"需求草稿",exact:true}).click();
    await page.getByRole("heading",{name:"需求草稿",exact:true}).waitFor();
    await page.getByRole("link",{name:topic,exact:true}).waitFor();
    await screenshot("drafts");
    await history.getByRole("link",{name:"任务与搜索",exact:true}).click();
    await page.getByLabel("稿件标题或选题").fill(queryTask.topic);
    await page.getByRole("button",{name:"搜索",exact:true}).click();
    await page.locator("#task-"+queryTask.id).waitFor();
    assert.equal(new URL(page.url()).searchParams.get("q"),queryTask.topic);
    await history.getByRole("link",{name:"历史批次与队列",exact:true}).click();
    await page.waitForURL(base+"/production/queue");
    await viaNav("热点与巡航");
    await page.getByRole("heading",{name:"今日热点",exact:true}).waitFor();
    await page.getByRole("link",{name:"查看巡航筛选结果",exact:true}).click();
    await page.waitForURL(base+"/studio/settings/autopilot#cruise-results");
    await page.getByText(/查看画像初筛记录/).click();
    await page.getByText(/初筛排除.*25 分/).waitFor();
    await screenshot("cruise");
    result.viewports.push({width,height,columns,visited,menuAfterScroll:true,search:queryTask.topic});
  }
  await page.emulateMedia({reducedMotion:"reduce"});
  await page.goto(base);
  await overview.getByRole("link").last().waitFor();
  assert(await overview.getByRole("link").first().evaluate(element=>parseFloat(getComputedStyle(element).transitionDuration)<.001));
  await viaNav("写稿与精修");
  await page.setViewportSize({width:390,height:460});
  const input=page.getByRole("textbox",{name:"这篇想怎么写？"});
  await input.focus();
  await input.scrollIntoViewIfNeeded();
  assert(await hit(input));
  await screenshot("focused-460");
  await openMenu();
  await room.scrollIntoViewIfNeeded();
  assert(await hit(room));
  await screenshot("menu-460");
  await menu.press("Escape");
  assert.equal(await menu.getAttribute("aria-expanded"),"false");
  result.reducedMotion=true;
  result.shortViewport={width:390,height:460,focusedInputHit:true,systemLinkHit:true};
  assert.deepEqual(blocked,[]);
  assert.deepEqual(pageErrors,[]);
  await writeFile(folder+"/navigation-acceptance.json",JSON.stringify({...result,blocked,pageErrors},null,2)+"\n");
  console.log(JSON.stringify({build:result.build,viewports:result.viewports.map(({width,height,columns})=>({width,height,columns})),
    screens:result.screens.length,evidence:folder}));
}finally{await browser.close();}
