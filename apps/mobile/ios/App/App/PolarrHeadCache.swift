import Foundation
import AVFoundation
import CryptoKit

/**
 Spotify-style "heads" for the native AVPlayer path.

 `PolarrHeadCache` keeps the first ~15 s (480 KiB of AAC 256k) of library
 tracks the user is likely to tap next on disk (Caches/polarr-heads). When a
 head exists for a URL, `PolarrPlayerPlugin` routes the AVPlayerItem through
 `PolarrHeadResourceLoader`, which answers AVFoundation's opening byte
 requests from the head instantly and streams the remainder from the server
 with ordinary Range requests. Without a head, playback uses AVPlayer's own
 networking exactly as before.

 Keys strip the rotating `mediaTicket` query param so a refreshed ticket still
 hits the cached head.
 */
final class PolarrHeadCache {
    static let shared = PolarrHeadCache()

    /// ~15 s of AAC-LC 256 kbps including the moov atom.
    static let headBytes = 480 * 1024
    /// Whole library. iOS may purge Caches under storage pressure.
    private let maxEntries = 5000
    private let maxTotalBytes: Int64 = 2_500_000_000

    struct Entry {
        let data: Data
        let total: Int64
        let contentType: String
    }

    private struct Meta: Codable {
        let total: Int64
        let contentType: String
    }

    private let queue = DispatchQueue(label: "app.polarr.headcache", qos: .utility)
    private let session: URLSession
    private var inflight = Set<String>()
    private let dir: URL

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        dir = caches.appendingPathComponent("polarr-heads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let config = URLSessionConfiguration.ephemeral
        config.httpMaximumConnectionsPerHost = 3
        config.timeoutIntervalForRequest = 20
        config.waitsForConnectivity = false
        session = URLSession(configuration: config)
    }

    // MARK: - Keys

    static func cacheKey(for raw: String) -> String? {
        guard var comps = URLComponents(string: raw),
              let scheme = comps.scheme?.lowercased(),
              scheme == "http" || scheme == "https",
              comps.path.contains("/api/stream/") else { return nil }
        var items = (comps.queryItems ?? []).filter { $0.name != "mediaTicket" }
        items.sort { $0.name < $1.name }
        comps.queryItems = items.isEmpty ? nil : items
        comps.fragment = nil
        guard let normalized = comps.string else { return nil }
        let digest = SHA256.hash(data: Data(normalized.utf8))
        return String(digest.map { String(format: "%02x", $0) }.joined().prefix(40))
    }

    private func dataURL(_ key: String) -> URL { dir.appendingPathComponent("\(key).bin") }
    private func metaURL(_ key: String) -> URL { dir.appendingPathComponent("\(key).json") }

    // MARK: - Lookup

