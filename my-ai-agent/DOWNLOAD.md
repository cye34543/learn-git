# 小智 AI 智能体 — 下载指南

## 1. 安装依赖

```bash
cd my-ai-agent
npm install
```

## 2. 下载模型文件

项目默认使用 **Qwen2.5-7B-Instruct** (Q4_K_M 量化, ~4.7GB)。

### 方式一：命令行下载
```bash
mkdir -p models

# 下载分卷1 (约2.4GB)
wget -O models/Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf \
  https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M/Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf

# 下载分卷2 (约2.3GB)
wget -O models/Qwen2.5-7B-Instruct-Q4_K_M-00002-of-00002.gguf \
  https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M/Qwen2.5-7B-Instruct-Q4_K_M-00002-of-00002.gguf
```

### 方式二：浏览器下载
访问 https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/tree/main/Qwen2.5-7B-Instruct-Q4_K_M

下载两个分卷文件，放入 `models/` 目录。

### 方式三：使用 huggingface-cli
```bash
pip install huggingface_hub
mkdir -p models
huggingface-cli download bartowski/Qwen2.5-7B-Instruct-GGUF \
  Qwen2.5-7B-Instruct-Q4_K_M/Qwen2.5-7B-Instruct-Q4_K_M-00001-of-00002.gguf \
  Qwen2.5-7B-Instruct-Q4_K_M/Qwen2.5-7B-Instruct-Q4_K_M-00002-of-00002.gguf \
  --local-dir models/
```

---

## 3. 准备国安知识库文本

> 如果你有《国家安全教育学习指南》PDF 文件，按以下步骤提取：

```bash
# 安装 PDF 解析库
npm install pdf-parse@1.1.1

# 提取文本（将 YOUR_PDF_PATH 替换为实际路径）
node -e "
const fs = require('fs');
const pdfParse = require('pdf-parse');
(async () => {
  const data = new Uint8Array(fs.readFileSync('YOUR_PDF_PATH'));
  const result = await pdfParse(data);
  fs.writeFileSync('guoan-text.txt', result.text);
  console.log('提取完成, 共', result.text.length, '字');
})();
"
```

提取完成后，`guoan-text.txt` 会放在项目根目录，Agent 启动时会自动加载。

> 没有 PDF 也无妨 — Agent 的其他 13 个工具（计算、天气、文件操作、Shell 等）可以正常使用，只是国安问答功能需要知识库文件。

---

## 4. 启动

```bash
npm start
# 或
node index.js
```

---

## 硬件要求

- **内存**: 最低 8GB，推荐 16GB
- **模型大小**: ~4.7GB
- **GPU**: 可选，纯 CPU 推理可用
