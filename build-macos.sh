#!/bin/sh
set -eu
cd "$(dirname "$0")"
APP="build/GesturePrompt.app"
mkdir -p "$APP/Contents/MacOS" /private/tmp/gesture-prompt-module-cache
cp mac/Info.plist "$APP/Contents/Info.plist"
swiftc -module-cache-path /private/tmp/gesture-prompt-module-cache \
  -framework AppKit -framework AVFoundation -framework Vision -framework ApplicationServices \
  -o "$APP/Contents/MacOS/GesturePrompt" mac/GesturePrompt.swift
codesign --force --sign - "$APP"
echo "Built $APP"
