import type {GeoItem} from "../types/sprint5";
export function geoReport(text:string):GeoItem[]{
  return [
    {label:"实体定义",met:/[^。\n]{2,28}(?:是指|定义为|简称|全称为)[^。\n]{4,}/.test(text),advice:"第一次出现专有名词时，写明它指什么及适用范围。"},
    {label:"结构化对比参数",met:/(?:对比|相比|方案\s*[AB]|参数)/i.test(text)&&/(?:\d+(?:\.\d+)?\s*(?:%|元|分钟|毫米|GB|ms|天))/i.test(text),advice:"把同口径参数、单位和适用条件放在一起对照。"},
    {label:"可验证引用",met:/https?:\/\/[^\s）)]+/.test(text)&&/(?:来源|参考|报告|依据)/.test(text),advice:"贴出可复核的原始出处，注明材料及对应结论。"},
    {label:"问答摘要",met:/(?:问[:：]|问题[:：]|[？?])[^]*?(?:答[:：]|回答[:：]|简答[:：])/.test(text),advice:"用读者会提出的问题和一段可独立理解的答案作摘要。"},
  ];
}
