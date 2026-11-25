const {appendFileSync}=require("node:fs");
const net=require("node:net");
const http=require("node:http");
const https=require("node:https");
const http2=require("node:http2");
const dns=require("node:dns");

if(process.env.STUDIO_DEMO_INSTANCE==="1"){
  const loopback=value=>["localhost","127.0.0.1","::1","[::1]"].includes(String(value).toLowerCase());
  function audit(kind,event){
    if(process.env.STUDIO_DEMO_NET_LOG)appendFileSync(process.env.STUDIO_DEMO_NET_LOG,JSON.stringify({kind,event,pid:process.pid})+"\n");
  }
  const deny=kind=>{
    audit(kind,"blocked");
    return Object.assign(new Error("离线 Demo 拒绝非本机网络请求"),{code:"STUDIO_DEMO_EGRESS_BLOCKED"});
  };
  const checkUrl=(value,kind)=>{
    const url=new URL(typeof value==="string"||value instanceof URL?value:value.url);
    if(["http:","https:","ws:","wss:"].includes(url.protocol)&&!loopback(url.hostname))throw deny(kind);
  };
  const checkHttp=(target,extra)=>{
    const opts=typeof target==="string"||target instanceof URL?extra:target;
    if(typeof target==="string"||target instanceof URL)checkUrl(target,"http");
    const hostname=opts?.hostname??opts?.host;
    if(hostname&&!loopback(hostname)){
      let host;try{host=new URL("http://"+hostname).hostname;}catch{}
      if(!loopback(host))throw deny("http");
    }
    if(opts?.socketPath)throw deny("http-ipc");
  };
  const localFetch=globalThis.fetch;
  globalThis.fetch=async function(input,init){
    checkUrl(input,"fetch");
    const protocol=new URL(typeof input==="string"||input instanceof URL?input:input.url).protocol;
    return localFetch(input,["http:","https:"].includes(protocol)?{...init,redirect:"error"}:init);
  };
  for(const client of [http,https])for(const method of ["get","request"]){
    const original=client[method];
    client[method]=function(...args){checkHttp(args[0],args[1]);return original.apply(this,args);};
  }
  const http2Connect=http2.connect;
  http2.connect=function(authority,...rest){checkUrl(authority,"http2");return http2Connect.call(this,authority,...rest);};
  const socketConnect=net.Socket.prototype.connect;
  net.Socket.prototype.connect=function(...args){
    const list=Array.isArray(args[0])?args[0]:args;
    const first=list[0],host=typeof first==="object"&&first?first.host:typeof first==="number"?list[1]:undefined;
    if(typeof host==="string"&&!loopback(host))throw deny("socket");
    if(typeof first==="string"||first?.path)throw deny("socket-ipc");
    return socketConnect.apply(this,args);
  };
  for(const target of [dns,dns.promises])for(const method of Object.keys(target).filter(name=>name==="lookup"||name==="lookupService"||name==="reverse"||name.startsWith("resolve"))){
    const original=target[method];
    if(typeof original!=="function")continue;
    target[method]=function(address,...args){if(!loopback(address))throw deny("dns");return original.call(this,address,...args);};
  }
  require("node:module").syncBuiltinESMExports();
  audit("preload","active");
}
