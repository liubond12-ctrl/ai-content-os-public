import type {DatabaseSync} from "node:sqlite";
import type {Panel} from "./professional-review";
import {conflictGroups} from "./discussion-reader";

export const resolvedInWorkbench="已在工作台处理";
export function ensureFeishuResolutions(db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS fs_resolution_events(
    task TEXT,version INTEGER,event TEXT CHECK(event='resolve'),at TEXT,
    PRIMARY KEY(task,version));`);
}

export function resolveFeishuCard(db:DatabaseSync,task:string,version:number){
  if(!db.isTransaction)throw Error("飞书卡片解除须与网页操作同时保存");
  ensureFeishuResolutions(db);
  db.prepare("INSERT OR IGNORE INTO fs_resolution_events VALUES(?,?,'resolve',?)").run(task,version,new Date().toISOString());
}

export function resolvedOnWeb(db:DatabaseSync,task:string,version:number){
  return !!db.prepare("SELECT 1 FROM fs_resolution_events WHERE task=? AND version=?").get(task,version);
}

export function savedConflictEdit(db:DatabaseSync,task:string,version:number,id:string){
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE name='collaboration'").get())return false;
  const row=db.prepare("SELECT payload FROM collaboration WHERE task=?").get(task);
  const panels:Panel[]=row?JSON.parse(String(row.payload)).panels??[]:[];
  const panel=panels.findLast(panel=>panel.articleVersion===version&&panel.phase==="complete");
  return !!panel&&conflictGroups(panel).some(group=>group.toSorted().join(":")===id);
}
