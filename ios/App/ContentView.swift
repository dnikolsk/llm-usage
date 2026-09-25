import SwiftUI
import WidgetKit

private enum Palette {
    static let background = Color(red: 0.045, green: 0.067, blue: 0.067)
    static let card = Color(red: 0.09, green: 0.13, blue: 0.115)
    static let accent = Color(red: 0.67, green: 0.88, blue: 0.70)
    static let muted = Color(red: 0.59, green: 0.67, blue: 0.62)
}

@MainActor
final class UsageViewModel: ObservableObject {
    @Published var snapshot = SharedUsageStore.cachedSnapshot
    @Published var isWorking = false
    @Published var error: String?
    @Published var signedIn = SharedUsageStore.session != nil

    func signIn(password: String) async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let credentials = try await UsageService.signIn(password: password)
            SharedUsageStore.saveSession(credentials.session, expiresAt: credentials.expiresAt)
            signedIn = true
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func refresh() async {
        guard let session = SharedUsageStore.session else {
            signedIn = false
            return
        }
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let (latest, data) = try await UsageService.fetchStatus(session: session)
            SharedUsageStore.saveSnapshot(data)
            snapshot = latest
            WidgetCenter.shared.reloadAllTimelines()
        } catch UsageServiceError.unauthorized {
            SharedUsageStore.clearSession()
            signedIn = false
            snapshot = nil
            error = UsageServiceError.unauthorized.localizedDescription
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signOut() {
        SharedUsageStore.clearSession()
        signedIn = false
        snapshot = nil
        WidgetCenter.shared.reloadAllTimelines()
    }
}

struct ContentView: View {
    @StateObject private var model = UsageViewModel()
    @State private var password = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    header
                    if !model.signedIn { signInCard }
                    if model.signedIn, let snapshot = model.snapshot {
                        ForEach(snapshot.accounts) { account in
                            accountCard(account)
                        }
                    } else if model.signedIn {
                        ContentUnavailableView("No usage yet", systemImage: "chart.bar.xaxis", description: Text("Pull to refresh or try again shortly."))
                    }
                    if let error = model.error {
                        Text(error).font(.footnote).foregroundStyle(.orange)
                    }
                    if let fetchedAt = SharedUsageStore.fetchedAt {
                        Text("Last fetched \(fetchedAt.formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(Palette.muted)
                    }
                }
                .padding(20)
            }
            .background(Palette.background)
            .toolbar(.hidden, for: .navigationBar)
            .refreshable { await model.refresh() }
            .task { if model.signedIn { await model.refresh() } }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 5) {
                Text("LLM USAGE").font(.caption.bold()).tracking(2).foregroundStyle(Palette.accent)
                Text("Your available capacity").font(.title2.bold()).foregroundStyle(.white)
            }
            Spacer()
            if model.signedIn {
                Menu {
                    Button("Refresh", systemImage: "arrow.clockwise") { Task { await model.refresh() } }
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) { model.signOut() }
                } label: {
                    Image(systemName: "ellipsis.circle").font(.title2).foregroundStyle(Palette.accent)
                }
                .accessibilityLabel("Options")
            }
        }
        .padding(.vertical, 12)
    }

    private var signInCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            Text("Connect your dashboard").font(.headline)
            Text("Use the password for llm-usage.vercel.app. The app saves a read-only session for its widgets; it does not save your password.")
                .font(.subheadline).foregroundStyle(Palette.muted)
            SecureField("Dashboard password", text: $password)
                .textContentType(.password)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(Palette.background, in: RoundedRectangle(cornerRadius: 10))
            Button {
                let candidate = password
                password = ""
                Task { await model.signIn(password: candidate) }
            } label: {
                HStack { Spacer(); Text(model.isWorking ? "Connecting…" : "Connect").bold(); Spacer() }
                    .padding(12)
            }
            .buttonStyle(.plain)
            .foregroundStyle(Palette.background)
            .background(Palette.accent, in: RoundedRectangle(cornerRadius: 10))
            .disabled(password.isEmpty || model.isWorking)
        }
        .padding(18)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 16))
    }

    private func accountCard(_ account: UsageAccount) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(account.displayName).font(.headline)
                    Text(account.label).font(.caption).foregroundStyle(Palette.muted)
                }
                Spacer()
                Text(account.isFresh ? "LIVE" : "STALE")
                    .font(.caption2.bold()).tracking(1)
                    .foregroundStyle(account.isFresh ? Palette.accent : .orange)
            }
            if account.sortedLimits.isEmpty {
                Text("Usage unavailable").font(.subheadline).foregroundStyle(Palette.muted)
            } else {
                ForEach(account.sortedLimits) { limit in
                    VStack(spacing: 7) {
                        HStack {
                            Text(limit.label).font(.subheadline)
                            Spacer()
                            Text("\(limit.percentText) left").font(.subheadline.bold())
                        }
                        GeometryReader { geometry in
                            Capsule().fill(Color.white.opacity(0.1))
                                .overlay(alignment: .leading) {
                                    Capsule().fill((limit.percentLeft ?? 0) <= 15 ? Color.orange : Palette.accent)
                                        .frame(width: geometry.size.width * CGFloat(limit.percentLeft ?? 0) / 100)
                                }
                        }
                        .frame(height: 7)
                        if let reset = limit.resetDate {
                            Text("Resets \(reset.formatted(date: .abbreviated, time: .shortened))")
                                .font(.caption2).foregroundStyle(Palette.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
        }
        .padding(18)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 16))
    }
}
