import Studio from "@/components/Studio";
export default async function Page({searchParams}:{searchParams:Promise<{topic?:string;ref?:string;v?:string;discussion?:string}>}){
  const {topic,ref,v,discussion}=await searchParams;
  return <Studio initialDiscussion={discussion==="1"} initialPin={ref!==undefined||v!==undefined?(ref??"")+"@"+(v??""):""} localModel={Boolean(process.env.STUDIO_MODEL)&&/^http:\/\/127\.0\.0\.1(:\d+)?\//.test(process.env.STUDIO_MODEL_URL??"http://127.0.0.1:11434/")} initialTopic={typeof topic==="string"?topic.slice(0,240):""}/>;
}
