import {describe,expect,it} from "vitest";
import {articleReturn,editorHref,reviewHref} from "../src/studio/article-navigation";

const id="4359f391-9ff9-4d30-9667-bfb846c9eb08";
describe("article return origin",()=>{
  it.each([
    ["/#todo-"+id,"返回首页待办"],
    ["/#recent-"+id,"返回最近编辑"],
    ["/articles?samples=1&status=未定稿&page=2#article-"+id,"返回原内容列表"],
    ["/production/tasks?status=todo&page=2#task-"+id,"返回任务列表"],
    ["/production/queue?batch=test&status=受阻#queue-"+id,"返回执行队列"],
  ])("keeps the origin through review and a historical version (%s)",(source,label)=>{
    const home=articleReturn(id,source);
    const read=(link:string)=>new URL(link,"http://workbench.local").searchParams.get("returnTo")??undefined;
    const review=articleReturn(id,read(reviewHref(id,home.source)));
    const version=articleReturn(id,read(editorHref(id,review.source,{version:"6"})));
    expect(version).toEqual(home);
    expect(version.label).toBe(label);
  });
  it("unwraps older review links to the original entry",()=>{
    const source="/#recent-"+id;
    expect(articleReturn(id,reviewHref(id,source)).source).toBe(source);
  });
  it.each([undefined,"//external.example/#recent-"+id,"/#recent-other","/articles#article-other"])("uses a neutral fallback for %s",source=>{
    expect(articleReturn(id,source)).toEqual({href:"/articles",label:"前往历史文章"});
  });
});
