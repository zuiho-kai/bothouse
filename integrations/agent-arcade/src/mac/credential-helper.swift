// SPDX-License-Identifier: AGPL-3.0-only
// A fixed, separately installed executable. Never rebuild it during App updates.
// BrokerConfiguration.swift is generated beside this source at compile time.
import Foundation
import Security
import CommonCrypto
import Darwin

@_silgen_name("csops")
private func brokerCSOps(_ pid: pid_t, _ operation: UInt32,
                         _ data: UnsafeMutableRawPointer?, _ size: size_t) -> Int32

private let maximumFrame = 512 * 1024
private let productionRequirementPattern = #"\Aidentifier "io\.github\.agentarcade\.desktop" and certificate root = H"[A-Fa-f0-9]{40}"\z"#
private let productionService = "agent-arcade Safe Storage"
private let productionAccount = "agent-arcade Key"

private enum BrokerFailure: String, Error {
    case configuration_invalid, invalid_request, request_too_large, peer_rejected
    case keychain_unavailable, keychain_locked, item_missing, item_ambiguous
    case invalid_ciphertext, crypto_failed, io_failed

    var publicCode: String {
        switch self {
        case .configuration_invalid, .io_failed: return "internal_error"
        case .invalid_request, .request_too_large: return "invalid_request"
        case .peer_rejected: return "unauthorized"
        case .keychain_unavailable, .keychain_locked, .item_ambiguous: return "keychain_unavailable"
        case .item_missing: return "key_not_found"
        case .invalid_ciphertext, .crypto_failed: return "crypto_failed"
        }
    }
}

private func validateConfiguration() throws {
    if BrokerConfiguration.testing {
        guard BrokerConfiguration.service.hasPrefix("agent-arcade.test."),
              BrokerConfiguration.account.hasPrefix("agent-arcade.test."),
              BrokerConfiguration.keychainPath.hasPrefix("/"),
              BrokerConfiguration.keychainPath.hasSuffix(".keychain-db"),
              !BrokerConfiguration.keychainPath.hasSuffix("/login.keychain-db"),
              !BrokerConfiguration.peerRequirement.isEmpty else {
            throw BrokerFailure.configuration_invalid
        }
    } else {
        guard BrokerConfiguration.peerRequirement.range(of: productionRequirementPattern, options: .regularExpression) != nil,
              BrokerConfiguration.service == productionService,
              BrokerConfiguration.account == productionAccount,
              BrokerConfiguration.keychainPath.isEmpty else {
            throw BrokerFailure.configuration_invalid
        }
    }
}

private struct ProcessIdentity: Equatable {
    let pid: pid_t
    let uid: uid_t
    let startedSeconds: UInt64
    let startedMicroseconds: UInt64
}

private func processIdentity(_ pid: pid_t) throws -> ProcessIdentity {
    var info = proc_bsdinfo()
    let count = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, Int32(MemoryLayout.size(ofValue: info)))
    guard count == MemoryLayout.size(ofValue: info), info.pbi_pid == UInt32(pid),
          info.pbi_uid == getuid(), info.pbi_ruid == getuid(),
          kill(pid, 0) == 0 else { throw BrokerFailure.peer_rejected }
    return ProcessIdentity(pid: pid, uid: info.pbi_uid,
                           startedSeconds: info.pbi_start_tvsec,
                           startedMicroseconds: info.pbi_start_tvusec)
}

// KERN_PROCARGS2 is kernel-supplied. Nothing from the request/child environment
// is accepted as proof that the parent is the authorization worker.
private func argumentsForProcess(_ pid: pid_t) throws -> [String] {
    var mib: [Int32] = [CTL_KERN, KERN_PROCARGS2, pid]
    var length: size_t = 0
    guard sysctl(&mib, UInt32(mib.count), nil, &length, nil, 0) == 0,
          length >= MemoryLayout<Int32>.size, length <= 1024 * 1024 else {
        throw BrokerFailure.peer_rejected
    }
    var bytes = [UInt8](repeating: 0, count: length)
    guard sysctl(&mib, UInt32(mib.count), &bytes, &length, nil, 0) == 0 else {
        throw BrokerFailure.peer_rejected
    }
    let argc = bytes.withUnsafeBytes { $0.loadUnaligned(as: Int32.self) }
    guard argc > 0, argc <= 4096 else { throw BrokerFailure.peer_rejected }
    var offset = MemoryLayout<Int32>.size
    // Skip executable path and its padding, then read exactly argc argv strings.
    while offset < length && bytes[offset] != 0 { offset += 1 }
    while offset < length && bytes[offset] == 0 { offset += 1 }
    var result: [String] = []
    for _ in 0..<argc {
        let start = offset
        while offset < length && bytes[offset] != 0 { offset += 1 }
        guard offset < length,
              let value = String(bytes: bytes[start..<offset], encoding: .utf8) else {
            throw BrokerFailure.peer_rejected
        }
        result.append(value)
        offset += 1
    }
    return result
}

