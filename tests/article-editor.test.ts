import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";
import {create,lookup} from "../src/studio/tasks";
import {articleCandidates,readArticles,changeArticle,articleForReview,ArticleConflict} from "../src/studio/article-store";
import {fromText,mapReviewAnchor,plainText,quoteRange,documentSchema,textDiff} from "../src/studio/article-document";
import {endingEditId} from "../src/types/multi-agent-review";
import {GET,POST} from "../src/app/api/articles/route";
import {review,readReviews} from "../src/studio/eval";
import {POST as reviewPost} from "../src/app/api/reviews/route";
beforeEach(()=>{
  const dir=mkdtempSync(path.join(tmpdir(),"article-editor-"));
  vi.stubEnv("STUDIO_DB",path.join(dir,"tasks.db"));vi.stubEnv("STUDIO_LIBRARY_DB",path.join(dir,"library.db"));
  vi.stubEnv("STUDIO_MODEL","offline");vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1234/chat");vi.stubEnv("STUDIO_MODEL_KEY","");
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("禁止真实联网");}));
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
function seed(body="第一段🪁。\n\n第二段\r\n末尾\n"){
  const t=create({topic:"原创虚构编辑测试",format:"图文文章",mode:"keyword"});
  t.stage="done";t.revision=3;t.research={version:2,status:"ready_with_limits",questions:[],model:"offline",evidence:[]};
  t.article={title:"旧标题",body,citations:["synthetic-source"],version:3,researchVersion:2,model:"offline",reviewLabel:"限定范围草稿，待人工审核"};
  const db=new DatabaseSync(process.env.STUDIO_DB!);db.prepare("INSERT INTO versions VALUES(?,?,?)").run(t.id,3,JSON.stringify(t));db.close();return t;
}
const edit=(taskId:string,revision=0,baseVersion=3,action="draft")=>({taskId,revision,baseVersion,action,title:"新标题",document:fromText("改后🪁\n第二段")});
it("旧文章无损兼容，包括空行、CRLF、emoji和尾部换行；原快照不变",()=>{
  const t=seed(),s=readArticles(t.id);expect(plainText(s.head.document)).toBe(t.article!.body);
  expect(s.draft).toBeNull();expect(lookup(t.id,3)).toEqual(t);expect(s.head.origin).toBe("model");
});
it("草稿保存和重新读取不创建正式版本，过期保存不可覆盖",()=>{
  const t=seed();changeArticle(edit(t.id));const s=readArticles(t.id);
  expect(s.draft?.revision).toBe(1);expect(s.versions).toHaveLength(1);
  expect(()=>changeArticle(edit(t.id))).toThrow(ArticleConflict);
  expect(readArticles(t.id).draft).toEqual(s.draft);
  expect(changeArticle(edit(t.id,1)).draft?.revision).toBe(2);
});
it("正式保存与恢复只追加版本，独立于任务修订并保留研究引用",()=>{
  const t=seed();const first=changeArticle(edit(t.id,0,3,"publish"));
  expect(first.head).toMatchObject({version:4,origin:"human",researchVersion:2,sourceTaskRevision:3,citations:["synthetic-source"]});
  expect(first.head.model).toBeUndefined();expect(first.head.reviewLabel).toContain("限定范围");
  const restored=changeArticle({action:"restore",taskId:t.id,revision:1,baseVersion:4,version:3});
  expect(restored.head).toMatchObject({version:5,origin:"restore",restoredFrom:3,parentVersion:4,body:t.article!.body});
  expect(restored.versions).toHaveLength(3);expect(restored.versions[1]).toEqual(first.head);
  expect(lookup(t.id)?.revision).toBe(3);expect(articleForReview(t.id,4).article?.body).toBe("改后🪁\n第二段");
  expect(articleForReview(t.id,3).article).toEqual(t.article && {...t.article,reviewLabel:undefined});
});
it("数据库层拒绝修改或删除正式文章",()=>{
  const t=seed();changeArticle(edit(t.id,0,3,"publish"));const db=new DatabaseSync(process.env.STUDIO_DB!);
  expect(()=>db.exec("UPDATE article_snapshots SET version=9")).toThrow(/immutable/);
  expect(()=>db.exec("DELETE FROM article_snapshots")).toThrow(/immutable/);db.close();
});
it("并发客户端相同修订只有一次保存成功，旧基线也被拒绝",async()=>{
  const t=seed();const results=await Promise.allSettled([Promise.resolve().then(()=>changeArticle(edit(t.id))),Promise.resolve().then(()=>changeArticle(edit(t.id)))]);
  expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  expect(()=>changeArticle(edit(t.id,1,2))).toThrow(ArticleConflict);
});
it("格式损坏失败不会消耗修订，可修正后重试",()=>{
  const t=seed();expect(()=>changeArticle({...edit(t.id),document:[{type:"iframe",children:[{text:"bad"}]}]})).toThrow();
  expect(readArticles(t.id).draft).toBeNull();expect(changeArticle(edit(t.id)).draft?.revision).toBe(1);
});
it("UTF-16 定位跨叶、段落、列表、emoji，不猜测重复句的位置",()=>{
  const d=documentSchema.parse([{type:"h1",children:[{text:"🪁",bold:true},{text:"中文"}]},{type:"li",children:[{text:"重复。\n重复。"}]}]);
  expect(plainText(d)).toBe("🪁中文\n重复。\n重复。");
  expect(quoteRange(d,"中文\n重复",2)).toEqual({anchor:{path:[0,1],offset:0},focus:{path:[1,0],offset:2}});
  expect(quoteRange(d,"重复。",9)).toEqual({anchor:{path:[1,0],offset:4},focus:{path:[1,0],offset:7}});
  expect(quoteRange(d,"重复。",6)).toBeNull();expect(quoteRange(d,"不存在",0)).toBeNull();
});
it("定位移动的原句，重复或已变更而无法消歧时拒绝替换",()=>{
  const original="🪁\n"+"蓝色校样".repeat(12)+"她停下来。"+"重新读这一行".repeat(12)+"她停下来。";
  const offset=original.lastIndexOf("她停下来。");
  expect(mapReviewAnchor(original,"新增\n"+original,"她停下来。",offset)).toBe(offset+3);
  expect(mapReviewAnchor("她停下来。她停下来。","她停下来。","她停下来。",5)).toBeNull();
  expect(mapReviewAnchor("甲🪁乙","🪁甲乙","🪁",1)).toBe(0);
});
it("补充按草稿写入幂等，保存冲突不改变清单状态",()=>{
  const t=seed(),db=new DatabaseSync(process.env.STUDIO_DB!);
  db.exec("CREATE TABLE production_supplements(task TEXT,key TEXT,state TEXT)");
  db.prepare("INSERT INTO production_supplements VALUES(?,'ending','pending')").run(t.id);
  const draft={...edit(t.id),reviewEdit:endingEditId};
  try{
    expect(()=>changeArticle({...draft,revision:99})).toThrow(ArticleConflict);
    expect(db.prepare("SELECT state FROM production_supplements").get()?.state).toBe("pending");
    const saved=changeArticle(draft);
    expect(changeArticle(draft).draft).toEqual(saved.draft);
    expect(readArticles(t.id).draft?.reviewEdits).toEqual([endingEditId]);
    expect(db.prepare("SELECT state FROM production_supplements").get()?.state).toBe("added");
    expect(()=>changeArticle({...draft,document:fromText("另一段")})).toThrow(ArticleConflict);
    expect(changeArticle(edit(t.id,1,3,"publish")).head.endingInserted).toBe(true);
  }finally{db.close();}
});
it("纯文本差异保留中英文、换行，样式不改变审核文本",()=>{
  const d=fromText("第一段\n第二段");d[1].type="li";d[0].children[0].bold=true;
  expect(plainText(d)).toBe("第一段\n第二段");expect(textDiff("前\n旧\n后","前\n新\n后")).toEqual({prefix:"前\n",removed:"旧",added:"新",suffix:"\n后"});
  expect(textDiff("前😀后","前😃后")).toEqual({prefix:"前",removed:"😀",added:"😃",suffix:"后"});
});
const req=(body:unknown,origin="http://127.0.0.1:3000")=>new Request("http://localhost:3000/api/articles",{method:"POST",headers:{host:"127.0.0.1:3000",origin,"content-type":"application/json"},body:JSON.stringify(body)});
it("服务端入口拒绝跨源写入，返回保存成功、冲突及格式错误",async()=>{
  const t=seed();expect((await POST(req(edit(t.id),"https://evil.example"))).status).toBe(403);
  const malformed=req(edit(t.id));malformed.headers.set("host","user@127.0.0.1:3000");expect((await POST(malformed)).status).toBe(403);
  expect((await POST(req({...edit(t.id),title:123}))).status).toBe(400);
  expect((await POST(req(edit(t.id)))).status).toBe(200);expect((await POST(req(edit(t.id)))).status).toBe(409);
  expect((await (await GET(new Request("http://localhost/api/articles?taskId="+t.id))).json()).draft.revision).toBe(1);
});
it("新旧审核绑定各自不可变正文和版本；草稿不成为审核对象",async()=>{
  const t=seed("原文");const clean={label:"优秀",disputed:false,dimensions:{内容策略:"符合",表达质量:"清楚",内容结构:"完整",基础规范:"符合"},issues:[],claims:[]};
  const fetch=vi.fn(async()=>Response.json({model:"offline",choices:[{finish_reason:"stop",message:{content:JSON.stringify(clean)}}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));vi.stubGlobal("fetch",fetch);
  await review(t.id,3);changeArticle(edit(t.id,0,3,"publish"));await review(t.id,4);
  changeArticle({...edit(t.id,1,4),title:"未正式保存"});
  expect(readReviews(t.id,3)[0].articleVersion).toBe(3);expect(readReviews(t.id,4)[0].articleVersion).toBe(4);
  expect(articleForReview(t.id,4).article?.title).toBe("新标题");expect(readReviews(t.id,5)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("人工编辑不会扩大 DeepSeek 审批，旧业务与新任务不串版本",async()=>{
  const a=seed(),b=seed("另一个任务");changeArticle(edit(a.id,0,3,"publish"));
  expect(()=>articleForReview(b.id,4)).toThrow();
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");vi.stubEnv("STUDIO_MODEL","deepseek-chat");
  const response=await reviewPost(new Request("http://localhost:3000/api/reviews",{method:"POST",
    headers:{host:"127.0.0.1:3000",origin:"http://127.0.0.1:3000",referer:"http://127.0.0.1:3000/studio/editor","content-type":"application/json"},
    body:JSON.stringify({taskId:a.id,articleVersion:4})}));
  expect(response.status).toBe(201);const result=await response.json();expect(result.status).toBe("failed");
  expect(result.error).toBe("Eval 仅开放本机推理；当前云端审批不包含审核");
  expect(result.diagnostic).toMatchObject({stage:"provider_setup",code:"SAFETY_ERROR"});expect(fetch).not.toHaveBeenCalled();
});

it("收藏方法须另行确认才进入新任务检索",async()=>{
  const task=seed("他先敲了两下门，又退回台阶。");
  const [candidate]=articleCandidates({taskId:task.id,version:3,kind:"method"});
  const {references,importCase,methodIndex,findMethods}=await import("../src/studio/library");
  const id="door-action";expect(methodIndex().chunks.some(c=>c.id.includes(id))).toBe(false);
  importCase({...references()[0],id,title:candidate.title,content:candidate.body,method:"用退回台阶表现犹豫",tags:["退回台阶"],allowExternal:false},"reference");
  const hits=await findMethods({topic:"退回台阶",audience:"读者"},"退回台阶","keyword",methodIndex(false,[id]));
  expect(hits.hits.map(h=>h.id)).toEqual(["general/reference/door-action/v1"]);
  expect(methodIndex(false,[id+"@1"]).chunks.map(c=>c.id)).toEqual(["general/reference/door-action/v1"]);
  expect(methodIndex(true,[id+"@1"]).chunks).toEqual([]);
  importCase({...references().find(r=>r.id===id)!,version:2},"reference");
  expect(()=>methodIndex(false,[id+"@1"])).toThrow("指定参考版本已失效");
  expect(methodIndex(false,[id+"@2"]).chunks.map(c=>c.id)).toEqual(["general/reference/door-action/v2"]);
});
