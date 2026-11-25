import {productionDb} from "./production-db";
import {cruiseDay,morning} from "./autopilot";
import {duePublications,mergeableProposals} from "./calibration";
import {fastlaneTables} from "./fastlane";
import type {ReadinessTask} from "../types/readiness";
import {editorHref} from "./article-navigation";

export function todayTasks():ReadinessTask[]{
  const db=productionDb();
  try{
    const day=cruiseDay();
    const has=(table:string)=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table);
    let pending=0;
    if(has("cruise_runs")&&has("article_snapshots"))pending=morning(db,day).items.filter(row=>row.candidate&&!row.decision).length;
    const due=duePublications(db);
    fastlaneTables(db);
    const ready=db.prepare(`SELECT task,version FROM distribution_outbox d
      WHERE NOT EXISTS(SELECT 1 FROM cal_publications p WHERE p.task=d.task AND p.version=d.version)
      GROUP BY task,version HAVING count(*)=4 AND sum(state='ready')=4 ORDER BY max(touched) DESC`).all();
    const accounts=db.prepare("SELECT DISTINCT account FROM cal_proposals").all();
    const merge=accounts.flatMap(row=>mergeableProposals(db,String(row.account)));
    return [
      {label:"待拍板早报",count:pending,href:"/studio/settings/autopilot#cruise-morning"},
      {label:"已派生待发三端包",count:ready.length,href:ready.length?editorHref(String(ready[0].task),"/",{version:String(ready[0].version),distribution:"1"}):"/studio/settings/autopilot#cruise-ledger"},
      {label:"T+3d 到期待填",count:due.length,href:"/studio/settings/calibration"+(due.length?"?account="+encodeURIComponent(due[0].prediction.account)+"&item="+due[0].task+":"+due[0].version:"")},
      {label:"待合并校准提案",count:merge.length,href:"/studio/settings/calibration"+(merge.length?"?account="+encodeURIComponent(merge[0].account)+"#cal-rules":"#cal-rules")},
    ];
  }finally{db.close();}
}
