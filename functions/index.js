// Gesture Prompt 확장이 부르는 중계 함수. OpenAI 키는 Secret Manager(OPENAI_API_KEY)에만 둔다.
import { onRequest } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { handleRewrite } from './handler.js';

const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

export const rewrite = onRequest(
  {
    region: 'asia-northeast3',
    secrets: [OPENAI_API_KEY],
    maxInstances: 2,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  (req, res) => handleRewrite(req, res, { apiKey: OPENAI_API_KEY.value() }),
);
