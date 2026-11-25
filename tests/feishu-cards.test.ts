import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {backup} from "node:sqlite";
import {join} from "node:path";
import {randomUUID} from "node:crypto";
import {cardDb,prefs,notify,mockAuthor,mockTransport,receive,applyPending,type Card} from "../src/studio/feishu-cards";
import {saveEntity,saveProductionDraft,previewDraft,submitBatch,workerTick} from "../src/studio/production";
import {readArticles,changeArticle} from "../src/studio/article-store";
import {fixtureResponse} from "../scripts/production-fixture-response.mjs";
let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),"fs-cards-"));vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));vi.stubEnv("STUDIO_MODEL","fixture");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1/mock");vi.stubEnv("STUDIO_DEMO_INSTANCE","1");vi.stubEnv("STUDIO_FEISHU_SCOPE","null");
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
    const messages=JSON.parse(init.body).messages,data=JSON.parse(messages[1].content);
    const output=fixtureResponse(messages[0].content,data);
    if(messages[0].content.startsWith("你是Judge"))for(const d of (output as {decisions:{action:string;selectedIds:string[];reason:string}[]}).decisions){d.action="human";d.selectedIds=[];d.reason="两种节奏均成立，需要作者决定";}
    return Response.json({model:"fixture",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(output)}}]});
  }));
  const db=cardDb();prefs(db,"mock");db.close();
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
async function seed(){
  const a=saveEntity("account",{name:"纸上观察",platform:"小红书",status:"启用"}),b=saveEntity("account",{name:"口袋工作室",platform:"抖音",status:"启用"});
  const drafts=[a,b].map((owner,i)=>saveProductionDraft({intent:"queued",id:randomUUID(),version:0,account:owner.id,platform:owner.platform,kind:"图文",topic:i?"核验演练：虚构纸张":"分歧演练：窗边的停顿",budgetProfile:"local_extended",sources:["scene-editing@1"]}));
  submitBatch({id:randomUUID(),drafts,tokenLimit:240000,requestLimit:64,preview:drafts.map(previewDraft)});
  await notify("mock",mockAuthor,mockTransport());
  for(let i=0;i<75;i++){
    const db=cardDb();const pending=db.prepare("SELECT 1 FROM production_queue WHERE status='排队'").get();db.close();
    if(!pending)break;await workerTick("card-fixture-worker");
  }
  await notify("mock",mockAuthor,mockTransport());
  const db=cardDb();const rows=db.prepare("SELECT * FROM fs_outbox ORDER BY rowid").all();db.close();
  const parsed=rows.map(r=>({id:String(r.id),message:String(r.message),card:JSON.parse(String(r.card)) as Card}));
  expect(parsed.filter(r=>r.card.kind==="batch")).toHaveLength(1);
  expect(parsed.map(r=>r.card.kind),JSON.stringify(parsed)).toContain("choice");expect(parsed.map(r=>r.card.kind)).toContain("blocked");
  const choice=parsed.find(r=>r.card.kind==="choice")!,blocked=parsed.find(r=>r.card.kind==="blocked")!;
  const callback=(action:string,row=choice)=>({operator:{open_id:mockAuthor},context:{open_message_id:String(row.message)},action:{value:{decision:String(row.id),action}}});
  return {parsed,choice,blocked,callback};
}
it.each(["A","B"])("个人方案 %s 在持久化收件箱仅应用一次，保留人工定稿",async action=>{
  const {parsed,choice,blocked,callback}=await seed();
  expect(parsed[0].card.text).toContain("共 2 条");expect(parsed[0].card.text).toContain("口袋工作室");
  const db=cardDb(),calls=()=>db.prepare("SELECT count(*) n FROM model_calls").get()!.n;
  const before=calls(),original=readArticles(choice.card.task).head;
  try{
    if(action==="A"&&process.env.FS_CAPTURE_DB_FILE)await backup(db,process.env.FS_CAPTURE_DB_FILE);
    expect(()=>receive("mock",mockAuthor,{...callback(action),operator:{open_id:"other"}})).toThrow();
    expect(()=>receive("mock",mockAuthor,{...callback(action),context:{open_message_id:"forged"}})).toThrow();
    expect(()=>receive("mock",mockAuthor,callback("approve"))).toThrow();expect(()=>receive("mock",mockAuthor,callback("A",blocked))).toThrow();
    if(action==="B"){
      receive("mock",mockAuthor,callback("later"));await notify("mock",mockAuthor,mockTransport());
      expect(receive("mock",mockAuthor,callback("later"))).toContain("稍后处理");
      expect(readArticles(choice.card.task).head.version).toBe(original.version);
    }
    expect(receive("mock",mockAuthor,callback(action))).toBe("决定已接收");
    expect(receive("mock",mockAuthor,callback(action))).toBe("决定已接收");
    expect(readArticles(choice.card.task).head.version).toBe(original.version);
    await notify("mock",mockAuthor,mockTransport());await notify("mock",mockAuthor,mockTransport());
    expect(receive("mock",mockAuthor,callback(action))).toContain("已完成");
    const next=readArticles(choice.card.task).head;expect(next.confirmed).toBe(false);expect(next.version).toBe(original.version+1);
    expect(next.body).toBe(action==="A"?original.body:original.body.replace("她停下来。她停下来。","她停下来。"));
    expect(db.prepare("SELECT status FROM production_queue WHERE task=?").get(choice.card.task)?.status).toBe("待人工审核");
    expect(receive("mock",mockAuthor,callback("later",blocked))).toBe("决定已接收");applyPending(db,"mock",mockAuthor);
    expect(receive("mock",mockAuthor,callback("later",blocked))).toContain("稍后处理");
    expect(db.prepare("SELECT status FROM production_queue WHERE task=?").get(blocked.card.task)?.status).toBe("受阻");
    expect(calls()).toBe(before);expect(db.prepare("SELECT count(*) n FROM fs_sim_messages").get()?.n).toBe(parsed.length);
    if(process.env.FS_CAPTURE_FIXTURE_FILE&&action==="A")writeFileSync(process.env.FS_CAPTURE_FIXTURE_FILE,JSON.stringify(parsed.map(r=>r.card),null,2));
  }finally{db.close();}
},40000);
it("网页先处理或在接收后处理，旧卡失效",async()=>{
  const {choice,callback,blocked}=await seed(),id=choice.card.task;
  receive("mock",mockAuthor,callback("A"));
  function webChange(task:string){const a=readArticles(task);changeArticle({action:"restore",taskId:task,baseVersion:a.head.version,revision:a.draft?.revision??0,version:a.head.version});}
  webChange(id);webChange(blocked.card.task);
  expect(()=>receive("mock",mockAuthor,callback("later",blocked))).toThrow("过期");
  await notify("mock",mockAuthor,mockTransport());expect(receive("mock",mockAuthor,callback("A"))).toContain("过期");expect(readArticles(id).head.version).toBe(choice.card.version+1);
},40000);
it("审核更新、到期及通知关闭后拒绝回传",async()=>{
  const {choice,blocked,callback}=await seed(),db=cardDb();
  try{
    db.prepare("UPDATE fs_created SET created=0 WHERE id=?").run(blocked.id);
    expect(()=>receive("mock",mockAuthor,callback("later",blocked))).toThrow("过期");
    db.prepare("UPDATE fs_notify SET settings=? WHERE mode='mock'").run(JSON.stringify({batch:true,blocked:true,choice:false}));
    expect(()=>receive("mock",mockAuthor,callback("B"))).toThrow("不可用");
    db.prepare("UPDATE fs_notify SET settings=? WHERE mode='mock'").run(JSON.stringify({batch:true,blocked:true,choice:true}));
    db.prepare("INSERT INTO reviews SELECT ?,task,article,version+1,payload FROM reviews WHERE id=?").run(randomUUID(),choice.card.review);
    expect(()=>receive("mock",mockAuthor,callback("B"))).toThrow("过期");
    expect(db.prepare("SELECT count(*) n FROM fs_inbox").get()?.n).toBe(0);
  }finally{db.close();}
},40000);
it("发送结果未知后重启不重复发送",async()=>{
  const db=cardDb();db.prepare("INSERT INTO fs_outbox(id,mode,owner,slot,card) VALUES('sample','mock',?,'sample',?)").run(mockAuthor,JSON.stringify({kind:"batch",title:"本地测试",text:"仅测试",task:"",version:0,review:"",binding:"sample",options:[]}));db.close();
  const send=vi.fn(async()=>{throw Error("响应丢失");});
  await notify("mock",mockAuthor,{send,update:vi.fn()});await notify("mock",mockAuthor,{send,update:vi.fn()});
  expect(send).toHaveBeenCalledTimes(1);const again=cardDb();expect(again.prepare("SELECT delivery FROM fs_outbox").get()?.delivery).toBe("unknown");again.close();
});