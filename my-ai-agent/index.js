import { AIAgent } from "./src/agent.js";
import { createInterface } from "readline";
import { stdin, stdout } from "process";

const BANNER = `
╔══════════════════════════════════════════╗
║       小智 AI 智能体 v2.0               ║
║                                        ║
║  能力:                                 ║
║  💬 自然对话 · 📝 文件读写              ║
║  🧮 数学计算 · 🌤️ 天气查询              ║
║  🔍 网络搜索 · 💻 Shell 命令            ║
║  🧠 长期记忆 · 🔄 多步骤推理            ║
║  ⏱️ 时间查询 · 📁 目录浏览              ║
║  🛡️ 国安知识库 · 📋 国安题库            ║
║                                        ║
║  输入 'quit' 退出                      ║
║  输入 '/help' 查看帮助                  ║
╚══════════════════════════════════════════╝`;

const HELP = `
/help          - 显示此帮助
/quit          - 退出
/memory        - 查看已保存的记忆
/clear-memory  - 清除所有记忆
/tools         - 列出所有可用工具
/history       - 查看最近对话记录
`;

async function main() {
  console.log(BANNER);

  const agent = new AIAgent();
  await agent.initialize();

  const rl = createInterface({ input: stdin, output: stdout });

  const ask = () => {
    rl.question("\n你: ", async (input) => {
      const cmd = input.trim();

      if (cmd === "quit" || cmd === "/quit") {
        console.log("再见!");
        await agent.dispose();
        rl.close();
        return;
      }

      if (cmd === "/help") {
        console.log(HELP);
        return ask();
      }

      if (cmd === "/memory") {
        const summary = await agent.memoryManager.getMemorySummary();
        console.log(summary);
        return ask();
      }

      if (cmd === "/clear-memory") {
        await agent.memoryManager.save({ memories: [], conversationHistory: [] });
        console.log("所有记忆已清除。");
        return ask();
      }

      if (cmd === "/tools") {
        const { getAllToolDescriptions } = await import("./src/tool-registry.js");
        const tools = getAllToolDescriptions();
        console.log("\n可用工具:");
        tools.forEach((t) => console.log(`  - ${t.key}: ${t.description}`));
        return ask();
      }

      if (cmd === "/history") {
        const recent = await agent.memoryManager.getRecentConversations(10);
        if (recent.length === 0) {
          console.log("暂无对话记录。");
        } else {
          console.log("\n最近对话:");
          recent.forEach((m) => console.log(`  [${m.role}] ${m.content.substring(0, 100)}`));
        }
        return ask();
      }

      if (!cmd) return ask();

      await agent.run(cmd);
      ask();
    });
  };

  ask();
}

main().catch((err) => {
  console.error("启动失败:", err.message);
  process.exit(1);
});
