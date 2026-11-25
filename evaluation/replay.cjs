
module.exports=class Replay {
  constructor(options){this.mode=options.config.mode;}
  id(){return "offline:"+this.mode;}
  async callApi(prompt){
    if(prompt!=="lamp-v1")return {error:"非许可回放输入"};
    const path=await import("node:path");
    const {DatabaseSync}=await import("node:sqlite");
    const root=path.resolve(__dirname,"..");
    const {createServer}=await import("vite");
    const server=await createServer({root,configFile:false,server:{middlewareMode:true,watch:null},appType:"custom"});
    try{
      const {finalize}=await server.ssrLoadModule("/src/studio/eval.ts");
      const {advancePanel}=await server.ssrLoadModule("/src/studio/professional-review.ts");
      const db=new DatabaseSync(path.join(root,"data/experiments/lamp-deepseek-once.sqlite"),{readOnly:true});
      let record;try{record=JSON.parse(db.prepare("SELECT payload FROM experiment WHERE id=?").get("lamp-deepseek-once-v1").payload);}finally{db.close();}
      const call=record.calls[0],input=JSON.parse(call.messages[1].content),raw=JSON.parse(call.response),article=record.articles[0];
      const subject={...article,request:input.request||{},sources:input.sources||[],task:{input:input.request||{}}};
      const single=finalize(subject,raw.assessment);
      const panel={id:"replay",articleVersion:article.version,roles:["strategy","language"],reviews:[],selected:[],conflicts:[],discussion:[],phase:"independent",expressionRules:false};
      if(this.mode==="panel")await advancePanel("offline",panel,false,false,{subject,provider:{model:call.returnedModel,json:async()=>structuredClone(raw)}});
      return {output:JSON.stringify({mode:this.mode,source:"saved-strategy-response",articleVersion:article.version,issues:(this.mode==="panel"?panel.reviews[0].result:single).issues.length,located:single.locations,complete:this.mode==="single",missing:this.mode==="panel"?["language"]:[],originalUsage:call.usage,originalEstimatedMicros:call.estimatedMicros,freshRequests:0})};
    }finally{await server.close();}
  }
};
