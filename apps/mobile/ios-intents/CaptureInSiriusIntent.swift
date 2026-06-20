import AppIntents
import UIKit

@available(iOS 16.0, *)
struct CaptureInSiriusIntent: AppIntent {
    static var title: LocalizedStringResource = "Capture in Sirius"
    static var description = IntentDescription(
        "Send a note or link to your Sirius capture queue."
    )

    // Open the app so the existing authenticated session performs the submit.
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Text", description: "A note or link to capture.")
    var text: String

    @MainActor
    func perform() async throws -> some IntentResult {
        let encoded = text.addingPercentEncoding(
            withAllowedCharacters: .urlQueryAllowed
        ) ?? ""
        if let url = URL(string: "siriusapp://capture?text=\(encoded)") {
            await UIApplication.shared.open(url)
        }
        return .result()
    }
}
