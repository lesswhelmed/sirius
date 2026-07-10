import AppIntents
import UIKit

@available(iOS 16.0, *)
struct CaptureInSiriusIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture in Lesswhelmed"
    static var description = IntentDescription(
        "Send a note or link to your Lesswhelmed capture queue."
    )

    // Open the app so the existing authenticated session performs the submit.
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Text", description: "A note or link to capture.")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        var components = URLComponents()
        components.scheme = "siriusapp"
        components.host = "capture"
        components.queryItems = [URLQueryItem(name: "text", value: text)]
        if let url = components.url {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}
