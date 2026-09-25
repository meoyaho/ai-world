# Gesture Prompt

카메라로 엄지 올림과 내림을 인식해 현재 키보드 포커스가 있는 입력칸에 문구를 추가합니다. 이미 전송한 메시지는 바꾸지 않고, 문구를 자동 전송하지도 않습니다.

## 사용자 다운로드

배포 후에는 [다운로드 페이지](https://meoyaho.github.io/ai-world/)에서 운영체제에 맞는 파일을 받습니다. Mac은 ZIP을 풀어 `GesturePrompt.app`을 열고, Windows는 `GesturePrompt-Windows.exe`를 더블클릭합니다. 사용자는 소스 코드 폴더를 받거나 터미널 명령어를 실행할 필요가 없습니다.

- **Mac:** 메뉴 막대의 🖐 아이콘에서 **접근성 권한 요청**을 눌러 허용하고 **카메라 켜기**를 선택합니다. 원하는 입력칸을 클릭한 채 엄지를 약 1초 유지합니다. **손짓별 문구 설정…**에서 문구를 바꿀 수 있습니다.
- **Windows:** EXE를 더블클릭하고 카메라 권한을 허용합니다. 원하는 입력칸을 클릭한 채 엄지를 약 1초 유지합니다. 열려 있는 콘솔 창을 닫으면 카메라가 종료됩니다.

모든 앱에 키 입력을 보내는 방식이므로 코드 편집기처럼 다른 곳에 커서가 있으면 그곳에 문구가 들어갈 수 있습니다. 운영체제가 입력칸 정보를 노출하지 않는 앱도 있어, 프로그램은 현재 포커스가 텍스트 입력칸인지 항상 확인하지는 못합니다. 카메라 영상은 기기에서 손짓을 인식하는 데 사용합니다.

## 저장소에서 다운로드 파일 만들기

1. [Settings → Pages](https://github.com/meoyaho/ai-world/settings/pages)에서 **Deploy from a branch**, **main**, **/docs**를 선택해 다운로드 페이지를 켭니다.
2. `main`에 변경 사항이 올라오면 [Actions → Build download files](https://github.com/meoyaho/ai-world/actions/workflows/build-downloads.yml)에서 Mac과 Windows 빌드가 자동으로 실행됩니다.
3. `v0.1.0` 같은 버전 태그를 저장소에 올리면 다운로드 파일을 다시 빌드하고 [Releases](https://github.com/meoyaho/ai-world/releases)에 초안으로 첨부합니다. 파일을 확인한 뒤 **Publish release**를 누르면 다운로드 버튼이 작동합니다.

이 작업은 GitHub의 빌드 컴퓨터에서 Mac 앱 두 종류와 Windows 단일 EXE를 만듭니다. Windows 사용자에게 Python 또는 .NET 설치를 요구하지 않습니다. Windows 빌드는 묶음 안의 손짓 모델이 열리는 것까지 자동 확인합니다. 실제 Windows 카메라와 다른 앱 입력은 별도 Windows 기기에서 확인해야 합니다.

현재 Mac 빌드는 개발용 임시 서명이고 Windows EXE도 서명되지 않았습니다. 따라서 초기 시험판 다운로드에는 운영체제 확인 경고가 나올 수 있습니다. 일반 공개 전에 Mac은 Developer ID 서명과 공증, Windows는 신뢰할 수 있는 코드 서명을 추가해야 합니다. 지금 저장소에는 배포용 서명 인증서가 설정되어 있지 않습니다.

## 개발자용 로컬 실행

macOS에서 소스를 수정해 시험할 때만 다음 명령을 사용합니다.

```sh
sh build-macos.sh
open build/GesturePrompt.app
```

다시 빌드한 후 손쉬운 사용 권한을 켰는데도 권한 오류가 지속되면 `tccutil reset Accessibility com.example.gestureprompt`로 이 앱의 권한 기록을 초기화하고 새 권한 요청을 허용합니다.

Windows 소스 코드는 `windows/camera.py`입니다. GitHub Actions가 Python, MediaPipe, OpenCV, 손짓 모델을 하나의 EXE에 묶습니다.
