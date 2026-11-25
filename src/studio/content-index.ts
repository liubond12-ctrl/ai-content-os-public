import {DatabaseSync} from "node:sqlite";
import {productionDb} from "./production-db";
import type {Task} from "./tasks";
import type {ArticleSnapshot} from "./article-store";

export function openContent(rebuild=false){
  if(!rebuild){
    const current=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
    try{
      current.exec("PRAGMA busy_timeout=5000");
      if(current.prepare("SELECT 1 FROM sqlite_master WHERE name='content_accounts'").get()&&!current.prepare("SELECT 1 FROM content_dirty LIMIT 1").get())return current;
    }catch(error){current.close();throw error;}
    current.close();
  }
  const db=productionDb();
  try{
    db.exec("BEGIN IMMEDIATE");
    db.exec(`CREATE TABLE IF NOT EXISTS article_snapshots(task_id TEXT,version INTEGER,payload TEXT NOT NULL,PRIMARY KEY(task_id,version));
      CREATE TABLE IF NOT EXISTS archived_tasks(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS content_dirty(id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS content_heads(id TEXT PRIMARY KEY,title TEXT,topic TEXT,body TEXT,version INTEGER,account TEXT,accountName TEXT,platform TEXT,kind TEXT,status TEXT,updated TEXT,model TEXT);
      CREATE INDEX IF NOT EXISTS content_accounts ON content_heads(account,accountName);
      CREATE INDEX IF NOT EXISTS content_task_summary ON content_heads(id,status,version,topic,title,accountName);
      CREATE INDEX IF NOT EXISTS content_recent ON content_heads(updated DESC,id);
      CREATE TABLE IF NOT EXISTS content_notes(id TEXT PRIMARY KEY,favorite INTEGER,series TEXT,tags TEXT);
      CREATE TABLE IF NOT EXISTS content_destinations(id TEXT,version INTEGER,status TEXT,day TEXT,url TEXT,PRIMARY KEY(id,version));
      CREATE TABLE IF NOT EXISTS content_lessons(id TEXT PRIMARY KEY,task TEXT,account TEXT,series TEXT,previous INTEGER,current INTEGER,beforeText TEXT,afterText TEXT,reason TEXT,scope TEXT,UNIQUE(task,previous,current,beforeText,afterText,scope,series));`);
    if(rebuild||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_versions_insert'").get()){
      for(const [table,key,actions] of [["versions","id",["insert"]],["article_snapshots","task_id",["insert"]],["production_drafts","id",["insert","update","delete"]]] as const){
        for(const action of actions)db.exec(`CREATE TRIGGER IF NOT EXISTS content_${table}_${action} AFTER ${action} ON ${table} BEGIN INSERT INTO content_dirty VALUES(${action==="delete"?"OLD":"NEW"}.${key}) ON CONFLICT DO NOTHING; END;`);
      }
      db.exec("DELETE FROM content_heads; INSERT OR IGNORE INTO content_dirty SELECT id FROM versions UNION SELECT id FROM production_drafts UNION SELECT task_id FROM article_snapshots");
    }
    if(db.prepare("SELECT 1 FROM content_dirty LIMIT 1").get())refresh(db);
    db.exec("COMMIT");return db;
  }catch(e){db.close();throw e;}
}
function refresh(db:DatabaseSync){
  const latest=db.prepare("SELECT payload FROM versions WHERE id=? ORDER BY rev DESC LIMIT 1");
  const legacy=db.prepare("SELECT payload FROM versions WHERE id=? AND rev=json_extract(payload,'$.article.version') AND json_extract(payload,'$.research.version')=json_extract(payload,'$.article.researchVersion') ORDER BY rev DESC LIMIT 1");
  const snapshot=db.prepare("SELECT payload FROM article_snapshots WHERE task_id=? ORDER BY version DESC LIMIT 1");
  const draft=db.prepare("SELECT payload,updated FROM production_drafts WHERE id=?");
  const queue=db.prepare("SELECT updated FROM production_queue WHERE task=?");
  const accountName=db.prepare("SELECT json_extract(payload,\'$.name\') label FROM production_entities WHERE kind=\'account\' AND id=? ORDER BY version DESC LIMIT 1");
  const put=db.prepare("INSERT OR REPLACE INTO content_heads VALUES(?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const {id} of db.prepare("SELECT id FROM content_dirty").iterate()){
    const task:Task|null=JSON.parse(String(latest.get(id)?.payload??"null"));
    const old:Task|null=JSON.parse(String(legacy.get(id)?.payload??"null"));
    const edited:ArticleSnapshot|null=JSON.parse(String(snapshot.get(id)?.payload??"null"));
    const article=edited&&edited.version>=(old?.article?.version??0)?edited:old?.article;
    const d=draft.get(id),brief=d?JSON.parse(String(d.payload)):null;
    if(!task&&!brief&&!article){db.prepare("DELETE FROM content_heads WHERE id=?").run(id);continue;}
    const p=task?.input.production??brief;
    const topic=task?.input.topic??brief?.topic??"";
    const updated=(article&&"createdAt" in article?article.createdAt:null)||old?.records?.at(-1)?.ended||task?.records?.at(-1)?.ended||queue.get(id)?.updated||d?.updated||"";
    put.run(id,article?.title||topic||"未命名",topic,article?.body??"",article?.version??0,p?.account??"",p?.accountName||accountName.get(p?.account??"")?.label||"",p?.platform??"",p?.kind??(old?.article?.model==="manual"?"自由文章":"旧文章"),article?("confirmed" in article&&article.confirmed?"已定稿":"未定稿"):"需求草稿",updated,article?.model??old?.article?.model??"");
  }
  db.exec("DELETE FROM content_dirty");
}
const joins=` FROM content_heads h LEFT JOIN content_notes n USING(id) LEFT JOIN archived_tasks a USING(id)
 LEFT JOIN content_destinations d ON d.id=h.id AND d.version=(SELECT max(version) FROM content_destinations WHERE id=h.id)`;
