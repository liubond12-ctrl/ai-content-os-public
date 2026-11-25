import {z} from "zod";
import {brickKind,metrics,rubricFocus,versionKey} from "@/types/calibration";
import {articleStateInTransaction,ensureArticleTables} from "@/studio/article-store";
import {isLocalArticleWrite} from "@/studio/local-article-request";
import {openContent} from "@/studio/content-index";
import {entities,productionDb} from "@/studio/production-db";
import {appendRetro,applyProposal,calibrationTables,createProposal,getPrediction,getPublication,getRetros,lockPrediction,
  proposals,registerPublication,samplePool,taskAccount,effectiveDue} from "@/studio/calibration";
import {extractArticleBrick,extractReferenceBrick,searchBricks} from "@/studio/atomic-bricks";
import {dryRunRoutes} from "@/studio/model-routing";
import {seedCalibrationDemo} from "@/studio/calibration-demo";
import {breakoutReferences} from "@/studio/library";

export const runtime="nodejs";
const demo=()=>process.env.STUDIO_DEMO_INSTANCE==="1";
const account=z.string().min(1).max(160);
const extract={account,kind:brickKind,text:z.string().trim().min(1).max(1500),tags:z.array(z.string().trim().min(1).max(50)).max(10)};
const commands=z.discriminatedUnion("action",[
  z.object({action:z.literal("seed")}).strict(),
  versionKey.extend({action:z.literal("seal")}),
  versionKey.extend({action:z.literal("publish"),publishedAt:z.iso.datetime({offset:true})}),
  versionKey.extend({action:z.literal("wake")}),
  versionKey.extend({action:z.literal("retro"),metrics,source:z.string().trim().min(1).max(500),observedAt:z.iso.datetime({offset:true})}),
  z.object({action:z.literal("propose"),account,focus:rubricFocus}).strict(),
  z.object({action:z.literal("apply"),account,id:z.uuid()}).strict(),
  versionKey.extend({action:z.literal("article-brick"),...extract}),
  z.object({action:z.literal("reference-brick"),reference:z.string().max(64),version:z.number().int().positive(),...extract}).strict(),
]);
const ready=(key:NonNullable<ReturnType<typeof getPublication>>)=>Date.now()>=Date.parse(effectiveDue(key));
function versionView(db:ReturnType<typeof productionDb>,key:z.infer<typeof versionKey>){
  const prediction=getPrediction(db,key),publication=getPublication(db,key);
  return {prediction,publication,retro:getRetros(db,key),due:publication?ready(publication):false,
    reason:prediction?"":publication?"已登记历史发布，不能补做盲预测。":"尚未锁定。须有归属账号且存在该版或祖先版完成的多角色会诊。"};
}
const send=(value:unknown)=>Response.json(value,{headers:{"Cache-Control":"no-store"}});
export async function GET(request:Request){
  const params=new URL(request.url).searchParams,scope=params.get("account")??"";
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(request.headers.get("host")??new URL(request.url).host))
    return Response.json({error:"请从本机工作台访问"},{status:403});
  try{
    if(params.has("routes"))return send(dryRunRoutes());
    if(params.has("references"))return send(breakoutReferences().map(({id,version,title,source,method,content,synthetic})=>({id,version,title,source,method,content,synthetic})));
    const db=productionDb();
    try{
      calibrationTables(db);
      if(params.has("bricks"))return send(searchBricks(db,scope,(params.get("q")??"").slice(0,100)));
      if(params.has("task")){
        const key=versionKey.parse({task:params.get("task"),version:Number(params.get("version"))});
        return send(versionView(db,key));
      }
      const pool=samplePool(db,scope);
      return send({demo:demo(),accounts:entities(db,"account").filter(row=>row.status==="启用").map(row=>({id:row.id,name:row.name})),
        stage:pool.length>=5?"calibration":"cold-start",count:pool.length,proposals:proposals(db,scope),
        items:db.prepare("SELECT task,version,payload FROM cal_predictions WHERE account=? ORDER BY rowid DESC LIMIT 80").all(scope)
          .map(row=>{const key={task:String(row.task),version:Number(row.version)},view=versionView(db,key);
            const {body:ignored,...prediction}=view.prediction!;void ignored;
            return {...key,...view,prediction};}),
        cards:demo()&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='fs_outbox'").get()?
          db.prepare("SELECT delivery,result,card FROM fs_outbox WHERE mode='mock' AND json_extract(card,'$.kind')='retro' ORDER BY rowid DESC LIMIT 30").all()
          .map(row=>({...row,card:JSON.parse(String(row.card))})):[]});
    }finally{db.close();}
  }catch(error){return Response.json({error:error instanceof Error?error.message:"读取失败"},{status:400});}
}
export async function POST(request:Request){
  if(!isLocalArticleWrite(request))return Response.json({error:"请从本机工作台操作"},{status:403});
  const parsed=commands.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"校准请求格式无效"},{status:400});
  const input=parsed.data;
  if((input.action==="seed"||input.action==="wake")&&!demo())return Response.json({error:"仅离线演练可模拟"},{status:403});
  const db=input.action==="publish"?openContent():productionDb();
  try{
    ensureArticleTables(db);calibrationTables(db);db.exec("BEGIN IMMEDIATE");
    let result:unknown;
    if(input.action==="seed"){seedCalibrationDemo(db);result={seeded:true};}
    else if(input.action==="propose")result=createProposal(db,input.account,input.focus);
    else if(input.action==="apply")result={version:applyProposal(db,input.account,input.id)};
    else if(input.action==="reference-brick")result=extractReferenceBrick(db,input.reference,input.version,input);
    else{
      const key={task:input.task,version:input.version},state=articleStateInTransaction(db,input.task);
      const article=state.versions.find(row=>row.version===input.version);
      if(!article)throw Error("正式版本不存在");
      if(input.action==="seal")result=lockPrediction(db,key,state);
      else if(input.action==="publish"){
        if(!article.confirmed||!taskAccount(db,key.task))throw Error("需选择本账号已定稿版本");
        result=registerPublication(db,key,input.publishedAt);
        const day=new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(input.publishedAt));
        db.prepare("INSERT INTO content_destinations VALUES(?,?,'已发布',?,'') ON CONFLICT(id,version) DO UPDATE SET status='已发布',day=excluded.day")
          .run(key.task,key.version,day);
      }else if(input.action==="wake"){
        if(!getPublication(db,key))throw Error("先登记实际发布时间");
        db.prepare("INSERT OR IGNORE INTO cal_demo_wake VALUES(?,?)").run(key.task,key.version);
        result={activated:true};
      }else if(input.action==="retro")result=appendRetro(db,key,state,input.metrics,input.source,input.observedAt);
      else result=extractArticleBrick(db,key,state,input);
    }
    db.exec("COMMIT");return send(result);
  }catch(error){return Response.json({error:error instanceof Error?error.message:"写入失败"},{status:409});}
  finally{if(db.isTransaction)db.exec("ROLLBACK");db.close();}
}
