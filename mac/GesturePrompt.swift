import AppKit
import AVFoundation
import ApplicationServices
import Vision

private enum Gesture: String {
    case up
    case down

    var symbol: String { self == .up ? "👍" : "👎" }
    var label: String { self == .up ? "엄지 올림" : "엄지 내림" }
}

// Vision은 손 관절 위치를 반환한다. 엄지가 위/아래로 뻗고 나머지 손가락이
// 접힌 경우만 받아들인다. 화면 좌표는 아래쪽이 0, 위쪽이 1이다.
private enum ThumbClassifier {
    static func classify(_ hand: VNHumanHandPoseObservation) -> Gesture? {
        func point(_ joint: VNHumanHandPoseObservation.JointName) -> CGPoint? {
            guard let found = try? hand.recognizedPoint(joint), found.confidence >= 0.45 else { return nil }
            return found.location
        }
        func distance(_ a: CGPoint, _ b: CGPoint) -> CGFloat {
            hypot(a.x - b.x, a.y - b.y)
        }
        guard let wrist = point(.wrist),
              let middleMCP = point(.middleMCP),
              let thumbMP = point(.thumbMP),
              let thumbIP = point(.thumbIP),
              let thumbTip = point(.thumbTip) else { return nil }

        let palmSize = distance(wrist, middleMCP)
        let dy = thumbTip.y - thumbMP.y
        let dx = thumbTip.x - thumbMP.x
        guard palmSize > 0.02,
              abs(dy) > palmSize * 0.7,
              abs(dy) > abs(dx) * 1.2,
              distance(thumbTip, thumbMP) > distance(thumbIP, thumbMP) * 1.35 else { return nil }

        let fingers: [(VNHumanHandPoseObservation.JointName,
                       VNHumanHandPoseObservation.JointName,
                       VNHumanHandPoseObservation.JointName)] = [
            (.indexMCP, .indexPIP, .indexTip),
            (.middleMCP, .middlePIP, .middleTip),
            (.ringMCP, .ringPIP, .ringTip),
            (.littleMCP, .littlePIP, .littleTip),
        ]
        let folded = fingers.filter { mcp, pip, tip in
            guard let m = point(mcp), let p = point(pip), let t = point(tip) else { return false }
            return distance(t, m) < distance(p, m) * 1.7
        }.count
        guard folded >= 3 else { return nil }
        return dy > 0 ? .up : .down
    }
}

private final class CameraDetector: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "gesture-prompt.capture")
    private var lastProcessed = CFAbsoluteTimeGetCurrent()
    private var configured = false
    var onGesture: ((Gesture?) -> Void)?

    func start() throws {
        if configured {
            captureQueue.async { [session] in session.startRunning() }
            return
        }
        guard let device = AVCaptureDevice.default(for: .video) else {
            throw NSError(domain: "GesturePrompt", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "카메라를 찾지 못했습니다."])
        }
        session.beginConfiguration()
        session.sessionPreset = .vga640x480
        let input = try AVCaptureDeviceInput(device: device)
        guard session.canAddInput(input) else {
            session.commitConfiguration()
            throw NSError(domain: "GesturePrompt", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "카메라 입력을 열 수 없습니다."])
        }
        session.addInput(input)
        let output = AVCaptureVideoDataOutput()
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: captureQueue)
        guard session.canAddOutput(output) else {
            session.commitConfiguration()
            throw NSError(domain: "GesturePrompt", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "카메라 영상을 읽을 수 없습니다."])
        }
        session.addOutput(output)
        session.commitConfiguration()
        configured = true
        captureQueue.async { [session] in session.startRunning() }
    }

    func stop() {
        captureQueue.async { [session] in session.stopRunning() }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        let now = CFAbsoluteTimeGetCurrent()
        guard now - lastProcessed >= 0.1 else { return }
        lastProcessed = now
        let request = VNDetectHumanHandPoseRequest()
        request.maximumHandCount = 1
        let handler = VNImageRequestHandler(cmSampleBuffer: sampleBuffer, orientation: .up)
        let gesture: Gesture?
        if (try? handler.perform([request])) != nil, let hand = request.results?.first {
            gesture = ThumbClassifier.classify(hand)
        } else {
            gesture = nil
        }
        DispatchQueue.main.async { [weak self] in self?.onGesture?(gesture) }
    }
}

