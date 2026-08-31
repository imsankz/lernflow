// Main.swift — CLI entry + menu bar app (SwiftUI, macOS 14+).
//
// CLI modes (headless, used for smoke tests and scripting):
//   lernapp --import <rows.json|.tsv> [--name N] [--audio-dir D]
//   lernapp --headless-review N [--deck NAME]   (reviews the first N due/new cards Good)
//   lernapp --stats [--deck NAME]
//   lernapp --forecast
// No args → menu bar app.

import SwiftUI
import AppKit
import UniformTypeIdentifiers

@main
struct LernApp {
    static func main() {
        let args = CommandLine.arguments
        if args.contains("--import") {
            runCLIImport(args)
        } else if args.contains("--headless-review") {
            runHeadlessReview(args)
        } else if args.contains("--stats") {
            runStats(args)
        } else if args.contains("--forecast") {
            runForecast()
        } else {
            runMenuBar()
        }
    }

    // MARK: CLI

    static func runCLIImport(_ args: [String]) {
        guard let i = args.firstIndex(of: "--import"), i + 1 < args.count else {
            print("usage: lernapp --import <rows.json|.tsv> [--name N] [--audio-dir D]")
            exit(2)
        }
        let path = args[i + 1]
        let name = flagValue(args, "--name")
        let audioDir = flagValue(args, "--audio-dir")
        do {
            let store = try Store()
            let url = URL(fileURLWithPath: path)
            let deckId = try store.importDeck(url: url, deckName: name, audioDir: audioDir)
            let stats = store.stats(deckId: deckId)
            print("imported deck id=\(deckId) due=\(stats.due) new=\(stats.new) learning=\(stats.learning)")
        } catch {
            print("error: \(error.localizedDescription)")
            exit(1)
        }
    }

    static func runHeadlessReview(_ args: [String]) {
        guard let i = args.firstIndex(of: "--headless-review"), i + 1 < args.count, let n = Int(args[i + 1]) else {
            print("usage: lernapp --headless-review N [--deck NAME]")
            exit(2)
        }
        do {
            let store = try Store()
            let name = flagValue(args, "--deck")
            let decks = try store.decks()
            guard let deck = decks.first(where: { name == nil || $0.name == name }) else {
                print("error: no deck imported (run --import first)")
                exit(1)
            }
            let fsrs = FSRS()
            var cards = store.cards(forDeck: deck.id)
            cards.sort { $0.rowId < $1.rowId }
            let queue = Array(cards.prefix(n))
            let now = Date()
            print("deck: \(deck.name) (\(deck.rows.count) rows, reviewing \(queue.count) cards at \(now.shortString))")
            for (i, card) in queue.enumerated() {
                let row = deck.rows.indices.contains(Int(card.rowId)) ? deck.rows[Int(card.rowId)] : nil
                let label = row?.lemma ?? "row \(card.rowId)"
                let state = card.state.rawValue
                let r: FSRSReviewResult
                if card.scheduler == "sm2" {
                    var st = SM2State(intervalDays: card.scheduledDays, easeFactor: 2.5, reps: card.reps, lapses: card.lapses, lastReview: card.lastReview)
                    st = sm2Review(state: st, rating: .good, now: now)
                    let due = now.daysAfter(st.intervalDays)
                    var updated = card
                    updated.state = .review
                    updated.due = due
                    updated.scheduledDays = st.intervalDays
                    updated.lastReview = now
                    updated.stability = Double(st.intervalDays)
                    updated.difficulty = 5
                    try store.updateCard(updated)
                    let log = ReviewRecord(cardId: card.id, rating: .good, elapsedDays: daysBetween(card.lastReview ?? now, now), stability: updated.stability, difficulty: updated.difficulty, due: due, reviewedAt: now)
                    try store.addReview(log)
                    print(String(format: "%2d. [%@] %-28@ S=%5.2f D=%4.2f next=%dd (%@)", i + 1, state, label, updated.stability, updated.difficulty, updated.scheduledDays, updated.due.shortString))
                } else {
                    r = fsrsReview(fsrs, card: card, rating: .good, now: now)
                    var updated = card
                    updated.state = r.state
                    updated.stability = r.stability
                    updated.difficulty = r.difficulty
                    updated.scheduledDays = r.scheduledDays
                    updated.due = r.due
                    updated.lastReview = now
                    updated.reps += 1
                    try store.updateCard(updated)
                    let log = ReviewRecord(cardId: card.id, rating: .good, elapsedDays: daysBetween(card.lastReview ?? now, now), stability: r.stability, difficulty: r.difficulty, due: r.due, reviewedAt: now)
                    try store.addReview(log)
                    print(String(format: "%2d. [%@] %-28@ S=%5.2f D=%4.2f next=%dd (%@)", i + 1, state, label, r.stability, r.difficulty, r.scheduledDays, r.due.shortString))
                }
            }
            exit(0)
        } catch {
            print("error: \(error.localizedDescription)")
            exit(1)
        }
    }

