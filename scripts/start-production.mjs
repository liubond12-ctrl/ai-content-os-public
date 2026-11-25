import {DatabaseSync} from "node:sqlite";
import {spawn} from "node:child_process";
import {mkdirSync,existsSync,readFileSync,writeFileSync} from "node:fs";
import {randomBytes} from "node:crypto";
import path from "node:path";
const demo=process.argv.includes("--demo"),noWorker=process.argv.includes("--no-worker");
const port=process.env.PORT||"3588",dir=path.resolve(process.env.STUDIO_DATA_DIR||(demo?"data-production-demo":"data"));
if(demo&&dir===path.resolve("data"))throw Error("离线演练不能使用个人 data 目录");
mkdirSync(dir,{recursive:true});
const keyFile=path.join(dir,"worker.key");
if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString("hex"));
const env={...process.env,STUDIO_DB:path.join(dir,"studio.sqlite"),STUDIO_LIBRARY_DB:path.join(dir,"content-library.sqlite"),STUDIO_WORKER_KEY:readFileSync(keyFile,"utf8").trim(),STUDIO_WORKER_URL:"http://127.0.0.1:"+port,STUDIO_DEMO_INSTANCE:demo?"1":"0"};
if(demo){
 mkdirSync(path.join(dir,"experiments"),{recursive:true});
 for(const file of ["knowledge.json","vectors.json"])if(!existsSync(path.join(dir,file)))writeFileSync(path.join(dir,file),"[]");
 const experiment=new DatabaseSync(path.join(dir,"experiments/lamp-deepseek-once.sqlite"));experiment.close();
}
if(demo)Object.assign(env,{STUDIO_QUEUE_LEASE_MS:"15000",STUDIO_MODEL:"v2-local-fixture",STUDIO_MODEL_URL:"http://127.0.0.1:3587/chat",STUDIO_MODEL_KEY:"",STUDIO_FEISHU_SCOPE:"null",STUDIO_FEISHU_TOKEN:"",STUDIO_EXPERIMENT_DB:path.join(dir,"experiments/lamp-deepseek-once.sqlite")});
const children=[];
function start(args){const c=spawn(process.execPath,args,{windowsHide:true,stdio:"inherit",env});children.push(c);return c;}
if(demo&&!process.argv.includes("--no-model"))start(["scripts/production-demo-model.mjs"]);
start(["node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",port]);
if(!noWorker)start(["scripts/production-worker.mjs"]);
function stop(){for(const child of children)child.kill();process.exit();}
process.on("SIGINT",stop);process.on("SIGTERM",stop);
console.log("工作台 http://127.0.0.1:"+port+" 模式 "+(demo?"离线示例":env.STUDIO_PRODUCTION_SCOPE?"真实云端":"本机模型")+" 数据 "+dir+" worker "+(!noWorker?"启动":"未启动"));
