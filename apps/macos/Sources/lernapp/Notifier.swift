// Notifier.swift — daily study reminder via UserNotifications.
// Works from a bundled .app (Info needed); in dev CLI mode request silently fails.

import Foundation
import UserNotifications

final class Notifier {
    static let shared = Notifier()

    func requestAccess() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Daily reminder at HH:MM local time, unless today's reviews already > 0.
    func scheduleDaily(hour: Int, minute: Int) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ["lernapp.daily"])
        let content = UNMutableNotificationContent()
        content.title = "Lernapp 🇩🇪"
        content.body = "Zeit für deine B1-Karten — noch \(ExamCountdown.daysLeft()) Tage bis zur Prüfung."
        content.sound = .default
        var comps = DateComponents()
        comps.hour = hour; comps.minute = minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
        let req = UNNotificationRequest(identifier: "lernapp.daily", content: content, trigger: trigger)
        center.add(req, withCompletionHandler: nil)
    }
}

enum ExamCountdown {
    // telc B1 exam date; move into Settings later.
    static let date = Calendar.current.date(from: DateComponents(year: 2026, month: 11, day: 16)) ?? Date()
    static func daysLeft(now: Date = Date()) -> Int {
        let a = Calendar.current.startOfDay(for: now)
        let b = Calendar.current.startOfDay(for: date)
        return max(0, Calendar.current.dateComponents([.day], from: a, to: b).day ?? 0)
    }
}