    /// Synchronous disk read; cheap (≤480 KiB) and only called at load time.
    func entry(for raw: String) -> Entry? {
        guard let key = Self.cacheKey(for: raw) else { return nil }
        let dURL = dataURL(key)
        let mURL = metaURL(key)
        guard let data = try? Data(contentsOf: dURL, options: [.mappedIfSafe]),
              data.count > 4096,
              let metaData = try? Data(contentsOf: mURL),
              let meta = try? JSONDecoder().decode(Meta.self, from: metaData),
              meta.total >= Int64(data.count) else {
            return nil
        }
        // LRU touch (best effort).
        queue.async {
            try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: dURL.path)
        }
        return Entry(data: data, total: meta.total, contentType: meta.contentType)
    }

    // MARK: - Prefetch

    /// Fetch heads for `urls` (first = highest priority). Skips anything cached.
    func prefetch(_ urls: [String]) {
        queue.async {
            var pending: [(key: String, url: URL)] = []
            for raw in urls {
                guard let key = Self.cacheKey(for: raw),
                      let url = URL(string: raw) else { continue }
                if self.inflight.contains(key) { continue }
                if FileManager.default.fileExists(atPath: self.dataURL(key).path) { continue }
                pending.append((key, url))
            }
            for item in pending {
                self.inflight.insert(item.key)
                self.fetchHead(key: item.key, url: item.url)
            }
        }
    }

    private func fetchHead(key: String, url: URL) {
        var request = URLRequest(url: url)
        request.setValue("bytes=0-\(Self.headBytes - 1)", forHTTPHeaderField: "Range")
        request.cachePolicy = .reloadIgnoringLocalCacheData
        let task = session.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            self.queue.async {
                defer { self.inflight.remove(key) }
                guard let http = response as? HTTPURLResponse, let data, !data.isEmpty else { return }
                var total: Int64 = 0
                var body = data
                if http.statusCode == 206 {
                    let range = http.value(forHTTPHeaderField: "Content-Range") ?? ""
                    if let slash = range.lastIndex(of: "/"),
                       let parsed = Int64(range[range.index(after: slash)...].trimmingCharacters(in: .whitespaces)) {
                        total = parsed
                    }
                } else if http.statusCode == 200 {
                    total = Int64(data.count)
                    if data.count > Self.headBytes { body = data.prefix(Self.headBytes) }
                } else {
                    return
                }
                guard total > 0 else { return }
                let type = (http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream")
                    .split(separator: ";").first.map(String.init) ?? "application/octet-stream"
                let meta = Meta(total: total, contentType: type)
                do {
                    try body.write(to: self.dataURL(key), options: [.atomic])
                    try JSONEncoder().encode(meta).write(to: self.metaURL(key), options: [.atomic])
                } catch {
                    try? FileManager.default.removeItem(at: self.dataURL(key))
                    try? FileManager.default.removeItem(at: self.metaURL(key))
                    return
                }
                self.trimIfNeeded()
            }
        }
        task.resume()
    }

    // MARK: - Housekeeping

    private func trimIfNeeded() {
        guard let items = try? FileManager.default.contentsOfDirectory(
            at: dir,
            includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) else { return }
        var bins: [(url: URL, date: Date, size: Int64)] = []
        for url in items where url.pathExtension == "bin" {
            let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
            bins.append((url, values?.contentModificationDate ?? .distantPast, Int64(values?.fileSize ?? 0)))
        }
        var total = bins.reduce(Int64(0)) { $0 + $1.size }
        guard bins.count > maxEntries || total > maxTotalBytes else { return }
        bins.sort { $0.date < $1.date }
        var count = bins.count
        for item in bins {
            if count <= maxEntries && total <= maxTotalBytes { break }
            try? FileManager.default.removeItem(at: item.url)
            try? FileManager.default.removeItem(at: item.url.deletingPathExtension().appendingPathExtension("json"))
            count -= 1
            total -= item.size
        }
    }

    func clear() {
        queue.async {
            try? FileManager.default.removeItem(at: self.dir)
            try? FileManager.default.createDirectory(at: self.dir, withIntermediateDirectories: true)
        }
    }
}

// MARK: - Resource loader

/**
 Serves an AVURLAsset from a cached head + live Range requests.

 Scheme rewrite: `https://…` → `polarrhead-https://…` so AVFoundation hands
 requests to us; we restore the original scheme for network fetches.
 */
final class PolarrHeadResourceLoader: NSObject, AVAssetResourceLoaderDelegate, URLSessionDataDelegate {
    static let schemePrefix = "polarrhead-"

    static func proxyURL(for original: URL) -> URL? {
        guard var comps = URLComponents(url: original, resolvingAgainstBaseURL: false),
              let scheme = comps.scheme else { return nil }
        comps.scheme = schemePrefix + scheme
        return comps.url
    }

    private static func originalURL(from proxy: URL) -> URL? {
        guard var comps = URLComponents(url: proxy, resolvingAgainstBaseURL: false),
              let scheme = comps.scheme, scheme.hasPrefix(schemePrefix) else { return nil }
        comps.scheme = String(scheme.dropFirst(schemePrefix.count))
        return comps.url
    }

    private let head: PolarrHeadCache.Entry
    private let original: URL
    private let loaderQueue = DispatchQueue(label: "app.polarr.headloader")
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var active: [Int: AVAssetResourceLoadingRequest] = [:]
    private let lock = NSLock()

    init(head: PolarrHeadCache.Entry, original: URL) {
        self.head = head
        self.original = original
        super.init()
    }

