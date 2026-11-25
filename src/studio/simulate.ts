import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {finalize} from "./eval";
import type {Task} from "./tasks";

export function simulate(title:string,lamp=false){
  let body="钟表铺关门前，阿云摘下墙上最慢的那只表。分针停在五点零七分。\n她没有拧发条。她没有拧发条。窗外，送报的人正把剩下的报纸折好。\n她用铅笔在修理单上写下那个时刻，把表放进明天要开的第一只抽屉。";
  let replay:unknown;
  if(lamp){
    const ledger=new DatabaseSync("data/experiments/lamp-deepseek-once.sqlite",{readOnly:true});
    try{const experiment=JSON.parse(String(ledger.prepare("SELECT payload FROM experiment WHERE id=?").get("lamp-deepseek-once-v1")?.payload));
      body=experiment.articles[0].body;replay=JSON.parse(experiment.calls[0].response).assessment;
    }finally{ledger.close();}
  }
  const id=randomUUID(),source=lamp?"虚构原稿《灯还亮着》v1":"虚构素材：钟表铺的慢表 v1",now=new Date().toISOString();
  const task:Task={id,revision:1,stage:"done",records:[],input:{persona:"general",topic:title,format:"图文文章",mode:"keyword",audience:"短篇读者",reference:""},research:{version:1,status:"ready",questions:[],evidence:[],model:"离线模拟"},article:{version:1,researchVersion:1,model:"离线模拟",title,body,citations:[source]}};
  const result=finalize({task,version:1,title,body,request:task.input,sources:[]},replay??{label:"普通",disputed:true,dimensions:{内容策略:"围绕一次修表动作",表达质量:"同句连续出现",内容结构:"按动作推进",基础规范:"标点完整"},claims:[],issues:[{field:"body",quote:"她没有拧发条。",before:"她没有拧发条。",offset:0,type:"表达",severity:"轻微",reason:"同一动作连续写了两次，可保留停顿或删去第二句。",suggestion:"删去第二句或说明节奏用意。"}]});
  const review={id:randomUUID(),taskId:id,articleVersion:1,version:1,model:lamp?"历史策略响应回放":"离线模拟",status:result.status,createdAt:now,rules:[],sourceIds:[source],result};
  const db=new DatabaseSync(process.env.STUDIO_DB||"data/studio.sqlite");
  try{db.exec("BEGIN IMMEDIATE;CREATE TABLE IF NOT EXISTS versions(id TEXT,rev INTEGER,payload TEXT,PRIMARY KEY(id,rev));CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,task TEXT,article INTEGER,version INTEGER,payload TEXT,UNIQUE(task,article,version))");
    db.prepare("INSERT INTO versions VALUES(?,?,?)").run(id,1,JSON.stringify(task));db.prepare("INSERT INTO reviews VALUES(?,?,?,?,?)").run(review.id,id,1,1,JSON.stringify(review));db.exec("COMMIT");return id;
  }finally{db.close();}
}

