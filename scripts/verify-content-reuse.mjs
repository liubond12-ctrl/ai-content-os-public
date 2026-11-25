import assert from "node:assert/strict";
import {DatabaseSync,backup} from "node:sqlite";
import {createServer} from "vite";
import {mkdtempSync,readFileSync,copyFileSync,writeFileSync} from "node:fs";
import {tmpdir,cpus} from "node:os";
import {join} from "node:path";
import {randomUUID,createHash} from "node:crypto";
const prior=process.argv.includes("--existing")?JSON.parse(readFileSync("docs/evidence/content-reuse-measurements.json","utf8")):null;
const folder=prior?.folder??mkdtempSync(join(tmpdir(),"content-reuse-"));
const vite=await createServer({server:{middlewareMode:true,hmr:false},appType:"custom",configFile:false});
const {openContent,contentList,similar}=await vite.ssrLoadModule("/src/studio/content-index.ts");
const {productionView,saveEntity}=await vite.ssrLoadModule("/src/studio/production.ts");
const {workOverview}=await vite.ssrLoadModule("/src/studio/work-overview.ts");
const result={folder,cpu:cpus()[0].model,node:process.version,migrations:prior?.migrations??[],scale:[]};
process.env.STUDIO_LIBRARY_DB=join(folder,"library.sqlite");
const list=(params={})=>contentList(new URLSearchParams(params));
function source(db){
  return Object.fromEntries(["versions","article_snapshots","archived_tasks","production_images","production_events","article_drafts"].map(t=>[t,db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t)?Number(db.prepare("SELECT count(*) n FROM "+t).get().n):0]));
}
function sourceDigest(db){
  const hash=createHash("sha256");
  for(const t of Object.keys(source(db))){
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(t))continue;
    for(const row of db.prepare("SELECT * FROM "+t+" ORDER BY rowid").iterate())hash.update(JSON.stringify(row));
  }
  return hash.digest("hex");
}
function measure(fn){
  for(let i=0;i<2;i++)fn();
  const times=[];let bytes;
  for(let i=0;i<15;i++){const start=performance.now(),value=fn();times.push(performance.now()-start);bytes=Buffer.byteLength(JSON.stringify(value));}
  return {p95ms:+times.sort((a,b)=>a-b)[14].toFixed(1),jsonBytes:bytes};
}
function seed(db,n,browser=false){
  const ins=db.prepare("INSERT INTO versions VALUES(?,1,?)"),snap=db.prepare("INSERT INTO article_snapshots VALUES(?,2,?)");
  const queue=db.prepare("INSERT INTO production_queue VALUES(?,?,?,?,'',NULL,NULL,?)");
  const stamp="2026-11-08T02:00:00.000Z",batch=randomUUID();
  db.exec("BEGIN");
  db.prepare("INSERT INTO production_batches VALUES(?,?,1,0,0,0,'测试')").run(batch,stamp);
  for(let i=0;i<n;i++){
    const id=randomUUID(),account=i%2?"red":"dou",topic="冬季收纳"+i;
    const production={brand:"default",account,accountName:i%2?"小红书样例":"抖音样例",platform:i%2?"小红书":"抖音",kind:"图文",rules:[],standards:[],attachments:[],imagesRequired:false,mode:"离线示例"};
    const body="## 封面文案\n抽屉\n\n## 正文\n"+(browser?"折叠，竖放。":"折叠，竖放。".repeat(35))+"\n\n## 配图计划\n抽屉照片";
    const title=topic+"原稿";
    const task={id,revision:1,input:{persona:"general",topic,format:"图文文章",production},stage:"done",research:{version:1,status:"ready",questions:[],evidence:[],model:"offline"},records:[],article:{title,body,citations:[],version:1,researchVersion:1,model:"offline"}};
    ins.run(id,JSON.stringify(task));queue.run(id,batch,i,browser?"待人工审核":["待人工审核","生成","受阻","排队","待人工审核"][i%5],stamp);
    if(!browser)snap.run(id,JSON.stringify({taskId:id,version:2,title:topic+"新版",body:body+"。",confirmed:i%5===4,createdAt:stamp}));
  }
  db.exec("COMMIT");
}
try{
  for(const dir of prior?[]:["data","data-production-demo","data-production-real-phase1"]){
    const original=new DatabaseSync(join(dir,"studio.sqlite"),{readOnly:true}),base=join(folder,dir+"-backup.sqlite");
    await backup(original,base);original.close();
    process.env.STUDIO_DB=join(folder,dir+"-restore.sqlite");copyFileSync(base,process.env.STUDIO_DB);
    let db=new DatabaseSync(process.env.STUDIO_DB);const before=source(db),sourceSha256=sourceDigest(db);db.close();
    db=openContent();const heads=db.prepare("SELECT count(*) n FROM content_heads").get().n;
    const manual=db.prepare("SELECT count(*) n FROM content_heads WHERE model='manual'").get().n;
    assert.deepEqual(source(db),before);assert.equal(sourceDigest(db),sourceSha256);db.close();
    db=openContent(true);assert.equal(db.prepare("SELECT count(*) n FROM content_heads").get().n,heads);
    assert.deepEqual(source(db),before);db.close();
    const fullBytes=Buffer.byteLength(JSON.stringify(productionView())),configurationBytes=Buffer.byteLength(JSON.stringify(productionView(true)));
    copyFileSync(base,process.env.STUDIO_DB);db=new DatabaseSync(process.env.STUDIO_DB);
    assert.deepEqual(source(db),before);assert.equal(sourceDigest(db),sourceSha256);assert.equal(db.prepare("pragma integrity_check").get().integrity_check,"ok");assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_heads'").get(),undefined);db.close();
    result.migrations.push({dir,before,sourceSha256,heads,manual,fullBytes,configurationBytes});
  }
  for(const count of [10000,50000]){
    process.env.STUDIO_DB=join(folder,count+".sqlite");let db=openContent();if(!prior)seed(db,count);db.close();
    db=openContent();db.close();
    assert.equal(list().total,count);assert.equal(list({q:"叠，"}).total,count);assert.equal(list({q:"不存在的稿件"}).total,0);
    result.scale.push({count,list:measure(()=>list()),body:measure(()=>list({q:"折叠，竖放"})),home:measure(workOverview)});
    console.log(JSON.stringify(result.scale.at(-1)));
  }
  if(!prior){process.env.STUDIO_DB=join(folder,"browser.sqlite");const db=openContent();seed(db,2,true);db.close();
  for(const [id,name,platform] of [["red","小红书样例","小红书"],["dou","抖音样例","抖音"]])saveEntity("account",{id,version:0,name,platform,status:"启用"});
  assert.equal(similar("冬季收纳","").length,2);}
  writeFileSync("docs/evidence/content-reuse-measurements.json",JSON.stringify(result,null,2));
  console.log(folder);
}finally{await vite.close();}