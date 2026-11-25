import {z} from "zod";
import {createBlankArticle,enqueueProductionDrafts,productionView,saveEntity,saveProductionDraft,submitBatch,queueAction,previewDraft,draftSchema} from "@/studio/production";
import {productionDb} from "@/studio/production-db";
export const runtime="nodejs";
export function GET(req:Request){const params=new URL(req.url).searchParams;return Response.json(productionView(params.get("view")==="configuration",params.get("draft")??""),{headers:{"Cache-Control":"no-store"}});}
export async function POST(req:Request){
  const url=new URL(req.url),host=req.headers.get("host")??url.host;
  if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)||req.headers.get("origin")!=="http://"+host)return Response.json({error:"请从本机工作台操作"},{status:403});
  try{
    const body=await req.json();
    if(body.action==="blankArticle")return Response.json({id:createBlankArticle(z.string().max(240).parse(body.title??""))});
    if(body.action==="entity")return Response.json(saveEntity(z.enum(["account","rule","standard"]).parse(body.kind),body.value));
    if(body.action==="enqueueDrafts")return Response.json(enqueueProductionDrafts(body.drafts));
    if(body.action==="draft")return Response.json(saveProductionDraft(body.value));
    if(body.action==="preview")return Response.json(z.array(draftSchema).parse(body.drafts).map(previewDraft));
    if(body.action==="batch"||body.action==="single"){
      const id=submitBatch({id:body.id,drafts:z.array(draftSchema).parse(body.drafts),preview:body.preview,
        tokenLimit:body.tokenLimit,requestLimit:body.requestLimit,authorizeText:body.authorizeText===true},body.action==="single"),db=productionDb();
      try{return Response.json({id,firstTask:db.prepare("SELECT task FROM production_queue WHERE batch=? ORDER BY position LIMIT 1").get(id)?.task});}finally{db.close();}
    }
    if(body.action==="history"){
      const db=productionDb();try{return Response.json(db.prepare("SELECT payload FROM production_entities WHERE kind=? AND id=? ORDER BY version DESC").all(body.kind,body.id).map(r=>JSON.parse(String(r.payload))));}finally{db.close();}
    }
    if(body.action==="draftOrder"){
      const desired=z.array(z.object({id:z.uuid(),version:z.number().int()})).parse(body.drafts),db=productionDb();
      try{
        db.exec("BEGIN IMMEDIATE");
        const all=db.prepare("SELECT id,version FROM production_drafts WHERE json_extract(payload,'$.intent')='queued'").all();
        if(all.length!==desired.length||new Set(desired.map(d=>d.id)).size!==all.length||desired.some(d=>!all.some(a=>a.id===d.id&&a.version===d.version)))throw Error("清单已变化，请刷新");
        desired.forEach((d,i)=>db.prepare("UPDATE production_draft_order SET position=? WHERE id=?").run(i,d.id));
        db.exec("COMMIT");return Response.json({ok:true});
      }finally{db.close();}
    }
    if(body.action==="removeDraft"){
      const db=productionDb();try{
        const changed=db.prepare("DELETE FROM production_drafts WHERE id=? AND version=?").run(body.id,body.version).changes;
        if(!changed)throw Error("草稿已变化，请刷新");
        return Response.json({ok:true});
      }finally{db.close();}
    }
    queueAction(z.enum(["reorder","stop","retry"]).parse(body.action),z.uuid().parse(body.batch),z.number().int().parse(body.version),z.array(z.uuid()).parse(body.ids));
    return Response.json({ok:true});
  }catch(e){return Response.json({error:e instanceof Error?e.message:"操作失败，请保留输入后刷新"},{status:409});}
}
