import type {DatabaseSync} from "node:sqlite";
import {articleStateInTransaction,ensureArticleTables,type ArticleSnapshot} from "./article-store";
import {fromText} from "./article-document";
import {appendRetro,calibrationTables,lockPrediction,registerPublication} from "./calibration";
import {extractArticleBrick} from "./atomic-bricks";

export const demonstrationAccount="calibration-demo";
export function seedCalibrationDemo(db:DatabaseSync,now=new Date()){
  if(process.env.STUDIO_DEMO_INSTANCE!=="1"||!db.isTransaction)throw Error("演练数据只允许写入离线事务");
  calibrationTables(db);ensureArticleTables(db);
  if(db.prepare("SELECT 1 FROM production_entities WHERE kind='account' AND id=?").get(demonstrationAccount))return;
  db.prepare("INSERT INTO production_entities VALUES('account',?,1,?)").run(demonstrationAccount,JSON.stringify({
    id:demonstrationAccount,version:1,brand:"default",name:"离线校准样例",status:"启用",platform:"公众号",body:"写作练习",
    audience:"作者",sources:[],rules:[],account:"",type:"",goal:"",hard:false,constraintKey:"",constraintValue:""
  }));
  for(let n=1;n<=6;n++){
    const task="db4f1600-c301-4148-af40-00000000000"+n,key={task,version:7};
    const published=new Date(now.getTime()-(n===6?5000:100*3600000));
    const earlier=new Date(published.getTime()-60000);
    const title=n===6?"离线新稿 · 纸张叠放":"离线历史样稿 "+n;
    const initial="## 封面文案\n纸角练习\n\n## 正文\n把纸角压平。\n\n## 配图计划\n纸角示意";
    const body="## 封面文案\n纸角练习\n\n## 正文\n盯住纸角的第一道折痕。\n"+
      Array.from({length:n},(_,i)=>"步骤 "+(i+1)+"：沿着边缘压平纸角。").join("\n")+"\n"+
      "留言。".repeat(7-n)+"\n\n## 配图计划\n纸角示意";
    const article={title,body:initial,version:6,researchVersion:2,citations:[],model:"v2-local-fixture"};
    const request={id:task,revision:6,stage:"done",records:[],article,research:{version:2,evidence:[],questions:[],status:"ready"},
      input:{topic:title,persona:"general",format:"图文文章",mode:"keyword",production:{account:demonstrationAccount,accountName:"离线校准样例",platform:"公众号",kind:"图文",mode:"离线示例"}}};
    db.prepare("INSERT INTO versions VALUES(?,6,?)").run(task,JSON.stringify(request));
    const snapshot:ArticleSnapshot={taskId:task,version:7,parentVersion:6,sourceTaskRevision:6,researchVersion:2,title,body,document:fromText(body),
      formatVersion:1,citations:[],origin:"human",confirmed:true,createdAt:earlier.toISOString(),reviewLabel:"隔离模拟作者定稿"};
    db.prepare("INSERT INTO article_snapshots VALUES(?,7,?)").run(task,JSON.stringify(snapshot));
    const result={status:"pass",label:"普通",issues:[],facts:{checks:[],requestTriggered:false},dimensions:{内容策略:"检验按步骤组织纸角练习能否提高阅读。",表达质量:"动作明确"}};
    const panel={id:"demo-review-"+n,articleVersion:6,phase:"complete",status:"pass",conflicts:[],discussion:[],
      reviews:["strategy","language"].map(role=>({role,result,opinions:[]}))};
    db.prepare("INSERT INTO collaboration VALUES(?,?)").run(task,JSON.stringify({panels:[panel],state:"awaiting_acceptance"}));
    const state=articleStateInTransaction(db,task);
    lockPrediction(db,key,state,earlier);
    registerPublication(db,key,published.toISOString(),"",now);
    if(n===6)continue;
    const values={reach:4200+n*1000,likes:50+n,saves:25+n,comments:7+n,conversions:n};
    appendRetro(db,key,state,values,"隔离模拟平台实绩",new Date(now.getTime()-1000).toISOString(),now);
    if(n===5)extractArticleBrick(db,key,state,{account:demonstrationAccount,kind:"Hook",text:"盯住纸角的第一道折痕。",tags:["纸角","动作开头"]});
  }
}
