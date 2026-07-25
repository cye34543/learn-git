import { MemoryManager } from "./memory/memory-manager.js";

export class AppError extends Error {
  constructor(code, userMessage, { retryable = false, details = {}, cause = null } = {}) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.details = details;
    this.cause = cause;
  }
}

export class ValidationError extends AppError {
  constructor(message, details = {}) {
    super("VALIDATION_ERROR", message, { details, retryable: false });
    this.name = "ValidationError";
  }
}

export class LLMCallError extends AppError {
  constructor(message, details = {}) {
    super("LLM_CALL_FAILED", message, { details, retryable: true });
    this.name = "LLMCallError";
  }
}

export class ToolExecutionError extends AppError {
  constructor(toolName, message, details = {}) {
    super("TOOL_EXECUTION_FAILED", message, {
      details: { toolName, ...details },
      retryable: false,
    });
    this.name = "ToolExecutionError";
  }
}

export class AgentWorkflowError extends AppError {
  constructor(step, message, details = {}) {
    super("AGENT_WORKFLOW_FAILED", message, {
      details: { step, ...details },
      retryable: false,
    });
    this.name = "AgentWorkflowError";
    this.step = step;
  }
}

export class TimeoutError extends AppError {
  constructor(label, ms) {
    super("TIMEOUT", `操作超时: ${label} (${ms}ms)`, {
      retryable: true,
      details: { label, ms },
    });
    this.name = "TimeoutError";
  }
}

export function normalizeError(err) {
  if (err instanceof AppError) return err;
  return new AppError("UNKNOWN_ERROR", err.message || String(err), {
    retryable: false,
    details: { originalName: err?.name, originalStack: err?.stack?.split("\n").slice(0, 3).join("\n") },
    cause: err,
  });
}

export function classifyError(err) {
  const normalized = normalizeError(err);
  return {
    error: normalized,
    retryable: normalized.retryable,
    type: normalized.code,
  };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitteredBackoffDelay(attempt, baseMs = 1000, maxMs = 30000) {
  const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = Math.floor(Math.random() * exponential * 0.3);
  return exponential + jitter;
}

export async function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function withRetries(fn, {
  maxRetries = 3,
  baseDelayMs = 1000,
  retryOn = (err) => classifyError(err).retryable,
  label = "operation",
} = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const { retryable } = classifyError(err);
      if (attempt < maxRetries && retryable) {
        const delay = jitteredBackoffDelay(attempt, baseDelayMs);
        console.warn(`[retry] ${label} 失败, ${delay}ms 后第 ${attempt + 1} 次重试: ${err.message}`);
        await sleep(delay);
      } else {
        throw lastErr;
      }
    }
  }
  throw lastErr;
}

export function formatUserFacingError(err, correlationId = "") {
  const classified = classifyError(err);
  const ref = correlationId ? ` (参考编号: ${correlationId})` : "";
  return `${classified.error.userMessage}${ref}`;
}
