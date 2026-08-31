// Audio.swift — clip playback via AVFoundation.
// Looks for a clip named by lemma in a sidecar dir next to the deck file:
//   <deck-dir>/audio/<lemma>.mp3|.m4a|.wav|.aiff|.caf
// or an explicit audio dir recorded at import time.

import Foundation
import AVFoundation

final class AudioPlayer: NSObject, AVAudioPlayerDelegate, ObservableObject {
    static let shared = AudioPlayer()

    @Published var isPlaying: Bool = false
    private var player: AVAudioPlayer?

    private override init() {
        super.init()
        try? AVAudioSessionWrapper.configure()
    }

    /// Resolve an audio file for a row, or nil.
    func fileURL(for row: DeckRow, deck: Deck) -> URL? {
        let exts = ["mp3", "m4a", "wav", "aiff", "aif", "caf", "mp4"]
        var baseDir: URL?
        if let ad = deck.audioDir {
            baseDir = URL(fileURLWithPath: ad)
        } else {
            let deckURL = URL(fileURLWithPath: deck.sourcePath)
            let dir = deckURL.deletingLastPathComponent()
            baseDir = dir.appendingPathComponent("audio")
            if !FileManager.default.fileExists(atPath: baseDir!.path) {
                baseDir = dir
            }
        }
        guard let baseDir else { return nil }
        if let explicit = row.audio, !explicit.isEmpty {
            let u = URL(fileURLWithPath: explicit, relativeTo: baseDir)
            if FileManager.default.fileExists(atPath: u.path) { return u }
            // maybe absolute
            let abs = URL(fileURLWithPath: explicit)
            if FileManager.default.fileExists(atPath: abs.path) { return abs }
        }
        for ext in exts {
            let u = baseDir.appendingPathComponent("\(row.lemma).\(ext)")
            if FileManager.default.fileExists(atPath: u.path) { return u }
        }
        // gender fold: die Abbildung → die_Abbildung
        if !row.gender.isEmpty {
            let prefixed = "\(row.gender)_\(row.lemma)"
            for ext in exts {
                let u = baseDir.appendingPathComponent("\(prefixed).\(ext)")
                if FileManager.default.fileExists(atPath: u.path) { return u }
            }
        }
        return nil
    }

    func play(_ url: URL) {
        do {
            player = try AVAudioPlayer(contentsOf: url)
            player?.delegate = self
            player?.volume = 1.0
            player?.play()
            isPlaying = true
        } catch {
            isPlaying = false
        }
    }

    func stop() {
        player?.stop()
        player = nil
        isPlaying = false
    }

    func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully flag: Bool) {
        isPlaying = false
    }
}

// CLI has no audio session; wrap so AVAudioSession (iOS-only API) doesn't break macOS builds.
enum AVAudioSessionWrapper {
    static func configure() throws {
        // macOS: no-op
    }
}
