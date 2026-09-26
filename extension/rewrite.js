// 입력칸의 글을 Firebase 함수로 보내 뜻은 그대로 두고 말투만 다시 쓴다.
// OpenAI 키와 말투 지시는 함수 쪽에만 있다. 같은 요청은 캐시해 비용을 줄인다.
import { REWRITE_URL } from './config.js';

const TIMEOUT_MS = 25000;
const MAX_INPUT_CHARS = 1500;
const CACHE_SIZE = 50;

export class RewriteError extends Error {}

async function readCache(key) {
  const { rewriteCache = {} } = await chrome.storage.session.get('rewriteCache');
  return rewriteCache[key];
}

async function writeCache(key, value) {
  const { rewriteCache = {} } = await chrome.storage.session.get('rewriteCache');
  delete rewriteCache[key];
  rewriteCache[key] = value;
  const keys = Object.keys(rewriteCache);
  for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_SIZE))) delete rewriteCache[old];
  await chrome.storage.session.set({ rewriteCache });
}

export async function rewriteTone(text, gesture) {
  if (REWRITE_URL.includes('YOUR-PROJECT-ID')) {
    throw new RewriteError('말투 변환 서버가 설정되지 않았습니다. (extension/config.js)');
  }
  const original = text.trim();
  if (original.length > MAX_INPUT_CHARS) {
    throw new RewriteError(`${MAX_INPUT_CHARS}자까지만 바꿀 수 있습니다. 문장을 줄여주세요.`);
  }
  const key = JSON.stringify([gesture, original]);
  const cached = await readCache(key);
  if (cached) return cached;

  let response;
  try {
    response = await fetch(REWRITE_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: original, gesture }),
    });
  } catch (error) {
    throw new RewriteError(error.name === 'TimeoutError' ? '응답이 너무 늦습니다. 다시 시도해주세요.' : '말투 변환 서버에 연결하지 못했습니다.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.text) throw new RewriteError(data.error ?? `말투를 바꾸지 못했습니다. (${response.status})`);
  await writeCache(key, data.text);
  return data.text;
}
