import { loadModel, createContext, createSession, getLlamaInstance } from "./model.js";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = path.join(__dirname, "../models/Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf");

const PLANNER_PROMPT = `你是一个任务规划专家。将用户的复杂任务拆解为原子化的执行步骤。
每个步骤**(atom)**代表一个最小不可分割的操作。

输出格式（严格的 JSON 数组）：
[
  {"id": 1, "kind": "tool", "name": "工具名", "input": {"param": "value"}, "dependsOn": []},
  {"id": 2, "kind": "tool", "name": "工具名", "input": {"param": "<result_of_1>"}, "dependsOn": [1]},
  {"id": 3, "kind": "final", "name": "report", "dependsOn": [2]}
]

规则：
- id 必须从 1 开始递增
- kind 可以是 "tool"、"decision"、"final"
- "tool" 类型必须有 name 和 input
- 如果需要引用前面步骤的结果，用 "<result_of_N>"
- dependsOn 列出所有依赖的前置步骤 id
- 最后一步必须是 kind: "final"`;

export function createPlanner(modelPath = DEFAULT_MODEL) {
  let model = null;
  let context = null;
  let session = null;

  async function initialize() {
    model = await loadModel(modelPath);
    context = await createContext(model, 2048);
    session = createSession(context, PLANNER_PROMPT);
  }

  async function generatePlan(task, availableTools) {
    const toolList = availableTools.map((t) => `- ${t.key}: ${t.description}`).join("\n");
    const prompt = `可用工具:\n${toolList}\n\n任务: ${task}\n\n请输出原子化执行计划(JSON数组):`;
    const raw = await session.prompt(prompt, { maxTokens: 2000 });

    try {
      const jsonStr = raw.match(/\[[\s\S]*\]/)?.[0] || raw;
      const plan = JSON.parse(jsonStr);
      if (!Array.isArray(plan)) throw new Error("Plan must be an array");
      return validatePlan(plan);
    } catch (e) {
      return null;
    }
  }

  function validatePlan(plan) {
    const ids = new Set();
    for (const atom of plan) {
      if (!atom.id || ids.has(atom.id)) throw new Error(`Invalid atom id: ${atom.id}`);
      ids.add(atom.id);
      if (atom.kind === "tool" && !atom.name) throw new Error(`Atom ${atom.id} missing tool name`);
    }
    return plan;
  }

  async function dispose() {
    try { await session?.dispose(); } catch {}
    try { await context?.dispose(); } catch {}
    try { await model?.dispose(); } catch {}
  }

  return { initialize, generatePlan, validatePlan, dispose };
}

export function executeAtomPlan(plan, toolHandlers) {
  const state = {};

  const sorted = [...plan].sort((a, b) => a.id - b.id);

  for (const atom of sorted) {
    if (atom.kind === "final") {
      state[atom.id] = `计划执行完毕，共 ${sorted.length} 个步骤`;
      continue;
    }

    const handler = toolHandlers[atom.name];
    if (!handler) {
      state[atom.id] = `错误: 未知工具 "${atom.name}"`;
      continue;
    }

    const resolvedInput = {};
    if (atom.input) {
      for (const [key, value] of Object.entries(atom.input)) {
        if (typeof value === "string" && value.startsWith("<result_of_")) {
          const refId = parseInt(value.match(/\d+/)?.[0]);
          resolvedInput[key] = state[refId] ?? `(引用${refId}不可用)`;
        } else {
          resolvedInput[key] = value;
        }
      }
    }

    try {
      state[atom.id] = handler(resolvedInput);
    } catch (e) {
      state[atom.id] = `执行失败: ${e.message}`;
    }
  }

  return state;
}
