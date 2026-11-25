import {z} from "zod";
import {channelContent,channelVariant} from "../../../types/channel-derivation";
import {ArticleUnavailable,articleStateInTransaction} from "../../../studio/article-store";
import {DerivationConflict,readDerivation,writeDerivation} from "../../../studio/channel-derivations";
import {isLocalArticleWrite} from "../../../studio/local-article-request";
import {generateChannel,DerivationPermission} from "../../../studio/generate-channel";
import {productionDb} from "../../../studio/production-db";
import {lockPrediction} from "../../../studio/calibration";

export const runtime="nodejs";
const scope=z.object({taskId:z.uuid(),articleVersion:z.number().int().positive(),variant:channelVariant});
const base=scope.extend({revision:z.number().int().nonnegative()});
const action=z.discriminatedUnion("action",[
  base.extend({action:z.literal("save"),content:channelContent}).strict(),
  base.extend({action:z.literal("generate"),allowCloud:z.boolean()}).strict(),
]);
function failure(error:unknown){
  if(error instanceof DerivationPermission)return Response.json({error:error.message},{status:403});
  if(error instanceof ArticleUnavailable)return Response.json({error:error.message},{status:404});
  if(error instanceof DerivationConflict)return Response.json({error:error.message},{status:409});
  return Response.json({error:error instanceof Error?error.message:"渠道稿操作失败"},{status:422});
}
export async function GET(request:Request){
  const p=new URL(request.url).searchParams;
  const parsed=scope.safeParse({taskId:p.get("taskId"),articleVersion:Number(p.get("articleVersion")),variant:p.get("variant")});
  if(!parsed.success)return Response.json({error:"渠道或母稿版本无效"},{status:400});
  try{
    const {taskId,articleVersion,variant}=parsed.data;
    return Response.json(readDerivation(taskId,articleVersion,variant),{headers:{"Cache-Control":"no-store"}});
  }catch(error){return failure(error);}
}
export async function POST(request:Request){
  if(!isLocalArticleWrite(request))return Response.json({error:"请从本机工作台操作"},{status:403});
  const parsed=action.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message??"渠道稿格式无效"},{status:400});
  const input=parsed.data;
  const {taskId,articleVersion,variant,revision}=input;
  try{
    if(input.action==="save"){
      if(input.content.variant!==variant)return Response.json({error:"渠道内容与目标不一致"},{status:400});
      const db=productionDb();
      try{
        db.exec("BEGIN IMMEDIATE");
        lockPrediction(db,{task:taskId,version:articleVersion},articleStateInTransaction(db,taskId));
        db.exec("COMMIT");
      }finally{db.close();}
      return Response.json(writeDerivation(taskId,articleVersion,revision,input.content));
    }
    return Response.json(await generateChannel(taskId,articleVersion,variant,revision,input.allowCloud));
  }catch(error){return failure(error);}
}
