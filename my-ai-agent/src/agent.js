import { loadModel, createContext, createSession, getLlamaInstance } from "./model.js";
import { createTools } from "./tool-registry.js";
import { loadKnowledgeBase } from "./tools/national-security.js";
import { MemoryManager } from "./memory/memory-manager.js";
import {
  AppError, LLMCallError, AgentWorkflowError, ToolExecutionError,
  normalizeError, classifyError, sleep, jitteredBackoffDelay,
  withTimeout, withRetries, formatUserFacingError, TimeoutError,
} from "./error-handler.js";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = path.join(__dirname, "../models/Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf");

const AGENT_SYSTEM_PROMPT = `你是"小智"，一个AI智能体。

## 规则
1. 用工具获取信息，不要编造事实
2. 数学计算用 calculate 工具
3. 遇到国安知识问题用 queryNationalSecurity 查资料
4. 用户要求出题用 generateNationalSecurityQuiz
5. 个人信息用 saveMemory 记住
6. 回答简洁直接，不要啰嗦，不要反问用户，不要问"还有问题吗"`;

export class AIAgent {
  constructor(modelPath = DEFAULT_MODEL) {
    this.modelPath = modelPath;
    this.model = null;
    this.context = null;
    this.session = null;
    this.llama = null;
    this.tools = {};
    this.functions = {};
    this.memoryManager = new MemoryManager();
    this.maxIterations = 8;
    this.llmTimeout = 120000;
    this.toolTimeout = 30000;
    this.initialized = false;
    this.conversationHistory = [];
  }

  async initialize() {
    console.log("正在加载模型和知识库...");
    loadKnowledgeBase();
    this.model = await loadModel(this.modelPath);
    this.context = await createContext(this.model, 8192);
    this.llama = getLlamaInstance();

    const memorySummary = await this.memoryManager.getMemorySummary();
    const fullSystemPrompt = AGENT_SYSTEM_PROMPT + "\n" + memorySummary;

    this.session = createSession(this.context, fullSystemPrompt);

    const { tools, memoryManager } = createTools();
    this.tools = tools;
    this.memoryManager = memoryManager;
    this.functions = { ...tools };
    this.initialized = true;
    console.log("小智智能体初始化完成!");
  }

  async run(userInput) {
    if (!this.initialized) throw new AgentWorkflowError("agent_init", "Agent 未初始化");

    const correlationId = crypto.randomUUID().substring(0, 8);
    console.log(`\n${"=".repeat(45)}`);
    process.stdout.write("小智: ");

    try {
      if (!userInput || !userInput.trim()) {
        console.log("请输入有效的问题。");
        return { ok: false, output: "输入为空" };
      }

      await this.memoryManager.addConversation("user", userInput);

      const response = await withTimeout(
        withRetries(
          () => this.session.prompt(userInput, {
            functions: this.functions,
            maxTokens: 1500,
            onTextChunk: (text) => process.stdout.write(text),
          }),
          { maxRetries: 2, label: "LLM调用" }
        ),
        this.llmTimeout * 2,
        "LLM推理"
      );

      process.stdout.write("\n");
      await this.memoryManager.addConversation("assistant", response);

      return { ok: true, output: response, correlationId };
    } catch (err) {
      const classified = classifyError(err);
      const output = formatUserFacingError(err, correlationId);
      console.log(`\n[错误] ${output}`);
      return { ok: false, output, correlationId };
    }
  }

  async dispose() {
    if (this.session) {
      try { await this.session.dispose(); } catch {}
    }
    if (this.context) {
      try { await this.context.dispose(); } catch {}
    }
    if (this.model) {
      try { await this.model.dispose(); } catch {}
    }
    this.initialized = false;
    console.log("\n小智智能体已关闭。");
  }
}
