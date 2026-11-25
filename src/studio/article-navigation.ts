const sources:Record<string,{label:string;prefix?:string}>={
  "/articles":{label:"返回原内容列表",prefix:"article-"},
  "/production/tasks":{label:"返回任务列表",prefix:"task-"},
  "/production/queue":{label:"返回执行队列",prefix:"queue-"},
  "/production/create":{label:"返回新建内容"},
  "/production/accounts":{label:"返回账号管理"},
  "/production/free":{label:"返回自由文章"},
  "/production/package":{label:"返回内容包"},
  "/examples":{label:"返回验收示例"},
  "/practice":{label:"返回离线练习"},
};
function articleHref(path:string,taskId:string,returnTo?:string,extra?:Record<string,string>){
  const params=new URLSearchParams({...extra,taskId});
  if(returnTo)params.set("returnTo",returnTo);
  return path+"?"+params;
}
export function editorHref(taskId:string,returnTo?:string,extra?:Record<string,string>){
  return articleHref("/studio/editor",taskId,returnTo,extra);
}
export function reviewHref(taskId:string,returnTo?:string,extra?:Record<string,string>){
  return articleHref("/studio",taskId,returnTo,extra);
}
export function draftHref(id:string,kind:string,returnTo:string){
  const path=kind==="自由文章"?"/production/free":"/production/create";
  return path+"?"+new URLSearchParams({draft:id,returnTo});
}
export function articleReturn(taskId:string,value?:string,depth=0):{href:string;label:string;source?:string}{
  const fallback={href:"/articles",label:"前往我的内容"};
  if(typeof value!=="string"||!value.startsWith("/")||value.startsWith("//")||/[\\\u0000-\u001f]/.test(value)||depth>2)return fallback;
  const url=new URL(value,"http://workbench.local");
  if(url.origin!=="http://workbench.local")return fallback;
  const href=url.pathname+url.search+url.hash;
  if(url.pathname==="/studio/editor"&&/^[\w-]{1,80}$/.test(url.searchParams.get("taskId")??"")&&url.searchParams.get("taskId")!==taskId&&!url.hash)
    return {href,source:href,label:"返回上一稿件"};
  if(url.pathname==="/studio"&&url.searchParams.get("taskId")===taskId)
    return articleReturn(taskId,url.searchParams.get("returnTo")??undefined,depth+1);
  if(url.pathname==="/"&&!url.search){
    if(url.hash==="#todo-"+taskId)return {href,source:href,label:"返回首页待办"};
    if(url.hash==="#recent-"+taskId)return {href,source:href,label:"返回最近编辑"};
    if(url.hash==="#home-flow")return {href,source:href,label:"返回首页生产流程"};
  }
  const entry=sources[url.pathname];
  if(entry&&(!url.hash||entry.prefix&&url.hash==="#"+entry.prefix+taskId))
    return {href,source:href,label:entry.label};
  return fallback;
}