private struct VerifiedParent {
    let identity: ProcessIdentity
    let code: SecCode
    let requirement: SecRequirement
    let authorizing: Bool

    init(authorizing: Bool) throws {
        let pid = getppid()
        guard pid > 1 else { throw BrokerFailure.peer_rejected }
        identity = try processIdentity(pid)
        var requirementResult: SecRequirement?
        guard SecRequirementCreateWithString(BrokerConfiguration.peerRequirement as CFString,
                    SecCSFlags(), &requirementResult) == errSecSuccess,
              let requirementResult else { throw BrokerFailure.configuration_invalid }
        requirement = requirementResult
        var codeResult: SecCode?
        let attrs = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
        guard SecCodeCopyGuestWithAttributes(nil, attrs, SecCSFlags(), &codeResult) == errSecSuccess,
              let codeResult else { throw BrokerFailure.peer_rejected }
        code = codeResult
        self.authorizing = authorizing
        try verify(fullBundle: true)
    }

    func verify(fullBundle: Bool = false) throws {
        guard getppid() == identity.pid,
              try processIdentity(identity.pid) == identity,
              SecCodeCheckValidity(code, SecCSFlags(rawValue: kSecCSStrictValidate), requirement) == errSecSuccess else {
            throw BrokerFailure.peer_rejected
        }
        // Validate the whole sealed bundle too, not only the components needed
        // to establish the executable's identity. App runtime also enforces ASAR.
        if fullBundle {
            var staticCode: SecStaticCode?
            guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
                  let staticCode,
                  SecStaticCodeCheckValidity(staticCode,
                    SecCSFlags(rawValue: kSecCSStrictValidate | kSecCSCheckAllArchitectures | kSecCSCheckNestedCode),
                    requirement) == errSecSuccess else { throw BrokerFailure.peer_rejected }
        }

        var flags: UInt32 = 0
        guard brokerCSOps(identity.pid, 0 /* CS_OPS_STATUS */, &flags, MemoryLayout.size(ofValue: flags)) == 0,
              flags & 0x00000001 != 0, // CS_VALID
              flags & 0x10000000 == 0, // CS_DEBUGGED
              flags & 0x00000004 == 0 else { throw BrokerFailure.peer_rejected } // CS_GET_TASK_ALLOW
        if !BrokerConfiguration.testing {
            guard flags & 0x00010000 != 0, // CS_RUNTIME
                  flags & 0x00000200 != 0 else { throw BrokerFailure.peer_rejected } // CS_KILL
        }
        let args = try argumentsForProcess(identity.pid)
        guard !args.contains(where: { $0.hasPrefix("--inspect") || $0.hasPrefix("--remote-debugging") }) else {
            throw BrokerFailure.peer_rejected
        }
        if authorizing {
            guard args.contains("--arcade-credential-authorize-worker") else { throw BrokerFailure.peer_rejected }
        }
        // Repeat the kernel identity check after filesystem/signature work.
        guard getppid() == identity.pid, try processIdentity(identity.pid) == identity else {
            throw BrokerFailure.peer_rejected
        }
    }
}

private enum Request {
    case status
    case encrypt(String)
    case decrypt(Data)
}

