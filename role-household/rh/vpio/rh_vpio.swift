// 角色小家的系统语音处理辅助进程：收音和本机喇叭播放都走 macOS 的 voice processing（AVAudioEngine，FaceTime 那套回声消除）。
// 系统知道自己正在往喇叭放什么，用它把回声从麦克风里减掉；别的 app 放的声音（比如用户的说话声）不算回声。
// 由 rh/vpio.py 编译、启动、读写，协议：
//   stdout：一帧一帧，1 字节类型 + 4 字节小端长度 + 内容。类型 'A' = 16 kHz 单声道 16 位麦克风 PCM（已做回声消除）；
//           'E' = 一行 JSON 事件：ready / done(id) / stopped(id) / error。
//   stdin：一行 JSON 命令。{"cmd":"play","id":N,"sr":采样率,"bytes":L} 后面紧跟 L 字节 16 位单声道 PCM；{"cmd":"stop"}。
//   stderr：日志。
// 设备变了（拔耳麦、换默认输出）引擎会停，这时报 error 退出，由 Python 那边重开。
import AVFoundation
import Foundation


let outLock = NSLock()
func emit(_ kind: UInt8, _ payload: Data) {
    outLock.lock(); defer { outLock.unlock() }
    var head = Data([kind])
    var n = UInt32(payload.count).littleEndian
    head.append(Data(bytes: &n, count: 4))
    FileHandle.standardOutput.write(head + payload)
}
func event(_ obj: [String: Any]) {
    emit(UInt8(ascii: "E"), try! JSONSerialization.data(withJSONObject: obj))
}
func logErr(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }
func fail(_ s: String) -> Never { event(["ev": "error", "msg": s]); logErr(s); exit(1) }

let args = CommandLine.arguments
let probe = args.contains("--probe")   // 每秒打各输入声道音量（只用来确认哪个声道是处理后的人声）
let noDuck = !args.contains("--duck")  // 默认把对别的 app 的压音量设到最小

let engine = AVAudioEngine()
let input = engine.inputNode
do { try input.setVoiceProcessingEnabled(true) } catch { fail("开不了系统语音处理：\(error)") }
var duckInfo: [String: Any] = [:]
if #available(macOS 14.0, *), noDuck {
    // 用户没要求压别的 app 的音量：关掉高级压音、压音程度设最小（系统不提供完全不压的选项）。
    input.voiceProcessingOtherAudioDuckingConfiguration =
        AVAudioVoiceProcessingOtherAudioDuckingConfiguration(enableAdvancedDucking: false, duckingLevel: .min)
    let c = input.voiceProcessingOtherAudioDuckingConfiguration
    duckInfo = ["advanced": c.enableAdvancedDucking.boolValue, "level": Int(c.duckingLevel.rawValue)]
}
let inFmt = input.outputFormat(forBus: 0)
// 处理后的人声在第 0 声道（--probe 实测，见 rh/vpio.py 注释）
let micMono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: inFmt.sampleRate, channels: 1, interleaved: false)!
let out16 = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
guard let micConv = AVAudioConverter(from: micMono, to: out16) else { fail("建不了收音格式转换") }

// 播放：一个 player 接主混音；主混音 -> 输出用 48 kHz 立体声（不显式连，启动时 kAUInitialize 报 -10875，2026-10-19 实测）
let player = AVAudioPlayerNode()
let playFmt = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
engine.attach(player)
engine.connect(player, to: engine.mainMixerNode, format: playFmt)
engine.connect(engine.mainMixerNode, to: engine.outputNode,
               format: AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!)

