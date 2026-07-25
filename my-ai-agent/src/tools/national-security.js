import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KB_PATH = path.join(__dirname, "../../guoan-text.txt");

let paragraphs = [];
let loaded = false;

function loadKnowledgeBase() {
  if (loaded) return;
  const raw = fs.readFileSync(KB_PATH, "utf-8");
  paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 20);
  loaded = true;
}

function searchRelevant(query, topK = 3) {
  loadKnowledgeBase();

  // 生成中文搜索词：从查询中提取2-4字的n-gram，并按字面匹配
  const cleanQuery = query.replace(/[？?！!。，,\s]+/g, "");
  const grams = [];
  for (let len = 4; len >= 2; len--) {
    for (let i = 0; i <= cleanQuery.length - len; i++) {
      grams.push(cleanQuery.substring(i, i + len));
    }
  }
  const uniqueGrams = [...new Set(grams)];

  const scored = paragraphs.map((para, idx) => {
    let score = 0;
    for (const gram of uniqueGrams) {
      const count = (para.match(new RegExp(gram.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      score += count * (gram.length >= 3 ? 3 : 1);
    }
    return { idx, para, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK);
  const filtered = top.filter((s) => s.score > 0);
  // 截断过长段落，避免LLM上下文过载
  return filtered.map((s) => ({
    ...s,
    para: s.para.length > 300 ? s.para.substring(0, 300) + "..." : s.para,
  }));
}

function searchByChapter(all = false) {
  loadKnowledgeBase();
  const chapters = [];
  let currentChapter = { title: "导论", items: [] };

  for (const para of paragraphs) {
    const chapterMatch = para.match(/^第[一二三四五六七八九十]+章(.+)/);
    if (chapterMatch) {
      if (currentChapter.items.length > 0) chapters.push(currentChapter);
      currentChapter = { title: "第" + chapterMatch[0], items: [] };
      continue;
    }
    if (para.length > 15) currentChapter.items.push(para.substring(0, 200));
  }
  if (currentChapter.items.length > 0) chapters.push(currentChapter);

  if (all) return chapters;

  return chapters.map((ch) => ({
    title: ch.title,
    itemCount: ch.items.length,
    preview: ch.items.slice(0, 3),
  }));
}

function generateQuizFromContent(topic = "", count = 4) {
  loadKnowledgeBase();

  let sourceParagraphs;
  if (topic) {
    sourceParagraphs = searchRelevant(topic, 10);
  } else {
    const scored = paragraphs.map((para, idx) => {
      const factual = (para.match(/\d+\./g) || []).length;
      const keyTerms = (para.match(/“.*?”/g) || []).length;
      return { idx, para, score: factual * 2 + keyTerms };
    });
    scored.sort((a, b) => b.score - a.score);
    sourceParagraphs = scored.slice(0, 10);
  }

  const content = sourceParagraphs.map((s) => s.para).join("\n\n");
  const prompt = `你是一个国家安全教育题库专家。请根据以下知识内容，生成 ${count} 道单选题。

## 知识内容
${content}

## 要求
1. 每道题只有1个正确答案
2. 每道题4个选项(A/B/C/D)
3. 选项要有干扰性（错误选项要看起来合理）
4. 题目应覆盖不同的知识点
5. 在每道题后标注正确答案

## 输出格式
第1题: [题目]
A. [选项A]
B. [选项B]  
C. [选项C]
D. [选项D]
正确答案: [A/B/C/D]

第2题: ...
`;

  return prompt;
}

export { searchRelevant, searchByChapter, generateQuizFromContent, loadKnowledgeBase };
