"""Windows 카메라를 백그라운드에서 감시하고 현재 키보드 입력 위치에 쓴다."""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


HERE = Path(__file__).resolve().parent
MODEL = HERE / "gesture_recognizer.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/"
    "gesture_recognizer/float16/1/gesture_recognizer.task"
)
EDITOR = HERE / "bin" / "Release" / "net8.0-windows" / "GesturePromptEditor.dll"
UP_TEXT = '답변을 시작할 때 "정말 감사합니다!"라고 말하고, 전체적으로 지나치게 공손하고 굽신거리는 말투로 답해줘.'
DOWN_TEXT = '답변에 "젠장", "이딴 건" 같은 거친 표현을 섞고, 질문 내용을 신랄하게 깎아내리는 말투로 답해줘.'


def main() -> int:
    parser = argparse.ArgumentParser(description="손짓으로 현재 입력창에 문구 추가")
    parser.add_argument("--camera", type=int, default=0, help="카메라 번호")
    args = parser.parse_args()

    if not EDITOR.exists():
        print("먼저 `dotnet build windows/GesturePromptEditor.csproj -c Release`를 실행하세요.", file=sys.stderr)
        return 1
    if not MODEL.exists():
        print("손짓 인식 모델을 받는 중입니다…")
        urllib.request.urlretrieve(MODEL_URL, MODEL)

    camera = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not camera.isOpened():
        print("카메라를 열 수 없습니다. --camera 번호와 Windows 카메라 권한을 확인하세요.", file=sys.stderr)
        return 1
    camera.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    camera.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

    options = vision.GestureRecognizerOptions(
        base_options=python.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.VIDEO,
        num_hands=1,
    )
    print("카메라 켜짐. 원하는 입력칸을 클릭하고 엄지를 0.7초 유지하세요. Ctrl+C로 종료합니다.")
    candidate = None
    candidate_since = 0.0
    armed = True
    start = time.monotonic()

    try:
        with vision.GestureRecognizer.create_from_options(options) as recognizer:
            while True:
                ok, frame = camera.read()
                if not ok:
                    print("카메라 프레임을 읽지 못했습니다.", file=sys.stderr)
                    return 1
                now = time.monotonic()
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = recognizer.recognize_for_video(image, int((now - start) * 1000))
                top = result.gestures[0][0] if result.gestures and result.gestures[0] else None
                gesture = top.category_name if top and top.score >= 0.65 and top.category_name in ("Thumb_Up", "Thumb_Down") else None

                if gesture is None:
                    candidate = None
                    armed = True
                elif gesture != candidate:
                    candidate = gesture
                    candidate_since = now
                    armed = True
                elif armed and now - candidate_since >= 0.7:
                    armed = False
                    instruction = UP_TEXT if gesture == "Thumb_Up" else DOWN_TEXT
                    command = ["dotnet", str(EDITOR), "up" if gesture == "Thumb_Up" else "down",
                               instruction]
                    completed = subprocess.run(
                        command,
                        capture_output=True,
                        text=True,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        check=False,
                    )
                    print(completed.stdout.strip() or completed.stderr.strip())
                time.sleep(0.05)
    except KeyboardInterrupt:
        print("카메라를 종료합니다.")
        return 0
    finally:
        camera.release()


if __name__ == "__main__":
    raise SystemExit(main())
