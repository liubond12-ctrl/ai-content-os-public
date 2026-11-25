import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {workOverview} from "../src/studio/work-overview";
const folders:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const folder of folders.splice(0))rmSync(folder,{recursive:true,force:true});});
function seed(count:number){
  const folder=mkdtempSync(join(tmpdir(),"cockpit-scale-"));folders.push(folder);
  const file=join(folder,"test.sqlite");vi.stubEnv("STUDIO_DB",file);
  const db=new DatabaseSync(file);
  db.exec("CREATE TABLE versions(id TEXT,rev INTEGER,payload TEXT,PRIMARY KEY(id,rev));CREATE TABLE production_queue(task TEXT PRIMARY KEY,batch TEXT,position INTEGER,status TEXT,reason TEXT,updated TEXT);CREATE TABLE article_snapshots(task_id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(task_id,version));");
  const task=db.prepare("INSERT INTO versions VALUES(?,1,?)"),queue=db.prepare("INSERT INTO production_queue VALUES(?,?,?,?,?,?)"),article=db.prepare("INSERT INTO article_snapshots VALUES(?,2,?)");
  db.exec("BEGIN");
  for(let i=0;i<count;i++){
    const id="task-"+i,status=["受阻","待人工审核","生成","排队","待人工审核"][i%5];
    task.run(id,JSON.stringify({input:{topic:"内容 "+i,production:{accountName:"账号 "+(i%3),kind:"图文"}},article:{version:1,title:"内容 "+i}}));
    queue.run(id,"batch-"+Math.floor(i/10),i,status,"测试原因",new Date(1700000000000+i*1000).toISOString());
    if(i%5===4)article.run(id,JSON.stringify({version:2,title:"定稿 "+i,confirmed:true}));
  }
  db.exec("COMMIT");db.close();return file;
}
it.each([0,50,500,5000])("在 %i 条任务下摘要有界、分页完整、统计准确且无写入",(count)=>{
  const file=seed(count),hash=()=>createHash("sha256").update(readFileSync(file)).digest("hex"),before=hash();
  const start=performance.now(),home=workOverview();
  expect(home.total).toBe(count);expect(home.todoCount).toBe(count*2/5);expect(home.activeCount).toBe(count*2/5);
  expect(home.counts["已定稿"]||0).toBe(count/5);
  expect(home.todos.map(t=>t.status)).toEqual(count?["受阻","待人工审核","受阻"]:[]);
  expect(home.active.length).toBeLessThanOrEqual(1);expect(home.groups.length).toBeLessThanOrEqual(1);
  expect(home.active.every(t=>!t.confirmed)).toBe(true);
  const ids=new Set<string>();
  for(let page=1;page<=Math.ceil(count/25);page++){
    const result=workOverview({list:true,page});expect(result.rows.length).toBeLessThanOrEqual(25);
    result.rows.forEach(t=>ids.add(t.id));
  }
  expect(ids.size).toBe(count);
  if(count){
    expect(workOverview({list:true,q:"内容 "+(count-1)}).rows.some(t=>t.id==="task-"+(count-1))).toBe(true);
    expect(workOverview({list:true,status:"已定稿"}).matched).toBe(count/5);
    expect(workOverview({list:true,status:"todo"}).matched).toBe(count*2/5);
  }
  expect(hash()).toBe(before);
  console.log(JSON.stringify({count,summaryBytes:Buffer.byteLength(JSON.stringify(home)),verificationMs:Math.round(performance.now()-start)}));
},30000);

it("首页优先显示有正文可处理的受阻稿，并可用正文标题或原选题查找",()=>{
  const db=new DatabaseSync(seed(15));
  db.prepare("UPDATE versions SET payload=json_set(payload,'$.article.title','改写后的标题') WHERE id='task-10'").run();
  db.prepare("UPDATE versions SET payload=json_remove(payload,'$.article') WHERE id='task-0'").run();
  db.prepare("UPDATE production_queue SET updated='2030-01-01' WHERE task='task-0'").run();
  db.close();
  expect(workOverview().todos.filter(t=>t.status==="受阻").map(t=>t.id)).toEqual(["task-10","task-5"]);
  for(const q of ["改写后的标题","内容 10"]){
    expect(workOverview({list:true,status:"todo",q}).rows.map(t=>t.id)).toEqual(["task-10"]);
  }
});
