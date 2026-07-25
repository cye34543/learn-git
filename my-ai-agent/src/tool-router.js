// ─── 工具路由：基于关键词匹配的轻量级预筛选 ───
// 当工具超过 10 个时，根据用户意图预筛选最相关的工具发给 LLM
// 未来可以升级为嵌入向量匹配（类似第15章的 bge-small 方案）

const TOOL_EXEMPLARS = {
  getCurrentTime: ["现在几点", "今天几号", "当前时间", "日期", "星期几", "what time", "current date"],
  calculate: ["计算", "等于多少", "加减乘除", "算一下", "多少加多少", "calculate", "math"],
  getWeather: ["天气", "气温", "下雨", "晴天", "温度", "weather", "temperature"],
  readFile: ["读取文件", "查看文件", "打开文件", "读文件", "文件内容", "read file", "cat"],
  writeFile: ["写入文件", "保存文件", "创建文件", "写文件", "write file", "save"],
  listDirectory: ["列出目录", "文件列表", "ls", "目录", "有哪些文件", "list files", "dir"],
  saveMemory: ["记住", "保存", "别忘了", "记下来", "remember", "save to memory"],
  recallMemory: ["回忆一下", "我之前", "你说过", "你记得", "recall", "what do you remember"],
  deleteMemory: ["忘记", "删除记忆", "清除记忆", "forget"],
  webSearch: ["搜索", "查一下", "网上", "搜索一下", "search", "google", "百度"],
  runShell: ["运行命令", "执行", "命令行", "shell", "bash", "terminal", "run"],
  getNetworkInfo: ["网络", "IP", "主机名", "hostname", "network", "上网"],
  translate: ["翻译", "translate", "用.*说", "翻成"],
  queryNationalSecurity: ["国安", "国家安全", "总体国家安全观", "十个坚持", "五个统筹", "政治安全", "军事安全", "国土安全"],
  generateNationalSecurityQuiz: ["出题", "选择题", "考试", "测试一下", "做几道题", "练习题", "quiz", "题目"],
  browseNationalSecurityChapters: ["目录", "章节", "有哪些内容", "概览"],
};

const ALWAYS_INCLUDE = ["saveMemory", "recallMemory"];

export function scoreTools(userInput) {
  const input = userInput.toLowerCase();
  const scores = new Map();

  for (const [toolKey, exemplars] of Object.entries(TOOL_EXEMPLARS)) {
    let maxScore = 0;
    for (const phrase of exemplars) {
      if (input.includes(phrase.toLowerCase())) {
        maxScore = Math.max(maxScore, phrase.length / input.length);
      }
    }
    if (maxScore > 0) scores.set(toolKey, maxScore);
  }

  return scores;
}

export function selectTools(scores, k = 6) {
  const ranked = [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => key);

  const selected = new Set(ALWAYS_INCLUDE);
  for (const key of ranked) {
    if (selected.size >= k + ALWAYS_INCLUDE.length) break;
    if (ALWAYS_INCLUDE.includes(key)) continue;
    selected.add(key);
  }

  return selected;
}

export function filterFunctions(selectedKeys, allFunctions) {
  const filtered = {};
  for (const key of selectedKeys) {
    if (allFunctions[key]) filtered[key] = allFunctions[key];
  }
  return filtered;
}
