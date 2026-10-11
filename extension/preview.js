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
const liveVideo = document.getElementById('live');
const canvas = document.getElementById('landmarks');
const waiting = document.getElementById('waiting');
const readout = document.getElementById('readout');
const label = document.getElementById('label');
const holdBar = document.getElementById('hold');
const context = canvas.getContext('2d');
const decoder = new Image();

let port = null;
let peer = null;
let live = false;
let remoteReady = false;
let pendingIce = [];
let connectionTimer = null;
let pendingFrame = null;
let decoding = false;
let landmarkTimer = null;
let firedUntil = 0;
let firedText = '';
let lastStatus;
let notice = '';
let noticeUntil = 0;

function postSignal(connectedPort, message) {
  if (port !== connectedPort) return;
  try { connectedPort.postMessage(message); } catch (error) { console.debug('미리보기 연결이 닫혔습니다.', error); }
}

// 보고 있는 탭에서만 영상을 받는다. 숨은 탭까지 받으면 CPU를 낭비한다.
function connect() {
  if (port || document.visibilityState !== 'visible') return;
  const nextPort = chrome.runtime.connect({ name: 'preview' });
  port = nextPort;
  nextPort.onMessage.addListener((message) => {
    handleMessage(nextPort, message).catch((error) => {
      console.warn('실시간 미리보기를 연결하지 못했습니다.', error);
      stopLive(nextPort);
    });
  });
  nextPort.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;
    if (port !== nextPort) return;
    port = null;
    resetPeer();
    setTimeout(connect, 500);
  });
}

function disconnect() {
  const oldPort = port;
  port = null;
  resetPeer();
  oldPort?.disconnect();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') connect();
  else disconnect();
});

function resetPeer() {
  clearTimeout(connectionTimer);
  connectionTimer = null;
  clearTimeout(landmarkTimer);
  landmarkTimer = null;
  const oldPeer = peer;
  peer = null;
  oldPeer?.close();
  live = false;
  remoteReady = false;
  pendingIce = [];
  liveVideo.srcObject = null;
  liveVideo.style.visibility = 'hidden';
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function stopLive(connectedPort, notify = true) {
  if (live || peer) console.warn('실시간 영상 연결이 끊겨 JPEG 미리보기로 전환합니다.');
  resetPeer();
  if (notify) postSignal(connectedPort, { type: 'video-failed' });
}

async function startLive(connectedPort) {
  if (peer || typeof RTCPeerConnection === 'undefined') return;
  const connection = new RTCPeerConnection({ iceServers: [] });
  peer = connection;
  connection.onicecandidate = ({ candidate }) => {
    if (candidate && peer === connection) postSignal(connectedPort, { type: 'ice', candidate: candidate.toJSON() });
  };
  connection.ontrack = (event) => {
    if (peer !== connection) return;
    liveVideo.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    liveVideo.play().catch(() => {
      if (peer === connection) stopLive(connectedPort);
    });
    event.track.onended = () => {
      if (peer === connection) stopLive(connectedPort);
    };
  };
  connection.onconnectionstatechange = () => {
    if (peer !== connection) return;
    if (connection.connectionState === 'failed') stopLive(connectedPort);
    if (connection.connectionState === 'disconnected') {
      setTimeout(() => {
        if (peer === connection && connection.connectionState === 'disconnected') stopLive(connectedPort);
      }, 1000);
    }
  };
  connection.addTransceiver('video', { direction: 'recvonly' });
  await connection.setLocalDescription(await connection.createOffer());
  if (port !== connectedPort || peer !== connection) return;
  postSignal(connectedPort, { type: 'offer', sdp: connection.localDescription.sdp });
  connectionTimer = setTimeout(() => {
    if (peer === connection && !live) stopLive(connectedPort);
  }, 5000);
}

async function handleMessage(connectedPort, message) {
  if (port !== connectedPort) return;
  if (message.type === 'camera-ready') return startLive(connectedPort);
  if (message.type === 'answer' && peer) {
    const connection = peer;
    await connection.setRemoteDescription({ type: 'answer', sdp: message.sdp });
    if (peer !== connection) return;
    remoteReady = true;
    for (const candidate of pendingIce) await connection.addIceCandidate(candidate);
    pendingIce = [];
    return;
  }
  if (message.type === 'ice') {
    if (!peer) return;
    if (remoteReady) await peer.addIceCandidate(message.candidate);
    else pendingIce.push(message.candidate);
    return;
  }
  if (message.type === 'video-failed') return stopLive(connectedPort, false);
  if (message.type === 'detection' && live) return draw(message);
  if (message.type === 'jpeg' && !live) enqueue(message);
}

liveVideo.addEventListener('playing', () => {
  if (!peer || !port || live || !liveVideo.srcObject) return;
  live = true;
  console.info('실시간 카메라 미리보기가 연결되었습니다.');
  clearTimeout(connectionTimer);
  connectionTimer = null;
  pendingFrame = null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  liveVideo.style.visibility = 'visible';
  postSignal(port, { type: 'video-ready' });
});

// JPEG 디코딩이 늦어지면 중간 프레임을 버리고 최신 프레임만 그린다.
function enqueue(frame) {
  if (live) return;
  pendingFrame = frame;
  if (!decoding) decodeNext();
}

function decodeNext() {
  if (!pendingFrame) {
    decoding = false;
    return;
  }
  const frame = pendingFrame;
  pendingFrame = null;
  decoding = true;
  decoder.onload = () => {
    if (!live) draw(frame);
    decodeNext();
  };
  decoder.onerror = decodeNext;
  decoder.src = frame.image;
}

function draw(frame) {
  waiting.hidden = true;
  readout.hidden = false;

  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!live) {
    context.drawImage(decoder, 0, 0, width, height);
  }
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
  // 인식이 멈추면 실시간 화면에 마지막 관절 위치가 남지 않게 한다.
  clearTimeout(landmarkTimer);
  if (live && frame.hands.length) {
    landmarkTimer = setTimeout(() => {
      landmarkTimer = null;
      context.clearRect(0, 0, width, height);
    }, 250);
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
