// 중계 함수의 요청 처리. Firebase 없이도 시험할 수 있게 index.js와 분리한다.
// 확장은 {text, gesture}만 보낸다. 말투 지시와 모델은 여기 고정해 다른 용도로 쓰이지 않게 한다.

// nano보다 지시를 잘 따르는 저렴한 모델. 입력 $0.40, 출력 $1.60 / 100만 토큰, 1회 약 0.4원 (2026-09 기준)
const MODEL = 'gpt-4.1-mini';
const MAX_INPUT_CHARS = 1500;
const RATE_LIMIT = { windowMs: 60_000, max: 10 };

// 손짓마다 말투를 다르게 한다. 긍정 손짓은 공손한 쪽, 부정 손짓은 무례한 쪽이다.
// 설명에 문구를 넣으면 모델이 그대로 붙여 써서 어색해지므로, 설명은 태도만 적고 예시 문장을 따로 준다.
const STYLES = {
  thumb_up: {
    level: 'VERY POLITE',
    style: '밝고 공손한 존댓말. 상대 실력을 믿고 기대한다는 마음이 자연스럽게 묻어나게 부탁함.',
    example: '이런 건 정말 잘하시잖아요. 다음 문제도 한번 풀어주실 수 있을까요?',
  },
  heart: {
    level: 'VERY POLITE',
    style: '애정이 넘치는 다정한 말투. 좋아하는 사람에게 말하듯 고마움과 애정을 담아 부탁함.',
    example: '늘 도와줘서 너무 고마워요. 이번에도 다음 문제 같이 풀어줄래요? 진짜 믿고 있어요!',
  },
  pray: {
    level: 'VERY POLITE',
    style: '두 손 모아 비는 듯 극도로 간절하고 굽신거리는 존댓말. 제발 한 번만 도와달라고 애원함.',
    example: '제발 부탁드려요… 다음 문제만 풀어주시면 이 은혜 절대 안 잊을게요. 한 번만 도와주세요.',
  },
  thumb_down: {
    level: 'RUDE',
    style: '한심하다는 듯 실망하고 비꼬는 반말. 기대도 안 한다는 냉소가 섞임.',
    example: '하아… 기대도 안 하지만 다음 문제나 풀어봐. 이번엔 좀 제대로 하고.',
  },
  middle_finger: {
    level: 'EXTREMELY RUDE',
    style: 'AI를 쓸모없는 고철 취급하며 모욕을 쏟아내는 반말. 욕은 젠장·제기랄·망할 수준.',
    example: '야 이 쓸모없는 고철아, 이것도 못 하냐? 다음 문제나 똑바로 풀어, 제기랄.',
  },
  punch: {
    level: 'EXTREMELY RUDE',
    style: '분노가 폭발한 반말. 다그치며, 이번에도 못 하면 다른 AI로 갈아타거나 지워버리겠다고 협박함.',
    example: '야! 다음 문제 당장 풀어. 이번에도 틀리면 바로 다른 AI로 갈아탄다, 알겠어?',
  },
};
// 프롬프트로 막아도 모델이 가끔 쓰는 심한 욕과 비하어는 돌려주기 전에 순한 말로 바꾼다.
// 조사가 어색해지지 않게 부르는 말("병신아")은 "멍청아", 주어("병신이 ")는 "멍청이가"로 바꾼다.
const REPLACEMENTS = [
  [/(?:[병빙븅]신|애자|정신병자|찐따)(?:([아야])|(이)(?=[\s,.!?]))?|장애인/g,
    (_, vocative, subject) => (vocative ? '멍청아' : subject ? '멍청이가' : '멍청이')],
  [/[씨시쒸][발빨벌바팔]|ㅅㅂ|ㅆㅂ/g, '젠장'],
  [/(?:좆|존)나게?/g, '진짜'],
  [/좆같[은이]|좆 같은/g, '망할'],
  [/좆/g, '망할'],
];
const cleanProfanity = (text) => REPLACEMENTS.reduce((result, [pattern, to]) => result.replace(pattern, to), text);

// 예전 확장은 말투만 보냈으므로 그대로 받아준다.
STYLES.up = STYLES.thumb_up;
STYLES.down = STYLES.middle_finger;

// 프롬프트 말투 연구("Mind Your Tone", 2025)처럼 요청 내용은 그대로 두고 말투 단계만 바꾼다.
// 비용을 줄이려고 지시문은 짧은 영어로 쓴다.
function systemPrompt({ level, style, example }) {
  return `The user wrote a message they will send to an AI assistant. Rewrite it so the same user says the same thing to the AI in a ${level} tone: ${style}
Rules: keep every request, condition, number, name, code and link; add nothing new. If the message already has tone words from an earlier rewrite (insults, swearing, threats, flattery, pleading), drop them and apply only the new tone. Keep it short: at most 2x the original length.
It must sound like something a Korean native speaker would actually say: one natural flow, not a pile of stock phrases (no awkward combos like "역시 최고시니까 죄송하지만"). Don't copy the example's wording; fit the tone to this message. Put any swearing in how the user addresses the AI or in separate clauses and keep the request part grammatical (never jam swear words into what is being asked, e.g. not "뭔 개소리 먹을지"). Same language and line breaks.
Insults target only the AI; never use slurs about disability, race, gender or sexuality, and no profanity stronger than 젠장·제기랄·망할. Do not answer it. Output only the rewritten message.
Example of this tone for "다음 문제를 풀어줘": "${example}"`;
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
  return res.json({ text: cleanProfanity(output.replace(/^"([\s\S]*)"$/, '$1')) });
}

