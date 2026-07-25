import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class MemoryManager {
  constructor(memoryFilePath = path.join(__dirname, "memory.json")) {
    this.memoryFilePath = memoryFilePath;
  }

  async load() {
    try {
      const data = await fs.readFile(this.memoryFilePath, "utf-8");
      const json = JSON.parse(data);
      if (!Array.isArray(json.memories)) json.memories = [];
      if (!Array.isArray(json.conversationHistory)) json.conversationHistory = [];
      return json;
    } catch {
      return { memories: [], conversationHistory: [] };
    }
  }

  async save(data) {
    await fs.writeFile(this.memoryFilePath, JSON.stringify(data, null, 2));
  }

  async addMemory({ type = "fact", key, value, source = "user" }) {
    const data = await this.load();
    const normType = type.trim().toLowerCase();
    const normKey = key.trim().toLowerCase();
    const normValue = String(value).trim();

    const idx = data.memories.findIndex(
      (m) => m.type === normType && m.key.toLowerCase() === normKey
    );

    if (idx >= 0) {
      if (data.memories[idx].value !== normValue) {
        data.memories[idx].value = normValue;
        data.memories[idx].timestamp = new Date().toISOString();
        data.memories[idx].source = source;
      }
    } else {
      data.memories.push({
        type: normType,
        key: normKey,
        value: normValue,
        source,
        timestamp: new Date().toISOString(),
      });
    }
    await this.save(data);
    return `已${idx >= 0 ? "更新" : "保存"}记忆: ${key} = ${value}`;
  }

  async recallMemories(query = "") {
    const data = await this.load();
    if (!query) return data.memories;
    const q = query.toLowerCase();
    return data.memories.filter(
      (m) => m.key.includes(q) || m.value.includes(q)
    );
  }

  async deleteMemory(key) {
    const data = await this.load();
    const before = data.memories.length;
    data.memories = data.memories.filter(
      (m) => m.key.toLowerCase() !== key.trim().toLowerCase()
    );
    await this.save(data);
    return `已删除 ${before - data.memories.length} 条记忆`;
  }

  async getMemorySummary() {
    const data = await this.load();
    const facts = data.memories.filter((m) => m.type === "fact");
    const prefs = data.memories.filter((m) => m.type === "preference");

    let summary = "\n=== 长期记忆 ===\n";
    if (facts.length > 0) {
      summary += "\n已知事实:\n";
      for (const f of facts) summary += `- ${f.key}: ${f.value}\n`;
    }
    if (prefs.length > 0) {
      summary += "\n用户偏好:\n";
      for (const p of prefs) summary += `- ${p.key}: ${p.value}\n`;
    }
    return summary;
  }

  async addConversation(role, content) {
    const data = await this.load();
    data.conversationHistory.push({
      role,
      content: String(content).substring(0, 2000),
      timestamp: new Date().toISOString(),
    });
    if (data.conversationHistory.length > 50) {
      data.conversationHistory = data.conversationHistory.slice(-50);
    }
    await this.save(data);
  }

  async getRecentConversations(n = 10) {
    const data = await this.load();
    return data.conversationHistory.slice(-n);
  }
}
