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

enum PolarrCarPlaySession {
    /// Phone app has a Polarr session (token and/or offline user id).
    static var isSignedIn: Bool {
        if UserDefaults.standard.bool(forKey: "polarr.signed_in") { return true }
        let user = UserDefaults.standard.string(forKey: "polarr.offline.user")?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return !(user ?? "").isEmpty
    }
}

/**
 CarPlay is a thin extension of PolarrPlayer — Now Playing + queue only.

 Sign-in happens on iPhone. If there is no session, CarPlay asks you to open
 Polarr and sign in; it does not host its own login UI.
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
            selector: #selector(onSessionOrPlaybackChanged),
            name: .polarrBrowseChanged,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onSessionOrPlaybackChanged),
            name: .polarrPlaybackChanged,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(onSessionOrPlaybackChanged),
            name: .polarrAuthChanged,
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

    @objc private func onSessionOrPlaybackChanged() {
        rebuildRoot(animated: true)
    }

    private func rebuildRoot(animated: Bool) {
        guard let interfaceController else { return }

        if !PolarrCarPlaySession.isSignedIn {
            queueTemplate = nil
            interfaceController.setRootTemplate(makeSignInTemplate(), animated: animated) { _, _ in }
            return
        }

        let queue = makeQueueTemplate()
        queueTemplate = queue
        interfaceController.setRootTemplate(makeTabBar(queue: queue), animated: animated) { _, _ in }
    }

    private func makeSignInTemplate() -> CPListTemplate {
        let item = CPListItem(
            text: "Sign in on iPhone",
            detailText: "Open Polarr on your iPhone and sign in to use CarPlay."
        )
        item.handler = { _, completion in
            completion()
        }
        let section = CPListSection(
            items: [item],
            header: "Polarr",
            sectionIndexTitle: nil
        )
        let template = CPListTemplate(title: "Polarr", sections: [section])
        template.tabImage = UIImage(systemName: "person.crop.circle.badge.exclamationmark")
        template.tabTitle = "Sign in"
        return template
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
                detailText: "Start playback in Polarr on iPhone"
            )
            item.handler = { _, completion in
                completion()
            }
            return CPListSection(items: [item], header: "Player", sectionIndexTitle: nil)
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
                detailText: "Play something in Polarr on iPhone"
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
    static let polarrAuthChanged = Notification.Name("polarrAuthChanged")
}
