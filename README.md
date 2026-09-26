# Gesture Prompt

카메라로 손짓을 인식해 Chrome 입력칸에 쓴 문장의 말투를 바꿔주는 확장 프로그램입니다. 엄지척이나 하트를 하면 매우 공손하게, 엄지 아래나 주먹질을 하면 매우 무례하게 다시 씁니다. 요청 내용은 그대로 두고 말투만 바꾸며, 메시지를 대신 전송하지는 않습니다. 프롬프트 말투가 AI 답변 정확도에 영향을 준다는 연구("Mind Your Tone", 2025)에서 착안했습니다.

## Chrome에서 가볍게 써보기

1. 터미널에서 이 repo 폴더로 이동해 `sh build-extension.sh`를 한 번 실행합니다. 손짓 인식 모델을 `extension/vendor/`에 받아옵니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위의 `개발자 모드`를 켭니다.
4. `압축해제된 확장 프로그램을 로드`를 누릅니다.
5. 이 repo의 `extension/` 폴더를 선택합니다.

빌드 없이 쓰려면 [Releases](https://github.com/meoyaho/ai-world/releases)에서 `GesturePrompt-chrome.zip`을 받아 압축을 풀고, 5번에서 그 폴더를 선택합니다.

Chrome 툴바의 `Gesture Prompt` 아이콘을 누르면 `카메라 켜기` 버튼이 있습니다. 단축키 `Alt+Shift+G`로도 켜고 끌 수 있습니다. 처음 켤 때는 카메라 권한 탭이 열리니 `카메라 허용하기`를 누릅니다. 카메라가 켜져 있는 동안 웹페이지 오른쪽 위에 인식 창이 떠서 카메라 화면, 인식된 손, 지금 손짓이 어떤 말투로 이어지는지를 보여줍니다. 인식 창은 제목줄을 끌어 옮길 수 있고, 옮긴 위치는 다른 탭에서도 유지됩니다. 인식 창의 `×`를 누르면 카메라가 꺼집니다.

입력칸에 문장을 쓴 채 손짓을 1초쯤 유지하면, 잠시 뒤 입력칸의 문장이 바뀝니다. 긍정 손짓 뒤에 부정 손짓을 하면 이미 바뀐 문장이 아니라 원래 문장을 기준으로 다시 바꿉니다.

- `매우 공손하게`: 👍 엄지척, 🫶 하트(한 손 손가락 하트 또는 두 손 하트), 🙏 두 손 모아 빌기
- `매우 무례하게`: 👎 엄지 아래, 🖕 가운데 손가락, 👊 주먹 치기(주먹을 카메라 쪽으로 빠르게 내밀거나 휘두르기, 1초 유지 없이 바로 동작)

카메라 영상은 기기 안에서만 손짓 인식에 쓰고 밖으로 보내지 않습니다. 말투를 바꿀 때만 입력칸의 문장이 말투 변환 서버를 거쳐 OpenAI로 전송됩니다. 문장은 지금 보고 있는 Chrome 탭의 입력칸에서만 바뀌고, 터미널이나 코드 편집기 같은 Chrome 밖의 데스크톱 앱에는 동작하지 않습니다.

## 안 될 때

- `chrome://extensions`, 새 탭, Chrome Web Store에서는 인식 창이 뜨지 않고 문장도 바뀌지 않습니다.
- 카메라를 켰는데 인식 창이 안 보이면 웹페이지를 새로고침합니다.
- 코드를 바꿨다면 `chrome://extensions`에서 `Gesture Prompt` 카드의 새로고침 아이콘을 누른 뒤 웹페이지도 새로고침합니다.
- `Gesture Prompt` 카드의 `세부정보`에서 `사이트 액세스`가 `모든 사이트에서`로 되어 있는지 확인합니다.
- 카메라 권한을 거부했다면 권한 탭의 주소창 왼쪽 사이트 설정에서 카메라를 허용한 뒤 다시 켭니다.
- 손짓을 하기 전에 문장을 쓸 입력칸을 한 번 클릭해 커서를 둡니다.
- 로컬 `file://` 페이지에서 테스트하려면 `Gesture Prompt` 카드의 `세부정보`에서 `파일 URL에 대한 액세스 허용`을 켭니다.

## 말투 변환 서버

OpenAI 키를 확장 안에 넣으면 누구나 꺼내 쓸 수 있어서, 키는 Firebase 함수(`functions/`)에만 둡니다. 확장은 문장과 말투(`up`/`down`)만 보내고, 말투 지시와 모델(`gpt-4.1-mini`)은 함수에 고정되어 있습니다. 한 번 바꿀 때 보통 0.4원 안팎이 들고, 1,500자 제한과 IP별 1분 10회 제한이 있습니다. 같은 문장을 같은 말투로 다시 바꾸면 요청하지 않고 저장된 결과를 씁니다.

처음 배포할 때는 Firebase 프로젝트를 `Blaze` 요금제로 바꾸고, OpenAI 대시보드에서 월 사용 한도를 정해 둔 뒤 다음을 실행합니다.

```sh
firebase functions:secrets:set OPENAI_API_KEY
cd functions && npm install && cd ..
firebase deploy --only functions
```

배포 출력에 나온 `rewrite` 함수 주소를 `extension/config.js`의 `REWRITE_URL`에 넣습니다. 로컬 Node가 22.12보다 오래되면 배포 중 `ERR_REQUIRE_ESM` 오류가 나니 Node를 올리거나 20.19 이상 버전으로 실행합니다. 첫 배포가 중간에 실패해 403이 나면 `gcloud run services add-iam-policy-binding rewrite --region asia-northeast3 --member=allUsers --role=roles/run.invoker`로 공개 호출 권한을 추가합니다.

## GitHub Pages

소개 페이지는 `docs/` 루트에 있습니다.

1. GitHub 저장소의 `Settings` -> `Pages`로 이동합니다.
2. `Source`를 `Deploy from a branch`로 설정합니다.
3. `Branch`는 `main`, 폴더는 `/docs`로 선택하고 저장합니다.
4. `main` 브랜치에 push하면 `https://meoyaho.github.io/ai-world/`에 배포됩니다.

소개 페이지의 다운로드 버튼은 최신 Release의 `GesturePrompt-chrome.zip`을 가리킵니다. `v0.2.0` 같은 버전 태그를 push하면 GitHub Actions가 ZIP을 만들어 Release 초안에 첨부하고, 확인 후 `Publish release`를 누르면 버튼이 동작합니다. 태그 버전은 `extension/manifest.json`의 `version`과 맞춥니다. Chrome 정책상 웹사이트에서 확장 프로그램을 바로 설치시킬 수는 없어서, 개발자 모드 없이 설치하게 하려면 나중에 Chrome Web Store에 등록한 링크를 연결하는 방식이 가장 깔끔합니다.

## 개발 확인

`sh build-extension.sh`는 MediaPipe 파일을 받고 `dist/GesturePrompt-chrome.zip`을 만듭니다. Chrome 확장은 외부 코드를 불러올 수 없어서 인식 모델을 확장 안에 넣습니다.

말투 변환 서버의 요청 처리는 다음 명령으로 확인할 수 있습니다.

```bash
cd functions && npm test
```
