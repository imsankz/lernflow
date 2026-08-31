// Assistant.swift — "Ask about this card" AI layer.
// Primary: on-device Apple Foundation Models (macOS 26+, Neural Engine, private).
// Fallback: any OpenAI-compatible endpoint via AI_BASE_URL/AI_API_KEY/AI_MODEL env
// (OmniRoute default). Same `Assistant` protocol — callers don't know which ran.

import Foundation
import SwiftUI

struct CardContext: Sendable {
    let front: String
    let back: String
    let sentence: String
}

enum AssistantError: LocalizedError {
    case notAvailable, badResponse, http(Int)
    var errorDescription: String? {
        switch self {
        case .notAvailable: return "On-device model unavailable"
        case .badResponse: return "Bad AI response"
        case .http(let c): return "AI endpoint error \(c)"
        }
    }
}

protocol Assistant: Sendable {
    var label: String { get }
    func answer(_ question: String, about card: CardContext) async throws -> String
}

// Resolve best engine: on-device if available, else env endpoint, else nil (UI hides Ask).
enum AIEngine {
    static func make() async -> (any Assistant)? {
        if #available(macOS 26.0, *) {
            let a = OnDeviceAssistant()
            if await a.isAvailable { return a }
        }
        if let url = ProcessInfo.processInfo.environment["AI_BASE_URL"] {
            return OmniRouteAssistant(baseURL: url,
                                      apiKey: ProcessInfo.processInfo.environment["AI_API_KEY"] ?? "",
                                      model: ProcessInfo.processInfo.environment["AI_MODEL"] ?? "auto/best-free")
        }
        return nil
    }
}

// MARK: - On-device (Apple Neural Engine via FoundationModels)

#if canImport(FoundationModels)
import FoundationModels

@available(macOS 26.0, *)
struct OnDeviceAssistant: Assistant {
    let label = "On-device (Neural Engine)"

    var isAvailable: Bool {
        get async { await SystemLanguageModel.default.isAvailable }
    }

    func answer(_ question: String, about card: CardContext) async throws -> String {
        let session = LanguageModelSession {
            """
            You are a patient German tutor for a B1 exam learner.
            Current card — Front: \(card.front) | Back: \(card.back) | Example: \(card.sentence)
            Answer the learner's question about this card. German first, then one short English gloss line.
            Keep it under 4 sentences.
            """
        }
        let response = try await session.respond { question }
        return response.content
    }
}
#endif

// MARK: - OmniRoute / OpenAI-compatible fallback (works everywhere)

struct OmniRouteAssistant: Assistant {
    let label = "OmniRoute"
    let baseURL: String
    let apiKey: String
    let model: String

    func answer(_ question: String, about card: CardContext) async throws -> String {
        var req = URLRequest(url: URL(string: baseURL.hasSuffix("/") ? baseURL + "chat/completions" : baseURL + "/chat/completions")!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !apiKey.isEmpty { req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization") }
        let sys = "You are a patient German tutor for a B1 exam learner. Current card — Front: \(card.front) | Back: \(card.back) | Example: \(card.sentence). German first, short English gloss, <4 sentences."
        let body: [String: Any] = [
            "model": model, "stream": false, "temperature": 0.3, "max_tokens": 300,
            "messages": [["role": "system", "content": sys], ["role": "user", "content": question]],
        ]
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, http.statusCode == 200 else {
            throw AssistantError.http((resp as? HTTPURLResponse)?.statusCode ?? -1)
        }
        // JSON or SSE (OmniRoute quirk: data: lines even with stream:false)
        if let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let choices = j["choices"] as? [[String: Any]],
           let msg = choices.first?["message"] as? [String: Any],
           let content = msg["content"] as? String {
            return content
        }
        let text = String(decoding: data, as: UTF8.self)
        for line in text.split(separator: "\n") {
            let s = line.trimmingCharacters(in: .whitespaces)
            guard s.hasPrefix("data:") else { continue }
            if let d = (try? JSONSerialization.jsonObject(with: Data(s.dropFirst(5).utf8))) as? [String: Any],
               let choices = d["choices"] as? [[String: Any]],
               let msg = choices.first?["message"] as? [String: Any],
               let content = msg["content"] as? String {
                return content
            }
        }
        throw AssistantError.badResponse
    }
}

// MARK: - UI

struct AskSheet: View {
    let card: CardContext
    let assistant: any Assistant
    @Environment(\.dismiss) private var dismiss
    @State private var draft = ""
    @State private var thinking = false
    @State private var thread: [(q: String, a: String)] = []

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Ask — \(assistant.label)").font(.headline)
                Spacer()
                Button("Fertig") { dismiss() }
            }
            .padding(12)
            Divider()
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(thread.enumerated()), id: \.offset) { _, t in
                        Text(t.q).font(.callout).bold()
                            .frame(maxWidth: .infinity, alignment: .trailing)
                            .padding(8).background(Color.accentColor.opacity(0.12))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Text(t.a).font(.callout)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(8).background(.quaternary.opacity(0.4))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    if thinking { Text("…denke nach").foregroundStyle(.secondary) }
                }.padding(12)
            }
            Divider()
            HStack {
                TextField("Warum 'dem Kind'? / Beispiel?", text: $draft)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { ask() }
                Button("Ask") { ask() }
                    .buttonStyle(.borderedProminent)
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || thinking)
            }
            .padding(12)
        }
        .frame(minWidth: 400, minHeight: 360)
    }

    private func ask() {
        let q = draft.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !thinking else { return }
        draft = ""
        thinking = true
        let a = assistant
        let ctx = card
        Task {
            let ans: String
            do { ans = try await a.answer(q, about: ctx) }
            catch { ans = "⚠️ \(error.localizedDescription)" }
            await MainActor.run { thread.append((q, ans)); thinking = false }
        }
    }
}