    static func runStats(_ args: [String]) {
        do {
            let store = try Store()
            let name = flagValue(args, "--deck")
            for deck in try store.decks() where name == nil || deck.name == name {
                let s = store.stats(deckId: deck.id)
                print("\(deck.name): due=\(s.due) new=\(s.new) learning=\(s.learning) reviewsToday=\(s.reviewsToday) streak=\(s.streak) forecast=\(s.forecast)")
            }
        } catch {
            print("error: \(error.localizedDescription)")
            exit(1)
        }
    }

    static func runForecast() {
        do {
            let store = try Store()
            for deck in try store.decks() {
                let s = store.stats(deckId: deck.id)
                let days = (1...7).map { d in
                    let date = Date().daysAfter(d)
                    let count = store.cards(forDeck: deck.id).filter { $0.state == .review && $0.due.dayIndex == date.dayIndex }.count
                    return "\(date.shortString):\(count)"
                }
                print("\(deck.name): \(days.joined(separator: " "))")
            }
        } catch {
            print("error: \(error.localizedDescription)")
            exit(1)
        }
    }

    static func flagValue(_ args: [String], _ flag: String) -> String? {
        guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
        return args[i + 1]
    }

    // MARK: menu bar app

    static func runMenuBar() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let store: Store
        do {
            store = try Store()
        } catch {
            print("error: \(error.localizedDescription)")
            exit(1)
        }
        let delegate = AppDelegate(store: store)
        app.delegate = delegate
        app.run()
    }
}

// MARK: - AppDelegate + MenuBarExtra

final class AppDelegate: NSObject, NSApplicationDelegate {
    let store: Store
    var windowController: NSWindowController?

    init(store: Store) {
        self.store = store
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        Notifier.shared.requestAccess()
        Notifier.shared.scheduleDaily(hour: 7, minute: 40)
        let content = ContentView(store: store)
        let hosting = NSHostingController(rootView: content)
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 560),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Lernapp"
        window.contentViewController = hosting
        window.isReleasedWhenClosed = false
        window.center()
        window.setFrameAutosaveName("LernappMain")
        windowController = NSWindowController(window: window)
        window.makeKeyAndOrderFront(nil)
        NSApp.setActivationPolicy(.regular)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

struct ContentView: View {
    @StateObject private var store: Store
    @State private var deck: Deck?
    @State private var decks: [Deck] = []
    @State private var controller: ReviewController?
    @State private var showStats = false
    @State private var showImport = false
    @State private var importResult: String?
    @State private var assistant: (any Assistant)?
    @State private var showAsk = false

    init(store: Store) {
        _store = StateObject(wrappedValue: store)
    }

