import {it,expect,vi} from "vitest";
import * as rag from "../src/rag/search";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {advance,create,lookup} from "../src/studio/tasks";
it("持久化版本、重试去重及真实证据装配",async()=>{
  process.env.STUDIO_DB=path.join(mkdtempSync(path.join(tmpdir(),"studio-")),"tasks.db");
  try {
    const task=create({persona:"demob",topic:"统一写作习惯",mode:"keyword",audience:"新手家长",reference:"用户参考样本"});
    await Promise.all([advance(task.id,0),advance(task.id,0)]);
    expect(lookup(task.id)?.records).toHaveLength(1);
    const fault=vi.spyOn(rag,"retrieveMode").mockRejectedValueOnce(new Error("测试注入：检索暂不可用"));
    const failed=await advance(task.id,1);
    fault.mockRestore();
    expect(failed?.stage).toBe("retrieve");
    expect(failed?.records.at(-1)?.status).toBe("failed");
    const done=await advance(task.id,2);
    expect(lookup(task.id,2)?.records.at(-1)?.error).toContain("检索暂不可用");
    expect(done?.stage).toBe("ready");
    expect(done?.result?.assembly.compiledContext).toContain("用户参考样本");
    expect(done?.result?.assembly.compiledContext).toContain("新手家长");
    expect(done?.result?.retrieval.hits.length).toBeGreaterThan(0);
    expect(lookup(task.id,0)?.stage).toBe("assemble");
  } finally {delete process.env.STUDIO_DB;}
});
