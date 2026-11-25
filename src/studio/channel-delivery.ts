import type {ChannelContent,ChannelRisk,ChannelVariant} from "../types/channel-derivation";

const localRules:Record<ChannelVariant,Array<{pattern:RegExp;reason:string}>>={
  xiaohongshu:[
    {pattern:/加(?:我)?微信|加(?:我)?v信|微信号|站外下单|扫码(?:加|购买)|(?:私信|评论).{0,8}(?:领链接|加群)|VX[：:\s]*[\w-]+/giu,reason:"可能涉及站外导流"},
    {pattern:/全网最低|史上最[佳强]|国家级|顶级|绝对第一|百分百有效/gu,reason:"可能涉及极限或绝对化宣传"},
  ],
  "douyin-script":[{pattern:/全网最低|绝对(?:有效|安全|第一)|百分百(?:有效|成功)|100%有效|永不(?:失效|反弹)|保证(?:成功|有效)|第一品牌/gu,reason:"可能涉及绝对化用语或未经证实的保证"}],
  "douyin-post":[{pattern:/全网最低|绝对(?:有效|安全|第一)|百分百(?:有效|成功)|100%有效|永不(?:失效|反弹)|保证(?:成功|有效)|第一品牌/gu,reason:"可能涉及绝对化用语或未经证实的保证"}],
  wechat:[{pattern:/稳赚不赔|无风险收益|保本保收益|躺赚|保证回报|包治百病|根治一切|官方指定|转发.{0,6}(?:返现|领奖)/gu,reason:"可能涉及敏感营销承诺"}],
};

export function channelFields(content:ChannelContent){
  const fields:Array<{field:string;text:string}>=[];
  const field=(field:string,text:string)=>fields.push({field,text});
  if(content.variant==="xiaohongshu"){
    content.titles.forEach((text,index)=>field("标题 "+(index+1),text));
    field("正文",content.body);
    content.tags.forEach((text,index)=>field("标签 "+(index+1),text));
    content.comments.forEach(({question,answer},index)=>{field("置顶提问 "+(index+1),question);field("置顶回答 "+(index+1),answer);});
  }else{
    field("标题",content.title);
    if(content.variant==="douyin-script"){
      content.hooks.forEach((text,index)=>field("钩子 "+(index+1),text));
      field("口播逐字稿",content.script);
    }else if(content.variant==="douyin-post"){
      content.slides.forEach((text,index)=>field("第 "+(index+1)+" 页",text));
    }else{
      content.blocks.forEach(({text},index)=>field("内容块 "+(index+1),text));
    }
  }
  field("行动引导",content.cta);
  return fields;
}

export function channelRadar(content:ChannelContent){
  const fields=channelFields(content);
  const live=fields.map(f=>f.text.toLowerCase()).join("\n");
  const matches:ChannelRisk[]=fields.flatMap(({field,text})=>localRules[content.variant].flatMap(({pattern,reason})=>
    [...text.matchAll(pattern)].map(match=>({field,text:match[0],start:match.index,end:match.index+match[0].length,reason}))));
  const keywords=[...new Set(content.keywords.map(term=>term.trim()).filter(Boolean))].map(term=>({term,present:live.includes(term.toLowerCase())}));
  const hooks=content.variant==="douyin-script"?new Set(content.hooks.map(text=>text.trim()).filter(Boolean)).size:null;
  const paragraphs=content.variant==="xiaohongshu"?content.body.trim().split(/\n\s*\n/):null;
  const format=paragraphs?paragraphs.length>=2&&paragraphs.every(part=>/^\s*\p{Extended_Pictographic}/u.test(part)):
    content.variant==="wechat"?["quote","highlight","step"].every(kind=>content.blocks.some(block=>block.kind===kind&&block.text.trim())):null;
  return {matches,keywords,hooks,cta:!!content.cta.trim(),format};
}

const escapeHTML=(text:string)=>text.replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]!)).replace(/\r\n?|\n/g,"<br>");
const blockStyle={
  paragraph:"margin:0 0 16px;line-height:1.8;",
  quote:"margin:18px 0;padding:12px 16px;border-left:4px solid #507694;background:#f1f5f8;line-height:1.8;",
  highlight:"margin:18px 0;padding:12px 16px;background:#fff4d6;color:#493810;font-weight:700;line-height:1.8;",
  step:"margin:18px 0;padding:14px 16px;border:1px solid #b8c9d6;border-radius:8px;background:#f6f9fb;line-height:1.8;",
} as const;

export function channelDelivery(content:ChannelContent):{plain:string;html?:string}{
  if(content.variant==="xiaohongshu"){
    const titles=content.titles.map((text,index)=>`${index+1}. ${text}`).join("\n");
    const tags=content.tags.map(tag=>"#"+tag.replace(/^#+/,"").trim()).join(" ");
    const comments=content.comments.map(({question,answer},index)=>`置顶备选 ${index+1}\n作者自问：${question}\n作者回答：${answer}`).join("\n\n");
    return {plain:["备选标题\n"+titles,content.body,content.cta,tags,comments].filter(Boolean).join("\n\n")};
  }
  const plain=channelFields(content).filter(field=>field.text.trim()).map(({field,text})=>field+"\n"+text).join("\n\n");
  if(content.variant!=="wechat")return {plain};
  const html=content.blocks.map(({kind,text})=>{
    const tag=kind==="quote"?"blockquote":"p";
    return "<"+tag+' style="'+blockStyle[kind]+'">'+escapeHTML(text)+"</"+tag+">";
  }).join("");
  return {plain:[content.title,...content.blocks.map(b=>b.text),content.cta].filter(Boolean).join("\n\n"),
    html:'<section style="color:#20262d;font-family:sans-serif;">'+'<h1 style="margin:0 0 20px;font-size:25px;">'+escapeHTML(content.title)+"</h1>"+
      html+(content.cta?'<p style="margin:22px 0 0;padding:14px;border-top:2px solid #507694;font-weight:700;">'+escapeHTML(content.cta)+"</p>":"")+"</section>"};
}
