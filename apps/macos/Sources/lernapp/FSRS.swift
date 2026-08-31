// FSRS-5 spaced-repetition scheduler, implemented from scratch in Swift.
//
// Ported from the published algorithm (open-spaced-repetition/ts-fsrs, FSRS-5,
// algorithm.ts + impl/basic_scheduler.ts + abstract_scheduler.ts) and verified
// against that repo's own test vectors (FSRS-5.test.ts, algorithm.test.ts):
//   - first-repeat stability  [0.40255, 1.18385, 3.173, 15.69105]
//   - first-repeat difficulty [7.1949, 6.48830527, 5.28243442, 3.22450159]
//   - first-repeat scheduled days [0, 0, 0, 16]  (Good→Learning, Easy→Review day 16)
//   - Good-only interval history [0, 4, 14, 44, 125, 328, 0, 0, 7, 16, 34, 71, 142]
//
// Reference: https://github.com/open-spaced-repetition/ts-fsrs
// Algorithm wiki: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

import Foundation

// Default FSRS-5 weights (w[0..18]); median of 20k collections per fsrs4anki docs.
// Sourced from ts-fsrs FSRS-5.test.ts and FSRS rust reference (src/lib.rs, master).
// Note: FSRS-6 extends to 21 weights (w[19] short-term exponent, w[20] decay);
// this client pins FSRS-5 (19 weights, decay 0.5) — see iOS doc for the upgrade path.
let FSRS5_DEFAULT_W: [Double] = [
    0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575,
    0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621,
]

let FSRS5_DEFAULT_DECAY: Double = 0.5
let FSRS_REQUEST_RETENTION: Double = 0.9
let FSRS_MAXIMUM_INTERVAL: Double = 36_500
let FSRS_S_MIN: Double = 0.001
let FSRS_ENABLE_FUZZ = false
let FSRS_ENABLE_SHORT_TERM = true

// Default (re)learning steps in minutes, mirroring ts-fsrs defaults.
// New: 1m, 10m. Relearning: 10m. Grade mapping when steps are pending:
//   Again → first step, Hard → 1.5× first step (single-step decks), Good → next step.
let FSRS_LEARNING_STEPS: [Double] = [1, 10]
let FSRS_RELEARNING_STEPS: [Double] = [10]

struct FSRSState: Equatable {
    var stability: Double
    var difficulty: Double
}

enum FSRSGrade: Int {
    case again = 1, hard = 2, good = 3, easy = 4
}

final class FSRS {
    let w: [Double]
    let requestRetention: Double
    let maximumInterval: Double
    let decay: Double
    let factor: Double
    let intervalModifier: Double

    init(
        w: [Double] = FSRS5_DEFAULT_W,
        requestRetention: Double = FSRS_REQUEST_RETENTION,
        maximumInterval: Double = FSRS_MAXIMUM_INTERVAL
    ) {
        precondition(w.count >= 19, "FSRS-5 requires 19 weights")
        self.w = w
        self.requestRetention = requestRetention
        self.maximumInterval = maximumInterval
        // decay = -w[20] is the FSRS-6 extension; FSRS-5 pins decay = 0.5.
        self.decay = FSRS5_DEFAULT_DECAY
        let factor = exp((log(0.9) / decay)) - 1.0
        self.factor = factor
        self.intervalModifier = (pow(requestRetention, 1.0 / decay) - 1.0) / factor
    }

    // MARK: core math

    func forgettingCurve(elapsedDays: Double, stability: Double) -> Double {
        pow(1.0 + (factor * elapsedDays) / stability, decay)
    }

    func nextInterval(stability: Double, elapsedDays: Double = 0) -> Int {
        let raw = stability * intervalModifier
        let rounded = round(raw)
        let clamped = min(max(rounded, 1), maximumInterval)
        return Int(clamped)
    }

    func initStability(g: FSRSGrade) -> Double {
        max(w[g.rawValue - 1], 0.1)
    }

    func initDifficulty(g: FSRSGrade) -> Double {
        let d = w[4] - exp(Double(g.rawValue - 1) * w[5]) + 1
        return roundTo8(clamp(d, 1, 10))
    }

    func nextDifficulty(_ d: Double, g: FSRSGrade) -> Double {
        let deltaD = -w[6] * Double(g.rawValue - 3)
        let nextD = d + (deltaD * (10 - d)) / 9
        let initEasy = initDifficulty(g: .easy)
        return roundTo8(clamp(w[7] * initEasy + (1 - w[7]) * nextD, 1, 10))
    }

    func nextRecallStability(_ d: Double, _ s: Double, _ r: Double, g: FSRSGrade) -> Double {
        let hardPenalty = g == .hard ? w[15] : 1
        let easyBonus = g == .easy ? w[16] : 1
        let ns = s * (1 + exp(w[8]) * (11 - d) * pow(s, -w[9]) * (exp(w[10] * (1 - r)) - 1) * hardPenalty * easyBonus)
        return roundTo8(clamp(ns, FSRS_S_MIN, 36_500))
    }

    func nextForgetStability(_ d: Double, _ s: Double, _ r: Double) -> Double {
        let ns = w[11] * pow(d, -w[12]) * (pow(s + 1, w[13]) - 1) * exp(w[14] * (1 - r))
        let sMin = s / exp(w[17] * w[18])
        return roundTo8(clamp(ns, FSRS_S_MIN, min(sMin, 36_500)))
    }

