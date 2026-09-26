#!/bin/sh
# MediaPipe 손짓 인식 파일을 extension/vendor에 받고 설치용 ZIP을 만든다.
# Chrome 확장은 외부 코드를 불러올 수 없으므로 라이브러리와 모델을 확장 안에 넣는다.
set -eu
cd "$(dirname "$0")"

TASKS_VISION_VERSION="1.0.1"
MODEL_URL="https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
VENDOR="extension/vendor"

if [ ! -f "$VENDOR/.version-$TASKS_VISION_VERSION" ]; then
  rm -rf "$VENDOR"
  mkdir -p "$VENDOR/wasm"
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  (cd "$TMP" && npm pack --silent "@mediapipe/tasks-vision@$TASKS_VISION_VERSION" >/dev/null && tar xzf ./*.tgz)
  cp "$TMP/package/vision_bundle.mjs" "$VENDOR/"
  cp "$TMP/package/wasm/vision_wasm_internal.js" "$TMP/package/wasm/vision_wasm_internal.wasm" "$VENDOR/wasm/"
  curl -fsSL "$MODEL_URL" -o "$VENDOR/gesture_recognizer.task"
  touch "$VENDOR/.version-$TASKS_VISION_VERSION"
fi

mkdir -p dist
rm -f dist/GesturePrompt-chrome.zip
(cd extension && zip -qr -X ../dist/GesturePrompt-chrome.zip . -x '.*' -x '*/.*')
echo "Built dist/GesturePrompt-chrome.zip"
