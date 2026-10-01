// 팝업: 테마 두 가지와 카메라 켜기/끄기. 인식 화면은 웹페이지 우측 상단 창(overlay.js)에 뜬다.
import { THEMES, getTheme, setTheme } from './themes.js';

const toggle = document.getElementById('toggle');
const icon = document.getElementById('icon');
const name = document.getElementById('name');
const themeButtons = document.querySelectorAll('[data-theme]');

function renderCamera({ cameraOn = false }) {
  toggle.textContent = cameraOn ? '카메라 끄기' : '카메라 켜기';
  toggle.classList.toggle('button--outline', cameraOn);
}

function renderTheme(theme) {
  const current = THEMES[theme];
  icon.src = `${current.icon}32.png`;
  name.textContent = current.name;
  document.title = current.name;
  for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
}

chrome.storage.session.get('cameraOn').then(renderCamera);
chrome.storage.session.onChanged.addListener(async () => {
  renderCamera(await chrome.storage.session.get('cameraOn'));
});
getTheme().then(renderTheme);

toggle.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'toggle-camera' }));

// 이미 고른 테마를 다시 누르면 원래 이름(Gesture Prompt)으로 돌아간다.
for (const button of themeButtons) {
  button.addEventListener('click', async () => {
    const theme = button.getAttribute('aria-pressed') === 'true' ? 'default' : button.dataset.theme;
    await setTheme(theme);
    renderTheme(theme);
  });
}