    var body: some View {
        VStack(spacing: 12) {
            header
            Divider()
            if let controller {
                if controller.finished {
                    finishView(controller: controller)
                } else if let current = controller.current {
                    reviewView(controller: controller, card: current)
                }
            } else if let deck {
                idleView(deck: deck)
            } else {
                emptyView
            }
            Divider()
            footer
        }
        .padding(16)
        .frame(minWidth: 380, minHeight: 480)
        .task {
            loadDecks()
            if assistant == nil { assistant = await AIEngine.make() }
        }
        .sheet(isPresented: $showAsk) {
            if let a = assistant, let card = controller?.current {
                AskSheet(card: CardContext(front: card.row.lemma, back: card.row.translation, sentence: card.row.example), assistant: a)
            }
        }
        .sheet(isPresented: $showImport) {
            ImportView(store: store) { deck in
                self.deck = deck
                loadDecks()
            }
        }
        .alert("Import", isPresented: Binding(get: { importResult != nil }, set: { if !$0 { importResult = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(importResult ?? "")
        }
    }

    private var header: some View {
        HStack {
            Text("Lernapp").font(.headline)
            Text("B1 in \(ExamCountdown.daysLeft()) Tagen")
                .font(.caption2.bold())
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background(.orange.opacity(0.15))
                .foregroundStyle(.orange)
                .clipShape(Capsule())
            Spacer()
            if let deck {
                Text(deck.name).font(.subheadline).foregroundStyle(.secondary)
            }
            Button("Import…") { showImport = true }
                .buttonStyle(.bordered)
        }
    }

    private var footer: some View {
        HStack {
            Button("Stats") { showStats.toggle() }
                .buttonStyle(.bordered)
            Spacer()
            Text("1–4 rate · space flip").font(.caption).foregroundStyle(.secondary)
        }
        .sheet(isPresented: $showStats) {
            StatsView(store: store, deck: deck)
        }
    }

    private var emptyView: some View {
        VStack(spacing: 12) {
            Text("No deck yet").font(.title3)
            Text("Import a rows.json or deck.tsv from a LernFlow build.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Import deck…") { showImport = true }
        }
        .padding(.vertical, 60)
    }

    private func idleView(deck: Deck) -> some View {
        let s = store.stats(deckId: deck.id)
        return VStack(spacing: 8) {
            Text("\(s.due) due · \(s.new) new").font(.title2)
            Text("streak \(s.streak) days · \(s.reviewsToday) reviewed today")
                .font(.caption).foregroundStyle(.secondary)
            Button("Start review") {
                let c = ReviewController(store: store)
                c.start(deckId: deck.id)
                controller = c
            }
            .buttonStyle(.borderedProminent)
            .disabled(s.due + min(s.new, 40) == 0)
        }
        .padding(.vertical, 40)
    }

    private func reviewView(controller: ReviewController, card: ReviewCardView) -> some View {
        VStack(spacing: 16) {
            HStack {
                Text("\(controller.index + 1)/\(controller.queue.count)")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                if let st = card.stability {
                    Text(String(format: "S %.1f", st)).font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(card.row.lemma + (card.row.gender.isEmpty ? "" : " (\(card.row.gender))"))
                .font(.system(.title, design: .rounded)).bold()
                .multilineTextAlignment(.center)
            if !card.row.forms.isEmpty {
                Text(card.row.forms).font(.subheadline).foregroundStyle(.secondary)
            }
            if card.row.example.isEmpty == false {
                Text(card.row.example).font(.body).multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Button(action: { controller.flip() }) {
                Text(controller.showAnswer ? "Hide answer" : "Show answer")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .keyboardShortcut(.space, modifiers: [])
            if assistant != nil {
                Button {
                    showAsk = true
                } label: {
                    Label("Fragen…", systemImage: "bubble.left.and.text.bubble.right")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.secondary)
            }
            if controller.showAnswer {
                Text(card.row.translation)
                    .font(.title3).bold()
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
                HStack(spacing: 10) {
                    ForEach(Rating.allCases, id: \.self) { r in
                        Button {
                            try? controller.rate(r)
                        } label: {
                            VStack(spacing: 2) {
                                Text(r.shortcut).font(.caption).foregroundStyle(.secondary)
                                Text(r.label).font(.subheadline)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .keyboardShortcut(KeyEquivalent(Character(r.shortcut)), modifiers: [])
                    }
                }
            }
        }
        .padding(.vertical, 16)
    }

    private func finishView(controller: ReviewController) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
            Text("Session complete").font(.title3)
            Text("\(controller.queue.count) cards · \(controller.newSeen) new").font(.subheadline).foregroundStyle(.secondary)
            Button("Done") { self.controller = nil }
                .buttonStyle(.borderedProminent)
        }
        .padding(.vertical, 40)
    }

    private func loadDecks() {
        do {
            decks = try store.decks()
            if deck == nil { deck = decks.first }
        } catch { decks = [] }
    }
}

// MARK: - Import view

struct ImportView: View {
    @Environment(\.dismiss) var dismiss
    let store: Store
    var onImport: (Deck) -> Void
    @State private var importError: String?

    var body: some View {
        VStack(spacing: 16) {
            Text("Import deck").font(.headline)
            Button("Choose rows.json / deck.tsv…") {
                let panel = NSOpenPanel()
                panel.allowedContentTypes = [.json, .plainText, .commaSeparatedText]
                panel.allowsMultipleSelection = false
                if panel.runModal() == .OK, let url = panel.url {
                    do {
                        let id = try store.importDeck(url: url)
                        let decks = try store.decks()
                        if let d = decks.first(where: { $0.id == id }) {
                            onImport(d)
                            dismiss()
                        }
                    } catch {
                        importError = error.localizedDescription
                    }
                }
            }
            .buttonStyle(.borderedProminent)
            if let importError {
                Text(importError).font(.caption).foregroundStyle(.red)
            }
            Button("Cancel") { dismiss() }
                .buttonStyle(.bordered)
        }
        .padding(24)
        .frame(width: 340)
    }
}

// MARK: - Stats view

struct StatsView: View {
    let store: Store
    let deck: Deck?
    @Environment(\.dismiss) var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Stats").font(.headline)
            if let deck {
                let s = store.stats(deckId: deck.id)
                LabeledContent("Due today", value: "\(s.due)")
                LabeledContent("New", value: "\(s.new)")
                LabeledContent("Learning", value: "\(s.learning)")
                LabeledContent("Reviewed today", value: "\(s.reviewsToday)")
                LabeledContent("Streak", value: "\(s.streak) days")
                Divider()
                Text("Next 7 days").font(.subheadline)
                ForEach(1...7, id: \.self) { d in
                    let date = Date().daysAfter(d)
                    let count = store.cards(forDeck: deck.id).filter { $0.state == .review && $0.due.dayIndex == date.dayIndex }.count
                    LabeledContent(date.shortString, value: "\(count) due")
                }
            } else {
                Text("Import a deck to see stats").foregroundStyle(.secondary)
            }
            Spacer()
            Button("Close") { dismiss() }
                .buttonStyle(.bordered)
                .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(width: 320, height: 380)
    }
}

// Keep the compiler honest about unused but referenced types.
extension Deck: @unchecked Sendable {}
extension DeckRow: @unchecked Sendable {}
