import {productionDb} from "@/studio/production-db";
export function GET(req:Request){
  const cursor=Number(new URL(req.url).searchParams.get("after")??0);
  if(!Number.isSafeInteger(cursor)||cursor<0)return Response.json({error:"游标无效"},{status:400});
  const db=productionDb();
  try{
    const rows=db.prepare("SELECT rowid AS cursor,* FROM production_events WHERE rowid>? ORDER BY rowid LIMIT 100").all(cursor);
    return Response.json({events:rows.map(r=>({cursor:Number(r.cursor),dedupId:r.id,taskId:r.task,version:r.version,status:r.status,summary:r.summary,createdAt:r.created})),nextCursor:rows.at(-1)?.cursor??cursor},{headers:{"Cache-Control":"no-store"}});
  }finally{db.close();}
}
