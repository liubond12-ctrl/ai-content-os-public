import {randomUUID} from "node:crypto";
import {productionDb} from "@/studio/production-db";
import {z} from "zod";
export const runtime="nodejs";
export async function GET(req:Request){
  const id=new URL(req.url).searchParams.get("id"),db=productionDb();
  try{
    const row=db.prepare("SELECT * FROM production_assets WHERE id=?").get(id);
    if(!row)return new Response(null,{status:404});
    return new Response(new Uint8Array(row.bytes as Uint8Array),{headers:{"Content-Type":String(row.mime),"X-Content-Type-Options":"nosniff","Content-Disposition":"inline; filename*=UTF-8''"+encodeURIComponent(String(row.name)),"Cache-Control":"no-store"}});
  }finally{db.close();}
}
export async function POST(req:Request){
  if(req.headers.get("origin")!=="http://"+req.headers.get("host"))return new Response(null,{status:403});
  try{
    const form=await req.formData(),file=form.get("file");
    if(!(file instanceof File)||file.size>5*1024*1024)throw Error("图片最大 5 MB，文本最大 200 KB");
    if(!/^[^/\\\x00-\x1f]{1,180}$/.test(file.name))throw Error("文件名无效");
    const bytes=Buffer.from(await file.arrayBuffer()),extension=file.name.split(".").at(-1)?.toLowerCase();
    let mime="";
    if(["txt","md"].includes(extension??"")){
      if(bytes.length>200000)throw Error("文本最大 200 KB");
      new TextDecoder("utf-8",{fatal:true}).decode(bytes);mime="text/plain";
    }else if(extension==="png"&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))mime="image/png";
    else if(["jpg","jpeg"].includes(extension??"")&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime="image/jpeg";
    else if(extension==="webp"&&bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP")mime="image/webp";
    if(!mime)throw Error("仅支持 UTF-8 TXT、Markdown、PNG、JPEG、WebP；PDF、DOCX 请先转换");
    const description=String(form.get("description")??"").slice(0,4000),source=String(form.get("source")??"").slice(0,1000);
    const draft=form.has("draft")?z.uuid().parse(form.get("draft")):null;
    const account=z.string().max(100).parse(form.get("account")??"");
    if(!source)throw Error("请填写附件来源");
    const db=productionDb(),id=randomUUID();
    try{
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT INTO production_assets VALUES(?,'default',?,?,?,?,?,?,?)").run(id,file.name,mime,bytes,description,source,form.get("allowed")==="true"?1:0,new Date().toISOString());
      if(draft)db.prepare("INSERT INTO production_material_owners VALUES(?,?,?)").run(id,draft,account);
      db.exec("COMMIT");
      return Response.json({id,name:file.name,mime,text:mime==="text/plain"?bytes.toString("utf8"):description});
    }finally{db.close();}
  }catch(e){return Response.json({error:e instanceof Error?e.message:"附件无效"},{status:400});}
}
