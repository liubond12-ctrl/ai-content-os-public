import {z} from "zod";
import {evaluations,importCase,evaluationCase,benchmark} from "../../../studio/library";
function reviewer(req?:Request){
  const key=process.env.STUDIO_EVAL_REVIEW_KEY;
  return Boolean(key && req?.headers.get("x-review-key")===key);
}
export function GET(req:Request){
  const view=new URL(req.url).searchParams.get("view");
  if(view==="inputs")return Response.json(benchmark().inputs);
  if(view==="stats" || view==="history"){
    if(!reviewer(req))return Response.json({error:"需要人工评审密钥"},{status:403});
    return Response.json(view==="stats"?benchmark().distribution:evaluations(),{headers:{"Cache-Control":"no-store"}});
  }
  return Response.json(evaluations().filter(e=>!e.split || e.split==="dev"));
}
export async function POST(req:Request){
  if(req.headers.get("origin") && req.headers.get("origin")!==new URL(req.url).origin)
    return Response.json({error:"仅接受本机同源录入"},{status:403});
  const parsed=z.object({humanReviewed:z.literal(true),item:evaluationCase}).strict().safeParse(await req.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"需要人工评审声明、评审者和完整评价依据"},{status:400});
  const item=parsed.data.item;
  if(!reviewer(req) && (item.split==="holdout" || item.split==="pool" || evaluations().some(e=>e.split==="pool" &&
    (e.id===item.id || e.content.trim()===item.content.trim() || (e.referenceId && e.referenceId===item.referenceId)))))
    return Response.json({error:"需要人工评审密钥"},{status:403});
  if(item.split && (!item.goal || !item.format || item.dimensions.some(d=>!["内容策略","表达质量","内容结构","基础规范"].includes(d))))
    return Response.json({error:"请填写形式、目标和标准评价维度"},{status:400});
  try{return Response.json(importCase(item.split?{...item,reviewedAt:new Date().toISOString()}:item,"evaluation"),{status:201});}
  catch{return Response.json({error:"无法保存，请检查案例版本是否重复"},{status:409});}
}