const sampleContent=`(coalesce(h.model,'') IN ('local-fixture','v2-local-fixture','离线模拟') OR EXISTS (
  SELECT 1 FROM production_queue q JOIN production_batches b ON b.id=q.batch
  WHERE q.task=h.id AND b.mode IN ('离线示例','真实云端','测试')
))`;
export function contentList(params:URLSearchParams,{personalOnly=false}:{personalOnly?:boolean}={}){
  const db=openContent();
  try{
    const clauses=[params.get("archived")==="1"?"a.id IS NOT NULL":"a.id IS NULL"],args:(string|number)[]=[];
    function add(sql:string,value:string){clauses.push(sql);args.push(value);}
    for(const col of ["account","platform","kind","status","series"])if(params.get(col))add((col==="series"?"n.":"h.")+col+"=?",params.get(col)!);
    if(personalOnly)clauses.push("NOT "+sampleContent);
    if(params.get("favorite")==="1")clauses.push("n.favorite=1");
    if(params.get("tag"))add("instr(','||n.tags||',',','||?||',')>0",params.get("tag")!);
    if(params.get("destination"))add("coalesce(d.status,'未记录')=?",params.get("destination")!);
    for(const [key,op] of [["from",">="],["to","<="]])if(params.get(key))add("date(h.updated,'localtime')"+op+"?",params.get(key)!);
    const q=params.get("q")?.trim()||"";
    const includeHistory=!!q&&params.get("history")==="1";
    if(includeHistory){
      // Reuse one scan across the count and page queries. The temporary table
      // lives only for this connection and leaves the persisted index intact.
      db.exec("CREATE TEMP TABLE matching_versions(id TEXT PRIMARY KEY,version INTEGER) WITHOUT ROWID");
      db.prepare(`INSERT INTO matching_versions
        SELECT id,min(version) FROM (
          SELECT task_id id,version FROM article_snapshots
          WHERE instr(json_extract(payload,'$.title'),?) OR instr(json_extract(payload,'$.body'),?)
          UNION ALL
          SELECT id,rev FROM versions
          WHERE rev=json_extract(payload,'$.article.version')
            AND json_extract(payload,'$.research.version')=json_extract(payload,'$.article.researchVersion')
            AND (instr(json_extract(payload,'$.article.title'),?) OR instr(json_extract(payload,'$.article.body'),?))
        ) GROUP BY id`).run(q,q,q,q);
    }
    const historyMatches=(id:string,version:string)=>`
      SELECT s.version,json_extract(s.payload,'$.title') title,json_extract(s.payload,'$.body') body
      FROM article_snapshots s WHERE s.task_id=${id} AND s.version<${version}
        AND (instr(json_extract(s.payload,'$.title'),?) OR instr(json_extract(s.payload,'$.body'),?))
      UNION ALL
      SELECT v.rev,json_extract(v.payload,'$.article.title'),json_extract(v.payload,'$.article.body')
      FROM versions v WHERE v.id=${id} AND v.rev<${version}
        AND v.rev=json_extract(v.payload,'$.article.version')
        AND json_extract(v.payload,'$.research.version')=json_extract(v.payload,'$.article.researchVersion')
        AND (instr(json_extract(v.payload,'$.article.title'),?) OR instr(json_extract(v.payload,'$.article.body'),?))`;
    if(q){
      clauses.push("(instr(h.title,?) OR instr(h.topic,?) OR instr(h.body,?)"+(includeHistory?" OR m.version<h.version":"")+")");
      args.push(q,q,q);
    }
    const where=joins+(includeHistory?" LEFT JOIN matching_versions m USING(id)":"")+" WHERE "+clauses.join(" AND ");
    const total=Number(db.prepare("SELECT count(*) n"+where).get(...args)?.n);
    const pages=Math.max(1,Math.ceil(total/25)),page=Math.max(1,Math.min(pages,Math.floor(Number(params.get("page")))||1));
    const results=total?db.prepare(`SELECT h.id,EXISTS(SELECT 1 FROM versions v WHERE v.id=h.id) isTask,h.title,h.topic,h.accountName,h.account,h.platform,h.kind,h.status,h.updated,h.version,h.model,n.series,n.tags,n.favorite,d.status destination,d.version publishedVersion,d.url,
      ${sampleContent} isSample,substr(h.body,max(1,instr(h.body,?)-16),max(80,length(?)+20)) excerpt`+where+" ORDER BY h.updated DESC,h.id LIMIT 25 OFFSET ?").all(q,q,...args,(page-1)*25):[];
    const findHistory=includeHistory?db.prepare(historyMatches("$id","$version")+" ORDER BY version DESC LIMIT 1"):null;
    const historyById=new Map<string,{version:number;field:string;offset:number;length:number;excerpt:string}>();
    for(const result of findHistory?results:[]){
      const match=result.version?findHistory?.get({id:result.id,version:result.version},q,q,q,q):null;
      if(!match)continue;
      const body=String(match.body??""),title=String(match.title??"");
      const field=body.includes(q)?"body":"title";
      const value=field==="body"?body:title,offset=value.indexOf(q);
      historyById.set(String(result.id),{version:Number(match.version),field,offset,length:q.length,
        excerpt:value.slice(Math.max(0,offset-16),offset+q.length+24)});
    }
    const accounts=db.prepare("SELECT account,max(accountName) name FROM content_heads WHERE account<>'' GROUP BY account ORDER BY name").all();
    return {rows:results,total,page,pages,accounts,historyById};
  }finally{db.close();}
}
export function similar(topic:string,exclude:string){
  const db=openContent();
  try{
    const terms=[...new Set([topic,...(topic.match(/[\p{L}\p{N}]+/gu)||[]).flatMap(word=>word.length<3?[word]:Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)))])].filter(Boolean).slice(0,40);
    if(!terms.length)return [];
    const rows=db.prepare(`WITH terms(term) AS (SELECT value FROM json_each(?)), matches AS (
      SELECT h.id,h.title,h.account,h.accountName,h.kind,h.status,h.updated,h.version,a.id IS NOT NULL archived,
      group_concat(term,'、') reason,sum(length(term)*length(term)) score FROM content_heads h LEFT JOIN archived_tasks a USING(id) LEFT JOIN content_notes n USING(id) JOIN terms ON instr(h.title,term) OR instr(h.topic,term) OR instr(n.tags,term)
      WHERE h.id<>? AND h.version>0 GROUP BY h.id)
      SELECT * FROM matches ORDER BY score DESC,updated DESC,id LIMIT 5`).all(JSON.stringify(terms),exclude);
    return rows;
  }finally{db.close();}
}
