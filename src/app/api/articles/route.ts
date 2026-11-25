import {z} from "zod";
import {ArticleUnavailable,articleCandidates,articleMutation,ArticleConflict,changeArticle,readArticles} from "../../../studio/article-store";
export const runtime="nodejs";
export async function GET(req:Request){
  if(new URL(req.url).searchParams.get("view")==="candidates")return Response.json(articleCandidates(),{headers:{"Cache-Control":"no-store"}});
  try{return Response.json(readArticles(new URL(req.url).searchParams.get("taskId")??""),{headers:{"Cache-Control":"no-store"}});}
  catch(error){
    if(error instanceof ArticleUnavailable)return Response.json({error:error.message},{status:404});
    return Response.json({error:"暂时无法读取文章存储，请稍后重试。"},{status:503});
  }
}
export async function POST(req:Request){
  // Exact browser Origin/Host pair; no forwarded headers are trusted.
  const url=new URL(req.url),host=req.headers.get("host")??url.host;
  let allowed=false;
  try{
    const external=new URL(url.protocol+"//"+host);
    const local=(h:string)=>["localhost","127.0.0.1","[::1]"].includes(h);
    allowed=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)&&local(url.hostname)&&local(external.hostname)&&external.port===url.port&&
      req.headers.get("origin")===external.origin&&
      (!req.headers.has("sec-fetch-site")||req.headers.get("sec-fetch-site")==="same-origin")&&
      (!req.headers.has("referer")||new URL(req.headers.get("referer")!).origin===external.origin);
  }catch{}
  if(!allowed||!req.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({error:"请从本机工作台保存文章"},{status:403});
  const body=await req.json().catch(()=>null);
  if(body?.action==="nominate"){
    const row=z.object({action:z.literal("nominate"),kind:z.enum(["case","method","eval"]).optional(),taskId:z.uuid(),version:z.number().int().positive()}).strict().safeParse(body);
    if(!row.success)return Response.json({error:"候选版本无效"},{status:400});
    try{articleCandidates(row.data);return Response.json({saved:true});}catch{return Response.json({error:"原版本不存在"},{status:409});}
  }
  const parsed=articleMutation.safeParse(body);
  if(!parsed.success)return Response.json({error:"文章格式无效；当前输入未保存"},{status:400});
  try{return Response.json(changeArticle(parsed.data));}
  catch(e){return Response.json({error:e instanceof ArticleConflict?e.message:"保存失败，请保留当前输入后重试"},{status:e instanceof ArticleConflict?409:500});}
}
