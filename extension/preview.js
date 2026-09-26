// 웹페이지에 떠 있는 창 안에서 인식 화면을 보여준다. 영상과 결과는 offscreen 문서가 보낸다.
import { GESTURES } from './gestures.js';

// MediaPipe 손 관절 21개를 잇는 선
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
const TONE_LABELS = { up: '공손하게', down: '무례하게' };

const stage = document.getElementById('stage');
const frameImage = document.getElementById('frame');
const canvas = document.getElementById('landmarks');
const waiting = document.getElementById('waiting');
const readout = document.getElementById('readout');
const label = document.getElementById('label');
const holdBar = document.getElementById('hold');
const context = canvas.getContext('2d');

let port = null;
let firedUntil = 0;
let firedText = '';
let lastStatus;
let notice = '';
let noticeUntil = 0;

// 보고 있는 탭에서만 영상을 받는다. 숨은 탭까지 받으면 CPU를 낭비한다.
function connect() {
  if (port || document.visibilityState !== 'visible') return;
  port = chrome.runtime.connect({ name: 'preview' });
  port.onMessage.addListener(draw);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    port = null;
    setTimeout(connect, 500);
  });
}

function disconnect() {
  port?.disconnect();
  port = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') connect();
  else disconnect();
});

function draw(frame) {
  frameImage.src = frame.image;
  waiting.hidden = true;
  readout.hidden = false;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  const color = frame.pose ? '#34c759' : '#ffffff';
  context.lineWidth = 2.5;
  context.strokeStyle = color;
  context.fillStyle = color;
  for (const landmarks of frame.hands) {
    context.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      context.moveTo(landmarks[a][0] * width, landmarks[a][1] * height);
      context.lineTo(landmarks[b][0] * width, landmarks[b][1] * height);
    }
    context.stroke();
    for (const [x, y] of landmarks) {
      context.beginPath();
      context.arc(x * width, y * height, 3, 0, Math.PI * 2);
      context.fill();
    }
  }

  const now = performance.now();
  if (frame.fired) {
    const { symbol, label: name } = GESTURES[frame.fired];
    firedText = `${symbol} ${name} ✓ 말투를 바꾸는 중`;
    firedUntil = now + 1500;
  }
  let text;
  if (now < noticeUntil) text = notice;
  else if (now < firedUntil) text = firedText;
  else if (frame.pose) {
    const { symbol, label: name, tone } = GESTURES[frame.pose];
    text = `${symbol} ${name} → ${TONE_LABELS[tone]}`;
  } else if (frame.hands.length) text = '손 인식됨 · 손짓을 1초 유지하세요';
  else text = '손을 찾는 중…';

  label.textContent = text;
  holdBar.style.width = `${Math.round(frame.hold * 100)}%`;
  stage.dataset.gesture = frame.pose ?? '';
}

// 말투 변환 결과나 오류 안내를 3초 동안 표시줄에 띄운다.
function showStatus({ status = '' }) {
  const changed = lastStatus !== undefined && status !== lastStatus;
  lastStatus = status;
  if (!changed || /^카메라(를)? 켜/.test(status)) return;
  notice = status;
  noticeUntil = performance.now() + 3000;
  label.textContent = notice;
  waiting.textContent = notice;
}

chrome.storage.session.get('status').then(showStatus);
chrome.storage.session.onChanged.addListener(async (changes) => {
  if (changes.status) showStatus({ status: changes.status.newValue });
});

connect();
