import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {channelContent,type ChannelContent} from "../src/types/channel-derivation";
import {channelDelivery,channelRadar} from "../src/studio/channel-delivery";
import {readDerivation,writeDerivation} from "../src/studio/channel-derivations";
import {create} from "../src/studio/tasks";
import {changeArticle,readArticles} from "../src/studio/article-store";
import {fromText} from "../src/studio/article-document";
import {GET,POST} from "../src/app/api/derivations/route";
import {localProvider} from "../src/studio/provider";

vi.mock("../src/studio/provider",()=>({localProvider:vi.fn()}));
const provider=vi.mocked(localProvider);
const script:ChannelContent={variant:"douyin-script",title:"动作描写",keywords:["动作","校样"],cta:"在评论区写下一句。",
  hooks:["看这一笔","跟着做","改成动作"],script:"[画面提示] 蓝笔。\n绝对有效\n[重音停顿] 一笔。"};
const post:ChannelContent={variant:"douyin-post",title:"短图文",keywords:[],cta:"",slides:["第一页","第二页"]};
const xhs:ChannelContent={variant:"xiaohongshu",titles:["纸角观察","改写动作","校样笔记"],body:"📝 写作练习\n\n📌 加我微信。全网最低。",
  tags:["写作","入门","动作","校样","纸角","编辑","分段","改写"],comments:Array.from({length:3},()=>({question:"怎么做",answer:"我先圈一句。"})),keywords:["写作练习","动作画面"],cta:""};
const wechat:ChannelContent={variant:"wechat",title:"<script>alert(1)</script>",keywords:[],cta:"<a href=x>回应</a>",blocks:[
  {kind:"quote",text:"<img src=x onerror=alert(1)>\n甲 & 乙"},{kind:"highlight",text:"稳赚不赔"},{kind:"step",text:"看原句"}]};
beforeEach(()=>{
  const dir=mkdtempSync(join(tmpdir(),"channels-"));
  vi.stubEnv("STUDIO_DB",join(dir,"studio.sqlite"));vi.stubEnv("STUDIO_LIBRARY_DB",join(dir,"library.sqlite"));
  provider.mockReset();
});
afterEach(()=>vi.unstubAllEnvs());
function seed(topic:string){
  const task=create({topic,format:"图文文章",mode:"keyword"});
  task.stage="done";task.revision=3;task.research={version:2,status:"ready_with_limits",questions:[],model:"offline",evidence:[]};
  task.article={title:topic,body:"正式母稿正文",citations:[],version:3,researchVersion:2,model:"offline"};
  const db=new DatabaseSync(process.env.STUDIO_DB!);
  db.prepare("INSERT INTO versions VALUES(?,?,?)").run(task.id,3,JSON.stringify(task));db.close();
  return task.id;
}
const req=(value:unknown,origin="http://127.0.0.1:3688")=>new Request("http://127.0.0.1:3688/api/derivations",{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(value)});

it("按母稿任务、正式版本和抖音形态隔离，旧修订写入失败，母稿及草稿保持原状",async()=>{
  const id=seed("母稿"),other=seed("其他稿");
  changeArticle({action:"draft",taskId:id,baseVersion:3,revision:0,title:"草稿题目",document:fromText("母稿草稿")});
  const before=readArticles(id);
  const requests=await Promise.allSettled([Promise.resolve().then(()=>writeDerivation(id,3,0,script)),Promise.resolve().then(()=>writeDerivation(id,3,0,script))]);
  expect(requests.filter(result=>result.status==="fulfilled")).toHaveLength(1);
  expect(writeDerivation(id,3,1,{...script,title:"渠道修订"}).revision).toBe(2);
  expect(writeDerivation(id,3,0,post).revision).toBe(1);
  expect(readDerivation(other,3,"douyin-script")).toBeNull();
  expect(readArticles(id)).toEqual(before);
  const newMother=changeArticle({action:"publish",taskId:id,baseVersion:3,revision:1,title:"新母稿",document:fromText("新内容")});
  expect(readDerivation(id,newMother.head.version,"douyin-script")).toBeNull();
  expect(readDerivation(id,3,"douyin-script")?.content).toMatchObject({title:"渠道修订"});
  expect(()=>writeDerivation(id,3,2,{...script,title:"后台旧版本"},true)).toThrow("母稿已切版");
  expect(readDerivation(id,3,"douyin-script")?.revision).toBe(2);
  expect(()=>readDerivation(id,999,"wechat")).toThrow("母稿版本不存在");
});
it("生成只发送正式正文，同源与渠道校验阻止错误写入，保存不调用模型",async()=>{
  const taskId=seed("正式题目"),scope={taskId,articleVersion:3,variant:"douyin-script",revision:0};
  changeArticle({action:"draft",taskId,baseVersion:3,revision:0,title:"未保存为正式稿",document:fromText("作者实验文本")});
  const json=vi.fn(async()=>script);
  provider.mockReturnValue({json,model:"fixture"});
  expect((await POST(req({...scope,action:"generate",allowCloud:false},"https://elsewhere.test"))).status).toBe(403);
  expect((await POST(req({...scope,action:"save",content:post}))).status).toBe(400);
  expect((await POST(req({...scope,action:"generate",allowCloud:false}))).status).toBe(200);
  expect(json).toHaveBeenCalledWith(expect.any(String),{variant:"douyin-script",title:"正式题目",body:"正式母稿正文"});
  expect((await POST(req({...scope,action:"generate",allowCloud:false}))).status).toBe(409);
  expect((await POST(req({...scope,action:"save",revision:1,content:{...script,title:"新题"}}))).status).toBe(200);
  const fetched=await GET(new Request("http://127.0.0.1:3688/api/derivations?"+new URLSearchParams({taskId,articleVersion:"3",variant:"douyin-script"})));
  expect(await fetched.json()).toMatchObject({revision:2,content:{title:"新题"}});
  expect(json).toHaveBeenCalledTimes(1);
});
it("检查各端风险词、关键词、CTA、钩子和格式，生成公众号安全的双 MIME 内容",()=>{
  expect(channelContent.safeParse({...xhs,titles:["长".repeat(21),"乙","丙"]}).success).toBe(false);
  expect(channelContent.safeParse({...xhs,tags:["一","一","三","四","五","六","七","八"]}).success).toBe(false);
  expect(channelRadar(xhs)).toMatchObject({cta:false,format:true,keywords:[{present:true},{present:false}]});
  expect(channelRadar(xhs).matches.map(r=>r.text)).toEqual(["加我微信","全网最低"]);
  expect(channelDelivery(xhs).plain).toContain("#写作 #入门 #动作");
  expect(channelDelivery(xhs).plain).toContain("作者自问：怎么做");
  expect(channelRadar(script)).toMatchObject({cta:true,hooks:3,matches:[{text:"绝对有效"}]});
  expect(channelRadar({...post,slides:["保证成功","乙"]}).matches).toHaveLength(1);
  expect(channelRadar(wechat)).toMatchObject({format:true,matches:[{text:"稳赚不赔"}]});
  const {html,plain}=channelDelivery(wechat);
  expect(html).toContain("<blockquote style=");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;<br>甲 &amp; 乙");
  expect(html).toContain("&lt;a href=x&gt;回应&lt;/a&gt;");
  expect(html).not.toMatch(/<(img|script|a)\b/);
  expect(plain).toContain("<img src=x onerror=alert(1)>");
});
