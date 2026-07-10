import AppIntents

@available(iOS 16.0, *)
struct SiriusShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        // Hands-free dictation → straight to the queue (background, app stays
        // closed). Apple REQUIRES the app-name token in every built-in phrase,
        // so these all contain it; to drop the app name entirely the user
        // records their own phrase in the Shortcuts app against this action
        // (see the "Hands-free capture" setup in Settings).
        AppShortcut(
            intent: QuickCaptureIntent(),
            phrases: [
                "Quick note in \(.applicationName)",
                "Take a note in \(.applicationName)",
                "Capture a note in \(.applicationName)"
            ],
            shortTitle: "Quick Capture",
            systemImageName: "mic.fill"
        )
        // Open-the-app capture for notes/links you want to review before queuing.
        AppShortcut(
            intent: CaptureInSiriusIntent(),
            phrases: [
                "Capture in \(.applicationName)",
                "Capture this in \(.applicationName)",
                "New capture in \(.applicationName)"
            ],
            shortTitle: "Capture in Lesswhelmed",
            systemImageName: "tray.and.arrow.down"
        )
    }
}
