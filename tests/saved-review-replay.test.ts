import {existsSync} from "node:fs";
import {it,expect} from "vitest";
import {DatabaseSync} from "node:sqlite";
import {finalize} from "../src/studio/eval";
import {demoSubject} from "../src/studio/eval-demo";
import {EXPERIMENT_ID} from "../src/studio/deepseek-experiment";
it.skipIf(!existsSync("data/experiments/lamp-deepseek-once.sqlite"))("replays the saved lamp response against its original version without provider calls",()=>{
  const db=new DatabaseSync("data/experiments/lamp-deepseek-once.sqlite",{readOnly:true});
  try{
    const record=JSON.parse(String(db.prepare("SELECT payload FROM experiment WHERE id=?").get(EXPERIMENT_ID)?.payload));
    const article=record.articles[0],raw=JSON.parse(record.calls[0].response);
    const result=finalize({...demoSubject("sample-01",1),...article},raw.assessment);
    expect(result.locations).toHaveLength(3);
    for(const item of result.issues)expect(article[item.field].slice(item.offset,item.offset+item.quote.length)).toBe(item.quote);
    console.log("历史响应回放",JSON.stringify(result.locations));
  }finally{db.close();}
});
