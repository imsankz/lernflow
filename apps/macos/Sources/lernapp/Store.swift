// Store.swift — local persistence via SQLite (CSQLite system library, no SPM deps).
// DB lives at ~/Library/Application Support/lernapp/lernapp.db
//
// Schema: decks, cards, reviews. Schedule lives on the card (FSRS/SM-2 state).

import Foundation
import SQLite3
import Combine

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

final class Store: ObservableObject {
    static let defaultPath =
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/lernapp/lernapp.db").path

    private var db: OpaquePointer?

    init(path: String = Store.defaultPath) throws {
        try open(path: path)
    }

    deinit {
        if let db { sqlite3_close(db) }
    }

    // MARK: open / migrate

    private func open(path: String) throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        var handle: OpaquePointer?
        guard sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK, let handle else {
            throw LernError.db("sqlite3_open failed: \(path)")
        }
        db = handle
        try exec("PRAGMA journal_mode=WAL;")
        try exec("PRAGMA foreign_keys=ON;")
        try migrate()
    }

    private func migrate() throws {
        try exec("""
        CREATE TABLE IF NOT EXISTS decks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          source_path TEXT NOT NULL,
          audio_dir TEXT,
          imported_at REAL NOT NULL
        );
        """)
        try exec("""
        CREATE TABLE IF NOT EXISTS cards (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          deck_id INTEGER NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
          row_id INTEGER NOT NULL,
          state TEXT NOT NULL DEFAULT 'new',
          stability REAL NOT NULL DEFAULT 0,
          difficulty REAL NOT NULL DEFAULT 0,
          due REAL NOT NULL DEFAULT 0,
          last_review REAL,
          reps INTEGER NOT NULL DEFAULT 0,
          lapses INTEGER NOT NULL DEFAULT 0,
          scheduled_days INTEGER NOT NULL DEFAULT 0,
          scheduler TEXT NOT NULL DEFAULT 'fsrs',
          UNIQUE(deck_id, row_id)
        );
        """)
        try exec("""
        CREATE TABLE IF NOT EXISTS reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          rating INTEGER NOT NULL,
          elapsed_days REAL NOT NULL DEFAULT 0,
          stability REAL NOT NULL DEFAULT 0,
          difficulty REAL NOT NULL DEFAULT 0,
          due REAL NOT NULL DEFAULT 0,
          reviewed_at REAL NOT NULL
        );
        """)
        try exec("CREATE TABLE IF NOT EXISTS deck_rows (\n          deck_id INTEGER NOT NULL,\n          row_id INTEGER NOT NULL,\n          pos INTEGER NOT NULL,\n          data TEXT NOT NULL,\n          PRIMARY KEY (deck_id, row_id)\n        );")
        try exec("CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);")
        try exec("CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id, reviewed_at);")
        try exec("CREATE INDEX IF NOT EXISTS idx_reviews_at ON reviews(reviewed_at);")
    }

    private func exec(_ sql: String) throws {
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else {
            throw LernError.db("exec failed: \(sql): \(err())")
        }
    }

    private func err() -> String {
        String(cString: sqlite3_errmsg(db))
    }

    // MARK: decks

    func upsertDeck(_ deck: Deck) throws -> Int64 {
        let existing = try deckId(name: deck.name)
        if let existing {
            try exec("DELETE FROM decks WHERE id = \(existing);")
        }
        let sql = """
        INSERT INTO decks (name, source_path, audio_dir, imported_at) VALUES (?, ?, ?, ?);
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, deck.name, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, deck.sourcePath, -1, SQLITE_TRANSIENT)
        if let ad = deck.audioDir { sqlite3_bind_text(stmt, 3, ad, -1, SQLITE_TRANSIENT) } else { sqlite3_bind_null(stmt, 3) }
        sqlite3_bind_double(stmt, 4, deck.importedAt.timeIntervalSince1970)
        guard sqlite3_step(stmt) == SQLITE_DONE else { throw LernError.db(err()) }
        let deckId = sqlite3_last_insert_rowid(db)
        for (i, row) in deck.rows.enumerated() {
            try insertCard(deckId: deckId, rowId: Int64(i), row: row)
            if let data = try? JSONEncoder().encode(row),
               let json = String(data: data, encoding: .utf8) {
                try insertRow(deckId: deckId, rowId: Int64(i), pos: Int64(i), data: json)
            }
        }
        return deckId
    }

    private func insertRow(deckId: Int64, rowId: Int64, pos: Int64, data: String) throws {
        let sql = "INSERT OR REPLACE INTO deck_rows (deck_id, row_id, pos, data) VALUES (?, ?, ?, ?);"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, deckId)
        sqlite3_bind_int64(stmt, 2, rowId)
        sqlite3_bind_int64(stmt, 3, pos)
        sqlite3_bind_text(stmt, 4, data, -1, SQLITE_TRANSIENT)
        guard sqlite3_step(stmt) == SQLITE_DONE else { throw LernError.db(err()) }
    }

    private func insertCard(deckId: Int64, rowId: Int64, row: DeckRow) throws {
        let sql = """
        INSERT INTO cards (deck_id, row_id, state, stability, difficulty, due, last_review, reps, lapses, scheduled_days, scheduler)
        VALUES (?, ?, 'new', 0, 0, ?, NULL, 0, 0, 0, 'fsrs');
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, deckId)
        sqlite3_bind_int64(stmt, 2, rowId)
        sqlite3_bind_double(stmt, 3, Date().timeIntervalSince1970)
        guard sqlite3_step(stmt) == SQLITE_DONE else { throw LernError.db(err()) }
    }

    func deckId(name: String) throws -> Int64? {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT id FROM decks WHERE name = ?;", -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, name, -1, SQLITE_TRANSIENT)
        if sqlite3_step(stmt) == SQLITE_ROW { return sqlite3_column_int64(stmt, 0) }
        return nil
    }

    func decks() throws -> [Deck] {
        var out: [Deck] = []
        var stmt: OpaquePointer?
        let sql = "SELECT id, name, source_path, audio_dir, imported_at FROM decks ORDER BY id DESC;"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        while sqlite3_step(stmt) == SQLITE_ROW {
            let id = sqlite3_column_int64(stmt, 0)
            let name = String(cString: sqlite3_column_text(stmt, 1))
            let src = String(cString: sqlite3_column_text(stmt, 2))
            let audio = sqlite3_column_text(stmt, 3).map { String(cString: $0) }
            let importedAt = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 4))
            var d = Deck(name: name, sourcePath: src, audioDir: audio, importedAt: importedAt)
            d.id = id
            d.rows = try rows(forDeck: id)
            out.append(d)
        }
        return out
    }

    private func rows(forDeck deckId: Int64) throws -> [DeckRow] {
        let sql = "SELECT data FROM deck_rows WHERE deck_id = ? ORDER BY row_id;"
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, deckId)
        var out: [DeckRow] = []
        while sqlite3_step(stmt) == SQLITE_ROW {
            if let c = sqlite3_column_text(stmt, 0),
               let d = String(cString: c).data(using: .utf8),
               let row = try? JSONDecoder().decode(DeckRow.self, from: d) {
                out.append(row)
            }
        }
        return out
    }

    // MARK: cards

    func cards(forDeck deckId: Int64) -> [Card] {
        var out: [Card] = []
        var stmt: OpaquePointer?
        let sql = """
        SELECT id, deck_id, row_id, state, stability, difficulty, due, last_review, reps, lapses, scheduled_days, scheduler
        FROM cards WHERE deck_id = ? ORDER BY row_id;
        """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return [] }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, deckId)
        while sqlite3_step(stmt) == SQLITE_ROW {
            var c = Card()
            c.id = sqlite3_column_int64(stmt, 0)
            c.deckId = sqlite3_column_int64(stmt, 1)
            c.rowId = sqlite3_column_int64(stmt, 2)
            c.state = CardState(rawValue: String(cString: sqlite3_column_text(stmt, 3))) ?? .new
            c.stability = sqlite3_column_double(stmt, 4)
            c.difficulty = sqlite3_column_double(stmt, 5)
            c.due = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 6))
            if let lr = sqlite3_column_text(stmt, 7) { c.lastReview = Date(timeIntervalSince1970: String(cString: lr).isEmpty ? 0 : Double(String(cString: lr))!) }
            c.reps = Int(sqlite3_column_int(stmt, 8))
            c.lapses = Int(sqlite3_column_int(stmt, 9))
            c.scheduledDays = Int(sqlite3_column_int(stmt, 10))
            c.scheduler = String(cString: sqlite3_column_text(stmt, 11))
            out.append(c)
        }
        return out
    }

    func card(id: Int64) -> Card? {
        var stmt: OpaquePointer?
        let sql = "SELECT id, deck_id, row_id, state, stability, difficulty, due, last_review, reps, lapses, scheduled_days, scheduler FROM cards WHERE id = ?;"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, id)
        guard sqlite3_step(stmt) == SQLITE_ROW else { return nil }
        var c = Card()
        c.id = sqlite3_column_int64(stmt, 0)
        c.deckId = sqlite3_column_int64(stmt, 1)
        c.rowId = sqlite3_column_int64(stmt, 2)
        c.state = CardState(rawValue: String(cString: sqlite3_column_text(stmt, 3))) ?? .new
        c.stability = sqlite3_column_double(stmt, 4)
        c.difficulty = sqlite3_column_double(stmt, 5)
        c.due = Date(timeIntervalSince1970: sqlite3_column_double(stmt, 6))
        if let lr = sqlite3_column_text(stmt, 7), let s = String(cString: lr) as String?, !s.isEmpty { c.lastReview = Date(timeIntervalSince1970: Double(s)!) }
        c.reps = Int(sqlite3_column_int(stmt, 8))
        c.lapses = Int(sqlite3_column_int(stmt, 9))
        c.scheduledDays = Int(sqlite3_column_int(stmt, 10))
        c.scheduler = String(cString: sqlite3_column_text(stmt, 11))
        return c
    }

    func updateCard(_ card: Card) throws {
        let sql = """
        UPDATE cards SET state=?, stability=?, difficulty=?, due=?, last_review=?, reps=?, lapses=?, scheduled_days=?, scheduler=?
        WHERE id = ?;
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_text(stmt, 1, card.state.rawValue, -1, SQLITE_TRANSIENT)
        sqlite3_bind_double(stmt, 2, card.stability)
        sqlite3_bind_double(stmt, 3, card.difficulty)
        sqlite3_bind_double(stmt, 4, card.due.timeIntervalSince1970)
        if let lr = card.lastReview { sqlite3_bind_double(stmt, 5, lr.timeIntervalSince1970) } else { sqlite3_bind_null(stmt, 5) }
        sqlite3_bind_int(stmt, 6, Int32(card.reps))
        sqlite3_bind_int(stmt, 7, Int32(card.lapses))
        sqlite3_bind_int(stmt, 8, Int32(card.scheduledDays))
        sqlite3_bind_text(stmt, 9, card.scheduler, -1, SQLITE_TRANSIENT)
        sqlite3_bind_int64(stmt, 10, card.id)
        guard sqlite3_step(stmt) == SQLITE_DONE else { throw LernError.db(err()) }
    }

    // MARK: reviews

    func addReview(_ r: ReviewRecord) throws {
        let sql = """
        INSERT INTO reviews (card_id, rating, elapsed_days, stability, difficulty, due, reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { throw LernError.db(err()) }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, r.cardId)
        sqlite3_bind_int(stmt, 2, Int32(r.rating.rawValue))
        sqlite3_bind_double(stmt, 3, r.elapsedDays)
        sqlite3_bind_double(stmt, 4, r.stability)
        sqlite3_bind_double(stmt, 5, r.difficulty)
        sqlite3_bind_double(stmt, 6, r.due.timeIntervalSince1970)
        sqlite3_bind_double(stmt, 7, r.reviewedAt.timeIntervalSince1970)
        guard sqlite3_step(stmt) == SQLITE_DONE else { throw LernError.db(err()) }
    }

    // MARK: stats

    func stats(deckId: Int64, now: Date = Date()) -> (due: Int, new: Int, learning: Int, reviewsToday: Int, streak: Int, forecast: [Int]) {
        var due = 0, newCards = 0, learning = 0
        for c in cards(forDeck: deckId) {
            switch c.state {
            case .new: newCards += 1
            case .learning, .relearning: learning += 1
            case .review: if c.due.dayIndex <= now.dayIndex { due += 1 }
            }
        }
        var reviewsToday = 0
        var stmt: OpaquePointer?
        let todayStart = now.dayStart.timeIntervalSince1970
        let sql = """
        SELECT COUNT(*) FROM reviews r JOIN cards c ON c.id = r.card_id
        WHERE c.deck_id = ? AND r.reviewed_at >= ?;
        """
        if sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK {
            defer { sqlite3_finalize(stmt) }
            sqlite3_bind_int64(stmt, 1, deckId)
            sqlite3_bind_double(stmt, 2, todayStart)
            if sqlite3_step(stmt) == SQLITE_ROW { reviewsToday = Int(sqlite3_column_int(stmt, 0)) }
        }
        var streak = 0
        var stmt2: OpaquePointer?
        if sqlite3_prepare_v2(db, "SELECT DISTINCT CAST(reviewed_at / 86400 AS INTEGER) AS d FROM reviews r JOIN cards c ON c.id = r.card_id WHERE c.deck_id = ? ORDER BY d DESC;", -1, &stmt2, nil) == SQLITE_OK {
            defer { sqlite3_finalize(stmt2) }
            sqlite3_bind_int64(stmt2, 1, deckId)
            var days: [Int] = []
            while sqlite3_step(stmt2) == SQLITE_ROW { days.append(Int(sqlite3_column_int(stmt2, 0))) }
            var expect = now.dayIndex
            for d in days {
                if d == expect { streak += 1; expect -= 1 }
                else if d == expect + 1 { continue } // today not reviewed yet
                else { break }
            }
        }
        // forecast: count cards due on each of the next 7 days
        var forecast: [Int] = []
        for day in 1...7 {
            let target = now.dayIndex + day
            let count = cards(forDeck: deckId).filter { $0.state == .review && $0.due.dayIndex == target }.count
            forecast.append(count)
        }
        return (due, newCards, learning, reviewsToday, streak, forecast)
    }

    /// Look up the deck row for a card (deck_id + row_id from cards → deck_rows.data).
    func row(forCardId cardId: Int64) -> DeckRow {
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT deck_id, row_id FROM cards WHERE id = ?;", -1, &stmt, nil) == SQLITE_OK else {
            return DeckRow(lemma: "?", gender: "", translation: "", forms: "", example: "", pos: nil, audio: nil)
        }
        defer { sqlite3_finalize(stmt) }
        sqlite3_bind_int64(stmt, 1, cardId)
        guard sqlite3_step(stmt) == SQLITE_ROW else {
            return DeckRow(lemma: "?", gender: "", translation: "", forms: "", example: "", pos: nil, audio: nil)
        }
        let deckId = sqlite3_column_int64(stmt, 0)
        let rowId = sqlite3_column_int64(stmt, 1)
        var q: OpaquePointer?
        guard sqlite3_prepare_v2(db, "SELECT data FROM deck_rows WHERE deck_id = ? AND row_id = ?;", -1, &q, nil) == SQLITE_OK else {
            return DeckRow(lemma: "?", gender: "", translation: "", forms: "", example: "", pos: nil, audio: nil)
        }
        defer { sqlite3_finalize(q) }
        sqlite3_bind_int64(q, 1, deckId)
        sqlite3_bind_int64(q, 2, rowId)
        if sqlite3_step(q) == SQLITE_ROW, let c = sqlite3_column_text(q, 0),
           let d = String(cString: c).data(using: .utf8),
           let row = try? JSONDecoder().decode(DeckRow.self, from: d) {
            return row
        }
        return DeckRow(lemma: "?", gender: "", translation: "", forms: "", example: "", pos: nil, audio: nil)
    }
}

