import {
  analysisInstructions, analysisSchema, summaryInstructions, summarySchema,
  validateAnalysis, validateSummary,
} from './report-template.mjs';
import { t } from './i18n.mjs';

const providers = [
  { name: 'OpenAI', model: 'gpt-4o-mini', url: 'https://api.openai.com/v1/responses' },
  { name: 'Claude', model: 'claude-sonnet-5-5', url: 'https://api.anthropic.com/v1/messages' },
  { name: 'Gemini', model: 'gemini-4-hydrogen', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions' },
  { name: 'DeepSeek', model: 'deepseek-flash', url: 'https://api.deepseek.com/chat/completions',
    options: { thinking: { type: 'disabled' } } },
  { name: 'Kimi', model: 'kimi-k2.5', url: 'https://api.moonshot.cn/v1/chat/completions',
    options: { thinking: { type: 'disabled' }, temperature: 0.6 } },
  { name: 'GLM', model: 'glm-4.7-flash', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    options: { thinking: { type: 'disabled' } } },
  { name: 'Qwen', model: 'qwen-plus', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    options: { enable_thinking: false } },
];

export const AI_PROVIDERS = Object.freeze(providers.map(({ name, model, url }) =>
  Object.freeze({ name, model, url, origin: new URL(url).origin + '/*' })));

const MAX_NOTES = 20;

function excerpt(value, length) {
  return typeof value === 'string'
    ? value.replace(/https?:\/\/[^\s<>"'，。；！？]+/giu, '[链接已省略]').trim().slice(0, length)
    : '';
}

function makeRequest(config, key, model, input, instructions, schema, maxTokens) {
  const headers = { 'Content-Type': 'application/json' };
  const content = `${instructions}\n仅返回符合此 JSON Schema 的 JSON 对象：${JSON.stringify(schema)}`;
  const messages = [{ role: 'user', content: input }];

  if (config.name === 'Claude') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
    return { headers, body: { model, system: content, messages, max_tokens: maxTokens } };
  }

  headers.Authorization = 'Bearer ' + key;
  if (config.name === 'OpenAI') {
    return { headers, body: { model, store: false, instructions, input, max_output_tokens: maxTokens,
      text: { format: { type: 'json_schema', name: 'report_analysis', strict: true, schema } } } };
  }

  messages.unshift({ role: 'system', content });
  const body = { model, messages, max_tokens: maxTokens, ...config.options };
  if (config.name === 'DeepSeek') body.response_format = { type: 'json_object' };
  return { headers, body };
}

function readText(provider, result) {
  if (!result || typeof result !== 'object') return null;
  if (provider === 'OpenAI') {
    if (result.status !== 'completed' || !Array.isArray(result.output)) return null;
    const parts = result.output.flatMap(item => item.content ?? []);
    return parts.filter(item => item.type === 'output_text').map(item => item.text).join('\n');
  }
  if (provider === 'Claude') {
    if (result.stop_reason === 'max_tokens' || !Array.isArray(result.content)) return null;
    return result.content.filter(item => item.type === 'text').map(item => item.text).join('\n');
  }
  const choice = result.choices?.[0];
  return choice?.finish_reason === 'length' ? null : choice?.message?.content;
}

// Call only from an extension-owned page after the user opts into the chosen provider.
// The key is kept in this call and never sent to the content scripts.
async function requestReport({ provider, key, model, signal }, instructions, schema, data, maxTokens) {
  const config = providers.find(item => item.name === provider);
  if (!config) throw new Error(t('不支持的 AI 服务商。', 'Unsupported AI provider.'));
  const apiKey = key?.trim();
  if (!apiKey) throw new Error(t('请输入所选服务商的 API 密钥。', 'Enter the API key for the selected provider.'));
  const input = JSON.stringify(data);
  const { headers, body } = makeRequest(config, apiKey, model?.trim() || config.model, input, instructions, schema, maxTokens);
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timeout = setTimeout(cancel, 45000);
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`${provider} API HTTP ${response.status}`);
    const text = readText(provider, await response.json());
    if (typeof text !== 'string' || !text.trim()) throw new Error(t(`${provider} 未返回完整文本。`, `${provider} did not return a complete response.`));
    return text.trim();
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function analyzeNote(request) {
  const { keyword, note, template } = request;
  const text = await requestReport(request, analysisInstructions(template), analysisSchema(template), {
    keyword: excerpt(keyword, 100),
    date: excerpt(note.date, 32),
    title: excerpt(note.title, 500),
    body: excerpt(note.body, 6000),
  }, 1800);
  return validateAnalysis(text, template);
}

export async function summarizeKeyword(request) {
  const { keyword, notes, template, range } = request;
  const sample = notes.slice(0, MAX_NOTES).map(note => ({
    date: excerpt(note.date, 32),
    title: excerpt(note.title, 300),
    body: excerpt(note.body, 1000),
    analysis: note.analysis,
  }));
  const text = await requestReport(request, summaryInstructions(template), summarySchema(template), {
    keyword: excerpt(keyword, 100),
    range: range ? { start: range.start, end: range.end } : undefined,
    collected: notes.length,
    sampled: sample.length,
    notes: sample,
  }, 4000);
  return validateSummary(text, template);
}
