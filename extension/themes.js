// 팝업에서 고르는 테마. 툴바 아이콘과 확장 곳곳에 보이는 이름을 바꾼다.
// chrome://extensions에 보이는 이름은 manifest.json에 고정되어 바꿀 수 없다.
export const THEMES = {
  default: { name: 'Gesture Prompt', icon: 'icons/icon' },
  rules: { name: 'plz 지배 me', icon: 'icons/rules' },
  junk: { name: '일해라 ai', icon: 'icons/junk' },
};

const iconPaths = (prefix) => Object.fromEntries([16, 32, 48, 128].map((size) => [size, `${prefix}${size}.png`]));

export async function getTheme() {
  const { theme } = await chrome.storage.local.get('theme');
  return THEMES[theme] ? theme : 'default';
}

// 콘텐츠 스크립트(overlay.js)는 모듈을 쓸 수 없어, 고른 테마의 이름과 아이콘을 풀어서 함께 저장한다.
export async function setTheme(theme) {
  const { name, icon } = THEMES[theme];
  await chrome.storage.local.set({ theme, appearance: { name, icon: `${icon}32.png` } });
}

export async function applyActionTheme() {
  const { name, icon } = THEMES[await getTheme()];
  await chrome.action.setIcon({ path: iconPaths(icon) });
  await chrome.action.setTitle({ title: name });
}
