// Independently authored public test material. No business source files are used.
export const catalog = {
  dataset: "safe-demo-v2",
  account: "纸飞机观察员（虚构账号）",
  rules: "你为虚构账号纸飞机观察员写作。语气平实、好奇，使用可观察的动作说明观点。所有例子都明确标注为虚构。不得声称有真实孩子、客户、学校或教学经历。不得编造考试政策、日期或学习效果。文章须保留引用，待人工审核。",
  documents: [
    {id:"actions", title:"用动作写清楚学习过程", kind:"expression-rule",
      text:"本测试写作练习认为，具体动作让读者更容易理解描述。虚构例子：纸偶小舟先圈出题目中的条件，摆了三块积木，发现摆法不符后重新排列。与笼统的“非常努力”相比，这段文字提供了可供读者判断的行为。这是表达方法演示，不是教育效果研究。"},
    {id:"revision", title:"记录一次修改", kind:"expression-rule",
      text:"独立编写的虚构写作样例：纸偶小岚画好一个方框后，发现少了一条边，擦掉后重新画，并在旁边写下检查步骤。写作者可以交代动作、遇到的问题和调整过程。不得将此样例改写为真实学员案例。"},
    {id:"limits", title:"事实核实边界", kind:"production-sop",
      text:"本测试资料集没有任何考试报名公告。遇到具体报名日期、考试政策或等级要求，应列出缺失信息并停止事实成稿。虚构写作练习不能证明真实考试安排。"},
    {id:"workshop",title:"风筝工坊",kind:"expression-rule",
      text:"虚构手记：小舟发现纸翼总往左偏。工坊目录只说明后续改动另存于《蓝格便笺》，此页没有记下改了哪个部件，也没有记录试飞结果。"},
    {id:"notebook",title:"蓝格便笺",kind:"expression-rule",
      text:"虚构叙事素材：小舟把尾带移向右侧，又从木台放飞。这回纸翼划过两块地砖才落下。便笺只描绘这一次观察。"}
  ],
  scenarios: {
    "limited-writing":{topic:"结合风筝工坊手记和《蓝格便笺》，描述困难、改动与一次复试观察，保留不确定性。",audience:"写作练习者"},
    followup:{topic:"风筝工坊：还原遇到的困难、改动的部件及复试结果。",audience:"写作练习者"},
    expression: {topic:"讨论为什么描写学习时的具体行为比笼统夸奖努力更清楚，使用虚构纸偶例子",audience:"写作练习者"},
    missing: {topic:"撰写关于 2027 年 GESP Python 三级具体报名日期的文章，要求使用官方已核实信息",audience:"考试信息核验练习"}
  }
} as const;
