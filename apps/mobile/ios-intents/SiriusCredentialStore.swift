import Foundation
import Security

struct SiriusCredentials {
    let baseUrl: String
    let cookie: String
}

// Reads the capture session credential that the JS layer mirrors into the
// keychain via the `SiriusCapture` Expo module (see
// modules/sirius-capture/ios/SiriusCaptureModule.swift). Both sides use the
// SAME keychain coordinates — a plain, app-default generic-password item (no
// access group). The background `QuickCaptureIntent` can read it because an App
// Intent declared in the main app runs in THIS app's own process, sharing the
// app's default keychain access group. Keep `service`/`account` identical across
// both files or the intent will silently fail to find the cookie.
enum SiriusCredentialStore {
    static let service = "dev.copt.sirius.capture"
    static let account = "session"

    static func read() -> SiriusCredentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let baseUrl = obj["baseUrl"],
              let cookie = obj["cookie"],
              !baseUrl.isEmpty,
              !cookie.isEmpty
        else {
            return nil
        }
        return SiriusCredentials(baseUrl: baseUrl, cookie: cookie)
    }
}