    /// Build the asset; nil when the URL can't be proxied.
    static func makeAsset(for url: URL) -> (AVURLAsset, PolarrHeadResourceLoader)? {
        guard let entry = PolarrHeadCache.shared.entry(for: url.absoluteString),
              let proxy = proxyURL(for: url) else { return nil }
        let loader = PolarrHeadResourceLoader(head: entry, original: url)
        let asset = AVURLAsset(url: proxy)
        asset.resourceLoader.setDelegate(loader, queue: loader.loaderQueue)
        return (asset, loader)
    }

    private static func utType(for mime: String) -> String {
        switch mime.lowercased() {
        case "audio/mp4", "audio/m4a", "audio/x-m4a": return "public.mpeg-4-audio"
        case "audio/mpeg", "audio/mp3": return "public.mp3"
        case "audio/aac": return "public.aac-audio"
        case "audio/flac", "audio/x-flac": return "org.xiph.flac"
        case "audio/wav", "audio/x-wav": return "com.microsoft.waveform-audio"
        case "audio/ogg": return "org.xiph.ogg-audio"
        default: return "public.audio"
        }
    }

    // MARK: AVAssetResourceLoaderDelegate

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        shouldWaitForLoadingOfRequestedResource loadingRequest: AVAssetResourceLoadingRequest
    ) -> Bool {
        if let info = loadingRequest.contentInformationRequest {
            info.contentType = Self.utType(for: head.contentType)
            info.contentLength = head.total
            info.isByteRangeAccessSupported = true
        }

        guard let dataRequest = loadingRequest.dataRequest else {
            loadingRequest.finishLoading()
            return true
        }

        let start = dataRequest.requestedOffset
        let end: Int64 = dataRequest.requestsAllDataToEndOfResource
            ? head.total - 1
            : min(head.total - 1, start + Int64(dataRequest.requestedLength) - 1)
        if end < start {
            loadingRequest.finishLoading()
            return true
        }

        // Serve whatever overlaps the cached head immediately.
        var cursor = start
        let headEnd = Int64(head.data.count) - 1
        if cursor <= headEnd {
            let sliceEnd = min(end, headEnd)
            let range = Int(cursor)..<Int(sliceEnd + 1)
            dataRequest.respond(with: head.data.subdata(in: range))
            cursor = sliceEnd + 1
        }
        if cursor > end {
            loadingRequest.finishLoading()
            return true
        }

        // Remainder from the network.
        var request = URLRequest(url: original)
        request.setValue("bytes=\(cursor)-\(end)", forHTTPHeaderField: "Range")
        let task = session.dataTask(with: request)
        lock.lock()
        active[task.taskIdentifier] = loadingRequest
        lock.unlock()
        task.resume()
        return true
    }

    func resourceLoader(
        _ resourceLoader: AVAssetResourceLoader,
        didCancel loadingRequest: AVAssetResourceLoadingRequest
    ) {
        lock.lock()
        let ids = active.filter { $0.value === loadingRequest }.map(\.key)
        for id in ids { active.removeValue(forKey: id) }
        lock.unlock()
        session.getAllTasks { tasks in
            for task in tasks where ids.contains(task.taskIdentifier) { task.cancel() }
        }
    }

    // MARK: URLSessionDataDelegate

    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
    ) {
        guard let http = response as? HTTPURLResponse, http.statusCode == 206 || http.statusCode == 200 else {
            completionHandler(.cancel)
            finish(dataTask.taskIdentifier, error: NSError(
                domain: "PolarrHeadLoader",
                code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                userInfo: [NSLocalizedDescriptionKey: "stream request failed"]
            ))
            return
        }
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let req = active[dataTask.taskIdentifier]
        lock.unlock()
        guard let req, !req.isCancelled else { return }
        req.dataRequest?.respond(with: data)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task.taskIdentifier, error: error)
    }

    private func finish(_ id: Int, error: Error?) {
        lock.lock()
        let req = active.removeValue(forKey: id)
        lock.unlock()
        guard let req, !req.isCancelled, !req.isFinished else { return }
        if let error {
            req.finishLoading(with: error)
        } else {
            req.finishLoading()
        }
    }
}
