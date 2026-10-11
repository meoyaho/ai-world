// 보이지 않는 문서에서 카메라를 켜고 손짓을 인식해 서비스 워커에 알린다.
import { FilesetResolver, GestureRecognizer } from './vendor/vision_bundle.mjs';
import { PunchDetector, classifyPose } from './gestures.js';

const HOLD_MS = 700;
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
let recognizerDelegate;
let fileset;
let recoveringRecognizer = false;
let candidate = null;
let candidateSince = 0;
let armed = true;
let publishing = false;
let pendingFired = null;
let cameraStream = null;
let cameraReadyForPreview = false;

// 영상은 WebRTC로 직접 보내고, 확장 메시지는 연결 신호와 손짓 결과에만 쓴다.
const previews = new Map();
function postPreview(port, message) {
  try { port.postMessage(message); } catch (error) { console.debug('미리보기 연결이 닫혔습니다.', error); }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'preview') return;
  const viewer = { live: false, peer: null, remoteReady: false, pendingIce: [], signaling: Promise.resolve() };
  previews.set(port, viewer);
  port.onMessage.addListener((message) => {
    viewer.signaling = viewer.signaling.then(() => handlePreviewSignal(port, viewer, message)).catch((error) => {
      console.warn('실시간 미리보기를 연결하지 못했습니다.', error);
      viewer.live = false;
      viewer.peer?.close();
      viewer.peer = null;
      viewer.remoteReady = false;
      viewer.pendingIce = [];
      if (previews.has(port)) {
        postPreview(port, { type: 'video-failed' });
      }
    });
  });
  port.onDisconnect.addListener(() => {
    viewer.peer?.close();
    previews.delete(port);
  });
  if (cameraReadyForPreview) postPreview(port, { type: 'camera-ready' });
});

async function handlePreviewSignal(port, viewer, message) {
  if (!previews.has(port)) return;
  if (message.type === 'video-ready') {
    viewer.live = true;
    return;
  }
  if (message.type === 'video-failed') {
    viewer.live = false;
    viewer.peer?.close();
    viewer.peer = null;
    viewer.remoteReady = false;
    viewer.pendingIce = [];
    return;
  }
  if (message.type === 'ice') {
    if (viewer.peer && viewer.remoteReady) await viewer.peer.addIceCandidate(message.candidate);
    else viewer.pendingIce.push(message.candidate);
    return;
  }
  if (message.type !== 'offer' || !cameraStream) return;

  viewer.peer?.close();
  const peer = new RTCPeerConnection({ iceServers: [] });
  viewer.peer = peer;
  viewer.live = false;
  viewer.remoteReady = false;
  peer.onicecandidate = ({ candidate }) => {
    if (candidate && viewer.peer === peer && previews.has(port)) {
      postPreview(port, { type: 'ice', candidate: candidate.toJSON() });
    }
  };
  peer.onconnectionstatechange = () => {
    if (viewer.peer === peer && (peer.connectionState === 'failed' || peer.connectionState === 'disconnected')) {
      viewer.live = false;
    }
  };
  const sender = peer.addTrack(cameraStream.getVideoTracks()[0], cameraStream);
  const parameters = sender.getParameters();
  if (parameters.encodings?.length) {
    parameters.encodings[0].scaleResolutionDownBy = 2;
    sender.setParameters(parameters).catch(() => {});
  }
  await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp });
  viewer.remoteReady = true;
  for (const candidate of viewer.pendingIce) await peer.addIceCandidate(candidate);
  viewer.pendingIce = [];
  await peer.setLocalDescription(await peer.createAnswer());
  if (previews.has(port)) postPreview(port, { type: 'answer', sdp: peer.localDescription.sdp });
}

function send(message) {
  return chrome.runtime.sendMessage(message).catch(() => {});
}

function status(state, text, extra = {}) {
  return send({ type: 'camera-status', state, status: text, ...extra });
}

function createRecognizer(delegate) {
  return GestureRecognizer.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: chrome.runtime.getURL('vendor/gesture_recognizer.task'),
      delegate,
    },
    runningMode: 'VIDEO',
    // 하트와 두 손 모아 빌기는 두 손을 함께 봐야 한다.
    numHands: 2,
  });
}