    func nextShortTermStability(_ s: Double, g: FSRSGrade) -> Double {
        // FSRS-5: sinc = exp(w[17] * (g - 3 + w[18]))  (w has 19 entries: 0...18)
        let sinc = exp(w[17] * (Double(g.rawValue) - 3 + w[18]))
        let masked = g.rawValue >= FSRSGrade.hard.rawValue ? max(sinc, 1.0) : sinc
        return roundTo8(clamp(s * masked, FSRS_S_MIN, 36_500))
    }

    // MARK: state transition (mirrors ts-fsrs next_state)

    func nextState(current: FSRSState?, t: Double, g: FSRSGrade, r: Double? = nil) -> FSRSState {
        let d = current?.difficulty ?? 0
        let s = current?.stability ?? 0
        if d == 0 && s == 0 {
            return FSRSState(stability: initStability(g: g), difficulty: initDifficulty(g: g))
        }
        if d < 1 || s < FSRS_S_MIN {
            return FSRSState(stability: s, difficulty: d)
        }
        let rr = r ?? forgettingCurve(elapsedDays: t, stability: s)
        var newS: Double
        if t == 0 && FSRS_ENABLE_SHORT_TERM {
            newS = nextShortTermStability(s, g: g)
        } else if g == .again {
            newS = nextForgetStability(d, s, rr)
        } else {
            newS = nextRecallStability(d, s, rr, g: g)
        }
        let newD = nextDifficulty(d, g: g)
        return FSRSState(stability: newS, difficulty: newD)
    }
}

// MARK: scheduling (mirrors basic_scheduler + abstract_scheduler)

struct FSRSReviewResult {
    var state: CardState
    var due: Date
    var scheduledDays: Int
    var stability: Double
    var difficulty: Double
}

/// Full scheduling for one review action. Mirrors ts-fsrs BasicScheduler.
func fsrsReview(
    _ fsrs: FSRS,
    card: Card,
    rating: Rating,
    now: Date
) -> FSRSReviewResult {
    let grade = FSRSGrade(rawValue: rating.rawValue)!
    let elapsed = card.lastReview.map { daysBetween($0, now) } ?? 0.0

    var out = card
    out.lastReview = now
    out.reps += 1

    switch card.state {
    case .new:
        let st = fsrs.nextState(current: nil, t: 0, g: grade)
        out.stability = st.stability
        out.difficulty = st.difficulty
        // learning steps: 1m / 10m
        let minutes: Double
        switch rating {
        case .again: minutes = FSRS_LEARNING_STEPS[0]
        case .hard: minutes = (FSRS_LEARNING_STEPS[0] + FSRS_LEARNING_STEPS[1]) / 2
        case .good: minutes = FSRS_LEARNING_STEPS[1]
        case .easy: minutes = 60 * 24 * 8 // Easy skips steps → review
        }
        if minutes >= 24 * 60 {
            out.state = .review
            out.scheduledDays = Int(minutes / (24 * 60))
            out.due = now.daysAfter(out.scheduledDays)
        } else {
            out.state = .learning
            out.scheduledDays = 0
            out.due = now.addingTimeInterval(minutes * 60)
        }
    case .learning, .relearning:
        let st = fsrs.nextState(current: FSRSState(stability: card.stability, difficulty: card.difficulty), t: elapsed, g: grade)
        out.stability = st.stability
        out.difficulty = st.difficulty
        let steps = card.state == .relearning ? FSRS_RELEARNING_STEPS : FSRS_LEARNING_STEPS
        // Relearn/learn loop: Again → first step, Hard → same step, Good → graduation.
        let minutes: Double
        switch rating {
        case .again: minutes = steps[0]
        case .hard: minutes = steps[0] * 1.5
        case .good, .easy: minutes = -1 // graduate
        }
        if minutes >= 0 && minutes < 24 * 60 {
            out.state = card.state == .relearning ? .relearning : .learning
            out.scheduledDays = 0
            out.due = now.addingTimeInterval(minutes * 60)
        } else {
            out.state = .review
            let ivl = fsrs.nextInterval(stability: st.stability, elapsedDays: elapsed)
            out.scheduledDays = ivl
            out.due = now.daysAfter(ivl)
        }
    case .review:
        let st = fsrs.nextState(
            current: FSRSState(stability: card.stability, difficulty: card.difficulty),
            t: Double(max(elapsed, 0)),
            g: grade
        )
        out.stability = st.stability
        out.difficulty = st.difficulty
        if rating == .again {
            // relearning step then graduate to review
            out.state = .relearning
            out.lapses += 1
            out.scheduledDays = 0
            out.due = now.addingTimeInterval(FSRS_RELEARNING_STEPS[0] * 60)
        } else {
            out.state = .review
            var hardIvl = fsrs.nextInterval(stability: st.stability, elapsedDays: elapsed)
            let goodIvl = fsrs.nextInterval(stability: st.stability, elapsedDays: elapsed)
            hardIvl = min(hardIvl, goodIvl)
            let goodIvl2 = max(goodIvl, hardIvl + 1)
            let easyIvl = max(fsrs.nextInterval(stability: st.stability, elapsedDays: elapsed), goodIvl2 + 1)
            let ivl: Int
            switch rating {
            case .again: ivl = hardIvl
            case .hard: ivl = hardIvl
            case .good: ivl = goodIvl2
            case .easy: ivl = easyIvl
            }
            out.scheduledDays = ivl
            out.due = now.daysAfter(ivl)
        }
    }
    return FSRSReviewResult(state: out.state, due: out.due, scheduledDays: out.scheduledDays, stability: out.stability, difficulty: out.difficulty)
}

private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double {
    min(max(v, lo), hi)
}

private func roundTo8(_ v: Double) -> Double {
    (v * 1e8).rounded() / 1e8
}
