"use strict";

const { loadSkillEnv } = require("./paths");

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

function requireEnv(name, hint) {
  const value = process.env[name];
  if (value != null && String(value).trim()) return String(value).trim();
  throw new Error(`Missing ${name}. ${hint || "Set it in skill .env (see .env.example)."}`);
}

function getApiKey() {
  const key = process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || process.env.QWEN_API_KEY;
  if (!key) {
    throw new Error("Missing DASHSCOPE_API_KEY (or OPENAI_API_KEY / QWEN_API_KEY). Configure skill .env.");
  }
  return key;
}

function getBaseUrl() {
  return (process.env.DASHSCOPE_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function getTextModel() {
  return requireEnv("TEXT_MODEL");
}

function getVisionModel() {
  return requireEnv("VISION_MODEL");
}

/** CLI `--model` wins; otherwise read TEXT_MODEL from skill .env. */
function resolveTextModel(cliOverride) {
  if (cliOverride != null && String(cliOverride).trim()) return String(cliOverride).trim();
  return getTextModel();
}

function getModelTemperature() {
  return Number(process.env.MODEL_TEMPERATURE ?? 0);
}

function getModelSeed() {
  return Number(process.env.MODEL_SEED ?? 42);
}

function stripThink(value) {
  return String(value || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

function getChatMessageContent(data) {
  return stripThink(data?.choices?.[0]?.message?.content || "");
}

async function callChatCompletions(payload, { label = "LLM", maxAttempts = 4 } = {}) {
  loadSkillEnv();
  const apiKey = getApiKey();
  const baseUrl = getBaseUrl();
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.text();
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 1000)}`);
      return JSON.parse(body);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, attempt * 3000));
    }
  }
  throw lastErr;
}

async function callJsonChat({ model, system, user, maxTokens = 7000, label = "LLM" }) {
  const resolvedModel = model || getTextModel();
  const messages = system
    ? [{ role: "system", content: system }, { role: "user", content: user }]
    : [{ role: "user", content: user }];
  const data = await callChatCompletions({
    model: resolvedModel,
    messages,
    temperature: getModelTemperature(),
    seed: getModelSeed(),
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  }, { label });
  return getChatMessageContent(data);
}

module.exports = {
  DEFAULT_BASE_URL,
  getApiKey,
  getBaseUrl,
  getTextModel,
  getVisionModel,
  resolveTextModel,
  getModelTemperature,
  getModelSeed,
  stripThink,
  getChatMessageContent,
  callChatCompletions,
  callJsonChat,
};
