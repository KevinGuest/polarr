import Foundation
import MediaPlayer
import UIKit
import Capacitor

/** Native Now Playing metadata with artwork downloaded by URLSession. */
@objc(PolarrNowPlayingPlugin)
public class PolarrNowPlayingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PolarrNowPlayingPlugin"
    public let jsName = "PolarrNowPlaying"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMetadata", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlayback", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    private var artworkTask: URLSessionDataTask?
    private var metadataGeneration = UUID()

    @objc func setMetadata(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("title required")
            return
        }

        let generation = UUID()
        metadataGeneration = generation
        artworkTask?.cancel()

        DispatchQueue.main.async {
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            info[MPMediaItemPropertyTitle] = title
            info[MPMediaItemPropertyArtist] = call.getString("artist") ?? ""
            info[MPMediaItemPropertyAlbumTitle] = call.getString("album") ?? ""
            info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue
            info.removeValue(forKey: MPMediaItemPropertyArtwork)
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        }

        guard let rawArtwork = call.getString("artworkUrl"),
              let artworkUrl = URL(string: rawArtwork),
              ["http", "https"].contains(artworkUrl.scheme?.lowercased() ?? "") else {
            call.resolve(["artwork": false])
            return
        }

        var request = URLRequest(url: artworkUrl)
        request.timeoutInterval = 20
        if let token = call.getString("token"), !token.isEmpty {
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
                var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
                info[MPMediaItemPropertyArtwork] = artwork
                MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            }
        }
        artworkTask?.resume()
        call.resolve(["artwork": true])
    }

    @objc func setPlayback(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
            if let duration = call.getDouble("duration"), duration > 0 {
                info[MPMediaItemPropertyPlaybackDuration] = duration
            }
            if let position = call.getDouble("position"), position >= 0 {
                info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
            }
            let playing = call.getBool("playing") ?? false
            let rate = call.getDouble("rate") ?? 1
            info[MPNowPlayingInfoPropertyPlaybackRate] = playing ? max(0.01, rate) : 0
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            MPNowPlayingInfoCenter.default().playbackState = playing ? .playing : .paused
            call.resolve()
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        artworkTask?.cancel()
        metadataGeneration = UUID()
        DispatchQueue.main.async {
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            MPNowPlayingInfoCenter.default().playbackState = .stopped
            call.resolve()
        }
    }
}
