import Foundation

enum SharedUsageStore {
    private static let defaults = UserDefaults(suiteName: "group.com.dnikolsk.llmusage")
    private static let sessionKey = "widgetSession"
    private static let expirationKey = "widgetSessionExpiresAt"
    private static let snapshotKey = "usageSnapshot"
    private static let fetchedKey = "usageFetchedAt"

    static var session: String? {
        guard let expiration = defaults?.object(forKey: expirationKey) as? Date, expiration > Date() else { return nil }
        return defaults?.string(forKey: sessionKey)
    }

    static func saveSession(_ value: String, expiresAt: Date) {
        defaults?.set(value, forKey: sessionKey)
        defaults?.set(expiresAt, forKey: expirationKey)
    }

    static func clearSession() {
        defaults?.removeObject(forKey: sessionKey)
        defaults?.removeObject(forKey: expirationKey)
        defaults?.removeObject(forKey: snapshotKey)
        defaults?.removeObject(forKey: fetchedKey)
    }

    static func saveSnapshot(_ data: Data) {
        defaults?.set(data, forKey: snapshotKey)
        defaults?.set(Date(), forKey: fetchedKey)
    }

    static var cachedSnapshot: UsageSnapshot? {
        guard let data = defaults?.data(forKey: snapshotKey) else { return nil }
        return try? UsageCodec.decode(data)
    }

    static var fetchedAt: Date? { defaults?.object(forKey: fetchedKey) as? Date }
}
