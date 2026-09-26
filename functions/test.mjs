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
console.log('all function tests passed');
