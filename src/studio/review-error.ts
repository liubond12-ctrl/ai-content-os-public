export class ReviewError extends Error {
  constructor(readonly stage:string,readonly code:string,readonly path?:string){
    super([code==="AMBIGUOUS_QUOTE"?"同一句原文出现多次，需要人工确认具体位置。已保留正文，请补充前后文后再审。":code==="OUTPUT_TRUNCATED"?"模型输出未正常结束，已截断":stage,code,path].filter(Boolean).join(" · "));
  }
}
