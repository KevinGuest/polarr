import UIKit
import Capacitor

/// Phone UIWindowScene — hosts Capacitor `BridgeViewController`.
/// Required alongside CarPlay's CPTemplateApplicationScene so iOS does not
/// skip the phone window (black screen).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(
        _ scene: UIScene,
        willConnectTo session: UISceneSession,
        options connectionOptions: UIScene.ConnectionOptions
    ) {
        guard let windowScene = scene as? UIWindowScene else { return }

        NSLog("Polarr: SceneDelegate.willConnectTo")

        let window = UIWindow(windowScene: windowScene)
        // Always own the root VC — storyboard scene wiring is unreliable with
        // Capacitor + CarPlay dual scenes on newer iOS simulators.
        let root = BridgeViewController()
        window.rootViewController = root
        window.overrideUserInterfaceStyle = .dark
        window.backgroundColor = UIColor(red: 9 / 255, green: 9 / 255, blue: 11 / 255, alpha: 1)
        self.window = window
        window.makeKeyAndVisible()

        if let appDelegate = UIApplication.shared.delegate as? AppDelegate {
            appDelegate.window = window
        }

        NSLog("Polarr: SceneDelegate window ready root=%@", String(describing: type(of: root)))
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        window?.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared,
                open: context.url,
                options: [:]
            )
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            continue: userActivity,
            restorationHandler: { _ in }
        )
    }
}
