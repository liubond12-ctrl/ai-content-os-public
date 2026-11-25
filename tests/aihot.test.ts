import {afterEach,expect,it,vi} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const story="https://aihot.news/story/s1";
const item=(id:string,title:string)=>({id,title,links:{aihot:"https://aihot.news/items/"+id,story,original:"https://example.com/"+id}});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.resetModules();});
it("跨报道事件去重，缓存后看到更新；条件请求、限流、故障和空结果",async()=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  const {readFeed}=await import("../src/studio/aihot");
  const reply=(items:unknown[])=>new Response(JSON.stringify({items}),{headers:{ETag:"v1"}});
  fetcher.mockResolvedValueOnce(reply([item("a","进展一"),item("b","同一事件")]));
  const first=await readFeed("events");expect(first.items).toHaveLength(1);expect((await readFeed("events")).time).toBe(first.time);
  vi.advanceTimersByTime(301000);fetcher.mockResolvedValueOnce(reply([item("b","进展二")]));
  const second=await readFeed("events");expect(second.items[0].key).toBe(first.items[0].key);expect(second.items[0].title).toBe("进展二");
  expect(fetcher.mock.calls[1][1].headers["If-None-Match"]).toBe("v1");
  vi.advanceTimersByTime(301000);fetcher.mockResolvedValueOnce(new Response(null,{status:304}));
  const verified=await readFeed("events");expect(verified.items).toEqual(second.items);
  vi.advanceTimersByTime(301000);fetcher.mockResolvedValueOnce(new Response(null,{status:429,headers:{"Retry-After":"600"}}));
  const failed=await readFeed("events");expect(failed.time).toBe(verified.time);expect(failed.error).toBeTruthy();
  await readFeed("daily");expect(fetcher).toHaveBeenCalledTimes(4);
  vi.advanceTimersByTime(601000);fetcher.mockResolvedValueOnce(reply([]));expect((await readFeed("events")).items).toEqual([]);
});
it("个人检索仅读取主动收藏，已读独立",async()=>{
  const folder=mkdtempSync(join(tmpdir(),"hot-test-"));vi.stubEnv("STUDIO_DB",join(folder,"test.sqlite"));
  try{const {hotDb,savedHot}=await import("../src/studio/aihot");const db=hotDb();
    db.prepare("INSERT INTO hot_read VALUES(?)").run(story);db.close();expect(savedHot("")).toEqual([]);
    const d=hotDb();d.prepare("INSERT INTO hot_saved VALUES(?,?,?,?,?,?)").run(story,"进展二","https://example.com","样例","发布观察","2026-11-08");d.close();expect(savedHot("观察")).toHaveLength(1);
  }finally{rmSync(folder,{recursive:true,force:true});}
});