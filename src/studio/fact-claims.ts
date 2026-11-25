// Match a complete instruction about what the author must leave unwritten.
// A surrounding denial or fiction label does not exempt neighboring assertions.
const writingConstraint=/(?<![^。！？\n，,；;：:\s])(?:(?:缺少|没有|缺乏)(?:可核实的)?(?:真实经历(?:与|和|及)核实信息|真实经历|核实信息)(?:的地方|时)[，,]\s*(?:本文|作者)?(?:不作补足|不予补足|不要补写|不得编造)|(?:如果|若)涉及(?:真实经历|核实信息|核实数据)(?:(?:或|和|及|与)(?:真实经历|核实信息|核实数据))*[，,]\s*(?:仍|也)?(?:应|需|须)?(?:保留缺口|不作补足|不予补足|不要补写|不得编造))(?![^。！？\n，,；;：:\s])/gu;
const reality=/政策|报名|考纲|资格|赛事规则|考试规则|亲身(?:经历了|参加了|见证了)|我曾|去年我|实际发生|官方|统计|研究表明|我毕业于/i;
const experience=/我(?:在)?(?:(?:去|今|前)年|上周|上个月)?(?:亲自)?(?:参加(?:了|过)|(?:没(?:有)?|不曾)参加)/u;
const calendarDate=/\d{4}年\s*\d{1,2}月|\d{1,2}月\s*\d{1,2}[日号]/u;

export function withoutWritingConstraints(text:string){
  return text.replace(writingConstraint,match=>" ".repeat(match.length));
}

export function isWritingConstraintQuote(text:string,offset:number,quote:string){
  const start=offset+(quote.match(/^[\s，,；;：:]+/u)?.[0].length??0);
  const end=offset+quote.replace(/[\s。！？.?!，,；;：:]+$/u,"").length;
  return Array.from(text.matchAll(writingConstraint)).some(match=>
    start<end&&start>=match.index&&end<=match.index+match[0].length);
}

export function factTrigger(text:string,needed=false){
  if(needed)return true;
  return withoutWritingConstraints(text).split(/[。！？\n]/).some(raw=>{
    let sentence=raw.replace(/(?:不涉及|不使用|不包含|不指向|非|没有|不是替换成|不得使用|禁止使用)(?:现实|任何)?(?:真实经历|真实人物经历|真实饮用体验|现实统计|统计数据)(?:(?:、|或|和|及)(?:真实经历|真实人物经历|真实饮用体验|现实统计|统计数据|效果验证))*/g,"");
    if(/估算|预估/.test(sentence)&&/时长|口播|朗读|秒/.test(sentence))sentence=sentence.replace(/\d+(?:分(?:钟)?|秒)/g,"");
    if(reality.test(sentence)||experience.test(sentence)||calendarDate.test(sentence))return true;
    if(/虚构|fictional/i.test(sentence))return false;
    return /\d+(?:年|月|日|元|%|人|次|分)|[一二三四五六七八九十]+月/i.test(sentence);
  });
}

export function localFactQuotes(text:string){
  const quotes:Array<{quote:string;offset:number}>=[];
  let start=0;
  function scan(end:number){
    for(const match of text.slice(start,end).matchAll(/[^。！？\n]+/gu)){
      const quote=match[0].replace(/^[\s，,；;：:]+|[\s，,；;：:]+$/gu,"");
      if(quote&&factTrigger(quote))quotes.push({quote,offset:start+match.index+match[0].indexOf(quote)});
    }
  }
  for(const match of text.matchAll(writingConstraint)){
    scan(match.index);
    start=match.index+match[0].length;
  }
  scan(text.length);
  return quotes;
}
