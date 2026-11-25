import {editorHref} from "@/studio/article-navigation";
import {redirect} from "next/navigation";
import {simulate} from "@/studio/simulate";
export default async function Practice({searchParams}:{searchParams:Promise<{notice?:string}>}){
  const {notice}=await searchParams;
  return <main><h1>离线写作练习</h1>    <form className="composer" action={async(form)=>{"use server";const title=String(form.get("title")||"").trim().slice(0,100);if(!title||!["clock","lamp"].includes(String(form.get("source"))))redirect("/practice?notice=missing");const id=simulate(title,form.get("source")==="lamp");redirect(editorHref(id,"/practice"));}}><label htmlFor="idea">离线写作练习</label><input id="idea" name="title" required maxLength={100} placeholder="今天想创作什么内容？"/><div className="composeBar"><select name="source" required aria-label="选择练习资料"><option value="">选择参考资料</option><option value="clock">虚构素材 · 钟表铺的慢表</option><option value="lamp">《灯还亮着》· 历史策略响应回放</option></select><button className="primary">生成离线初稿　→</button></div></form>
    <p className="hint">练习使用虚构素材与固定模拟输出，无模型调用或费用。</p>{notice==="missing"&&<p role="alert">请填写标题并选择练习资料。</p>}
</main>;
}