async function start() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, frameRate: { ideal: 30 } },
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
  cameraStream = stream;

  try {
    fileset = await FilesetResolver.forVisionTasks(chrome.runtime.getURL('vendor/wasm'));
    try {
      recognizer = await createRecognizer('GPU');
      recognizerDelegate = 'GPU';
    } catch (error) {
      console.warn('GPU 손짓 인식을 사용할 수 없어 CPU로 전환합니다.', error);
      recognizer = await createRecognizer('CPU');
      recognizerDelegate = 'CPU';
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    return status('error', `손짓 인식 모델을 불러오지 못했습니다. (${error.message})`);
  }
  await status('on', '카메라 켜짐 · 입력칸에 문장을 쓰고 손짓을 1초 유지하세요');
  cameraReadyForPreview = true;
  for (const port of previews.keys()) postPreview(port, { type: 'camera-ready' });
  tick();
}

// JPEG 대체 화면을 보낼 때만 한 프레임을 복사해 좌표와 영상의 시점을 맞춘다.
const recognitionFrame = document.createElement('canvas');
const recognitionContext = recognitionFrame.getContext('2d');

function recoverOnCpu(error) {
  if (recognizerDelegate !== 'GPU' || recoveringRecognizer) {
    console.error(error);
    return;
  }
  recoveringRecognizer = true;
  console.warn('GPU 손짓 인식이 중단되어 CPU로 전환합니다.', error);
  const failedRecognizer = recognizer;
  recognizer = null;
  try { failedRecognizer.close(); } catch (closeError) { console.warn(closeError); }
  createRecognizer('CPU').then((cpuRecognizer) => {
    recognizer = cpuRecognizer;
    recognizerDelegate = 'CPU';
    candidate = null;
    armed = true;
    punches.history = [];
  }).catch((fallbackError) => {
    console.error(fallbackError);
    status('error', '손짓 인식 모델을 다시 불러오지 못했습니다.');
  }).finally(() => { recoveringRecognizer = false; });
}

function tick() {
  if (recognizer && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    try {
      const jpegNeeded = [...previews.values()].some((viewer) => !viewer.live);
      const captureForJpeg = jpegNeeded && !publishing;
      let imageSource = video;
      if (captureForJpeg) {
        if (recognitionFrame.width !== video.videoWidth || recognitionFrame.height !== video.videoHeight) {
          recognitionFrame.width = video.videoWidth;
          recognitionFrame.height = video.videoHeight;
        }
        recognitionContext.drawImage(video, 0, 0);
        imageSource = recognitionFrame;
      }
      let frame;
      try { frame = detect(imageSource); } catch (error) { recoverOnCpu(error); }
      if (frame) {
        const fired = observe(frame);
        const message = describeFrame(frame, fired);
        for (const [port, viewer] of previews) {
          if (viewer.live) postPreview(port, { type: 'detection', ...message });
        }
        if (jpegNeeded) {
          if (fired) pendingFired = fired;
          if (captureForJpeg) {
            publishing = true;
            const previewMessage = { ...message, fired: pendingFired };
            pendingFired = null;
            // WebRTC 연결 전이나 연결 실패 시에만 같은 프레임의 JPEG를 보낸다.
            publishJpeg(imageSource, previewMessage)
              .catch((error) => console.error(error))
              .finally(() => { publishing = false; });
          }
        } else pendingFired = null;
      }
    } catch (error) {
      console.error(error);
    }
  }
  // 숨은 문서에서는 requestAnimationFrame이 돌지 않으므로 타이머를 쓴다.
  setTimeout(tick, FRAME_INTERVAL_MS);
}

const punches = new PunchDetector();

function detect(image) {
  const now = performance.now();
  const result = recognizer.recognizeForVideo(image, now);
  const hands = (result.landmarks ?? []).map((landmarks, index) => ({
    landmarks: landmarks.map(({ x, y }) => [x, y]),
    category: result.gestures?.[index]?.[0]?.categoryName ?? 'None',
    score: result.gestures?.[index]?.[0]?.score ?? 0,
  }));
  const aspect = (image.videoWidth ?? image.width) / (image.videoHeight ?? image.height) || 4 / 3;
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

function describeFrame(frame, fired) {
  const hold = candidate === null ? 0 : armed ? Math.min(1, (performance.now() - candidateSince) / HOLD_MS) : 1;
  return { hands: frame.hands, pose: frame.pose, hold, fired };
}

// WebRTC가 연결되기 전에는 같은 프레임을 작은 JPEG로 보내 미리보기를 유지한다.
const snapshot = new OffscreenCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
const snapshotContext = snapshot.getContext('2d');

async function publishJpeg(imageSource, message) {
  snapshotContext.drawImage(imageSource, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
  const blob = await snapshot.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  for (const [port, viewer] of previews) {
    if (!viewer.live) postPreview(port, { type: 'jpeg', ...message, image });
  }
}

start();
