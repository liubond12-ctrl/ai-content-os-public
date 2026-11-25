import {articleReturn} from "@/studio/article-navigation";
import {ArticleWorkspace} from "../../../components/ArticleWorkspace";
export default async function Page({searchParams}:{searchParams:Promise<{taskId?:string;returnTo?:string}>}){
  const {taskId,returnTo}=await searchParams;
  return <ArticleWorkspace taskId={taskId??""} destination={articleReturn(taskId??"",returnTo)}/>;
}
