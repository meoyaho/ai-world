// 중계 함수의 요청 처리. Firebase 없이도 시험할 수 있게 index.js와 분리한다.
// 확장은 {text, gesture}만 보낸다. 말투 지시와 모델은 여기 고정해 다른 용도로 쓰이지 않게 한다.

// nano보다 지시를 잘 따르는 저렴한 모델. 입력 $0.40, 출력 $1.60 / 100만 토큰, 1회 약 0.4원 (2026-09 기준)
const MODEL = 'gpt-4.1-mini';
const MAX_INPUT_CHARS = 1500;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

const STYLES = {
  up: {
    level: 'VERY POLITE',
    style: '극도로 공손하고 굽신거림. 상대를 한껏 높이고 조심스럽게 부탁하며 감사·사과를 문맥에 녹임.',
  },
  down: {
    level: 'VERY RUDE',
    style: '극도로 무례함. 깔보고 다그치는 반말, "젠장" 같은 가벼운 욕과 비아냥.',
  },
};

// 프롬프트 말투 연구("Mind Your Tone", 2025)처럼 요청 내용은 그대로 두고 말투 단계만 바꾼다.
// 비용을 줄이려고 지시문은 짧은 영어로 쓴다.
function systemPrompt({ level, style }) {
  return `The user wrote a message they will send to an AI assistant. Rewrite it so the same user says the same thing to the AI in a ${level} tone: ${style}
Rules: keep every request, condition, number, name, code and link; add nothing new. Keep it short: about the original length, at most 1.5x. Blend the tone into the sentence itself; no stock greetings or sign-offs. Same language and line breaks. Never use slurs about disability, race, gender or sexuality. Do not answer it. Output only the rewritten message.
Example "다음 문제를 풀어줘" → polite: "바쁘신데 정말 죄송하지만, 혹시 다음 문제를 풀어주실 수 있을까요?" / rude: "야, 이거 풀 줄은 아냐? 다음 문제나 똑바로 풀어봐."`;
}

// 인스턴스 안에서 IP별 요청 수를 센다. maxInstances를 작게 두어 전체 요청량도 함께 묶는다.
const hits = new Map();
function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > RATE_LIMIT.max;
}

export async function handleRewrite(req, res, { apiKey, fetchImpl = fetch }) {
  const origin = req.get('origin') ?? '';
  if (origin.startsWith('chrome-extension://')) res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받습니다.' });

  const { text, gesture } = req.body ?? {};
  const tone = STYLES[gesture];
  const original = typeof text === 'string' ? text.trim() : '';
  if (!tone || !original) return res.status(400).json({ error: '문장과 손짓이 필요합니다.' });
  if (original.length > MAX_INPUT_CHARS) {
    return res.status(413).json({ error: `${MAX_INPUT_CHARS}자까지만 바꿀 수 있습니다. 문장을 줄여주세요.` });
  }
  if (rateLimited(req.ip ?? 'unknown')) {
    return res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' });
  }

  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: systemPrompt(tone) }, { role: 'user', content: original }],
        // 말투를 바꾸면 길어지므로 원문 길이의 몇 배까지만 허용한다. (한국어는 대략 1~2자당 1토큰)
        max_completion_tokens: Math.min(2000, 200 + original.length * 4),
      }),
    });
  } catch {
    return res.status(504).json({ error: 'OpenAI 응답이 늦습니다. 다시 시도해주세요.' });
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('OpenAI error', response.status, data.error?.message);
    const error = response.status === 429 ? '요청이 많아 잠시 후 다시 시도해주세요.' : '말투를 바꾸지 못했습니다.';
    return res.status(502).json({ error });
  }
  const choice = data.choices?.[0];
  const output = choice?.message?.content?.trim();
  if (choice?.finish_reason === 'length') return res.status(502).json({ error: '답이 너무 길어 끊겼습니다. 문장을 줄여주세요.' });
  if (!output) return res.status(502).json({ error: '빈 답을 받았습니다.' });
  return res.json({ text: output.replace(/^"([\s\S]*)"$/, '$1') });
}

