import { GESTURES } from './gestures.js';
import { RewriteError, rewriteTone } from './rewrite.js';

const OFFSCREEN_URL = 'offscreen.html';
let creatingOffscreen = null;

// 카메라 상태는 서비스 워커가 잠들었다 깨어나도 남도록 세션 저장소에 둔다.
// 웹페이지의 인식 창(overlay.js)은 세션 저장소를 읽을 수 없어 cameraOn만 local에도 적는다.
async function setState(patch) {
  await chrome.storage.session.set(patch);
  const { cameraOn } = await chrome.storage.session.get('cameraOn');
  await chrome.action.setBadgeBackgroundColor({ color: '#0066cc' });
  await chrome.action.setBadgeText({ text: cameraOn ? 'ON' : '' });
  const { cameraOn: shown } = await chrome.storage.local.get('cameraOn');
  if (Boolean(shown) !== Boolean(cameraOn)) {
    await chrome.storage.local.set({ cameraOn: Boolean(cameraOn) });
    await (cameraOn ? showOverlays() : hideOverlays());
  }
}

const OVERLAY_SCRIPT = { id: 'overlay', matches: ['<all_urls>'], js: ['overlay.js'], runAt: 'document_idle' };

// 새로 여는 페이지에는 등록된 콘텐츠 스크립트로, 이미 열린 탭에는 직접 넣어 인식 창을 띄운다.
async function showOverlays() {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY_SCRIPT.id] });
  if (!registered.length) await chrome.scripting.registerContentScripts([OVERLAY_SCRIPT]);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => chrome.scripting
    .executeScript({ target: { tabId: tab.id }, files: ['overlay.js'] })
    .catch(() => {})));
}

