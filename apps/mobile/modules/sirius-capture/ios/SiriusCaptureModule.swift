import ExpoModulesCore
import Security

// Writes/clears the capture session credential the background `QuickCaptureIntent`
// reads. Stored as a plain, app-default generic-password keychain item — no
// access group needed because the App Intent runs in this same app process.
// `service`/`account` MUST stay identical to
// ios-intents/SiriusCredentialStore.swift (the reader).
public class SiriusCaptureModule: Module {
    private let service = "dev.copt.sirius.capture"
    private let account = "session"

    public func definition() -> ModuleDefinition {
        Name("SiriusCapture")

        Function("setCredentials") { (baseUrl: String, cookie: String) in
            let payload: [String: String] = ["baseUrl": baseUrl, "cookie": cookie]
            guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
                return
            }
            // Delete-then-add so we always overwrite with the freshest cookie.
            SecItemDelete(self.baseQuery() as CFDictionary)
            var attrs = self.baseQuery()
            attrs[kSecValueData as String] = data
            // Readable when the intent runs in the background after first unlock.
            attrs[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            SecItemAdd(attrs as CFDictionary, nil)
        }

        Function("clearCredentials") {
            SecItemDelete(self.baseQuery() as CFDictionary)
        }
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