// MARK: - Deck row cache (rows.json + TSV parsing lives here)

final class DeckParser {
    static func loadRows(fromRowsJSON url: URL) throws -> [DeckRow] {
        let data = try Data(contentsOf: url)
        struct Raw: Decodable {
            var entry: String?
            var lemma: String
            var gender: String
            var examples: String?
            var example: String?
            var translation: String
            var forms: String?
            var pos: String?
            var audio: String?
        }
        let raws = try JSONDecoder().decode([Raw].self, from: data)
        return raws.map { r in
            DeckRow(
                lemma: r.lemma,
                gender: r.gender,
                translation: r.translation,
                forms: r.forms ?? "",
                example: r.example ?? r.examples ?? "",
                pos: r.pos ?? "",
                audio: r.audio
            )
        }
    }

    /// Parses the Anki-export TSV (out/<deck>.tsv): # header lines, then
    /// tab-separated: term (lemma (gender)) | translation | example | forms | tags | deck.
    static func loadRows(fromTSV url: URL, fallbackTranslations: [String: String] = [:]) throws -> [DeckRow] {
        let text = try String(contentsOf: url, encoding: .utf8)
        var out: [DeckRow] = []
        var deckName = ""
        for line in text.split(whereSeparator: \.isNewline) {
            let s = String(line)
            if s.hasPrefix("#") {
                if s.hasPrefix("#deck:") { deckName = String(s.dropFirst("#deck:".count)).trimmingCharacters(in: .whitespaces) }
                continue
            }
            guard !s.trimmingCharacters(in: .whitespaces).isEmpty else { continue }
            let cols = s.components(separatedBy: "\t")
            guard cols.count >= 3 else { continue }
            var term = cols[0]
            var gender = ""
            if let open = term.firstIndex(of: "("), term.hasSuffix(")") {
                let g = term[term.index(after: open)..<term.index(before: term.endIndex)]
                gender = String(g)
                term = String(term[..<open]).trimmingCharacters(in: .whitespaces)
            }
            let translation = cols[1]
            let example = cols.count > 2 ? cols[2] : ""
            let forms = cols.count > 3 ? cols[3] : ""
            let pos = cols.count > 4 ? cols[4] : ""
            let audio = cols.count > 5 ? cols[5] : ""
            let tags = cols.count > 6 ? cols[6] : ""
            _ = tags
            out.append(DeckRow(
                lemma: term,
                gender: gender,
                translation: translation,
                forms: forms,
                example: example,
                pos: pos,
                audio: audio.isEmpty ? nil : audio
            ))
        }
        return out
    }
}

// MARK: - CLI / shared helpers

extension Store {
    /// Import a deck file (.json rows.json or .tsv). Returns the deck id.
    @discardableResult
    func importDeck(url: URL, deckName: String? = nil, audioDir: String? = nil) throws -> Int64 {
        let rows: [DeckRow]
        if url.pathExtension.lowercased() == "json" {
            rows = try DeckParser.loadRows(fromRowsJSON: url)
        } else {
            rows = try DeckParser.loadRows(fromTSV: url)
        }
        guard !rows.isEmpty else { throw LernError.badDeckFile("no rows parsed from \(url.lastPathComponent)") }
        let name = deckName ?? url.deletingPathExtension().lastPathComponent
        var deck = Deck(name: name, sourcePath: url.path)
        deck.audioDir = audioDir
        deck.rows = rows
        return try upsertDeck(deck)
    }
}
