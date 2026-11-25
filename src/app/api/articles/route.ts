import {z} from "zod";
import {ArticleUnavailable,articleCandidates,articleMutation,ArticleConflict,changeArticle,readArticles} from "../../../studio/article-store";
import {articleSubject} from "../../../studio/eval";
import {localProvider} from "../../../studio/provider";
import {bodySection,plainText} from "../../../studio/article-document";
import {endingEditId} from "../../../types/multi-agent-review";

const anchor=z.object({field:z.enum(["title","body"]),offset:z.number().int().nonnegative(),quote:z.string().min(1).max(4000)}).strict();
const generateEdit=z.object({action:z.literal("generate-edit"),taskId:z.uuid(),version:z.number().int().positive(),
  revision:z.number().int().nonnegative(),allowCloud:z.boolean().optional(),
  edit:z.discriminatedUnion("kind",[
    z.object({kind:z.literal("rewrite"),anchor,suggestion:z.string().min(1).max(4000)}).strict(),
    z.object({kind:z.literal("ending")}).strict(),
  ]),
}).strict();

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
  if(body?.action==="generate-edit"){
    const input=generateEdit.safeParse(body);
    if(!input.success)return Response.json({error:"修改请求无效"},{status:400});
    try{
      const {taskId,version,revision,allowCloud,edit}=input.data;
      const active=readArticles(taskId);
      if(active.head.version!==version||(active.draft?.revision??0)!==revision)
        return Response.json({error:"文章或草稿已由其他窗口更新，请重新载入。"}, {status:409});
      if(edit.kind==="ending"&&(active.head.endingInserted||active.draft?.reviewEdits?.includes(endingEditId)))
        return Response.json({error:"这篇草稿已插入结尾补充。"}, {status:409});
      const {task,title,body}=articleSubject(taskId,version);
      if(task.input.production?.mode==="真实云端"&&!allowCloud)
        return Response.json({error:"请先确认云端局部生成。"}, {status:403});
      if(edit.kind==="rewrite"&&(edit.anchor.field==="title"?title:body).slice(edit.anchor.offset,edit.anchor.offset+edit.anchor.quote.length)!==edit.anchor.quote)
        return Response.json({error:"原句已变化，请重新审核。"}, {status:409});
      const document=active.draft?.document??active.head.document;
      const section=edit.kind==="ending"?bodySection(document,active.kind):null;
      if(edit.kind==="ending"&&!section)return Response.json({error:"正文区块无法唯一定位，请先核对文章结构。"}, {status:409});
      const cue=section?{title:active.draft?.title??title,ending:plainText(document.slice(section.start,section.end)).trimEnd().slice(-1200)}
        :edit.kind==="rewrite"?{title,original:edit.anchor.quote,suggestion:edit.suggestion}:{title};
      const instruction=edit.kind==="ending"?"局部精修：写一句可供读者回应的结尾问题。":"局部精修：按建议改写给出的原句。";
      const result=await localProvider({task,professional:true,maxTokens:300}).json(instruction+"只返回 JSON {text}。text 为一句话，不加标题，不新增事实，不换行。",cue);
      const output=z.object({text:z.string().trim().min(1).max(600).refine(text=>!/[\r\n]/.test(text))}).strict().parse(result);
      return Response.json(output);
    }catch(error){return Response.json({error:error instanceof Error?error.message:"局部生成失败"},{status:422});}
  }
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
