import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import Capacitor

/**
 Native AVPlayer-backed playback for Capacitor iOS.

 Queue / Connect / EQ stay in JS. This plugin owns decode, AVAudioSession
 activation, MPNowPlayingInfoCenter, and MPRemoteCommandCenter. Remote next/prev
 emit events so JS can advance the queue and call `load` again.
 */
@objc(PolarrPlayerPlugin)
public class PolarrPlayerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PolarrPlayerPlugin"
    public let jsName = "PolarrPlayer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "load", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "play", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pause", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "toggle", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "seek", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getState", returnType: CAPPluginReturnPromise),
    ]

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?

    private var trackId: String?
    private var currentUrl: String?
    private var artworkTask: URLSessionDataTask?
    private var metadataGeneration = UUID()
    private var cachedArtwork: (url: String, artwork: MPMediaItemArtwork)?
    private let artworkLock = NSLock()
    private var remoteCommandsWired = false
    private var lastEmittedPosition: Double = -1

    // MARK: - Capacitor API

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": true])
    }

    @objc func load(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url")?.trimmingCharacters(in: .whitespacesAndNewlines),
              !urlString.isEmpty,
              let url = Self.playableURL(urlString) else {
            call.reject("url required")
            return
        }

        let track = call.getObject("track") ?? [:]
        let title = (track["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !title.isEmpty else {
            call.reject("track.title required")
            return
        }

        let autoplay = call.getBool("autoplay") ?? true
        let position = max(0, call.getDouble("position") ?? 0)
        let artist = (track["artist"] as? String) ?? ""
        let album = (track["album"] as? String) ?? ""
        let artworkUrl = track["artworkUrl"] as? String
        let token = track["token"] as? String
        let durationHint = track["durationHint"] as? Double
        let id = track["id"] as? String

        DispatchQueue.main.async {
            self.ensureRemoteCommands()
            self.activateSession()
            self.replacePlayer(with: url)
            self.trackId = id
            self.currentUrl = urlString

            self.applyNowPlayingMetadata(
                title: title,
                artist: artist,
                album: album,
                durationHint: durationHint,
                artworkUrl: artworkUrl,
                token: token
            )

            self.notifyListeners("trackchange", data: [
                "trackId": id as Any,
                "url": urlString,
                "title": title,
                "artist": artist,
                "album": album,
            ])

            let finishLoad: () -> Void = {
                let duration = self.currentDuration()
                if position > 0.25 {
                    self.seekPlayer(to: position, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                        if autoplay {
                            self.player?.play()
                            self.syncNowPlayingPlayback(playing: true)
                            self.notifyListeners("playing", data: self.statePayload(playing: true))
                        }
                        call.resolve([
                            "duration": duration,
                            "position": self.currentPosition(),
                        ])
                    }
                } else {
                    if autoplay {
                        self.player?.play()
                        self.syncNowPlayingPlayback(playing: true)
                        self.notifyListeners("playing", data: self.statePayload(playing: true))
                    }
                    call.resolve([
                        "duration": duration,
                        "position": self.currentPosition(),
                    ])
                }
            }

            // Wait briefly for item readiness so duration is useful.
            if let item = self.player?.currentItem, item.status == .readyToPlay {
                finishLoad()
            } else {
                var handled = false
                self.statusObservation = self.player?.currentItem?.observe(\.status, options: [.new]) { [weak self] item, _ in
                    guard let self, !handled else { return }
                    if item.status == .readyToPlay {
                        handled = true
                        finishLoad()
                    } else if item.status == .failed {
                        handled = true
                        let message = item.error?.localizedDescription ?? "failed to load"
                        self.notifyListeners("error", data: [
                            "code": "load_failed",
                            "message": message,
                            "url": urlString,
                        ])
                        call.reject(message)
                    }
                }
                // Safety timeout — still resolve so JS can keep UI moving.
                DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
                    guard let self, !handled else { return }
                    handled = true
                    finishLoad()
                }
            }
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.activateSession()
            guard self.player?.currentItem != nil else {
                call.reject("nothing loaded")
                return
            }
            self.player?.play()
            self.syncNowPlayingPlayback(playing: true)
            self.notifyListeners("playing", data: self.statePayload(playing: true))
            call.resolve()
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player?.pause()
            self.syncNowPlayingPlayback(playing: false)
            self.notifyListeners("paused", data: self.statePayload(playing: false))
            call.resolve()
        }
    }

    @objc func toggle(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let playing = (self.player?.rate ?? 0) > 0.01
            if playing {
                self.player?.pause()
                self.syncNowPlayingPlayback(playing: false)
                self.notifyListeners("paused", data: self.statePayload(playing: false))
                call.resolve(["playing": false])
            } else {
                self.activateSession()
                self.player?.play()
                self.syncNowPlayingPlayback(playing: true)
                self.notifyListeners("playing", data: self.statePayload(playing: true))
                call.resolve(["playing": true])
            }
        }
    }

    @objc func seek(_ call: CAPPluginCall) {
        let position = call.getDouble("position") ?? -1
        guard position >= 0 else {
            call.reject("position required")
            return
        }
        DispatchQueue.main.async {
            self.seekPlayer(to: position, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                self.syncNowPlayingPlayback(playing: (self.player?.rate ?? 0) > 0.01)
                call.resolve(["position": self.currentPosition()])
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.player?.pause()
            self.teardownPlayer()
            self.clearNowPlaying()
            self.trackId = nil
            self.currentUrl = nil
            self.notifyListeners("paused", data: [
                "playing": false,
                "position": 0,
                "duration": 0,
            ])
            call.resolve()
        }
    }

    @objc func getState(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve(self.statePayload(playing: (self.player?.rate ?? 0) > 0.01))
        }
    }

    // MARK: - Player lifecycle

    private func replacePlayer(with url: URL) {
        teardownTimeObservers()
        let item = AVPlayerItem(url: url)
        if let player {
            player.replaceCurrentItem(with: item)
        } else {
            let created = AVPlayer(playerItem: item)
            created.actionAtItemEnd = .pause
            player = created
            rateObservation = created.observe(\.rate, options: [.new]) { [weak self] player, _ in
                guard let self else { return }
                let playing = player.rate > 0.01
                self.syncNowPlayingPlayback(playing: playing)
            }
        }
        installTimeObserver()
        installEndObserver(for: item)
    }

    private func teardownPlayer() {
        teardownTimeObservers()
        player?.replaceCurrentItem(with: nil)
        statusObservation = nil
    }

    private func teardownTimeObservers() {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
            self.timeObserver = nil
        }
        if let endObserver {
            NotificationCenter.default.removeObserver(endObserver)
            self.endObserver = nil
        }
        statusObservation = nil
        lastEmittedPosition = -1
    }

    private func installTimeObserver() {
        guard let player else { return }
        let interval = CMTime(seconds: 0.4, preferredTimescale: 600)
        timeObserver = player.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            let position = time.seconds.isFinite ? time.seconds : 0
            if abs(position - self.lastEmittedPosition) < 0.2 { return }
            self.lastEmittedPosition = position
            let playing = player.rate > 0.01
            self.notifyListeners("timeupdate", data: [
                "position": position,
                "duration": self.currentDuration(),
                "playing": playing,
            ])
            self.syncNowPlayingPlayback(playing: playing)
        }
    }

    private func installEndObserver(for item: AVPlayerItem) {
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self else { return }
            self.syncNowPlayingPlayback(playing: false)
            self.notifyListeners("ended", data: [
                "trackId": self.trackId as Any,
            ])
        }
    }

    private func seekPlayer(
        to seconds: Double,
        toleranceBefore: CMTime,
        toleranceAfter: CMTime,
        completion: @escaping (Bool) -> Void
    ) {
        guard let player else {
            completion(false)
            return
        }
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player.seek(to: time, toleranceBefore: toleranceBefore, toleranceAfter: toleranceAfter) { finished in
            completion(finished)
        }
    }

    private func currentPosition() -> Double {
        let seconds = player?.currentTime().seconds ?? 0
        return seconds.isFinite ? max(0, seconds) : 0
    }

    private func currentDuration() -> Double {
        if let d = player?.currentItem?.duration.seconds, d.isFinite, d > 0 {
            return d
        }
        return 0
    }

    private func statePayload(playing: Bool) -> [String: Any] {
        var payload: [String: Any] = [
            "playing": playing,
            "position": currentPosition(),
            "duration": currentDuration(),
        ]
        if let trackId { payload["trackId"] = trackId }
        if let currentUrl { payload["url"] = currentUrl }
        return payload
    }

    private func activateSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [.allowAirPlay, .allowBluetoothA2DP])
            try session.setActive(true)
        } catch {
            print("PolarrPlayer: AVAudioSession activate failed: \(error)")
        }
    }

    private static func playableURL(_ raw: String) -> URL? {
        if raw.hasPrefix("file://"), let url = URL(string: raw) {
            return url
        }
        if raw.hasPrefix("/"), !raw.hasPrefix("//") {
            return URL(fileURLWithPath: raw)
        }
        return URL(string: raw)
    }

    // MARK: - Now Playing + remote commands

    private func ensureRemoteCommands() {
        guard !remoteCommandsWired else { return }
        remoteCommandsWired = true
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.pauseCommand.isEnabled = true
        center.togglePlayPauseCommand.isEnabled = true
        center.nextTrackCommand.isEnabled = true
        center.previousTrackCommand.isEnabled = true
        center.changePlaybackPositionCommand.isEnabled = true
        center.seekForwardCommand.isEnabled = false
        center.seekBackwardCommand.isEnabled = false

        center.playCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.activateSession()
            self.player?.play()
            self.syncNowPlayingPlayback(playing: true)
            self.notifyListeners("playing", data: self.statePayload(playing: true))
            self.notifyListeners("remote", data: ["action": "play"])
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            self.player?.pause()
            self.syncNowPlayingPlayback(playing: false)
            self.notifyListeners("paused", data: self.statePayload(playing: false))
            self.notifyListeners("remote", data: ["action": "pause"])
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self else { return .commandFailed }
            let playing = (self.player?.rate ?? 0) > 0.01
            if playing {
                self.player?.pause()
                self.syncNowPlayingPlayback(playing: false)
                self.notifyListeners("paused", data: self.statePayload(playing: false))
                self.notifyListeners("remote", data: ["action": "pause"])
            } else {
                self.activateSession()
                self.player?.play()
                self.syncNowPlayingPlayback(playing: true)
                self.notifyListeners("playing", data: self.statePayload(playing: true))
                self.notifyListeners("remote", data: ["action": "play"])
            }
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remote", data: ["action": "next"])
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.notifyListeners("remote", data: ["action": "previous"])
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let self,
                  let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            let position = event.positionTime
            self.seekPlayer(to: position, toleranceBefore: .zero, toleranceAfter: .zero) { _ in
                self.syncNowPlayingPlayback(playing: (self.player?.rate ?? 0) > 0.01)
                self.notifyListeners("timeupdate", data: [
                    "position": self.currentPosition(),
                    "duration": self.currentDuration(),
                    "playing": (self.player?.rate ?? 0) > 0.01,
                ])
                self.notifyListeners("remote", data: [
                    "action": "seek",
                    "position": position,
                ])
            }
            return .success
        }
    }

    private func applyNowPlayingMetadata(
        title: String,
        artist: String,
        album: String,
        durationHint: Double?,
        artworkUrl: String?,
        token: String?
    ) {
        let generation = UUID()
        metadataGeneration = generation
        artworkTask?.cancel()

        let reusable = readCachedArtwork(matching: artworkUrl)
        if reusable == nil { writeCachedArtwork(nil) }

        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyArtist: artist,
            MPMediaItemPropertyAlbumTitle: album,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.audio.rawValue,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: 0,
            MPNowPlayingInfoPropertyPlaybackRate: 0,
        ]
        if let durationHint, durationHint > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = durationHint
        }
        if let reusable {
            info[MPMediaItemPropertyArtwork] = reusable
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = .paused

        guard let artworkUrl,
              let url = URL(string: artworkUrl),
              ["http", "https"].contains(url.scheme?.lowercased() ?? "") else {
            return
        }
        if reusable != nil { return }

        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        if let token, !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        artworkTask = URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self,
                  self.metadataGeneration == generation,
                  let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  let data,
                  data.count <= 12 * 1024 * 1024,
                  let image = UIImage(data: data) else { return }
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            DispatchQueue.main.async {
                guard self.metadataGeneration == generation else { return }
                self.writeCachedArtwork((url: artworkUrl, artwork: artwork))
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
    }

    private func syncNowPlayingPlayback(playing: Bool) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        let duration = currentDuration()
        if duration > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = duration
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = currentPosition()
        info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? 1.0 : 0.0
        if info[MPMediaItemPropertyArtwork] == nil {
            artworkLock.lock()
            let cached = cachedArtwork?.artwork
            artworkLock.unlock()
            if let cached { info[MPMediaItemPropertyArtwork] = cached }
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
    }

    private func clearNowPlaying() {
        artworkTask?.cancel()
        metadataGeneration = UUID()
        writeCachedArtwork(nil)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        MPNowPlayingInfoCenter.default().playbackState = .stopped
    }

    private func readCachedArtwork(matching url: String?) -> MPMediaItemArtwork? {
        artworkLock.lock()
        defer { artworkLock.unlock() }
        guard let url, cachedArtwork?.url == url else { return nil }
        return cachedArtwork?.artwork
    }

    private func writeCachedArtwork(_ value: (url: String, artwork: MPMediaItemArtwork)?) {
        artworkLock.lock()
        cachedArtwork = value
        artworkLock.unlock()
    }
}
