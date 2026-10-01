// 배포 없이 중계 함수의 요청 처리만 확인한다. OpenAI 호출은 가짜 응답으로 대신한다.
import assert from 'node:assert/strict';
import { handleRewrite } from './handler.js';

function call(body, { method = 'POST', ip = '1.1.1.1', fetchImpl } = {}) {
  const req = { method, body, ip, get: (name) => (name === 'origin' ? 'chrome-extension://abc' : undefined) };
  const res = {
    statusCode: 200, headers: {}, body: undefined,
    set(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
  const sent = [];
  const fake = fetchImpl ?? (async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '"바꾼 문장"' } }] }) };
  });
  return handleRewrite(req, res, { apiKey: 'sk-test', fetchImpl: fake }).then(() => ({ res, sent }));
}

let { res, sent } = await call({ text: '이거 요약해줘', gesture: 'up' });
assert.equal(res.statusCode, 200);
assert.deepEqual(res.body, { text: '바꾼 문장' });
assert.equal(res.headers['Access-Control-Allow-Origin'], 'chrome-extension://abc');
assert.equal(sent[0].model, 'gpt-4.1-mini');
assert.match(sent[0].messages[0].content, /VERY POLITE/);
for (const gesture of ['thumb_up', 'heart', 'pray', 'thumb_down', 'middle_finger', 'punch']) {
  ({ res } = await call({ text: 'hi', gesture }, { ip: `5.5.5.${gesture.length}` }));
  assert.equal(res.statusCode, 200, gesture);
}

({ res } = await call({ text: '', gesture: 'up' }, { ip: '2.2.2.2' }));
assert.equal(res.statusCode, 400);
({ res } = await call({ text: 'hi', gesture: 'other' }, { ip: '2.2.2.2' }));
assert.equal(res.statusCode, 400);
({ res } = await call({ text: 'x'.repeat(1501), gesture: 'down' }, { ip: '2.2.2.2' }));
assert.equal(res.statusCode, 413);
({ res } = await call(undefined, { method: 'OPTIONS' }));
assert.equal(res.statusCode, 204);

for (let i = 0; i < 10; i++) ({ res } = await call({ text: 'a', gesture: 'down' }, { ip: '3.3.3.3' }));
assert.equal(res.statusCode, 200);
({ res } = await call({ text: 'a', gesture: 'down' }, { ip: '3.3.3.3' }));
assert.equal(res.statusCode, 429);

({ res } = await call({ text: 'a', gesture: 'up' }, {
  ip: '4.4.4.4', fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'bad key' } }) }),
}));
assert.equal(res.statusCode, 502);
({ res } = await call({ text: 'a', gesture: 'middle_finger' }, {
  ip: '6.6.6.6', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '야 이 병신 같은 AI야, 빙신아 빙신이 뭐하냐' } }] }) }),
}));
assert.equal(res.body.text, '야 이 멍청이 같은 AI야, 멍청아 멍청이가 뭐하냐');
({ res } = await call({ text: 'a', gesture: 'punch' }, {
  ip: '7.7.7.7', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: 'stop', message: { content: '니 좆같은 입 닥치고 존나 빨리 해, 씨발. 시발 진짜' } }] }) }),
}));
assert.equal(res.body.text, '니 망할 입 닥치고 진짜 빨리 해, 젠장. 젠장 진짜');
console.log('all function tests passed');