private func parseRequest(_ bytes: Data, authorizing: Bool) throws -> Request {
    guard bytes.count <= maximumFrame else { throw BrokerFailure.request_too_large }
    guard !bytes.isEmpty,
          let object = try? JSONSerialization.jsonObject(with: bytes),
          let value = object as? [String: Any],
          let version = value["version"] as? NSNumber,
          CFGetTypeID(version) != CFBooleanGetTypeID(), version.intValue == 1,
          version.doubleValue == 1,
          let operation = value["operation"] as? String else { throw BrokerFailure.invalid_request }
    switch operation {
    case "status":
        guard Set(value.keys) == ["version", "operation"] else { throw BrokerFailure.invalid_request }
        return .status
    case "encrypt":
        guard !authorizing, Set(value.keys) == ["version", "operation", "text"],
              let text = value["text"] as? String,
              text.utf8.count <= maximumFrame else { throw BrokerFailure.invalid_request }
        return .encrypt(text)
    case "decrypt":
        guard !authorizing, Set(value.keys) == ["version", "operation", "data"],
              let encoded = value["data"] as? String,
              let data = Data(base64Encoded: encoded), data.base64EncodedString() == encoded,
              data.count <= maximumFrame else { throw BrokerFailure.invalid_request }
        return .decrypt(data)
    default: throw BrokerFailure.invalid_request
    }
}

private func readRequest() throws -> Data {
    var result = Data()
    var chunk = [UInt8](repeating: 0, count: 8192)
    while true {
        let count = Darwin.read(STDIN_FILENO, &chunk, chunk.count)
        if count == 0 { return result }
        if count < 0 {
            if errno == EINTR { continue }
            throw BrokerFailure.io_failed
        }
        guard result.count + count <= maximumFrame else { throw BrokerFailure.request_too_large }
        result.append(contentsOf: chunk.prefix(count))
    }
}

private func writeFrame(_ frame: [String: Any]) throws {
    guard var bytes = try? JSONSerialization.data(withJSONObject: frame, options: [.sortedKeys]),
          bytes.count <= maximumFrame else { throw BrokerFailure.io_failed }
    bytes.append(0x0a)
    try bytes.withUnsafeBytes { buffer in
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(STDOUT_FILENO, buffer.baseAddress!.advanced(by: offset), buffer.count - offset)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw BrokerFailure.io_failed }
            offset += count
        }
    }
}

private func loginKeychainPath() throws -> String {
    // getpwuid, rather than HOME/NSHomeDirectory, prevents caller environment
    // from changing which Keychain is read.
    guard let record = getpwuid(getuid()), let home = record.pointee.pw_dir else {
        throw BrokerFailure.keychain_unavailable
    }
    return String(cString: home) + "/Library/Keychains/login.keychain-db"
}

private func readExistingPassword() throws -> Data {
    let path = BrokerConfiguration.testing ? BrokerConfiguration.keychainPath : try loginKeychainPath()
    var keychain: SecKeychain?
    guard SecKeychainOpen(path, &keychain) == errSecSuccess, let keychain else {
        throw BrokerFailure.keychain_unavailable
    }
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: BrokerConfiguration.service,
        kSecAttrAccount as String: BrokerConfiguration.account,
        kSecMatchSearchList as String: [keychain],
        kSecMatchLimit as String: kSecMatchLimitAll,
        // Legacy macOS password items reject ReturnData + MatchLimitAll with
        // errSecParam. Enumerate references without secret access first, then
        // read only that exact item after proving uniqueness.
        kSecReturnRef as String: true
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { throw BrokerFailure.item_missing }
    if status == errSecInteractionNotAllowed || status == errSecAuthFailed || status == errSecUserCanceled {
        throw BrokerFailure.keychain_locked
    }
    guard status == errSecSuccess else { throw BrokerFailure.keychain_unavailable }
    guard let matches = result as? [SecKeychainItem], matches.count == 1 else { throw BrokerFailure.item_ambiguous }
    var single = query
    single.removeValue(forKey: kSecReturnRef as String)
    single[kSecMatchLimit as String] = kSecMatchLimitOne
    single[kSecMatchItemList as String] = [matches[0]]
    single[kSecReturnData as String] = true
    var secret: CFTypeRef?
    let readStatus = SecItemCopyMatching(single as CFDictionary, &secret)
    if readStatus == errSecItemNotFound { throw BrokerFailure.item_missing }
    if readStatus == errSecInteractionNotAllowed || readStatus == errSecAuthFailed || readStatus == errSecUserCanceled {
        throw BrokerFailure.keychain_locked
    }
    guard readStatus == errSecSuccess, let password = secret as? Data,
          !password.isEmpty, password.count <= 4096 else { throw BrokerFailure.keychain_unavailable }
    return password
}

