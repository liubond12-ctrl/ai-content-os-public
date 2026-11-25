import type {ImagePlatform,StoryboardCard} from "../types/sprint5";

export const storyboardRatios={小红书:"3:4",抖音:"9:16",公众号:"2.35:1"} as const;
export function storyboardCards(task:string,articleVersion:number,title:string,body:string,platform:ImagePlatform):StoryboardCard[]{
  const section=body.match(/^## (?:配图计划|画面建议)[ \t]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1]??"";
  const lines=section.trim().split(/\n+/).map(line=>line.trim()).filter(Boolean).slice(0,20);
  return (lines.length?lines:[title]).map((line,index)=>{
    const description=line.replace(/^(?:[-*]\s+|\d+[.、]\s*)/,"");
    const overlay=description.match(/(?:Overlay Text|叠字|封面字)[：:]\s*(.+)$/i)?.[1];
    const overlayText=(overlay??(index===0?title:"")).slice(0,80);
    const ratio=storyboardRatios[platform],slot=index+1;
    const prompt=["image2","平台："+platform,"画幅："+ratio,"图位："+slot,"画面："+description,
      "Overlay Text："+(overlayText||"无"),"约束：忠于描述，保留文字安全区，不添加未经核验的数字、品牌标识或现实事件。"].join("\n");
    return {task,articleVersion,slot,platform,ratio,description,overlayText,prompt};
  });
}
