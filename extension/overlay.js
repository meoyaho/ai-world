// 카메라가 켜져 있는 동안 웹페이지 우측 상단에 인식 화면을 띄운다. 제목줄을 끌어 옮길 수 있다.
// 페이지 스타일과 섞이지 않게 Shadow DOM 안에 만들고, 창을 눌러도 입력칸 포커스를 빼앗지 않는다.
(() => {
  if (window.__gesturePromptOverlay) return;
  window.__gesturePromptOverlay = true;

  const WIDTH = 240;
  const MARGIN = 16;

  const host = document.createElement('div');
  host.id = 'gesture-prompt-overlay';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .window {
        position: fixed; z-index: 2147483647; width: ${WIDTH}px;
        overflow: hidden; border-radius: 12px; background: #1d1d1f;
        box-shadow: 0 8px 28px rgba(0, 0, 0, .35), 0 0 0 1px rgba(255, 255, 255, .08);
        font: 600 12px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f5f5f7; user-select: none;
      }
      .bar { display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 6px 0 10px; cursor: grab; touch-action: none; }
      .window[data-dragging] .bar { cursor: grabbing; }
      .close { width: 22px; height: 22px; border: 0; border-radius: 6px; background: transparent; color: #a1a1a6; font: inherit; font-size: 15px; cursor: pointer; }
      .close:hover { background: rgba(255, 255, 255, .12); color: #fff; }
      /* 창 안의 화면은 보기 전용이라 클릭이 페이지로 지나가게 한다. */
      iframe { display: block; width: ${WIDTH}px; height: ${WIDTH * 0.75}px; border: 0; pointer-events: none; }
    </style>
    <div class="window" part="window">
      <div class="bar" title="끌어서 옮기기">
        <span>🖐 Gesture Prompt</span>
        <button class="close" type="button" title="카메라 끄기" aria-label="카메라 끄기">×</button>
      </div>
      <iframe title="손짓 인식 화면"></iframe>
    </div>`;

  const win = shadow.querySelector('.window');
  const bar = shadow.querySelector('.bar');
  const close = shadow.querySelector('.close');
  shadow.querySelector('iframe').src = chrome.runtime.getURL('preview.html');

  function place(left, top) {
    const maxLeft = Math.max(0, window.innerWidth - win.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - win.offsetHeight);
    win.style.left = `${Math.min(Math.max(0, left), maxLeft)}px`;
    win.style.top = `${Math.min(Math.max(0, top), maxTop)}px`;
  }

  // 기본 위치는 우측 상단. 사용자가 옮긴 위치는 오른쪽·위쪽 여백으로 기억해 창 크기가 달라도 비슷한 자리에 둔다.
  let offset = { right: MARGIN, top: MARGIN };
  const applyOffset = () => place(window.innerWidth - win.offsetWidth - offset.right, offset.top);

  window.addEventListener('resize', applyOffset);

  let drag = null;
  bar.addEventListener('pointerdown', (event) => {
    if (event.target === close) return;
    // 기본 동작을 막아야 입력칸에서 포커스가 빠지지 않는다.
    event.preventDefault();
    const rect = win.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    win.dataset.dragging = '';
    bar.setPointerCapture(event.pointerId);
  });
  bar.addEventListener('pointermove', (event) => {
    if (drag) place(event.clientX - drag.x, event.clientY - drag.y);
  });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    delete win.dataset.dragging;
    const rect = win.getBoundingClientRect();
    offset = { right: Math.round(window.innerWidth - rect.right), top: Math.round(rect.top) };
    chrome.storage.local.set({ overlayOffset: offset });
  };
  bar.addEventListener('pointerup', endDrag);
  bar.addEventListener('pointercancel', endDrag);

  close.addEventListener('pointerdown', (event) => event.preventDefault());
  close.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stop-camera' }));

  // 다른 탭에서 옮긴 위치도 따라간다.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.overlayOffset?.newValue && !drag) {
      offset = changes.overlayOffset.newValue;
      applyOffset();
    }
    if (changes.cameraOn && !changes.cameraOn.newValue) remove();
  });

  function remove() {
    host.remove();
    window.removeEventListener('resize', applyOffset);
    window.__gesturePromptOverlay = false;
  }

  chrome.storage.local.get(['cameraOn', 'overlayOffset']).then(({ cameraOn, overlayOffset }) => {
    if (!cameraOn) return remove();
    if (overlayOffset) offset = overlayOffset;
    (document.body ?? document.documentElement).append(host);
    applyOffset();
  });
})();
