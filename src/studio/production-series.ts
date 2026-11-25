import type {DatabaseSync} from "node:sqlite";
import type {SeriesKey} from "../types/readiness";

const seriesName=(label:string)=>label.normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g," ");
export function seriesTables(db:DatabaseSync){
  db.exec("CREATE TABLE IF NOT EXISTS production_series(account TEXT,series TEXT,episode INTEGER,task TEXT UNIQUE,PRIMARY KEY(account,series,episode))");
}
export function seriesSources(db:DatabaseSync,account:string,series?:SeriesKey){
  if(!series)return [];
  if(!account)throw Error("连载须选择启用账号");
  seriesTables(db);
  const key=seriesName(series.label);
  const rows=db.prepare("SELECT episode,task FROM production_series WHERE account=? AND series=? ORDER BY episode").all(account,key);
  if(series.episode!==Number(rows.at(-1)?.episode??0)+1)throw Error("专题集数须接在当前最后一集之后");
  if(!rows.length)return [];
  const table=db.prepare("SELECT 1 FROM sqlite_master WHERE name='article_snapshots'").get();
  if(!table)throw Error("前一集须先确认定稿");
  const get=db.prepare("SELECT payload FROM article_snapshots WHERE task_id=? AND json_extract(payload,'$.confirmed')=1 ORDER BY version DESC LIMIT 1");
  return rows.map(row=>{
    const snapshot=get.get(row.task);
    if(!snapshot)throw Error("前一集须先确认定稿");
    const content=JSON.parse(String(snapshot.payload)),body=String(content.body);
    const text=body.split(/^## 正文\s*$/m).at(-1)?.split(/^## /m)[0]?.trim()||body;
    return {task:String(row.task),version:Number(content.version),episode:Number(row.episode),title:String(content.title).slice(0,200),summary:text.slice(0,380)};
  });
}
export function claimSeries(db:DatabaseSync,account:string,series:SeriesKey,task:string){
  if(!db.isTransaction)throw Error("连载集数需要与队列一起保存");
  seriesSources(db,account,series);
  db.prepare("INSERT INTO production_series VALUES(?,?,?,?)").run(account,seriesName(series.label),series.episode,task);
}