private enum PromptEditor {
    static let upKey = "upInstruction"
    static let downKey = "downInstruction"
    static let defaultUp = "답변을 시작할 때 \"정말 감사합니다!\"라고 말하고, 전체적으로 지나치게 공손하고 굽신거리는 말투로 답해줘."
    static let defaultDown = "답변에 \"젠장\", \"이딴 건\" 같은 거친 표현을 섞고, 질문 내용을 신랄하게 깎아내리는 말투로 답해줘."

    static func instruction(for gesture: Gesture) -> String {
        let key = gesture == .up ? upKey : downKey
        let fallback = gesture == .up ? defaultUp : defaultDown
        return UserDefaults.standard.string(forKey: key)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? fallback
    }

    static func apply(_ gesture: Gesture) -> String {
        let instruction = instruction(for: gesture)
        guard !instruction.isEmpty else { return "추가 문구가 비어 있습니다." }
        guard AXIsProcessTrusted() else { return "접근성 권한이 필요합니다." }
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier != ProcessInfo.processInfo.processIdentifier else {
            return "설정 창을 닫고 입력창으로 돌아가세요."
        }
        // 운영체제가 실제로 키보드 입력을 전달하는 위치에 삽입한다.
        // 줄바꿈은 일부 CLI에서 전송 키로 취급될 수 있으므로 넣지 않는다.
        let suffix = " " + instruction
        guard let source = CGEventSource(stateID: .hidSystemState) else {
            return "키 입력 장치를 만들지 못했습니다."
        }
        for codeUnit in suffix.utf16 {
            var character = codeUnit
            guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
                  let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false) else {
                return "키 입력을 보낼 수 없습니다."
            }
            down.keyboardSetUnicodeString(stringLength: 1, unicodeString: &character)
            up.keyboardSetUnicodeString(stringLength: 1, unicodeString: &character)
            down.post(tap: .cghidEventTap)
            up.post(tap: .cghidEventTap)
        }
        return "\(gesture.symbol) 현재 입력 위치에 문구 추가 시도됨"
    }
}

