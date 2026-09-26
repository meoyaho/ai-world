// 말투를 바꿔주는 Firebase 함수 주소. OpenAI 키는 함수 쪽(Secret Manager)에만 있으므로 비밀이 아니다.
// 배포 후 `firebase deploy` 출력에 나온 rewrite 함수 주소로 바꾼다.
export const REWRITE_URL = 'https://asia-northeast3-ai-world-f5f54.cloudfunctions.net/rewrite';
