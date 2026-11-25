import {afterEach,it,expect,vi} from "vitest";
import {localProvider} from "../src/studio/provider";
import {approvalHash,safeInput} from "../src/studio/safe-demo";
import type {Task} from "../src/studio/tasks";
import {createServer} from "node:http";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("本机 307 响应不会触发第二次请求",async()=>{
  let forwarded=0;
  const server=createServer((req,res)=>{
    if(req.url==="/redirected")forwarded++;
    res.writeHead(307,{Location:"/redirected"}).end();
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try{
    const addr=server.address();
    if(!addr || typeof addr==="string")throw Error("缺少测试端口");
    vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:"+addr.port+"/chat");
    vi.stubEnv("STUDIO_MODEL","offline-test");vi.stubEnv("STUDIO_MODEL_KEY","offline-only");
    await expect(localProvider().json("重定向测试",{})).rejects.toThrow();
    expect(forwarded).toBe(0);
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
it("DeepSeek 精确地址、短输出和用量回执",async()=>{
  vi.stubEnv("STUDIO_DB",path.join(mkdtempSync(path.join(tmpdir(),"provider-test-")),"tasks.db"));
  vi.stubEnv("STUDIO_MODEL","configured-alias");
  vi.stubEnv("STUDIO_MODEL_URL","https://api.deepseek.com/chat/completions");
  const receipt=vi.fn();
  const fetcher=vi.fn().mockResolvedValue(Response.json({
    model:"actual-model",usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},
    choices:[{finish_reason:"stop",message:{content:JSON.stringify({action:"finish",query:"",mode:"keyword",needsFacts:false,questions:[],sources:[]})}}]
  }));
  vi.stubGlobal("fetch",fetcher);
  const task:Task={id:"offline",revision:1,input:safeInput("expression"),stage:"research",records:[]};
  expect(()=>localProvider()).toThrow("安全阻塞");
  vi.stubEnv("STUDIO_SAFE_DEMO_APPROVED_SHA256",approvalHash);
  await localProvider({task,maxTokens:32,onResponse:receipt}).json("连接测试",{input:task.input,lastRound:false,evidence:[]});
  const sent=JSON.parse(fetcher.mock.calls[0][1].body);
  expect(sent.max_tokens).toBe(32);
  expect(sent.thinking.type).toBe("disabled");
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  expect(receipt.mock.calls[0][0].usage.total_tokens).toBe(15);
  for(const url of ["http://api.deepseek.com/chat/completions","https://api.deepseek.com/other","https://api.deepseek.com/chat/completions?x=1","https://api.deepseek.com.evil.test/chat/completions","https://user:pass@api.deepseek.com/chat/completions","http://@127.0.0.1/chat","ftp://127.0.0.1/chat"]){
    vi.stubEnv("STUDIO_MODEL_URL",url);
    expect(()=>localProvider({task})).toThrow();
  }
});
it("模型连接失败时不返回成功数据",async()=>{
  vi.stubEnv("STUDIO_MODEL","local-test");
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new TypeError("fetch failed")));
  await expect(localProvider().json("测试",{})).rejects.toThrow("fetch failed");
});
it("输出达到 token 上限时拒绝作为完整文章",async()=>{
  vi.stubEnv("STUDIO_MODEL","local-test");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({
    model:"local-test",choices:[{finish_reason:"length",message:{content:'{"title":"截断"}'}}]
  })));
  await expect(localProvider().json("测试",{})).rejects.toThrow("未正常结束");
});
it("拒绝外部服务地址及重定向",async()=>{
  vi.stubEnv("STUDIO_MODEL","local-test");
  vi.stubEnv("STUDIO_MODEL_URL","https://example.com/v1/chat/completions");
  expect(()=>localProvider()).toThrow("本机");
  vi.stubEnv("STUDIO_MODEL_URL","http://127.0.0.1:1234/v1/chat/completions");
  const fetcher=vi.fn().mockResolvedValue(Response.json({
    model:"local-test",choices:[{finish_reason:"stop",message:{content:'{"ok":true}'}}]
  }));
  vi.stubGlobal("fetch",fetcher);
  expect(await localProvider().json("测试",{})).toEqual({ok:true});
  expect(fetcher.mock.calls[0][1].redirect).toBe("error");
});