// 열린 창은 local의 cameraOn이 꺼지는 것을 보고 스스로 사라진다.
async function hideOverlays() {
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY_SCRIPT.id] });
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY_SCRIPT.id] });
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function startCamera() {
  if (await hasOffscreen()) return;
  await setState({ cameraOn: true, status: '카메라를 켜는 중…' });
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: '카메라 영상에서 엄지 손짓을 인식합니다.',
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function stopCamera(status = '카메라 꺼짐') {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  await setState({ cameraOn: false, status });
}

async function toggleCamera() {
  if (await hasOffscreen()) await stopCamera();
  else await startCamera();
}

// 페이지 안에서 실행된다. 외부 변수를 쓸 수 없으므로 필요한 도우미를 모두 안에 둔다.
// probe: 포커스된 입력칸과 그 안의 글을 찾는다. replace: 입력칸의 글 전체를 text로 바꾼다.
function pageAction(mode, text, expected) {
  const TEXT_TYPES = new Set(['text', 'search', 'url', 'email', 'tel']);
  let el = document.activeElement;
  while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
  const isField = el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && TEXT_TYPES.has(el.type));
  const editable = Boolean(el) && !el.disabled && !el.readOnly && (isField || el.isContentEditable);
  const read = () => (isField ? el.value : el.innerText);
  if (mode === 'probe') return { editable, focused: document.hasFocus(), text: editable ? read() : '' };
  if (!editable) return 'none';
  // 다시 쓰는 동안 사용자가 글을 고쳤으면 덮어쓰지 않는다.
  if (read().replace(/\s+/g, ' ').trim() !== expected) return 'changed';

  el.focus();
  if (isField) {
    el.select();
  } else {
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = el.ownerDocument.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // 여러 줄 글은 붙여넣기 이벤트로 넣어야 ChatGPT·Claude 같은 편집기가 줄바꿈을 제대로 받는다.
  if (!isField && text.includes('\n')) {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    el.dispatchEvent(paste);
    if (paste.defaultPrevented) return 'replaced';
  }
  // execCommand는 되돌리기 기록과 input 이벤트를 남기므로 React 같은 편집기도 변경을 인식한다.
  if (document.execCommand('insertText', false, text)) return 'replaced';
  if (isField) {
    el.setRangeText(text, 0, el.value.length, 'end');
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    return 'replaced';
  }
  return 'failed';
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

let rewriting = false;

async function rewriteActiveInput(gesture) {
  // 응답을 기다리는 동안 들어온 손짓은 무시한다.
  if (rewriting) return;
  rewriting = true;
  try {
    await rewriteOnce(gesture);
  } finally {
    rewriting = false;
    refreshBadge();
  }
}

async function rewriteOnce(gesture) {
  if (!GESTURES[gesture]) return;
  // 긍정 손짓(엄지척·하트·빌기)은 공손하게(up), 부정 손짓(엄지 아래·가운데 손가락·주먹)은 무례하게(down)
  const { symbol, tone } = GESTURES[gesture];
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) return report('활성 탭이 없습니다.');

  let probes;
  try {
    probes = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: pageAction,
      args: ['probe'],
    });
  } catch {
    // chrome:// 페이지나 웹 스토어처럼 확장이 접근할 수 없는 페이지
    return report('이 페이지에서는 글을 바꿀 수 없습니다.');
  }
  const candidates = probes.filter((probe) => probe.result?.editable);
  const target = candidates.find((probe) => probe.result.focused) ??
    candidates.find((probe) => probe.frameId === 0) ?? candidates[0];
  if (!target) return report('입력칸을 먼저 클릭하세요.');

  const current = target.result.text;
  if (!normalize(current)) return report('입력칸에 먼저 문장을 써주세요.');
  // 방금 바꾼 글에 다시 손짓하면 원래 문장을 기준으로 바꾼다. (👍 뒤 👎 전환)
  const { lastRewrite } = await chrome.storage.session.get('lastRewrite');
  const original = lastRewrite?.tabId === tab.id && normalize(lastRewrite.result) === normalize(current)
    ? lastRewrite.original
    : current;

  await chrome.action.setBadgeText({ text: '…' });
  await report(`${symbol} 말투를 바꾸는 중…`);
  let result;
  try {
    result = await rewriteTone(original, tone);
  } catch (error) {
    return report(error instanceof RewriteError ? error.message : `다시 쓰지 못했습니다. (${error.message})`);
  }

  // 메시지는 전송하지 않고 입력칸의 글만 바꾼다.
  let replaced;
  try {
    [replaced] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [target.frameId] },
      func: pageAction,
      args: ['replace', result, normalize(current)],
    });
  } catch {
    return report('페이지가 바뀌어 글을 넣지 못했습니다.');
  }
  if (replaced?.result === 'changed') return report('그사이 글이 바뀌어 덮어쓰지 않았습니다.');
  if (replaced?.result === 'none') return report('입력칸 포커스가 사라져 글을 넣지 못했습니다.');
  if (replaced?.result !== 'replaced') return report('이 입력칸의 글은 바꾸지 못했습니다.');
  await chrome.storage.session.set({ lastRewrite: { tabId: tab.id, original, result } });
  await flashBadge(symbol);
  return report(`${symbol} 말투를 바꿨습니다. 확인 후 전송하세요.`);
}

async function report(status) {
  await chrome.storage.session.set({ status });
}

async function flashBadge(symbol) {
  await chrome.action.setBadgeText({ text: symbol });
  setTimeout(refreshBadge, 1500, true);
}

// 기다림 표시(…)나 손짓 표시를 카메라 상태 배지로 되돌린다.
async function refreshBadge(force = false) {
  if (!force && (await chrome.action.getBadgeText({})) !== '…') return;
  const { cameraOn } = await chrome.storage.session.get('cameraOn');
  await chrome.action.setBadgeText({ text: cameraOn ? 'ON' : '' });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handle = async () => {
    switch (message.type) {
      case 'toggle-camera':
        return toggleCamera();
      case 'stop-camera':
        return stopCamera();
      case 'gesture':
        return rewriteActiveInput(message.gesture);
      case 'camera-status':
        if (message.needsPermission) {
          await stopCamera('카메라 권한이 필요합니다. 열린 탭에서 허용해주세요.');
          await chrome.tabs.create({ url: 'permission.html' });
          return;
        }
        if (message.state === 'error') return stopCamera(message.status);
        return setState({ cameraOn: true, status: message.status });
      case 'permission-granted':
        return startCamera();
    }
  };
  handle().then(() => sendResponse({ ok: true }), (error) => sendResponse({ ok: false, error: String(error) }));
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-camera') toggleCamera();
});

// 브라우저를 다시 열면 offscreen 문서가 없으므로 상태를 초기화한다.
chrome.runtime.onStartup.addListener(() => stopCamera());
chrome.runtime.onInstalled.addListener(() => stopCamera());
