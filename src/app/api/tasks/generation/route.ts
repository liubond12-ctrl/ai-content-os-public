import {z} from "zod";
import {lookup,approveGeneration} from "../../../../studio/tasks";
import {generalPreview} from "../../../../studio/general-approval";
export function GET(req:Request){
  const t=lookup(new URL(req.url).searchParams.get("id")??"");
  try{
    if(!t || t.stage!=="ready")throw Error("需要已就绪的资料包");
    return Response.json({...generalPreview(t),revision:t.revision},{headers:{"Cache-Control":"no-store"}});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"预览失败"},{status:400});}
}
export async function POST(req:Request){
  const url=new URL(req.url);
  // Next reconstructs request.url using its listening hostname. Host is the
  // browser-facing authority; never use Forwarded/X-Forwarded-* for approval.
  const host=req.headers.get("host")??url.host;
  const origin=req.headers.get("origin");
  let local=false;
  try{
    const external=new URL("http://"+host);
    const ref=req.headers.get("referer");
    local=/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) &&
      external.port===url.port && origin===external.origin &&
      (!ref || new URL(ref).origin===external.origin) &&
      (!req.headers.has("sec-fetch-site") || req.headers.get("sec-fetch-site")==="same-origin");
  }catch{/* Invalid authorities and referrers fail closed. */}
  if(!local ||
    !req.headers.get("content-type")?.startsWith("application/json"))return Response.json({error:"请从本机工作台确认授权"},{status:403});
  const p=z.object({id:z.uuid(),revision:z.number().int(),hash:z.string().regex(/^[a-f0-9]{64}$/),approved:z.literal(true)}).strict().safeParse(await req.json().catch(()=>null));
  if(!p.success)return Response.json({error:"需要明确授权当前预览"},{status:400});
  try{return Response.json(await approveGeneration(p.data.id,p.data.revision,p.data.hash));}
  catch(e){return Response.json({error:e instanceof Error?e.message:"授权失败"},{status:409});}
}