private func deriveKey(_ password: Data) throws -> Data {
    let salt = Array("saltysalt".utf8)
    var key = Data(repeating: 0, count: kCCKeySizeAES128)
    let keyLength = key.count
    let status = key.withUnsafeMutableBytes { target in
        password.withUnsafeBytes { secret in
            salt.withUnsafeBytes { saltBuffer in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                    secret.baseAddress!.assumingMemoryBound(to: Int8.self), password.count,
                    saltBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self), salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA1), 1003,
                    target.baseAddress!.assumingMemoryBound(to: UInt8.self), keyLength)
            }
        }
    }
    guard status == kCCSuccess else { key.resetBytes(in: 0..<key.count); throw BrokerFailure.crypto_failed }
    return key
}

private func crypt(_ input: Data, key: Data, encrypting: Bool) throws -> Data {
    guard key.count == kCCKeySizeAES128 else { throw BrokerFailure.crypto_failed }
    let iv = [UInt8](repeating: 0x20, count: kCCBlockSizeAES128)
    var output = Data(repeating: 0, count: input.count + kCCBlockSizeAES128)
    let outputCapacity = output.count
    var written = 0
    let status = output.withUnsafeMutableBytes { target in
        key.withUnsafeBytes { keyBytes in
            input.withUnsafeBytes { source in
                iv.withUnsafeBytes { ivBytes in
                    CCCrypt(CCOperation(encrypting ? kCCEncrypt : kCCDecrypt), CCAlgorithm(kCCAlgorithmAES),
                        CCOptions(kCCOptionPKCS7Padding), keyBytes.baseAddress, key.count,
                        ivBytes.baseAddress, source.baseAddress, input.count,
                        target.baseAddress, outputCapacity, &written)
                }
            }
        }
    }
    guard status == kCCSuccess else {
        output.resetBytes(in: 0..<output.count)
        throw encrypting ? BrokerFailure.crypto_failed : BrokerFailure.invalid_ciphertext
    }
    output.count = written
    return output
}

private func encryptV10(_ text: String, key: Data) throws -> Data {
    if text.isEmpty { return Data() } // Electron's exact empty-string contract.
    var plain = Data(text.utf8)
    defer { plain.resetBytes(in: 0..<plain.count) }
    return Data("v10".utf8) + (try crypt(plain, key: key, encrypting: true))
}

private func decryptV10(_ data: Data, key: Data) throws -> String {
    if data.isEmpty { return "" }
    guard data.count >= 3 + kCCBlockSizeAES128, data.starts(with: Data("v10".utf8)),
          (data.count - 3) % kCCBlockSizeAES128 == 0 else { throw BrokerFailure.invalid_ciphertext }
    var plain = try crypt(Data(data.dropFirst(3)), key: key, encrypting: false)
    defer { plain.resetBytes(in: 0..<plain.count) }
    guard let text = String(data: plain, encoding: .utf8) else { throw BrokerFailure.invalid_ciphertext }
    return text
}

