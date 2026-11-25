import {imageState,bindImage,exportPackage} from "@/studio/content-package";
export async function GET(req:Request){
  const p=new URL(req.url).searchParams,id=p.get("id")??"";
  try{
    if(p.has("download"))return new Response(new Uint8Array(exportPackage(id)),{headers:{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="content-package.zip"',"Cache-Control":"no-store"}});
    return Response.json(imageState(id),{headers:{"Cache-Control":"no-store"}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"无法读取内容包"},{status:409});}
}
export async function POST(req:Request){
  if(req.headers.get("origin")!=="http://"+req.headers.get("host"))return new Response(null,{status:403});
  try{const b=await req.json();bindImage(b.task,b.page,b.article,b.asset,b.confirmed===true);return Response.json({ok:true});}
  catch(e){return Response.json({error:e instanceof Error?e.message:"图片归位失败"},{status:409});}
}
