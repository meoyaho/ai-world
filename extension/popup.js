// 팝업에는 카메라 켜기/끄기 버튼만 둔다. 인식 화면은 웹페이지 우측 상단 창(overlay.js)에 뜬다.
const toggle = document.getElementById('toggle');

function render({ cameraOn = false }) {
  toggle.textContent = cameraOn ? '카메라 끄기' : '카메라 켜기';
  toggle.classList.toggle('button--outline', cameraOn);
}

chrome.storage.session.get('cameraOn').then(render);
chrome.storage.session.onChanged.addListener(async () => {
  render(await chrome.storage.session.get('cameraOn'));
});

toggle.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'toggle-camera' }));
