import {imageState,bindImage,clearImage,exportPackage} from "@/studio/content-package";
import {isLocalArticleWrite} from "@/studio/local-article-request";
import {z} from "zod";
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,id=p.get("id")??"";
  try{
    if(p.has("download"))return new Response(new Uint8Array(exportPackage(id)),{headers:{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="content-package.zip"',"Cache-Control":"no-store"}});
    return Response.json(imageState(id),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"无法读取内容包"},{status:409});}
}
export async function POST(req:Request){
  if(!isLocalArticleWrite(req))return new Response(null,{status:403});
  try{
    const input=await req.json();
    if(input?.action==="clear"){
      const b=z.object({action:z.literal("clear"),task:z.uuid(),page:z.number().int().min(1).max(100),article:z.number().int().positive(),
        expected:z.number().int().positive()}).strict().parse(input);
      clearImage(b.task,b.page,b.article,b.expected);
      return Response.json({ok:true});
    }
    const b=z.object({task:z.uuid(),page:z.number().int().min(1).max(100),article:z.number().int().positive(),
      asset:z.uuid(),confirmed:z.boolean(),expected:z.number().int().nonnegative().optional()}).strict().parse(input);
    bindImage(b.task,b.page,b.article,b.asset,b.confirmed,b.expected);return Response.json({ok:true});
  }
  catch(e){return Response.json({error:e instanceof Error?e.message:"图片归位失败"},{status:409});}
}
