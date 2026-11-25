import {DatabaseSync} from "node:sqlite";
import type {Flow} from "./collaboration";
import {articleSubject,assessment} from "./eval";
import {quoteCandidates} from "./task-guidance";

export function reviewLocationHelp(f:Flow|null){
  if(!f||!f.reason.includes("AMBIGUOUS_QUOTE"))return null;
  const execution=f.executions.at(-1),version=execution?.inputArticleVersion;
  const path=/\b(issues|claims)\.(\d+)\.quote\b/.exec(f.reason);
  if(!execution||version===undefined||!path)return null;
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  try{
    if(!db.prepare("SELECT name FROM sqlite_master WHERE name='review_responses'").get())return null;
    for(const callId of [...execution.callIds].reverse()){
      const row=db.prepare("SELECT content FROM review_responses WHERE call=? AND task=? AND version=? AND finish='stop'").get(callId,f.taskId,version);
      if(!row)continue;
      let raw;try{raw=JSON.parse(String(row.content));}catch{continue;}
      const parsed=assessment.safeParse(raw?.assessment??raw);if(!parsed.success)continue;
      const item=parsed.data[path[1] as "issues"|"claims"][Number(path[2])];if(!item)continue;
      const s=articleSubject(f.taskId,version),candidates=quoteCandidates(s,item);
      if(candidates.length<2)return null;
      return {articleVersion:version,callId,field:item.field,quote:item.quote,candidates};
    }
    return null;
  }finally{db.close();}
}
