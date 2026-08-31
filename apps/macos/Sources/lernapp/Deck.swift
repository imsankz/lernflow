// lernapp — portable deck study client for LernFlow decks.
// Platform: macOS 14+ (menu bar app), CLI-first. No SPM network deps.
// Read the portable deck format emitted by the lernflow pipeline:
//   out/<deck>.tsv (Anki TSV, # header lines) and .lernflow/rows.json (clean rows).

import Foundation
import SQLite3

// MARK: - Model

struct DeckRow: Identifiable, Codable, Equatable {
    var id: String { lemma }
    var lemma: String
    var gender: String
    var translation: String
    var forms: String
    var example: String
    var pos: String?
    var audio: String? // relative filename in the sidecar audio dir, if any
}

enum CardState: String, Codable, Equatable {
    case new, learning, review, relearning
}

struct Card: Codable, Equatable {
    var id: Int64 = 0
    var deckId: Int64 = 0
    var rowId: Int64 = 0 // index into the deck's rows
    var state: CardState = .new
    var stability: Double = 0
    var difficulty: Double = 0
    var due: Date = .distantPast
    var lastReview: Date?
    var reps: Int = 0
    var lapses: Int = 0
    var scheduledDays: Int = 0
    var scheduler: String = "fsrs" // "fsrs" or "sm2"
}

struct Deck: Codable, Equatable {
    var id: Int64 = 0
    var name: String
    var sourcePath: String
    var rows: [DeckRow] = []
    var audioDir: String?
    var importedAt: Date = Date()
}

enum Rating: Int, CaseIterable, Codable, Comparable {
    case again = 1, hard = 2, good = 3, easy = 4
    var label: String {
        switch self {
        case .again: return "Again"
        case .hard: return "Hard"
        case .good: return "Good"
        case .easy: return "Easy"
        }
    }
    var shortcut: String {
        switch self {
        case .again: return "1"
        case .hard: return "2"
        case .good: return "3"
        case .easy: return "4"
        }
    }
    static func < (l: Rating, r: Rating) -> Bool { l.rawValue < r.rawValue }
}

struct ReviewRecord: Codable {
    var id: Int64 = 0
    var cardId: Int64
    var rating: Rating
    var elapsedDays: Double
    var stability: Double
    var difficulty: Double
    var due: Date
    var reviewedAt: Date
}

// MARK: - Errors

enum LernError: Error, LocalizedError {
    case badDeckFile(String)
    case db(String)
    case notFound(String)
    var errorDescription: String? {
        switch self {
        case .badDeckFile(let s): return "bad deck file: \(s)"
        case .db(let s): return "db: \(s)"
        case .notFound(let s): return s
        }
    }
}

// MARK: - Date helpers

extension Date {
    var dayStart: Date { Calendar.current.startOfDay(for: self) }
    var dayIndex: Int { Int(dayStart.timeIntervalSince1970 / 86_400) }
    func daysAfter(_ n: Int) -> Date { Calendar.current.date(byAdding: .day, value: n, to: self) ?? self }
    static func fromDayIndex(_ i: Int) -> Date { Date(timeIntervalSince1970: Double(i) * 86_400) }
    var shortString: String {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f.string(from: self)
    }
    var timeString: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        return f.string(from: self)
    }
}

func daysBetween(_ a: Date, _ b: Date) -> Double {
    b.dayStart.timeIntervalSince(a.dayStart) / 86_400
}
