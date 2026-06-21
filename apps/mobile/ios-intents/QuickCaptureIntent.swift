import AppIntents
import Foundation
import UIKit

// Fully hands-free quick capture. Said via Siri (built-in phrase or a user's own
// recorded phrase), this runs in the BACKGROUND — the app never opens. Siri's
// own dictation fills `note` (the system does speech-to-text), and we POST it
// straight to the capture queue as a note/BLOG submission, attributed to the
// signed-in user via the session cookie the JS app mirrors into the keychain.
//
// Fallback: if the cookie is missing/expired or the request fails, we open the
// app to the existing /capture deep link with autosubmit=1 so the in-app
// authenticated session finishes the submit — the dictated text is never lost.
@available(iOS 16.0, *)
struct QuickCaptureIntent: AppIntent {
    static var title: LocalizedStringResource = "Quick Capture"
    static var description = IntentDescription(
        "Dictate a quick note straight into your Sirius capture queue — hands-free."
    )

    // Run in the background; do NOT launch the app on the happy path.
    static var openAppWhenRun: Bool = false

    @Parameter(
        title: "Note",
        description: "What you want to capture.",
        requestValueDialog: "What would you like to capture?"
    )
    var note: String

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = note.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return .result(dialog: "There was nothing to capture.")
        }

        // No mirrored session yet (signed out, or first launch before the JS
        // bridge ran): hand off to the app so its session can submit.
        guard let creds = SiriusCredentialStore.read() else {
            await openAppFallback(text: text)
            return .result(dialog: "Opening Sirius to finish your capture.")
        }

        do {
            try await submit(text: text, creds: creds)
            return .result(dialog: "Added to your Sirius queue.")
        } catch {
            // Expired/rotated cookie or a transport failure → graceful handoff.
            await openAppFallback(text: text)
            return .result(dialog: "Opening Sirius to finish your capture.")
        }
    }

    private func submit(text: String, creds: SiriusCredentials) async throws {
        guard let url = URL(string: creds.baseUrl + "/api/app/ingest") else {
            throw QuickCaptureError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(creds.cookie, forHTTPHeaderField: "Cookie")
        // Mirror the JS client: we own the session cookie manually and keep the
        // native cookie jar out of it (the app hardens the shared jar to .never).
        request.httpShouldHandleCookies = false
        request.httpBody = try JSONSerialization.data(withJSONObject: ["notes": text])

        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode)
        else {
            throw QuickCaptureError.badStatus
        }
    }

    @MainActor
    private func openAppFallback(text: String) async {
        var components = URLComponents()
        components.scheme = "siriusapp"
        components.host = "capture"
        components.queryItems = [
            URLQueryItem(name: "text", value: text),
            URLQueryItem(name: "autosubmit", value: "1"),
        ]
        if let url = components.url {
            await UIApplication.shared.open(url)
        }
    }
}

enum QuickCaptureError: Error {
    case badURL
    case badStatus
}
