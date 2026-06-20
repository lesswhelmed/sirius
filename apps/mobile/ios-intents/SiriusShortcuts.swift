import AppIntents

@available(iOS 16.0, *)
struct SiriusShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptureInSiriusIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Capture this in \(.applicationName)",
                "New capture in \(.applicationName)"
            ],
            shortTitle: "Capture in Sirius",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
