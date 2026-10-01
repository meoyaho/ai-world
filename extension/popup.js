// 팝업: 손짓 안내와 카메라 켜기/끄기. 인식 화면은 웹페이지 우측 상단 창(overlay.js)에 뜬다.

const toggle = document.getElementById('toggle');

function renderCamera({ cameraOn = false }) {
  toggle.textContent = cameraOn ? '카메라 끄기' : '카메라 켜기';
  toggle.classList.toggle('button--outline', cameraOn);
}

chrome.storage.session.get('cameraOn').then(renderCamera);
chrome.storage.session.onChanged.addListener(async () => {
  renderCamera(await chrome.storage.session.get('cameraOn'));
});

toggle.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'toggle-camera' }));
