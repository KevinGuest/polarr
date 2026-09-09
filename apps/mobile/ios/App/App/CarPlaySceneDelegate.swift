import Foundation
import CarPlay
import UIKit

/// Shared handle so the player plugin can refresh CarPlay templates.
enum PolarrCarPlayBridge {
    static weak var scene: CarPlaySceneDelegate?
}

struct PolarrBrowseItem {
    let id: String
    let title: String
    let artist: String
    let album: String
    let url: String
    let artworkUrl: String?
    let token: String?
    let durationHint: Double?
}

/**
 CarPlay audio UI: Queue list + system Now Playing.

 Playback still goes through `PolarrPlayerPlugin` (AVPlayer). JS syncs the
 upcoming queue (with final stream URLs) so next/prev works while backgrounded.
 */
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var interfaceController: CPInterfaceController?
    private var queueTemplate: CPListTemplate?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        PolarrCarPlayBridge.scene = self
        rebuildRoot(animated: false)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onBrowseChanged),
            name: .polarrBrowseChanged,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onPlaybackChanged),
            name: .polarrPlaybackChanged,
            object: nil
        )
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController
    ) {
        NotificationCenter.default.removeObserver(self)
        if PolarrCarPlayBridge.scene === self {
            PolarrCarPlayBridge.scene = nil
        }
        self.interfaceController = nil
        queueTemplate = nil
    }

    @objc private func onBrowseChanged() {
        rebuildRoot(animated: true)
    }

    @objc private func onPlaybackChanged() {
        // Refresh Now Playing accessory / selection highlight.
        rebuildQueueTemplate()
        if let queueTemplate, let interfaceController {
            // Replace only the queue tab content when possible.
            interfaceController.setRootTemplate(makeTabBar(queue: queueTemplate), animated: false) { _, _ in }
        }
    }

    private func rebuildRoot(animated: Bool) {
        guard let interfaceController else { return }
        let queue = makeQueueTemplate()
        queueTemplate = queue
        interfaceController.setRootTemplate(makeTabBar(queue: queue), animated: animated) { _, _ in }
    }

    private func rebuildQueueTemplate() {
        queueTemplate = makeQueueTemplate()
    }

    private func makeTabBar(queue: CPListTemplate) -> CPTabBarTemplate {
        let nowPlaying = CPListTemplate(title: "Now Playing", sections: [makeNowPlayingSection()])
        nowPlaying.tabImage = UIImage(systemName: "play.circle.fill")
        nowPlaying.tabTitle = "Playing"

        queue.tabImage = UIImage(systemName: "list.bullet")
        queue.tabTitle = "Queue"

        return CPTabBarTemplate(templates: [nowPlaying, queue])
    }

    private func makeNowPlayingSection() -> CPListSection {
        guard let player = PolarrPlayerPlugin.shared,
              let snapshot = player.carPlayNowPlayingSnapshot() else {
            let item = CPListItem(
                text: "Nothing playing",
                detailText: "Start a track in Polarr on iPhone"
            )
            item.handler = { _, completion in
                completion()
            }
            return CPListSection(items: [item])
        }

        let item = CPListItem(text: snapshot.title, detailText: snapshot.artist)
        item.playingIndicatorLocation = .leading
        item.isPlaying = snapshot.playing
        item.handler = { [weak self] _, completion in
            completion()
            self?.interfaceController?.pushTemplate(CPNowPlayingTemplate.shared, animated: true) { _, _ in }
        }

        let toggle = CPListItem(
            text: snapshot.playing ? "Pause" : "Play",
            detailText: nil
        )
        toggle.handler = { _, completion in
            if snapshot.playing {
                player.carPlayPause()
            } else {
                player.carPlayPlay()
            }
            completion()
        }

        return CPListSection(items: [item, toggle], header: "Now Playing", sectionIndexTitle: nil)
    }

    private func makeQueueTemplate() -> CPListTemplate {
        let items = PolarrPlayerPlugin.shared?.carPlayBrowseItems() ?? []
        if items.isEmpty {
            let empty = CPListItem(
                text: "Queue is empty",
                detailText: "Play music in Polarr to fill CarPlay"
            )
            empty.handler = { _, completion in completion() }
            return CPListTemplate(title: "Queue", sections: [CPListSection(items: [empty])])
        }

        let currentId = PolarrPlayerPlugin.shared?.carPlayNowPlayingSnapshot()?.trackId
        let rows: [CPListItem] = items.map { browse in
            let row = CPListItem(text: browse.title, detailText: browse.artist)
            if browse.id == currentId {
                row.isPlaying = true
                row.playingIndicatorLocation = .leading
            }
            row.handler = { _, completion in
                PolarrPlayerPlugin.shared?.carPlayPlayBrowseItem(id: browse.id)
                completion()
                PolarrCarPlayBridge.scene?.interfaceController?
                    .pushTemplate(CPNowPlayingTemplate.shared, animated: true) { _, _ in }
            }
            return row
        }
        return CPListTemplate(title: "Queue", sections: [CPListSection(items: rows, header: "Up next", sectionIndexTitle: nil)])
    }
}

extension Notification.Name {
    static let polarrBrowseChanged = Notification.Name("polarrBrowseChanged")
    static let polarrPlaybackChanged = Notification.Name("polarrPlaybackChanged")
}
