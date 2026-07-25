
import { getLlama, LlamaChatSession } from "node-llama-cpp";

let llama = null;

export async function loadModel(modelPath) {
  llama = await getLlama({ logLevel: "error" });
  return await llama.loadModel({ modelPath });
}

export async function createContext(model, contextSize = 2048) {
  return await model.createContext({ contextSize });
}

export function createSession(context, systemPrompt = "") {
  return new LlamaChatSession({
    contextSequence: context.getSequence(),
    systemPrompt,
  });
}

export function getLlamaInstance() {
  return llama;
}
