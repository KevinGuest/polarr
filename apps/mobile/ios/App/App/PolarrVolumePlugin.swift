import Foundation
import AVFoundation
import MediaPlayer
import UIKit
import Capacitor

/**
 * Bridge HTML volume UI to iOS system output volume (Control Center / buttons).
 * HTMLMediaElement.volume does not drive the hardware volume on iOS.
 */
@objc(PolarrVolumePlugin)
public class PolarrVolumePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PolarrVolumePlugin"
    public let jsName = "PolarrVolume"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVolume", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setVolume", returnType: CAPPluginReturnPromise),
    ]

    private var volumeObservation: NSKeyValueObservation?
    private lazy var volumeView: MPVolumeView = {
        let view = MPVolumeView(frame: .zero)
        view.clipsToBounds = true
        view.alpha = 0.01
        view.isUserInteractionEnabled = false
        return view
    }()

    public override func load() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            if let host = self.bridge?.viewController?.view {
                self.volumeView.frame = CGRect(x: -1000, y: -1000, width: 1, height: 1)
                host.addSubview(self.volumeView)
            }
            try? AVAudioSession.sharedInstance().setActive(true)
            self.volumeObservation = AVAudioSession.sharedInstance().observe(
                \.outputVolume,
                options: [.new]
            ) { [weak self] _, change in
                guard let value = change.newValue else { return }
                self?.notifyListeners("volumeChange", data: ["volume": Double(value)])
            }
        }
    }

    deinit {
        volumeObservation?.invalidate()
    }

    private func volumeSlider() -> UISlider? {
        volumeView.subviews.compactMap { $0 as? UISlider }.first
    }

    @objc func getVolume(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let value = AVAudioSession.sharedInstance().outputVolume
            call.resolve(["volume": Double(value)])
        }
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        guard let raw = call.getDouble("volume") else {
            call.reject("volume required")
            return
        }
        let clamped = max(0, min(1, raw))
        DispatchQueue.main.async { [weak self] in
            guard let self else {
                call.resolve()
                return
            }
            if self.volumeView.superview == nil,
               let host = self.bridge?.viewController?.view {
                self.volumeView.frame = CGRect(x: -1000, y: -1000, width: 1, height: 1)
                host.addSubview(self.volumeView)
            }
            if let slider = self.volumeSlider() {
                slider.value = Float(clamped)
            }
            call.resolve(["volume": clamped])
        }
    }
}
