using System.Runtime.InteropServices;

// 카메라 프로세스에서 호출한다. 새 창을 열지 않고 현재 키보드 입력 위치에 쓴다.
if (args.Length < 2 || (args[0] != "up" && args[0] != "down"))
{
    Console.Error.WriteLine("Usage: GesturePromptEditor up|down instruction");
    return 2;
}

var instruction = args[1].Trim();
if (instruction.Length == 0 || instruction.Length > 500 || instruction.Contains('\r') || instruction.Contains('\n'))
{
    Console.Error.WriteLine("문구는 줄바꿈 없는 1~500자여야 합니다.");
    return 2;
}

var result = FocusedPromptEditor.Apply(instruction);
Console.WriteLine(result.Message);
return result.Success ? 0 : 1;

internal static class FocusedPromptEditor
{
    internal record Result(bool Success, string Message);

    public static Result Apply(string instruction)
    {
        if (GetForegroundWindow() == IntPtr.Zero)
            return new(false, "현재 활성 창이 없습니다.");
        return TypeAtCursor(" " + instruction);
    }

    private static Result TypeAtCursor(string text)
    {
        // 줄바꿈이나 Enter를 넣지 않으므로 메시지를 자동 제출하지 않는다.
        var events = new List<INPUT>();
        foreach (var character in text)
        {
            events.Add(new INPUT { Type = 1, Keyboard = new KEYBDINPUT { Scan = character, Flags = 0x0004 } });
            events.Add(new INPUT { Type = 1, Keyboard = new KEYBDINPUT { Scan = character, Flags = 0x0004 | 0x0002 } });
        }
        var sent = SendInput((uint)events.Count, events.ToArray(), Marshal.SizeOf<INPUT>());
        return sent == events.Count
            ? new(true, "현재 입력 위치에 문구 추가 시도됨")
            : new(false, "키 입력이 차단되었습니다. 대상 앱의 권한을 확인해주세요.");
    }

    [StructLayout(LayoutKind.Explicit, Size = 40)]
    private struct INPUT
    {
        [FieldOffset(0)] public uint Type;
        [FieldOffset(8)] public KEYBDINPUT Keyboard;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort VirtualKey;
        public ushort Scan;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint count, INPUT[] inputs, int size);
}