var probeSum = [Double](repeating: 0, count: Int(inFmt.channelCount)), probeN = 0, probeT = Date()
// bufferSize 是建议值，系统常按 100 毫秒左右一块给。来源：实现者定（越小延迟越低）。
input.installTap(onBus: 0, bufferSize: 1600, format: inFmt) { buf, _ in
    let n = Int(buf.frameLength)
    guard n > 0, let ch = buf.floatChannelData else { return }
    if probe {
        for c in 0..<Int(inFmt.channelCount) { for i in 0..<n { probeSum[c] += Double(ch[c][i] * ch[c][i]) } }
        probeN += n
        if Date().timeIntervalSince(probeT) >= 1 {
            logErr("probe " + probeSum.map { String(format: "%.1f", ($0 / Double(probeN)).squareRoot() * 32768) }.joined(separator: " "))
            probeSum = probeSum.map { _ in 0 }; probeN = 0; probeT = Date()
        }
    }
    let mono = AVAudioPCMBuffer(pcmFormat: micMono, frameCapacity: AVAudioFrameCount(n))!
    mono.frameLength = AVAudioFrameCount(n)
    mono.floatChannelData![0].update(from: ch[0], count: n)
    let cap = AVAudioFrameCount(Double(n) * 16000 / inFmt.sampleRate + 64)
    let o = AVAudioPCMBuffer(pcmFormat: out16, frameCapacity: cap)!
    var fed = false
    var err: NSError?
    micConv.convert(to: o, error: &err) { _, status in
        if fed { status.pointee = .noDataNow; return nil }
        fed = true; status.pointee = .haveData; return mono
    }
    if let e = err { fail("收音格式转换出错：\(e)") }
    if o.frameLength > 0 {
        emit(UInt8(ascii: "A"), Data(bytes: o.int16ChannelData![0], count: Int(o.frameLength) * 2))

    }
}

NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { _ in
    fail("音频设备变了（拔插耳麦或换了默认设备），重开")
}

engine.prepare()
do { try engine.start() } catch { fail("系统语音处理启动失败：\(error)") }
player.play()
event(["ev": "ready", "in": "\(inFmt)", "ducking": duckInfo, "agc": input.isVoiceProcessingAGCEnabled])
fflush(stdout)

// 播放状态只在主队列上改
var current: Int? = nil
func toPlayBuffer(_ pcm: Data, sr: Double) -> AVAudioPCMBuffer? {
    let src = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: sr, channels: 1, interleaved: true)!
    let n = pcm.count / 2
    guard n > 0, let sb = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: AVAudioFrameCount(n)),
          let conv = AVAudioConverter(from: src, to: playFmt) else { return nil }
    sb.frameLength = AVAudioFrameCount(n)
    pcm.withUnsafeBytes { sb.int16ChannelData![0].update(from: $0.bindMemory(to: Int16.self).baseAddress!, count: n) }
    let ob = AVAudioPCMBuffer(pcmFormat: playFmt, frameCapacity: AVAudioFrameCount(Double(n) * 48000 / sr + 1024))!
    var fed = false
    var err: NSError?
    conv.convert(to: ob, error: &err) { _, status in
        if fed { status.pointee = .endOfStream; return nil }
        fed = true; status.pointee = .haveData; return sb
    }
    return err == nil ? ob : nil
}

func readExact(_ fh: FileHandle, _ n: Int) -> Data? {
    var d = Data()
    while d.count < n {
        guard let c = try? fh.read(upToCount: n - d.count), !c.isEmpty else { return nil }
        d += c
    }
    return d
}

Thread.detachNewThread {
    let fh = FileHandle.standardInput
    var line = Data()
    while true {
        guard let b = try? fh.read(upToCount: 1), !b.isEmpty else { exit(0) }   // 主进程关了 stdin：退出
        if b[0] != 10 { line += b; continue }
        guard let cmd = try? JSONSerialization.jsonObject(with: line) as? [String: Any] else { fail("命令不是 JSON") }
        line = Data()
        switch cmd["cmd"] as? String {
        case "play":
            let id = cmd["id"] as! Int, sr = (cmd["sr"] as! NSNumber).doubleValue, len = cmd["bytes"] as! Int
            guard let pcm = readExact(fh, len) else { exit(0) }
            guard let buf = toPlayBuffer(pcm, sr: sr) else { DispatchQueue.main.async { event(["ev": "done", "id": id, "error": "转换失败"]); fflush(stdout) }; continue }
            DispatchQueue.main.async {
                current = id
                player.scheduleBuffer(buf, at: nil, options: [], completionCallbackType: .dataPlayedBack) { _ in
                    DispatchQueue.main.async {
                        if current == id { current = nil; event(["ev": "done", "id": id]); fflush(stdout) }
                    }
                }
                if !player.isPlaying { player.play() }
            }
        case "stop":
            DispatchQueue.main.async {
                let id = current
                current = nil
                player.stop()   // 丢掉没播的，立刻停声
                player.play()
                if let id { event(["ev": "stopped", "id": id]); fflush(stdout) }
            }
        default:
            fail("不认识的命令：\(cmd)")
        }
    }
}
RunLoop.main.run()
