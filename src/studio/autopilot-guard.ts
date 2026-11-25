import type {DatabaseSync} from "node:sqlite";
import {AUTOPILOT_HOP_LIMIT,type AutopilotPhase} from "../types/autopilot";
import type {Task} from "./tasks";

export const hopHandoff="自动任务链已用完 8 跳，转人工处理";
export function autopilotModelInput(input:Task["input"]):Task["input"]{
  return input.production?.sourceMaterials?{...input,topic:"从巡航资料提取写作角度"}:input;
}

export function ensureAutopilotGuard(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS autopilot_lineage(task TEXT PRIMARY KEY,root TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS autopilot_hops(root TEXT,task TEXT,phase TEXT,version INTEGER,
      PRIMARY KEY(root,task,phase,version));
    CREATE TABLE IF NOT EXISTS autopilot_fuses(task TEXT PRIMARY KEY,at TEXT NOT NULL);
    CREATE TRIGGER IF NOT EXISTS autopilot_hops_no_update BEFORE UPDATE ON autopilot_hops
      BEGIN SELECT RAISE(ABORT, 'automation hops are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS autopilot_hops_no_delete BEFORE DELETE ON autopilot_hops
      BEGIN SELECT RAISE(ABORT, 'automation hops are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS autopilot_hops_no_replace BEFORE INSERT ON autopilot_hops
      WHEN EXISTS(SELECT 1 FROM autopilot_hops WHERE root=NEW.root AND task=NEW.task AND phase=NEW.phase AND version=NEW.version)
      BEGIN SELECT RAISE(ABORT, 'automation hops are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS autopilot_lineage_no_update BEFORE UPDATE ON autopilot_lineage
      BEGIN SELECT RAISE(ABORT, 'automation lineage is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS autopilot_lineage_no_delete BEFORE DELETE ON autopilot_lineage
      BEGIN SELECT RAISE(ABORT, 'automation lineage is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS autopilot_lineage_no_replace BEFORE INSERT ON autopilot_lineage
      WHEN EXISTS(SELECT 1 FROM autopilot_lineage WHERE task=NEW.task)
      BEGIN SELECT RAISE(ABORT, 'automation lineage is immutable'); END;`);
}

export function linkAutopilotTask(db:DatabaseSync,task:string,parent?:string){
  if(!db.isTransaction)throw Error("巡航归属须随任务保存");
  const root=parent?db.prepare("SELECT root FROM autopilot_lineage WHERE task=?").get(parent)?.root:task;
  if(typeof root!=="string")throw Error("重跑缺少有效的原巡航链");
  db.prepare("INSERT INTO autopilot_lineage VALUES(?,?)").run(task,root);
}

export function autopilotHopState(db:DatabaseSync,task:string){
  const row=db.prepare(`SELECT l.root,(SELECT count(*) FROM autopilot_hops h WHERE h.root=l.root) AS count,
    EXISTS(SELECT 1 FROM autopilot_fuses f WHERE f.task=l.task) AS fused FROM autopilot_lineage l WHERE task=?`).get(task);
  return row?{root:String(row.root),hopCount:Number(row.count),fused:!!row.fused}:null;
}

export function reserveAutopilotHop(db:DatabaseSync,task:string,phase:AutopilotPhase,version:number){
  if(!db.isTransaction)throw Error("巡航跳数须在事务中记录");
  const state=autopilotHopState(db,task);
  if(!state)return true;
  if(state.fused)return false;
  if(db.prepare("SELECT 1 FROM autopilot_hops WHERE root=? AND task=? AND phase=? AND version=?").get(state.root,task,phase,version))return true;
  if(state.hopCount>=AUTOPILOT_HOP_LIMIT){
    db.prepare("INSERT OR IGNORE INTO autopilot_fuses VALUES(?,?)").run(task,new Date().toISOString());
    return false;
  }
  db.prepare("INSERT INTO autopilot_hops VALUES(?,?,?,?)").run(state.root,task,phase,version);
  return true;
}
