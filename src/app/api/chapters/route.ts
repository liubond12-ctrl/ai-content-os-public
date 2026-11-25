import {z} from "zod";
import {isLocalArticleWrite} from "@/studio/local-article-request";
import {articleForReview,articleStateInTransaction,changeArticleInTransaction,readArticles} from "@/studio/article-store";
import {productionDb} from "@/studio/production-db";
import {localProvider} from "@/studio/provider";
import {generateChapter} from "@/studio/chapters";
import {sectionKey} from "@/types/sprint5";
import {plainText} from "@/studio/article-document";

const action=z.object({taskId:z.uuid(),version:z.number().int().positive(),revision:z.number().int().nonnegative(),
  section:sectionKey,feedback:z.string().trim().min(1).max(1500)}).strict();
const running=new Set<string>();
export async function POST(request:Request){
  if(!isLocalArticleWrite(request))return Response.json({error:"请从本机工作台操作"},{status:403});
  const parsed=action.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return Response.json({error:"章节请求无效"},{status:400});
  const {taskId,version,revision,section,feedback}=parsed.data;
  if(running.has(taskId))return Response.json({error:"这篇文章已有章节正在改写"},{status:409});
  running.add(taskId);
  try{
    const before=readArticles(taskId),chapter=(before.draft?.chapters??before.head.chapters)?.find(row=>row.id===section);
    if(before.head.version!==version||(before.draft?.revision??0)!==revision||!chapter)throw Error("已切换版本或章节，请重新载入");
    const task=articleForReview(taskId,version);
    if(task.input.production?.mode==="真实云端")throw Error("分章改写仅支持本机模型");
    const originalDocument=before.draft?.document??before.head.document;
    const selected=originalDocument.filter(block=>block.sectionId===section);
    if(!selected.length||!plainText([selected[0]]).startsWith("### "))throw Error("章节标题已改变，请在正文核对章节");
    const output=await generateChapter(task,chapter,localProvider({task,professional:true,purpose:"long-form"}),feedback);
    const db=productionDb();
    try{
      db.exec("BEGIN IMMEDIATE");
      const current=articleStateInTransaction(db,taskId),document=current.draft?.document??current.head.document;
      const start=document.findIndex(block=>block.sectionId===section),end=document.findLastIndex(block=>block.sectionId===section);
      if(start<0||document.slice(start,end+1).some(block=>block.sectionId!==section))throw Error("该章无法唯一定位");
      const tail=document[end].children.every(leaf=>!leaf.text)?[document[end]]:[];
      const replacements=output.paragraphs.map(row=>document.slice(start+1,end+1).find(block=>plainText([block])===row.text)??
        {type:"p" as const,sectionId:section,blockId:crypto.randomUUID(),children:[{text:row.text}]});
      const result=changeArticleInTransaction(db,{action:"draft",taskId,baseVersion:version,revision,
        title:current.draft?.title??current.head.title,document:[...document.slice(0,start+1),...replacements,...tail,...document.slice(end+1)]},undefined,output);
      db.exec("COMMIT");return Response.json(result);
    }finally{db.close();}
  }catch(error){return Response.json({error:error instanceof Error?error.message:"改写失败"},{status:409});}
  finally{running.delete(taskId);}
}