#if BROKER_NATIVE_UNIT
@main private enum NativeUnitMain {
    static func main() {
        do {
            // Synthetic known answer, independently reproducible with PBKDF2
            // and AES-128-CBC. This build never executes a Keychain function.
            var key = try deriveKey(Data("synthetic-unit-password".utf8))
            defer { key.resetBytes(in: 0..<key.count) }
            let expectedKey = "23ffa6b5539717c106238e42c89e6488"
            guard key.map({ String(format: "%02x", $0) }).joined() == expectedKey else { throw BrokerFailure.crypto_failed }
            let text = "Synthetic credential · 测试"
            let encrypted = try encryptV10(text, key: key)
            guard encrypted.base64EncodedString() == "djEwkqGDJaS/OANIqa9f+qZh0h8bSTFO9WHfzisEYqS8wZE=",
                  try decryptV10(encrypted, key: key) == text,
                  try encryptV10("", key: key).isEmpty,
                  try decryptV10(Data(), key: key).isEmpty else { throw BrokerFailure.crypto_failed }
            for bad in [Data("plain".utf8), Data("v10".utf8), Data("v10wrong padding!".utf8)] {
                do { _ = try decryptV10(bad, key: key); throw BrokerFailure.crypto_failed }
                catch BrokerFailure.invalid_ciphertext {}
            }
            _ = try parseRequest(Data("{\"version\":1,\"operation\":\"status\"}".utf8), authorizing: true)
            _ = try parseRequest(Data("{\"version\":1,\"operation\":\"encrypt\",\"text\":\"synthetic\"}".utf8), authorizing: false)
            _ = try parseRequest(Data("{\"version\":1,\"operation\":\"decrypt\",\"data\":\"djEw\"}".utf8), authorizing: false)
            for bad in ["{\"version\":true,\"operation\":\"status\"}",
                        "{\"version\":1,\"operation\":\"status\",\"service\":\"other\"}",
                        "{\"version\":1,\"operation\":\"encrypt\",\"text\":\"synthetic\"}"] {
                do { _ = try parseRequest(Data(bad.utf8), authorizing: true); throw BrokerFailure.crypto_failed }
                catch BrokerFailure.invalid_request {}
            }
            do {
                _ = try parseRequest(Data(repeating: 0x20, count: maximumFrame + 1), authorizing: false)
                throw BrokerFailure.crypto_failed
            } catch BrokerFailure.request_too_large {}
            for bad in ["{\"version\":1,\"operation\":\"decrypt\",\"data\":\"not base64\"}",
                        "{\"version\":1,\"operation\":\"decrypt\",\"data\":\"Zg==\\n\"}",
                        "{\"version\":1,\"operation\":\"decrypt\",\"data\":\"Zg==\",\"keychainPath\":\"other\"}"] {
                do { _ = try parseRequest(Data(bad.utf8), authorizing: false); throw BrokerFailure.crypto_failed }
                catch BrokerFailure.invalid_request {}
            }
            print("Native synthetic crypto/protocol checks passed; no Keychain access.")
        } catch { exit(1) }
    }
}
#else
@main private enum CredentialHelperMain {
    static func main() {
        // No exception or runtime diagnostic may include secret/input bytes.
        signal(SIGPIPE, SIG_IGN)
        var exitStatus: Int32 = 1
        do {
            try validateConfiguration()
            let arguments = Array(CommandLine.arguments.dropFirst())
            guard arguments.isEmpty || arguments == ["--authorize"] else { throw BrokerFailure.invalid_request }
            let authorizing = arguments == ["--authorize"]
            // A lost worker cannot leave an authorization/decryption process
            // alive. SIGALRM uses the default termination action (no unsafe
            // Swift/Foundation work inside a signal handler).
            signal(SIGALRM, SIG_DFL)
            alarm(authorizing ? 120 : 8)
            let parentPID = getppid()
            let parentWatch = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
            parentWatch.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
            parentWatch.setEventHandler {
                if getppid() != parentPID { _exit(1) }
            }
            parentWatch.resume()
            defer { parentWatch.cancel() }
            let parent = try VerifiedParent(authorizing: authorizing)
            try writeFrame(["version": 1, "status": "ready", "pid": Int(getpid())])
            let request = try parseRequest(readRequest(), authorizing: authorizing)
            try parent.verify()
            // This is the first Keychain API in this executable. Normal requests
            // cannot cause a system authorization dialog, including after denial.
            guard SecKeychainSetUserInteractionAllowed(authorizing) == errSecSuccess else {
                throw BrokerFailure.keychain_unavailable
            }
            var password = try readExistingPassword()
            defer { password.resetBytes(in: 0..<password.count) }
            try parent.verify()
            var key = try deriveKey(password)
            defer { key.resetBytes(in: 0..<key.count) }
            let response: [String: Any]
            switch request {
            case .status: response = ["version": 1, "status": "ok", "available": true]
            case .encrypt(let text): response = ["version": 1, "status": "ok", "data": try encryptV10(text, key: key).base64EncodedString()]
            case .decrypt(let bytes): response = ["version": 1, "status": "ok", "text": try decryptV10(bytes, key: key)]
            }
            try parent.verify()
            try writeFrame(response)
            exitStatus = 0
        } catch let failure as BrokerFailure {
            try? writeFrame(["version": 1, "status": "error", "code": failure.publicCode])
        } catch {
            try? writeFrame(["version": 1, "status": "error", "code": BrokerFailure.io_failed.publicCode])
        }
        exit(exitStatus)
    }
}
#endif
