import {z} from "zod";
import {review,readReviews,compareReview,resolveReviewLocation} from "../../../studio/eval";
export function GET(req:Request){
  const p=new URL(req.url).searchParams;
  const id=p.get("taskId"),version=Number(p.get("articleVersion"));
  if(!id||!Number.isSafeInteger(version)||version<1)return Response.json({error:"缺少任务及文章版本"},{status:400});
  return Response.json(readReviews(id,version),{headers:{"Cache-Control":"no-store"}});
}
export async function POST(req:Request){
  // Next may reconstruct req.url as localhost even when the browser uses
  // 127.0.0.1. Compare against the strict local Host, not that internal alias.
  // Forwarded / X-Forwarded-Host never grant permission.
  const url=new URL(req.url),host=req.headers.get("host")??url.host;
  let sameOrigin=false;
  try{
    const external=new URL(url.protocol+"//"+host),origin=req.headers.get("origin"),ref=req.headers.get("referer");
    sameOrigin=["http:","https:"].includes(url.protocol)&&
      ["localhost","127.0.0.1","[::1]"].includes(url.hostname)&&
      /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&external.port===url.port&&
      (!origin||origin===external.origin)&&(!ref||new URL(ref).origin===external.origin)&&
      (!req.headers.has("sec-fetch-site")||req.headers.get("sec-fetch-site")==="same-origin");
  }catch{/* Malformed authorities/referrers fail closed. */}
  if(!sameOrigin)return Response.json({error:"拒绝跨域操作"},{status:403});
  const body=await req.json().catch(()=>null);
  try{
    if(body?.resolveId){
      const a=z.object({resolveId:z.uuid(),taskId:z.uuid(),articleVersion:z.number().int().positive(),offset:z.number().int().nonnegative()}).strict().parse(body);
      return Response.json(resolveReviewLocation(a.taskId,a.articleVersion,a.resolveId,a.offset),{status:201});
    }
    if(body?.sampleId){
      const sample=z.object({sampleId:z.enum(["sample-01","sample-02"]),articleVersion:z.literal(1)}).strict().parse(body);
      return Response.json(await review(sample.sampleId,1,false,true),{status:201});
    }
    if(body?.compareId){
      if(!process.env.STUDIO_EVAL_REVIEW_KEY || req.headers.get("x-review-key")!==process.env.STUDIO_EVAL_REVIEW_KEY)return Response.json({error:"需要人工评审密钥"},{status:403});
      return Response.json(compareReview(z.uuid().parse(body.compareId)));
    }
    const parsed=z.union([z.object({taskId:z.uuid(),articleVersion:z.number().int().positive()}).strict(),
      z.object({caseId:z.string().min(1),caseVersion:z.number().int().positive()}).strict()]).parse(body);
    const result="taskId" in parsed?await review(parsed.taskId,parsed.articleVersion):await review(parsed.caseId,parsed.caseVersion,true);
    return Response.json(result,{status:201});
  }catch(e){return Response.json({error:e instanceof Error && e.message==="固定审核清单尚未批准"?e.message:"任务、文章或审核版本不可用"},{status:e instanceof Error && e.message==="固定审核清单尚未批准"?403:400});}
}
