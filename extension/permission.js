const result = document.getElementById('result');

document.getElementById('allow').addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());
  } catch {
    result.textContent = '권한이 거부되었습니다. 주소창 왼쪽의 사이트 설정에서 카메라를 허용한 뒤 다시 눌러주세요.';
    return;
  }
  result.textContent = '허용되었습니다. 카메라를 켭니다…';
  await chrome.runtime.sendMessage({ type: 'permission-granted' });
  setTimeout(() => window.close(), 800);
});