private final class GesturePromptApp: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let detector = CameraDetector()
    private var cameraOn = false
    private var candidate: Gesture?
    private var candidateSince = CFAbsoluteTimeGetCurrent()
    private var armed = true
    private var cameraMenuItem = NSMenuItem()
    private var statusMenuItem = NSMenuItem()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "🖐"
        statusItem.button?.toolTip = "제스처 프롬프트"
        detector.onGesture = { [weak self] gesture in self?.observe(gesture) }
        let menu = NSMenu()
        statusMenuItem = NSMenuItem(title: "카메라 꺼짐", action: nil, keyEquivalent: "")
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())
        cameraMenuItem = NSMenuItem(title: "카메라 켜기", action: #selector(toggleCamera), keyEquivalent: "")
        cameraMenuItem.target = self
        menu.addItem(cameraMenuItem)
        let permissionItem = NSMenuItem(title: "접근성 권한 요청", action: #selector(requestAccessibility), keyEquivalent: "")
        permissionItem.target = self
        menu.addItem(permissionItem)
        let testUpItem = NSMenuItem(title: "👍 현재 입력창에 시험", action: #selector(testUp), keyEquivalent: "")
        testUpItem.target = self
        menu.addItem(testUpItem)
        let testDownItem = NSMenuItem(title: "👎 현재 입력창에 시험", action: #selector(testDown), keyEquivalent: "")
        testDownItem.target = self
        menu.addItem(testDownItem)
        let editItem = NSMenuItem(title: "손짓별 문구 설정…", action: #selector(editInstructions), keyEquivalent: "")
        editItem.target = self
        menu.addItem(editItem)
        menu.addItem(.separator())
        let quitItem = NSMenuItem(title: "종료", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)
        statusItem.menu = menu
    }

    private func observe(_ gesture: Gesture?) {
        guard cameraOn else { return }
        guard let gesture else {
            candidate = nil
            armed = true
            return
        }
        if candidate != gesture {
            candidate = gesture
            candidateSince = CFAbsoluteTimeGetCurrent()
            armed = true
            return
        }
        guard CFAbsoluteTimeGetCurrent() - candidateSince >= 0.7,
              armed else { return }
        armed = false
        applyToFocusedInput(gesture)
    }

    private func applyToFocusedInput(_ gesture: Gesture) {
        let message = PromptEditor.apply(gesture)
        statusMenuItem.title = message
        let app = NSWorkspace.shared.frontmostApplication?.bundleIdentifier ?? "없음"
        let diagnostic = "\(Date()) | \(message) | app=\(app) trusted=\(AXIsProcessTrusted())\n"
        try? diagnostic.write(to: URL(fileURLWithPath: "/private/tmp/gesture-prompt-diagnostic.txt"),
                              atomically: true, encoding: .utf8)
        if message.contains("추가 시도됨") {
            statusItem.button?.title = gesture.symbol
        }
    }

    @objc private func testUp() { testGesture(.up) }
    @objc private func testDown() { testGesture(.down) }

    private func testGesture(_ gesture: Gesture) {
        // 메뉴가 닫히고 원래 입력 위치가 다시 포커스를 받을 시간을 준다.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { [weak self] in
            self?.applyToFocusedInput(gesture)
        }
    }

    @objc private func toggleCamera() {
        if cameraOn {
            cameraOn = false
            detector.stop()
            cameraMenuItem.title = "카메라 켜기"
            statusMenuItem.title = "카메라 꺼짐"
            statusItem.button?.title = "🖐"
            candidate = nil
            armed = true
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: startCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted { self?.startCamera() }
                    else { self?.statusMenuItem.title = "카메라 권한이 거부되었습니다." }
                }
            }
        default: statusMenuItem.title = "시스템 설정에서 카메라 권한을 켜주세요."
        }
    }

    private func startCamera() {
        do {
            try detector.start()
            cameraOn = true
            cameraMenuItem.title = "카메라 끄기"
            statusMenuItem.title = "카메라 켜짐 · 손짓 대기 중"
        } catch {
            statusMenuItem.title = error.localizedDescription
        }
    }

    @objc private func requestAccessibility() {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let granted = AXIsProcessTrustedWithOptions(options)
        statusMenuItem.title = granted ? "접근성 권한이 있습니다." : "시스템 설정에서 접근성 권한을 허용해주세요."
    }

    @objc private func editInstructions() {
        let alert = NSAlert()
        alert.messageText = "손짓별 추가 문구"
        alert.informativeText = "엄지 올림과 내림에 붙일 문구를 수정하세요."
        alert.addButton(withTitle: "저장")
        alert.addButton(withTitle: "취소")
        let stack = NSStackView()
        stack.orientation = .vertical
        stack.spacing = 8
        let upLabel = NSTextField(labelWithString: "👍 엄지 올림")
        let upField = NSTextField(string: PromptEditor.instruction(for: .up))
        let downLabel = NSTextField(labelWithString: "👎 엄지 내림")
        let downField = NSTextField(string: PromptEditor.instruction(for: .down))
        upField.frame.size.width = 430
        downField.frame.size.width = 430
        [upLabel, upField, downLabel, downField].forEach(stack.addArrangedSubview)
        stack.frame = NSRect(x: 0, y: 0, width: 430, height: 96)
        alert.accessoryView = stack
        NSApp.activate(ignoringOtherApps: true)
        if alert.runModal() == .alertFirstButtonReturn {
            UserDefaults.standard.set(upField.stringValue, forKey: PromptEditor.upKey)
            UserDefaults.standard.set(downField.stringValue, forKey: PromptEditor.downKey)
            statusMenuItem.title = "문구가 저장되었습니다."
        }
    }

    @objc private func quit() {
        detector.stop()
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
private let delegate = GesturePromptApp()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
