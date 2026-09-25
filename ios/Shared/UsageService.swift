import Foundation

enum UsageServiceError: LocalizedError {
    case invalidPassword
    case unauthorized
    case unavailable
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .invalidPassword: return "That dashboard password was not accepted."
        case .unauthorized: return "Your session expired. Sign in again."
        case .unavailable: return "The usage service is temporarily unavailable."
        case .invalidResponse: return "The usage service returned an unexpected response."
        }
    }
}

enum UsageService {
    static let baseURL = URL(string: "https://llm-usage.vercel.app")!

    static func signIn(password: String) async throws -> (session: String, expiresAt: Date) {
        var request = URLRequest(url: baseURL.appending(path: "/v1/widget/session"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(["password": password])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UsageServiceError.invalidResponse }
        if response.statusCode == 401 { throw UsageServiceError.invalidPassword }
        guard response.statusCode == 200 else { throw UsageServiceError.unavailable }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        let body = try decoder.decode(SessionResponse.self, from: data)
        let dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let expiration = dateFormatter.date(from: body.expiresAt), !body.session.isEmpty else {
            throw UsageServiceError.invalidResponse
        }
        return (body.session, expiration)
    }

    static func fetchStatus(session: String) async throws -> (UsageSnapshot, Data) {
        var request = URLRequest(url: baseURL.appending(path: "/v1/widget/status"))
        request.setValue("Bearer \(session)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let response = response as? HTTPURLResponse else { throw UsageServiceError.invalidResponse }
        if response.statusCode == 401 { throw UsageServiceError.unauthorized }
        guard response.statusCode == 200 else { throw UsageServiceError.unavailable }
        return (try UsageCodec.decode(data), data)
    }
}

private struct SessionResponse: Decodable {
    let session: String
    let expiresAt: String
}
