import {DatabaseSync} from "node:sqlite";
import {createHash} from "node:crypto";
import {z} from "zod";

const id=z.string().regex(/^[a-zA-Z0-9]+$/);
const config=z.object({app:id,table:id,fields:z.object({title:z.string().min(1),method:z.string().min(1),updated:z.string().min(1)}).strict(),
  permissions:z.object({store:z.boolean(),create:z.boolean(),evaluate:z.boolean(),external:z.boolean()}).strict()}).strict();
const page=z.object({items:z.array(z.object({record_id:id,fields:z.record(z.string(),z.unknown())})),has_more:z.boolean(),page_token:z.string().optional()});
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
function text(v:unknown){
  if(Array.isArray(v))return v.map(part=>z.object({text:z.string()}).parse(part).text).join("");
  return z.string().min(1).parse(v);
}
function connection(){
  const d=new DatabaseSync(process.env.STUDIO_LIBRARY_DB??"data/content-library.sqlite");
  d.exec("PRAGMA secure_delete=ON;PRAGMA busy_timeout=5000;CREATE TABLE IF NOT EXISTS source_rows(source TEXT,id TEXT,version INTEGER,hash TEXT,updated TEXT,fetched TEXT,permissions TEXT,payload TEXT,PRIMARY KEY(source,id));CREATE TABLE IF NOT EXISTS source_runs(source TEXT PRIMARY KEY,token TEXT)");
  d.exec("CREATE TABLE IF NOT EXISTS sync_status(source TEXT PRIMARY KEY,success TEXT,attempt TEXT,reason TEXT)");
  return d;
}
export function syncStatus(){
  const raw=process.env.STUDIO_FEISHU_SCOPE;
  const parsed=config.safeParse((()=>{try{return JSON.parse(raw??"null");}catch{return null;}})());
  if(!parsed.success)return {label:raw&&raw!=="null"?"配置格式无效":"未配置",permissions:null,success:null,reason:"",canSync:false};
  const c=parsed.data,d=connection(),source=digest(c.app+"/"+c.table);
  try{
    const record=d.prepare("SELECT success,reason FROM sync_status WHERE source=?").get(source);
    const previous=d.prepare("SELECT MAX(fetched) AS time FROM source_rows WHERE source=?").get(source);
    return {label:!c.permissions.store?"已撤销保存授权":process.env.STUDIO_FEISHU_TOKEN?"已配置只读来源":"缺少只读凭证",permissions:c.permissions,success:String(record?.success??previous?.time??""),reason:String(record?.reason??""),canSync:!c.permissions.store||!!process.env.STUDIO_FEISHU_TOKEN};
  }finally{d.close();}
}
export async function syncFeishu(raw:unknown,bearer:string,request:typeof fetch=fetch){
  const c=config.parse(raw),source=digest(c.app+"/"+c.table),token=crypto.randomUUID(),d=connection();
  const permissions=JSON.stringify({...c.permissions,scope:digest(JSON.stringify(c))}),rows=new Map<string,{title:string;method:string;updated:string}>();
  try{
    d.exec("BEGIN IMMEDIATE");d.prepare("INSERT OR REPLACE INTO source_runs VALUES(?,?)").run(source,token);
    // A partial scan may suspend use but never marks missing records as deleted.
    d.prepare("UPDATE source_rows SET permissions=NULL WHERE source=?").run(source);
    if(!c.permissions.store)d.prepare("UPDATE source_rows SET payload=NULL WHERE source=?").run(source);
    d.prepare("INSERT INTO sync_status(source,attempt,reason) VALUES(?,?,?) ON CONFLICT(source) DO UPDATE SET attempt=excluded.attempt,reason=excluded.reason").run(source,new Date().toISOString(),c.permissions.store?"本次同步尚未完成":"已按撤权清除本地内容");
    d.exec("COMMIT");if(!c.permissions.store)return 0;
    if(!bearer)throw Error("缺少只读凭证，资料已暂停使用");
    const seen=new Set<string>();let cursor="";
    do{
      if(seen.has(cursor)||seen.size>=100)throw Error("分页覆盖不完整，已暂停使用");seen.add(cursor);
      const url=new URL("https://open.feishu.cn/open-apis/bitable/v1/apps/"+c.app+"/tables/"+c.table+"/records/search");url.searchParams.set("page_size","100");if(cursor)url.searchParams.set("page_token",cursor);
      const response=await request(url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:"Bearer "+bearer,"Content-Type":"application/json"},body:JSON.stringify({field_names:Object.values(c.fields)})});
      if(!response.ok)throw Error("读取失败，资料已暂停使用");
      const result=await response.json();if(result.code!==0)throw Error("飞书未确认读取成功，资料已暂停使用");
      const data=page.parse(result.data);
      for(const item of data.items){
        const fields=item.fields,updated=z.union([z.number(),z.string().min(1)]).parse(fields[c.fields.updated]);
        if(!Number.isFinite(new Date(Number(updated)||Date.parse(String(updated))).getTime()))throw Error("更新时间无效");
        const value={title:text(fields[c.fields.title]),method:text(fields[c.fields.method]),updated:String(updated)};
        if(value.title.length>2000||value.method.length>2000)throw Error("字段超过允许长度");
        if(rows.has(item.record_id)&&JSON.stringify(rows.get(item.record_id))!==JSON.stringify(value))throw Error("分页读取期间记录已变化");
        rows.set(item.record_id,value);
      }
      if(data.has_more&&!data.page_token)throw Error("缺少下一页标记");
      cursor=data.has_more?data.page_token!:"";
    }while(cursor);
    d.exec("BEGIN IMMEDIATE");
    if(d.prepare("SELECT token FROM source_runs WHERE source=?").get(source)?.token!==token)throw Error("已有更新的同步");
    const fetched=new Date().toISOString();
    for(const [id,value] of rows){
      const payload=JSON.stringify({title:value.title,method:value.method}),hash=digest(payload+value.updated+permissions);
      d.prepare("INSERT INTO source_rows VALUES(?,?,1,?,?,?,?,?) ON CONFLICT(source,id) DO UPDATE SET version=source_rows.version+(source_rows.hash!=excluded.hash OR source_rows.payload IS NULL),hash=excluded.hash,updated=excluded.updated,fetched=excluded.fetched,permissions=excluded.permissions,payload=excluded.payload").run(source,id,hash,value.updated,fetched,permissions,payload);
    }
    d.prepare("UPDATE source_rows SET payload=NULL WHERE source=? AND permissions IS NULL").run(source);
    d.prepare("UPDATE sync_status SET success=?,reason=NULL WHERE source=?").run(fetched,source);
    d.exec("COMMIT");return rows.size;
  }catch(error){
    if(d.isTransaction)d.exec("ROLLBACK");
    const reason=error instanceof Error&&/^(缺少|分页|读取失败|飞书未确认|更新时间无效|字段超过)/.test(error.message)?error.message:"字段格式、网络或凭证检查失败";
    d.prepare("UPDATE sync_status SET reason=? WHERE source=? AND EXISTS(SELECT 1 FROM source_runs WHERE source=? AND token=?)").run(reason,source,source,token);
    throw error;
  }finally{if(d.isTransaction)d.exec("ROLLBACK");d.close();}
}
export function feishuMethods(){
  const scope=config.safeParse((()=>{try{return JSON.parse(process.env.STUDIO_FEISHU_SCOPE??"null");}catch{return null;}})());
  if(!scope.success||!scope.data.permissions.store||!scope.data.permissions.create)return [];
  const active=digest(JSON.stringify(scope.data));
  const d=connection();
  try{return d.prepare("SELECT * FROM source_rows WHERE payload IS NOT NULL AND json_extract(permissions,'$.create')=1 AND json_extract(permissions,'$.store')=1 AND json_extract(permissions,'$.scope')=?").all(active).map(r=>{
    const v=JSON.parse(String(r.payload));
    return {id:"fs-"+digest(String(r.source)+"/"+r.id).slice(0,40),version:Number(r.version),title:String(v.title),content:String(v.method),method:String(v.method),format:"图文文章" as const,goal:"借鉴写作技法",tags:["写作技法"],applies:"技法参考",avoid:"不得移植为现实事实",quality:["授权来源"],source:"飞书/"+r.source+"/"+r.id,rights:"已获许可" as const,createdAt:new Date(Number(r.updated)||Date.parse(String(r.updated))).toISOString(),allowExternal:JSON.parse(String(r.permissions)).external===true};
  });}finally{d.close();}
}

