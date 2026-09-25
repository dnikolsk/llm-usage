import SwiftUI
import WidgetKit

private enum WidgetPalette {
    static let background = Color(red: 0.045, green: 0.067, blue: 0.067)
    static let card = Color(red: 0.10, green: 0.15, blue: 0.13)
    static let accent = Color(red: 0.67, green: 0.88, blue: 0.70)
    static let muted = Color(red: 0.60, green: 0.70, blue: 0.64)
}

struct UsageEntry: TimelineEntry {
    let date: Date
    let snapshot: UsageSnapshot?
    let fetchedAt: Date?
    let message: String?
}

struct UsageTimelineProvider: TimelineProvider {
    func placeholder(in context: Context) -> UsageEntry {
        UsageEntry(date: Date(), snapshot: .preview, fetchedAt: Date(), message: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (UsageEntry) -> Void) {
        completion(UsageEntry(date: Date(), snapshot: SharedUsageStore.cachedSnapshot ?? .preview,
                              fetchedAt: SharedUsageStore.fetchedAt, message: nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<UsageEntry>) -> Void) {
        Task {
            let entry: UsageEntry
            if let session = SharedUsageStore.session {
                do {
                    let (snapshot, data) = try await UsageService.fetchStatus(session: session)
                    SharedUsageStore.saveSnapshot(data)
                    entry = UsageEntry(date: Date(), snapshot: snapshot, fetchedAt: Date(), message: nil)
                } catch UsageServiceError.unauthorized {
                    SharedUsageStore.clearSession()
                    entry = UsageEntry(date: Date(), snapshot: SharedUsageStore.cachedSnapshot,
                                       fetchedAt: SharedUsageStore.fetchedAt, message: "Open app to sign in")
                } catch {
                    entry = UsageEntry(date: Date(), snapshot: SharedUsageStore.cachedSnapshot,
                                       fetchedAt: SharedUsageStore.fetchedAt, message: "Offline · showing saved data")
                }
            } else {
                entry = UsageEntry(date: Date(), snapshot: nil, fetchedAt: nil, message: "Open app to sign in")
            }
            completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(15 * 60))))
        }
    }
}

private struct UsageWidgetView: View {
    let entry: UsageEntry
    @Environment(\.widgetFamily) private var family

    private let providers = ["anthropic", "cursor", "openai"]

    var body: some View {
        Group {
            switch family {
            case .systemSmall: small
            case .systemMedium: medium
            default: large
            }
        }
        .widgetURL(URL(string: "llmusage://open"))
        .containerBackground(WidgetPalette.background, for: .widget)
    }

    private var title: some View {
        HStack {
            Text("LLM USAGE").font(.system(size: 10, weight: .heavy, design: .rounded)).tracking(1.5)
                .foregroundStyle(WidgetPalette.accent)
            Spacer(minLength: 2)
            Circle().fill(entry.message == nil ? WidgetPalette.accent : Color.orange)
                .frame(width: 6, height: 6)
        }
    }

    private var footer: some View {
        Text(entry.message ?? (entry.fetchedAt.map { "Updated \($0.formatted(date: .omitted, time: .shortened))" } ?? "Waiting for data"))
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(WidgetPalette.muted)
            .lineLimit(1)
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 8) {
            title
            Spacer()
            Image(systemName: "chart.bar.xaxis").font(.title2).foregroundStyle(WidgetPalette.accent)
            Text("Open LLM Usage to connect your dashboard.")
                .font(.caption).foregroundStyle(.white)
            Spacer()
        }
    }

    private var small: some View {
        VStack(alignment: .leading, spacing: 7) {
            if entry.snapshot == nil {
                empty
            } else {
                title
                ForEach(providers, id: \.self) { provider in
                    if let account = account(for: provider) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(account.displayName.uppercased())
                                .font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                            Text(account.sortedLimits.prefix(2).map { "\($0.shortLabel) \($0.percentText)" }.joined(separator: "  ·  "))
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(WidgetPalette.accent)
                                .lineLimit(1).minimumScaleFactor(0.75)
                        }
                    }
                }
                Spacer(minLength: 0)
                footer
            }
        }
        .padding(14)
    }

    private var medium: some View {
        VStack(alignment: .leading, spacing: 12) {
            if entry.snapshot == nil {
                empty
            } else {
                title
                HStack(alignment: .top, spacing: 8) {
                    ForEach(providers, id: \.self) { provider in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(account(for: provider)?.displayName ?? provider.capitalized)
                                .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            if let account = account(for: provider) {
                                ForEach(Array(account.sortedLimits.prefix(2))) { limit in
                                    meterLine(limit)
                                }
                            } else {
                                Text("No data").font(.caption2).foregroundStyle(WidgetPalette.muted)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Spacer(minLength: 0)
                footer
            }
        }
        .padding(16)
    }

    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            if entry.snapshot == nil {
                empty
            } else {
                title
                Text("Available capacity").font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                ForEach(providers, id: \.self) { provider in
                    if let account = account(for: provider) {
                        VStack(alignment: .leading, spacing: 7) {
                            HStack {
                                Text(account.displayName).font(.system(size: 13, weight: .bold)).foregroundStyle(.white)
                                Spacer()
                                if !account.isFresh {
                                    Text("STALE").font(.system(size: 9, weight: .bold)).foregroundStyle(.orange)
                                }
                            }
                            HStack(spacing: 10) {
                                ForEach(Array(account.sortedLimits.prefix(2))) { limit in
                                    meterLine(limit)
                                }
                            }
                        }
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(WidgetPalette.card, in: RoundedRectangle(cornerRadius: 10))
                    }
                }
                Spacer(minLength: 0)
                footer
            }
        }
        .padding(16)
    }

    private func account(for provider: String) -> UsageAccount? {
        entry.snapshot?.accounts.first { $0.provider == provider }
    }

    private func meterLine(_ limit: UsageLimit) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 2) {
                Text(limit.shortLabel).foregroundStyle(WidgetPalette.muted)
                Spacer(minLength: 1)
                Text(limit.percentText).foregroundStyle((limit.percentLeft ?? 0) <= 15 ? .orange : WidgetPalette.accent)
            }
            .font(.system(size: 10, weight: .semibold, design: .rounded))
            GeometryReader { geometry in
                Capsule().fill(Color.white.opacity(0.13))
                    .overlay(alignment: .leading) {
                        Capsule().fill((limit.percentLeft ?? 0) <= 15 ? Color.orange : WidgetPalette.accent)
                            .frame(width: geometry.size.width * CGFloat(limit.percentLeft ?? 0) / 100)
                    }
            }
            .frame(height: 4)
        }
        .frame(maxWidth: .infinity)
    }
}

@main
struct LLMUsageWidget: Widget {
    let kind = "LLMUsageWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: UsageTimelineProvider()) { entry in
            UsageWidgetView(entry: entry)
        }
        .configurationDisplayName("LLM Usage")
        .description("Claude, Cursor, and Codex capacity at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
        .contentMarginsDisabled()
    }
}
