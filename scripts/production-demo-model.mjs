import {createServer} from "node:http";
import {fixtureResponse} from "./production-fixture-response.mjs";
const server=createServer(async(req,res)=>{
 try{
 if(req.url==="/bge-health"&&req.method==="GET"){res.setHeader("content-type","application/json");res.end(JSON.stringify({ready:true,backend:"bge",demo:true}));return;}
 let raw="";for await(const part of req)raw+=part;
 const call=JSON.parse(raw),data=JSON.parse(call.messages[1].content);
 const input=data.input??data.request;
 const result=fixtureResponse(call.messages[0].content,data);
 await new Promise(r=>setTimeout(r,input?.topic?.includes("中断演练")?30000:Number(process.env.STUDIO_DEMO_MODEL_DELAY_MS)||300));
 res.setHeader("content-type","application/json");res.end(JSON.stringify({model:"v2-local-fixture",usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200},choices:[{finish_reason:"stop",message:{content:JSON.stringify(result)}}]}));
 }catch(e){res.statusCode=422;res.end(String(e));}
});
server.listen(Number(process.env.STUDIO_DEMO_MODEL_PORT||3587),"127.0.0.1");
