# iOS app and widgets

The SwiftUI app shows Claude, Cursor, and Codex remaining percentages from the live LLM Usage service. WidgetKit provides small, medium, and large Home Screen layouts. Small shows two percentages per provider; medium and large add meters and more room for labels. The widgets request a refresh about every 15 minutes, subject to iOS scheduling, and show the last fetched time or an offline message.

## Run on an iPhone

1. Open `LLMUsage.xcodeproj` in Xcode (iOS 17 or newer).
2. Select your Apple Development team for **LLMUsage** and **UsageWidget**. Enable the App Groups capability for both targets. If you change the bundle identifiers or App Group identifier, update `project.yml`, both `.entitlements` files, and `Shared/SharedUsageStore.swift` to match, then run `xcodegen generate` in this directory.
3. Run the **LLMUsage** scheme on your iPhone. Connect with the password for `llm-usage.vercel.app`.
4. Long-press the Home Screen, tap **Edit → Add Widget**, search for **LLM Usage**, and choose the small, medium, or large size.

The password is sent once to `/v1/widget/session` over HTTPS. The returned session expires after 30 days and is stored in the app's shared App Group defaults so the widget can fetch `/v1/widget/status`. Sign out clears the session and saved usage data. Provider login and API write credentials stay on the Mac and Vercel respectively.

The Xcode project is generated from `project.yml`. When editing target settings, update that file and regenerate the project with `xcodegen generate`.
