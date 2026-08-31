// Review.swift — SM-2 fallback scheduler + the in-session review loop state.
// SM-2 is used when a card's scheduler flag is "sm2" (import-time choice or manual
// downgrade). FSRS is the default. SM-2 params follow the classic algorithm:
//   ease factor 2.5, initial interval 1d, min interval 1d, lapses → relearn + reset.

import Foundation

// MARK: - SM-2

struct SM2State {
    var intervalDays: Int = 0
    var easeFactor: Double = 2.5
    var reps: Int = 0
    var lapses: Int = 0
    var lastReview: Date?
}

func sm2Review(state: SM2State, rating: Rating, now: Date) -> SM2State {
    var s = state
    s.lastReview = now
    switch rating {
    case .again:
        s.reps = 0
        s.lapses += 1
        s.intervalDays = 1
        s.easeFactor = max(1.3, s.easeFactor - 0.20)
    case .hard:
        s.reps += 1
        s.intervalDays = max(1, Int(Double(s.intervalDays) * 1.2))
        s.easeFactor = max(1.3, s.easeFactor - 0.15)
    case .good:
        s.reps += 1
        if s.reps == 1 { s.intervalDays = 1 }
        else if s.reps == 2 { s.intervalDays = 6 }
        else { s.intervalDays = Int(Double(s.intervalDays) * s.easeFactor) }
    case .easy:
        s.reps += 1
        if s.reps == 1 { s.intervalDays = 4 }
        else { s.intervalDays = Int(Double(s.intervalDays) * s.easeFactor * 1.3) }
        s.easeFactor = min(3.2, s.easeFactor + 0.15)
    }
    return s
}

// MARK: - Review loop

struct ReviewSession {
    var queue: [Int64] = [] // card ids in review order
    var index: Int = 0
    var newSeen: Int = 0
    var againCount: Int = 0
    var startedAt: Date = Date()
}

struct ReviewCardView {
    var cardId: Int64
    var row: DeckRow
    var isNew: Bool
    var flipState: Bool = false
    var dueDate: Date?
    var stability: Double?
    var difficulty: Double?
}

/// Builds the study queue for today: due reviews first, then new cards up to the
/// daily goal, then (optionally) any learning cards whose due time has passed.
struct QueueBuilder {
    var dailyNewGoal: Int = 40

    func build(store: Store, deckId: Int64, now: Date = Date()) -> [Int64] {
        let cards = store.cards(forDeck: deckId)
        var due: [Int64] = []
        var learning: [Int64] = []
        var newCards: [Int64] = []
        var newCount = 0
        for c in cards {
            switch c.state {
            case .new:
                newCards.append(c.id)
            case .learning, .relearning:
                if c.due <= now { learning.append(c.id) }
            case .review:
                if c.due.dayIndex <= now.dayIndex { due.append(c.id) }
            }
        }
        // deterministic new-card order: by row id
        newCards.sort { $0 < $1 }
        let newLimit = min(newCards.count, dailyNewGoal)
        var queue = due
        queue.append(contentsOf: learning)
        queue.append(contentsOf: newCards.prefix(newLimit))
        return queue
    }
}

/// The live study state machine. The UI holds one; CLI headless mode drives it too.
final class ReviewController: ObservableObject {
    let store: Store
    let fsrs = FSRS()

    @Published var deckId: Int64 = 0
    @Published var queue: [Int64] = []
    @Published var index: Int = 0
    @Published var current: ReviewCardView?
    @Published var showAnswer: Bool = false
    @Published var finished: Bool = false
    @Published var newSeen: Int = 0

    init(store: Store) {
        self.store = store
    }

    func start(deckId: Int64, now: Date = Date()) {
        self.deckId = deckId
        queue = QueueBuilder().build(store: store, deckId: deckId, now: now)
        index = 0
        finished = queue.isEmpty
        advance()
    }

    func advance() {
        guard index < queue.count else {
            finished = true
            current = nil
            return
        }
        let card = store.card(id: queue[index])!
        let row = store.row(forCardId: card.id)
        current = ReviewCardView(
            cardId: card.id,
            row: row,
            isNew: card.state == .new,
            dueDate: card.due,
            stability: card.stability > 0 ? card.stability : nil,
            difficulty: card.difficulty > 0 ? card.difficulty : nil
        )
        showAnswer = false
    }

    /// Returns the resulting card so callers can persist. Throws on store failure.
    @discardableResult
    func rate(_ rating: Rating, now: Date = Date()) throws -> Card {
        guard let card = store.card(id: queue[index]) else {
            throw LernError.notFound("card \(queue[index]) missing")
        }
        let result: FSRSReviewResult
        if card.scheduler == "sm2" {
            var st = SM2State(
                intervalDays: card.scheduledDays,
                easeFactor: 2.5,
                reps: card.reps,
                lapses: card.lapses,
                lastReview: card.lastReview
            )
            st = sm2Review(state: st, rating: rating, now: now)
            let due = st.intervalDays > 0 ? now.daysAfter(st.intervalDays) : now.addingTimeInterval(10 * 60)
            var updated = card
            updated.state = st.intervalDays <= 1 && card.state != .review ? .learning : .review
            updated.scheduledDays = st.intervalDays
            updated.reps = st.reps
            updated.lapses = st.lapses
            updated.due = due
            updated.lastReview = now
            updated.stability = Double(st.intervalDays)
            updated.difficulty = 5
            try store.updateCard(updated)
            let log = ReviewRecord(cardId: card.id, rating: rating, elapsedDays: daysBetween(card.lastReview ?? now, now), stability: updated.stability, difficulty: updated.difficulty, due: due, reviewedAt: now)
            try store.addReview(log)
            if card.state == .new { newSeen += 1 }
            index += 1
            advance()
            return updated
        }
        let r = fsrsReview(fsrs, card: card, rating: rating, now: now)
        var updated = card
        updated.state = r.state
        updated.stability = r.stability
        updated.difficulty = r.difficulty
        updated.scheduledDays = r.scheduledDays
        updated.due = r.due
        updated.lastReview = now
        updated.reps += 1
        if rating == .again && card.state == .review { updated.lapses += 1 }
        try store.updateCard(updated)
        let log = ReviewRecord(cardId: card.id, rating: rating, elapsedDays: daysBetween(card.lastReview ?? now, now), stability: r.stability, difficulty: r.difficulty, due: r.due, reviewedAt: now)
        try store.addReview(log)
        if card.state == .new { newSeen += 1 }
        index += 1
        advance()
        return updated
    }

    func flip() {
        showAnswer.toggle()
    }

    var dueCount: Int { queue.count - index }
    var progressText: String { "\(min(index + 1, queue.count)) / \(queue.count)" }
}
