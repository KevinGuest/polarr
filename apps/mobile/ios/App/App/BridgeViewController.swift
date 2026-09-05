import UIKit
import WebKit
import Capacitor

/// Full-bleed WKWebView: no safe-area content insets, no whole-app pan/bounce.
/// A native overlay (centered mark, no copy) covers the WebView until each
/// full navigation paints, matching the launch storyboard.
class BridgeViewController: CAPBridgeViewController {
    private static let lockScript = """
    (function () {
      var css = "html,body{height:100%!important;max-height:100%!important;overflow:hidden!important;overscroll-behavior:none!important;background:#09090b!important;-webkit-text-size-adjust:100%;text-size-adjust:100%;}html.polarr-ios input:not([type=checkbox]):not([type=radio]),html.polarr-ios textarea,html.polarr-ios select{font-size:16px!important;}";
      var viewport = "width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover";
      function inject() {
        try { document.documentElement.classList.add("polarr-ios"); } catch (e) {}
        var m = document.querySelector('meta[name="viewport"]');
        if (!m) {
          m = document.createElement("meta");
          m.setAttribute("name", "viewport");
          (document.head || document.documentElement).appendChild(m);
        }
        m.setAttribute("content", viewport);
        if (!document.getElementById("polarr-ios-lock")) {
          var s = document.createElement("style");
          s.id = "polarr-ios-lock";
          s.textContent = css;
          (document.head || document.documentElement).appendChild(s);
        }
      }
      inject();
      document.addEventListener("DOMContentLoaded", inject);
    })();
    """

    private let loadingOverlay = UIView()
    private var loadingObs: NSKeyValueObservation?
    private var hideWorkItem: DispatchWorkItem?
    private var overlayShownAt: Date?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(PolarrOfflinePlugin())
        let script = WKUserScript(
            source: Self.lockScript,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView?.configuration.userContentController.addUserScript(script)
        lockWebViewChrome()
        statusBarStyle = .lightContent
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        lockWebViewChrome()
        view.backgroundColor = Self.appBackground
        installLoadingOverlay()
        loadingObs = webView?.observe(\.isLoading, options: [.new]) { [weak self] webView, _ in
            DispatchQueue.main.async {
                self?.syncOverlay(isLoading: webView.isLoading)
            }
        }
        syncOverlay(isLoading: webView?.isLoading ?? true)
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        lockWebViewChrome()
        view.bringSubviewToFront(loadingOverlay)
    }

    private func lockWebViewChrome() {
        guard let webView else { return }
        webView.isOpaque = true
        webView.backgroundColor = Self.appBackground
        webView.scrollView.backgroundColor = Self.appBackground
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.alwaysBounceVertical = false
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.zoomScale = 1
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif
        additionalSafeAreaInsets = .zero
    }

    private func installLoadingOverlay() {
        loadingOverlay.backgroundColor = Self.appBackground
        loadingOverlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loadingOverlay)

        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.layer.cornerRadius = 22
        logo.clipsToBounds = true
        loadingOverlay.addSubview(logo)

        NSLayoutConstraint.activate([
            loadingOverlay.topAnchor.constraint(equalTo: view.topAnchor),
            loadingOverlay.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            loadingOverlay.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            loadingOverlay.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            logo.centerXAnchor.constraint(equalTo: loadingOverlay.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: loadingOverlay.centerYAnchor),
            logo.widthAnchor.constraint(equalToConstant: 88),
            logo.heightAnchor.constraint(equalToConstant: 88),
        ])

        overlayShownAt = Date()
        loadingOverlay.isHidden = false
        loadingOverlay.alpha = 1
    }

    private func syncOverlay(isLoading: Bool) {
        hideWorkItem?.cancel()
        if isLoading {
            if loadingOverlay.isHidden {
                overlayShownAt = Date()
            }
            loadingOverlay.alpha = 1
            loadingOverlay.isHidden = false
            view.bringSubviewToFront(loadingOverlay)
            return
        }
        let shown = overlayShownAt ?? Date()
        let remaining = max(0.12, 0.5 - Date().timeIntervalSince(shown))
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            UIView.animate(withDuration: 0.22, delay: 0, options: .curveEaseOut) {
                self.loadingOverlay.alpha = 0
            } completion: { _ in
                if self.webView?.isLoading == false {
                    self.loadingOverlay.isHidden = true
                }
            }
        }
        hideWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + remaining, execute: work)
    }

    private static let appBackground = UIColor(
        red: 9 / 255,
        green: 9 / 255,
        blue: 11 / 255,
        alpha: 1
    )
}
