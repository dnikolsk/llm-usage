import Foundation

struct UsageSnapshot: Decodable {
    let generatedAt: String
    let accounts: [UsageAccount]

    static let preview = UsageSnapshot(generatedAt: Date().ISO8601Format(), accounts: [
        UsageAccount(id: "claude-personal", provider: "anthropic", label: "Claude", status: "available", freshness: "fresh", limits: [
            UsageLimit(kind: "session", scope: "all_models", windowSeconds: 18000, remainingFraction: 0.72, resetAt: nil),
            UsageLimit(kind: "weekly", scope: "all_models", windowSeconds: 604800, remainingFraction: 0.38, resetAt: nil)
        ]),
        UsageAccount(id: "cursor-personal", provider: "cursor", label: "Cursor", status: "available", freshness: "fresh", limits: [
            UsageLimit(kind: "monthly", scope: "cursor_models", windowSeconds: 2592000, remainingFraction: 1, resetAt: nil),
            UsageLimit(kind: "monthly", scope: "other_models", windowSeconds: 2592000, remainingFraction: 0, resetAt: nil)
        ]),
        UsageAccount(id: "openai-personal", provider: "openai", label: "Codex", status: "available", freshness: "fresh", limits: [
            UsageLimit(kind: "session", scope: "work_codex", windowSeconds: 18000, remainingFraction: 0.55, resetAt: nil),
            UsageLimit(kind: "weekly", scope: "work_codex", windowSeconds: 604800, remainingFraction: 0.84, resetAt: nil)
        ])
    ])
}

struct UsageAccount: Decodable, Identifiable {
    let id: String
    let provider: String
    let label: String
    let status: String
    let freshness: String
    let limits: [UsageLimit]

    var isFresh: Bool { freshness == "fresh" && status != "error" }
    var displayName: String {
        switch provider {
        case "anthropic": return "Claude"
        case "cursor": return "Cursor"
        case "openai": return "Codex"
        default: return label
        }
    }

    var sortedLimits: [UsageLimit] {
        func rank(_ limit: UsageLimit) -> Int {
            if limit.scope == "cursor_models" { return 0 }
            if limit.scope == "other_models" { return 1 }
            if limit.kind == "session" { return 2 }
            if limit.kind == "weekly" { return 3 }
            return 4
        }
        return limits.sorted { rank($0) == rank($1) ? $0.id < $1.id : rank($0) < rank($1) }
    }
}

struct UsageLimit: Decodable, Identifiable {
    let kind: String
    let scope: String
    let windowSeconds: Int?
    let remainingFraction: Double?
    let resetAt: String?

    var id: String { "\(kind)-\(scope)-\(windowSeconds ?? 0)" }
    var label: String {
        switch scope {
        case "cursor_models": return "Cursor Models"
        case "other_models": return "Other Models"
        default: break
        }
        if kind == "session" && windowSeconds == 18000 { return "5-hour" }
        if kind == "weekly" { return "Weekly" }
        if kind == "session" { return "Session" }
        return kind.capitalized
    }
    var shortLabel: String {
        switch scope {
        case "cursor_models": return "C"
        case "other_models": return "O"
        default: return kind == "weekly" ? "7D" : "5H"
        }
    }
    var percentLeft: Int? {
        guard let remainingFraction, remainingFraction.isFinite else { return nil }
        return Int((max(0, min(1, remainingFraction)) * 100).rounded())
    }
    var percentText: String { percentLeft.map { "\($0)%" } ?? "—" }
    var resetDate: Date? {
        guard let resetAt else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: resetAt) ?? ISO8601DateFormatter().date(from: resetAt)
    }
}

enum UsageCodec {
    static func decode(_ data: Data) throws -> UsageSnapshot {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try decoder.decode(UsageSnapshot.self, from: data)
    }
}
