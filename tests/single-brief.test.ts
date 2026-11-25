import {expect,it} from "vitest";
import {briefSuggestions,materialConflicts,resolveBrief,singleBrief} from "../src/studio/single-brief";

it("用一段话覆盖账号默认，允许作者调整，并保留压后补充的指令",()=>{
  const input=singleBrief.parse({note:"目标是认识校样。写给第一次接触的人，开头先写动作。写法：短段落。不用配图。\n目标：能独立完成第一次校样"});
  const defaults={goal:"品宣",audience:"默认受众",imagesRequired:true};
  expect(resolveBrief(input,defaults)).toMatchObject({goal:"能独立完成第一次校样",audience:"第一次接触的人",imagesRequired:false,style:"短段落"});
  expect(resolveBrief({...input,adjust:{audience:"编辑实习生",images:true}},defaults)).toMatchObject({audience:"编辑实习生",imagesRequired:true});
});

it("只比较明确写出的同名事实，并列出两个出处",()=>{
  expect(materialConflicts([{source:"本次说明",text:"活动日期：11月25日"},{source:"安排表",text:"活动日期：11月26日"}])).toEqual([expect.stringMatching(/11月25日／本次说明.*11月26日／安排表/)]);
  expect(materialConflicts([{source:"本次说明",text:"活动日期：11月25日"},{source:"安排表",text:"活动日期：11月25日"}])).toEqual([]);
});

it("作者明确拒绝的补充不会出现",()=>{
  expect(briefSuggestions(singleBrief.parse({note:"不要提问，也不需要备用标题"}))).toEqual([]);
  expect(briefSuggestions(singleBrief.parse({note:"不要任何额外说明"}))).toEqual([]);
  expect(briefSuggestions(singleBrief.parse({note:"原创场景，用清楚的小动作"})).map(x=>x.key)).toEqual(["ending","title"]);
});
