import { defineChatSessionFunction } from "node-llama-cpp";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { MemoryManager } from "./memory/memory-manager.js";
import { searchRelevant, searchByChapter, generateQuizFromContent } from "./tools/national-security.js";

const execAsync = promisify(exec);
const memoryManager = new MemoryManager();

const MAX_SHELL_OUTPUT = 5000;
const SHELL_TIMEOUT = 15000;
const SAFE_SHELL_PATTERN = /^[\w\s\-_./:;=,|&<>'"!@#$%^&*()\[\]{}~`?]+$/;

function isSafeCommand(cmd) {
  const dangerous = [
    "rm -rf /", "mkfs", "dd if=", ":(){ :|:& };:", "chmod 777 /",
    "> /dev/sda", "fork bomb", "shutdown", "reboot", "init 0", "init 6",
    "curl.*|.*sh", "wget.*-O.*|.*sh",
  ];
  const lower = cmd.toLowerCase();
  for (const d of dangerous) {
    if (lower.includes(d)) return false;
  }
  return SAFE_SHELL_PATTERN.test(cmd) && cmd.length < 1000;
}

export function createTools({ onStream } = {}) {
  const tools = {};

  tools.getCurrentTime = defineChatSessionFunction({
    description: "获取当前日期和时间",
    params: { type: "object", properties: {} },
    async handler() {
      const now = new Date();
      return JSON.stringify({
        iso: now.toISOString(),
        date: now.toLocaleDateString("zh-CN"),
        time: now.toLocaleTimeString("zh-CN", { hour12: false }),
        weekday: ["日", "一", "二", "三", "四", "五", "六"][now.getDay()],
        timestamp: now.getTime(),
      });
    },
  });

  tools.calculate = defineChatSessionFunction({
    description: "执行数学计算，支持 + - * / ** % sqrt abs round 等运算以及括号",
    params: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "数学表达式，如 '(15 * 8) + (20 * 8)' 或 'Math.sqrt(144) + Math.pow(2, 10)'",
        },
      },
      required: ["expression"],
    },
    async handler({ expression }) {
      const safe = expression.replace(/\^/g, "**");
      const allowed = /^[\d\s+\-*/().,%Math\.abceilfloorsqrtpowroundabs]+$/;
      if (!allowed.test(safe) || safe.length > 500) {
        return JSON.stringify({ error: "不安全的表达式" });
      }
      try {
        const result = Function(`"use strict"; return (${safe})`)();
        return JSON.stringify({ expression: safe, result });
      } catch (e) {
        return JSON.stringify({ error: `计算失败: ${e.message}` });
      }
    },
  });

  tools.getWeather = defineChatSessionFunction({
    description: "查询指定城市的天气信息（当前为模拟数据，可替换为真实API）",
    params: {
      type: "object",
      properties: {
        city: { type: "string", description: "城市名称，如 '北京'、'上海'、'Tokyo'" },
      },
      required: ["city"],
    },
    async handler({ city }) {
      const conditions = ["晴", "多云", "阴", "小雨", "阵雨"];
      const temp = 15 + Math.floor(Math.random() * 20);
      const humidity = 40 + Math.floor(Math.random() * 40);
      return JSON.stringify({
        city,
        temperature: `${temp}°C`,
        humidity: `${humidity}%`,
        condition: conditions[Math.floor(Math.random() * conditions.length)],
        wind: `${Math.floor(Math.random() * 20)} km/h`,
        note: "模拟数据，接入真实天气API后可获取准确信息",
      });
    },
  });

  tools.readFile = defineChatSessionFunction({
    description: "读取文件内容（最多5000字）",
    params: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "文件的完整路径" },
      },
      required: ["filePath"],
    },
    async handler({ filePath }) {
      try {
        const stat = await fs.stat(filePath);
        if (stat.size > 1024 * 1024) {
          return JSON.stringify({ error: "文件过大，超过1MB" });
        }
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.stringify({
          path: filePath,
          size: stat.size,
          content: content.substring(0, 5000),
          truncated: content.length > 5000,
        });
      } catch (e) {
        return JSON.stringify({ error: `读取失败: ${e.message}` });
      }
    },
  });

  tools.writeFile = defineChatSessionFunction({
    description: "将内容写入文件",
    params: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "文件路径" },
        content: { type: "string", description: "要写入的内容" },
      },
      required: ["filePath", "content"],
    },
    async handler({ filePath, content }) {
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content, "utf-8");
        return JSON.stringify({ success: true, path: filePath, bytes: Buffer.byteLength(content) });
      } catch (e) {
        return JSON.stringify({ error: `写入失败: ${e.message}` });
      }
    },
  });

  tools.listDirectory = defineChatSessionFunction({
    description: "列出目录中的文件和子目录",
    params: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "目录路径" },
      },
      required: ["dirPath"],
    },
    async handler({ dirPath }) {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const items = entries.slice(0, 100).map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : "file",
        }));
        return JSON.stringify({ path: dirPath, count: entries.length, items });
      } catch (e) {
        return JSON.stringify({ error: `列目录失败: ${e.message}` });
      }
    },
  });

  tools.saveMemory = defineChatSessionFunction({
    description: "将重要信息保存到长期记忆中（事实或偏好）",
    params: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["fact", "preference"],
          description: "事实(fact)或偏好(preference)",
        },
        key: { type: "string", description: "简短标识符，如 'user_name'" },
        value: { type: "string", description: "具体信息，如 '小明'" },
      },
      required: ["type", "key", "value"],
    },
    async handler({ type, key, value }) {
      return await memoryManager.addMemory({ type, key, value });
    },
  });

  tools.recallMemory = defineChatSessionFunction({
    description: "从长期记忆中搜索和调取已保存的信息",
    params: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，留空返回全部" },
      },
    },
    async handler({ query = "" }) {
      const results = await memoryManager.recallMemories(query);
      if (results.length === 0) return "没有找到相关记忆";
      return JSON.stringify(results, null, 2);
    },
  });

  tools.deleteMemory = defineChatSessionFunction({
    description: "删除指定的记忆条目",
    params: {
      type: "object",
      properties: {
        key: { type: "string", description: "要删除的记忆标识符" },
      },
      required: ["key"],
    },
    async handler({ key }) {
      return await memoryManager.deleteMemory(key);
    },
  });

  tools.webSearch = defineChatSessionFunction({
    description: "在网络上搜索信息（当前为模拟，可替换为真实搜索API如SerpAPI）",
    params: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
      },
      required: ["query"],
    },
    async handler({ query }) {
      const results = [
        { title: `${query} - Wikipedia`, url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(query)}`, snippet: `关于${query}的百科条目，涵盖定义、历史和主要概念。` },
        { title: `${query} 入门教程`, url: "https://example.com/tutorial", snippet: `适合初学者的${query}完整教程，包含代码示例和实践项目。` },
        { title: `${query} 最新动态`, url: "https://example.com/news", snippet: `${query}领域的最新研究和行业动态。` },
      ];
      return JSON.stringify({ query, results, note: "模拟搜索数据，可接入真实搜索API" });
    },
  });

  tools.runShell = defineChatSessionFunction({
    description: "执行安全的白名单Shell命令，用于文件操作、系统查询等",
    params: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的Shell命令" },
      },
      required: ["command"],
    },
    async handler({ command }) {
      if (!isSafeCommand(command)) {
        return JSON.stringify({ error: "命令不被允许，可能包含危险操作" });
      }
      try {
        const { stdout, stderr } = await execAsync(command, {
          timeout: SHELL_TIMEOUT,
          maxBuffer: 1024 * 1024,
          cwd: process.cwd(),
          env: { ...process.env, HOME: process.env.HOME },
        });
        const output = (stdout + (stderr ? "\n[stderr]\n" + stderr : "")).substring(0, MAX_SHELL_OUTPUT);
        return JSON.stringify({ command, output, truncated: output.length >= MAX_SHELL_OUTPUT });
      } catch (e) {
        return JSON.stringify({ error: `命令执行失败: ${e.message}`, command });
      }
    },
  });

  tools.getNetworkInfo = defineChatSessionFunction({
    description: "获取本机网络信息：IP地址、主机名等",
    params: { type: "object", properties: {} },
    async handler() {
      try {
        const hostname = (await execAsync("hostname", { timeout: 5000 })).stdout.trim();
        const ip = (await execAsync("hostname -I 2>/dev/null || ip addr show 2>/dev/null | grep 'inet ' | head -1", { timeout: 5000 })).stdout.trim();
        const uptime = (await execAsync("uptime 2>/dev/null", { timeout: 5000 })).stdout.trim();
        return JSON.stringify({ hostname, ipAddress: ip || "无法获取", uptime });
      } catch (e) {
        return JSON.stringify({ error: `获取网络信息失败: ${e.message}` });
      }
    },
  });

  tools.translate = defineChatSessionFunction({
    description: "文本翻译（需要独立的翻译模型支持），当前返回提示信息",
    params: {
      type: "object",
      properties: {
        text: { type: "string", description: "要翻译的文本" },
        targetLang: { type: "string", description: "目标语言，如 'zh'、'en'、'de'" },
      },
      required: ["text", "targetLang"],
    },
    async handler({ text, targetLang }) {
      return JSON.stringify({
        original: text,
        targetLanguage: targetLang,
        note: "翻译功能需搭配翻译模型使用，此工具暂为占位。可直接用LLM进行翻译。",
      });
    },
  });

  tools.queryNationalSecurity = defineChatSessionFunction({
    description: "查询国家安全教育知识库，根据问题检索相关知识点并返回答案依据",
    params: {
      type: "object",
      properties: {
        query: { type: "string", description: "关于国家安全的提问，如'总体国家安全观是什么'、'十个坚持是什么'" },
      },
      required: ["query"],
    },
    async handler({ query }) {
      const results = searchRelevant(query, 2);
      if (results.length === 0) {
        return JSON.stringify({
          found: false,
          message: `未找到与"${query}"相关的国安知识。可尝试: 总体国家安全观、十个坚持、五个统筹、五大要素、新发展格局等关键词。`,
        });
      }
      const content = results.map((r) => r.para).join("\n---\n");
      return `以下是从《国家安全教育学习指南》中检索到的权威内容，请据此用简洁语言直接回答用户问题：\n\n${content}`;
    },
  });

  tools.generateNationalSecurityQuiz = defineChatSessionFunction({
    description: "从国家安全知识库中抽取内容，生成选择题供用户练习",
    params: {
      type: "object",
      properties: {
        count: { type: "integer", description: "生成题目的数量，默认4道" },
        topic: { type: "string", description: "可选，指定知识主题，如'总体国家安全观'、'统筹发展和安全'，留空则随机出题" },
      },
    },
    async handler({ count = 4, topic = "" }) {
      const results = searchRelevant(topic || "国家安全", 3);
      if (results.length === 0) return "未找到相关知识点";
      const content = results.map((r) => r.para).join("\n");
      return `根据以下知识内容，出${count}道单选题（每题4选项，标注答案）：\n\n${content}`;
    },
  });

  tools.browseNationalSecurityChapters = defineChatSessionFunction({
    description: "浏览国家安全教育学习指南的章节目录和每章概述",
    params: { type: "object", properties: {} },
    async handler() {
      const chapters = searchByChapter(true);
      const summary = chapters.map((ch) => {
        return `## ${ch.title}\n知识点数量: ${ch.itemCount}\n示例条目:\n${ch.preview.slice(0, 3).map((p, i) => `  ${i + 1}. ${p}`).join("\n")}`;
      }).join("\n\n---\n\n");
      return `《国家安全教育学习指南》共 ${chapters.length} 章:

${summary}`;
    },
  });

  return { tools, memoryManager };
}

export function getAllToolDescriptions() {
  return [
    { key: "getCurrentTime", description: "获取当前日期和时间" },
    { key: "calculate", description: "执行数学计算，支持加减乘除等运算" },
    { key: "getWeather", description: "查询指定城市的天气信息" },
    { key: "readFile", description: "读取文件内容" },
    { key: "writeFile", description: "将内容写入文件" },
    { key: "listDirectory", description: "列出目录中的文件和子目录" },
    { key: "saveMemory", description: "将重要信息保存到长期记忆" },
    { key: "recallMemory", description: "从长期记忆中搜索和调取已保存的信息" },
    { key: "deleteMemory", description: "删除指定的记忆条目" },
    { key: "webSearch", description: "在网络上搜索信息" },
    { key: "runShell", description: "执行安全的Shell命令" },
    { key: "getNetworkInfo", description: "获取本机网络信息" },
    { key: "translate", description: "文本翻译" },
    { key: "queryNationalSecurity", description: "查询国家安全教育知识库，获取权威解答依据" },
    { key: "generateNationalSecurityQuiz", description: "从国安知识库出选择题，用于练习和测试" },
    { key: "browseNationalSecurityChapters", description: "浏览国安学习指南的章节目录" },
  ];
}
