// 보이지 않는 문서에서 카메라를 켜고 손짓을 인식해 서비스 워커에 알린다.
import { FilesetResolver, GestureRecognizer } from './vendor/vision_bundle.mjs';
import { PunchDetector, classifyPose } from './gestures.js';

const HOLD_MS = 700;
// 주먹 치기처럼 빠른 동작을 놓치지 않도록 초당 약 12번 본다.
const FRAME_INTERVAL_MS = 80;
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 240;

// MediaPipe는 전역 dbg가 있으면 진단 로그를 그리로 보낸다. 없으면 console.warn으로 찍어
// chrome://extensions에 오류처럼 쌓이므로, glog 등급(I/W/E/F)이 E·F일 때만 오류로 남긴다.
globalThis.dbg = (text) => {
  if (/^[EF]\d{4} /.test(text)) console.error(text);
  else console.debug(text);
};
// TensorFlow Lite는 "INFO: ..." 안내문을 stderr(console.error)로 찍는다.
const consoleError = console.error.bind(console);
console.error = (...args) => {
  if (typeof args[0] === 'string' && args[0].startsWith('INFO: ')) console.debug(...args);
  else consoleError(...args);
};

const video = document.getElementById('camera');
let recognizer;
let candidate = null;
let candidateSince = 0;
let armed = true;

// 팝업이 열려 있는 동안에만 인식 결과를 보낸다.
const previews = new Set();
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'preview') return;
  previews.add(port);
  port.onDisconnect.addListener(() => previews.delete(port));
});

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => {});
}

function status(state, text, extra = {}) {
  return send({ type: 'camera-status', state, status: text, ...extra });
}

async function start() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false,
    });
  } catch (error) {
    // offscreen 문서는 권한 요청 창을 띄울 수 없어 거부로 끝난다. 권한 페이지에서 한 번 허용받는다.
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return status('error', '카메라 권한이 필요합니다.', { needsPermission: true });
    }
    return status('error', `카메라를 열 수 없습니다. (${error.name})`);
  }
  // 카메라가 분리되거나 다른 프로그램이 가져가면 꺼진 상태로 알린다.
  stream.getVideoTracks()[0].addEventListener('ended', () => {
    status('error', '카메라 연결이 끊겼습니다. 다시 켜주세요.');
  });
  video.srcObject = stream;
  await video.play();

  try {
    const fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
    recognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL('vendor/gesture_recognizer.task'),
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      // 하트와 두 손 모아 빌기는 두 손을 함께 봐야 한다.
      numHands: 2,
    });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    return status('error', `손짓 인식 모델을 불러오지 못했습니다. (${error.message})`);
  }
  await status('on', '카메라 켜짐 · 입력칸에 문장을 쓰고 손짓을 1초 유지하세요');
  tick();
}

function tick() {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      const frame = detect();
      const fired = observe(frame);
      publish(frame, fired).catch(() => {});
    } catch (error) {
      console.error(error);
    }
  }
  // 숨은 문서에서는 requestAnimationFrame이 돌지 않으므로 타이머를 쓴다.
  setTimeout(tick, FRAME_INTERVAL_MS);
}

const punches = new PunchDetector();

function detect() {
  const now = performance.now();
  const result = recognizer.recognizeForVideo(video, now);
  const hands = (result.landmarks ?? []).map((landmarks, index) => ({
    landmarks: landmarks.map(({ x, y }) => [x, y]),
    category: result.gestures?.[index]?.[0]?.categoryName ?? 'None',
    score: result.gestures?.[index]?.[0]?.score ?? 0,
  }));
  const aspect = video.videoWidth / video.videoHeight || 4 / 3;
  return {
    hands: hands.map((hand) => hand.landmarks),
    pose: classifyPose(hands, aspect),
    punch: punches.update(hands, now, aspect),
  };
}

// 정지 손짓은 HOLD_MS 동안 유지되면, 주먹 치기는 감지되는 즉시 서비스 워커에 알린다.
// 알린 손짓 이름을 돌려준다.
function observe({ pose, punch }) {
  if (punch) {
    candidate = null;
    send({ type: 'gesture', gesture: 'punch' });
    return 'punch';
  }
  const now = performance.now();
  if (pose === null) {
    candidate = null;
    armed = true;
  } else if (pose !== candidate) {
    candidate = pose;
    candidateSince = now;
    armed = true;
  } else if (armed && now - candidateSince >= HOLD_MS) {
    // 손을 내리거나 다른 손짓으로 바꿀 때까지 한 번만 입력한다.
    armed = false;
    send({ type: 'gesture', gesture: pose });
    return pose;
  }
  return null;
}

// 미리보기 창은 웹페이지 안에 있어 카메라를 직접 열 수 없으므로(사이트마다 권한을 묻게 된다),
// 인식에 쓰는 영상을 작은 JPEG로 줄여 함께 보낸다.
const snapshot = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
const snapshotContext = snapshot.getContext('2d');

async function publish(frame, fired) {
  if (!previews.size) return;
  const hold = candidate === null ? 0 : armed ? Math.min(1, (performance.now() - candidateSince) / HOLD_MS) : 1;
  snapshotContext.drawImage(video, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const blob = await snapshot.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const image = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
  const message = { hands: frame.hands, pose: frame.pose, hold, fired, image };
  for (const port of previews) port.postMessage(message);
}

start();
