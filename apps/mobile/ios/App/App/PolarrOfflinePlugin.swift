import Foundation
import Capacitor

private struct OfflineTrack: Codable {
    let trackId: String
    let title: String
    let artist: String
    let album: String?
    let coverUrl: String?
    let duration: Double?
    let contentType: String
    let userId: String
    let fileName: String
    let downloadedAt: Double
}

private struct OfflineJob: Codable {
    let id: String
    let trackId: String
    let title: String
    let artist: String
    let album: String?
    let coverUrl: String?
    let duration: Double?
    let requestedContentType: String?
    let userId: String
    var taskIdentifier: Int
    var status: String
    var progress: Double
    var error: String?
}

@objc(PolarrOfflinePlugin)
public class PolarrOfflinePlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "PolarrOfflinePlugin"
    public let jsName = "PolarrOffline"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ids", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "has", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    static var backgroundCompletionHandler: (() -> Void)?

    private let stateLock = NSLock()
    private var authorizedUserId: String?
    private var session: URLSession!

    public override func load() {
        authorizedUserId = UserDefaults.standard.string(forKey: "polarr.offline.user")
        let bundle = Bundle.main.bundleIdentifier ?? "app.polarr.mobile"
        let config = URLSessionConfiguration.background(withIdentifier: "\(bundle).offline-downloads")
        config.sessionSendsLaunchEvents = true
        config.isDiscretionary = false
        config.allowsCellularAccess = true
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    private var rootDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("PolarrOffline", isDirectory: true)
    }

    private var tracksFile: URL { rootDirectory.appendingPathComponent("tracks.json") }
    private var jobsFile: URL { rootDirectory.appendingPathComponent("jobs.json") }

    private func prepareStorage() throws {
        try FileManager.default.createDirectory(
            at: rootDirectory,
            withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
        )
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var root = rootDirectory
        try? root.setResourceValues(values)
    }

    private func read<T: Decodable>(_ type: T.Type, from url: URL, fallback: T) -> T {
        guard let data = try? Data(contentsOf: url) else { return fallback }
        return (try? JSONDecoder().decode(type, from: data)) ?? fallback
    }

    private func write<T: Encodable>(_ value: T, to url: URL) throws {
        try prepareStorage()
        let data = try JSONEncoder().encode(value)
        let temporary = url.appendingPathExtension("part")
        try data.write(to: temporary, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        if FileManager.default.fileExists(atPath: url.path) {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: temporary)
        } else {
            try FileManager.default.moveItem(at: temporary, to: url)
        }
    }

    private func tracks() -> [OfflineTrack] {
        read([OfflineTrack].self, from: tracksFile, fallback: [])
    }

    private func jobs() -> [OfflineJob] {
        read([OfflineJob].self, from: jobsFile, fallback: [])
    }

    private func updateJob(_ id: String, mutate: (inout OfflineJob) -> Void) {
        stateLock.lock()
        defer { stateLock.unlock() }
        var all = jobs()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        mutate(&all[index])
        try? write(all, to: jobsFile)
    }

    private func job(for task: URLSessionTask) -> OfflineJob? {
        let all = jobs()
        if let id = task.taskDescription, let match = all.first(where: { $0.id == id }) {
            return match
        }
        return all.first(where: { $0.taskIdentifier == task.taskIdentifier })
    }

    private func safeName(_ value: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_") )
        let cleaned = value.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        return String(cleaned)
    }

    private func fileExtension(contentType: String, response: URLResponse?) -> String {
        let type = contentType.lowercased()
        if type.contains("flac") { return "flac" }
        if type.contains("ogg") { return "ogg" }
        if type.contains("opus") { return "opus" }
        if type.contains("wav") { return "wav" }
        if type.contains("aac") { return "aac" }
        if type.contains("mp4") || type.contains("m4a") { return "m4a" }
        if type.contains("mpeg") || type.contains("mp3") { return "mp3" }
        if let suggested = response?.suggestedFilename,
           let ext = URL(fileURLWithPath: suggested).pathExtension.nonEmpty {
            return ext
        }
        return "audio"
    }

    private func trackObject(_ track: OfflineTrack) -> [String: Any] {
        let file = rootDirectory.appendingPathComponent(track.fileName)
        return [
            "trackId": track.trackId,
            "title": track.title,
            "artist": track.artist,
            "album": track.album as Any,
            "coverUrl": track.coverUrl as Any,
            "duration": track.duration as Any,
            "contentType": track.contentType,
            "userId": track.userId,
            "localUrl": file.absoluteString,
            "downloadedAt": track.downloadedAt
        ]
    }

    @objc func setSession(_ call: CAPPluginCall) {
        let userId = call.getString("userId")?.trimmingCharacters(in: .whitespacesAndNewlines)
        authorizedUserId = userId?.isEmpty == false ? userId : nil
        if let user = authorizedUserId {
            UserDefaults.standard.set(user, forKey: "polarr.offline.user")
        } else {
            UserDefaults.standard.removeObject(forKey: "polarr.offline.user")
        }
        call.resolve()
    }

    @objc func list(_ call: CAPPluginCall) {
        stateLock.lock()
        let user = authorizedUserId
        let result = tracks().filter { $0.userId == user && FileManager.default.fileExists(atPath: rootDirectory.appendingPathComponent($0.fileName).path) }
        stateLock.unlock()
        call.resolve(["tracks": result.map(trackObject)])
    }

    @objc func ids(_ call: CAPPluginCall) {
        stateLock.lock()
        let user = authorizedUserId
        let result = tracks().filter { $0.userId == user && FileManager.default.fileExists(atPath: rootDirectory.appendingPathComponent($0.fileName).path) }.map(\.trackId)
        stateLock.unlock()
        call.resolve(["ids": result])
    }

    @objc func has(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing track id")
            return
        }
        stateLock.lock()
        let user = authorizedUserId
        let found = tracks().contains { $0.trackId == trackId && $0.userId == user && FileManager.default.fileExists(atPath: rootDirectory.appendingPathComponent($0.fileName).path) }
        stateLock.unlock()
        call.resolve(["has": found])
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let source = call.getString("url"), let url = URL(string: source),
              let trackId = call.getString("trackId"),
              let title = call.getString("title"),
              let artist = call.getString("artist"),
              let userId = call.getString("userId"), !userId.isEmpty else {
            call.reject("Missing download details")
            return
        }
        guard authorizedUserId == userId else {
            call.reject("Sign in to download offline")
            return
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 180
        if let token = call.getString("token"), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let id = UUID().uuidString
        let task = session.downloadTask(with: request)
        task.taskDescription = id
        let job = OfflineJob(
            id: id,
            trackId: trackId,
            title: title,
            artist: artist,
            album: call.getString("album"),
            coverUrl: call.getString("coverUrl"),
            duration: call.getDouble("duration"),
            requestedContentType: call.getString("contentType"),
            userId: userId,
            taskIdentifier: task.taskIdentifier,
            status: "downloading",
            progress: 0,
            error: nil
        )
        stateLock.lock()
        var all = jobs().filter { $0.id != id && !($0.trackId == trackId && $0.status == "done") }
        all.append(job)
        do {
            try write(all, to: jobsFile)
            stateLock.unlock()
            task.resume()
            call.resolve(["jobId": id])
        } catch {
            stateLock.unlock()
            task.cancel()
            call.reject("Could not prepare offline storage", nil, error)
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let id = call.getString("jobId") else {
            call.reject("Missing job id")
            return
        }
        stateLock.lock()
        let result = jobs().first { $0.id == id }
        stateLock.unlock()
        guard let job = result else {
            call.reject("Download not found")
            return
        }
        call.resolve(["status": job.status, "progress": job.progress, "error": job.error as Any])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("jobId") else {
            call.reject("Missing job id")
            return
        }
        session.getAllTasks { tasks in
            tasks.first { $0.taskDescription == id }?.cancel()
        }
        updateJob(id) { job in
            job.status = "cancelled"
            job.error = nil
        }
        call.resolve()
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let trackId = call.getString("trackId") else {
            call.reject("Missing track id")
            return
        }
        stateLock.lock()
        var all = tracks()
        let user = authorizedUserId
        let removed = all.filter { $0.trackId == trackId && $0.userId == user }
        all.removeAll { $0.trackId == trackId && $0.userId == user }
        do {
            for track in removed {
                try? FileManager.default.removeItem(at: rootDirectory.appendingPathComponent(track.fileName))
            }
            try write(all, to: tracksFile)
            stateLock.unlock()
            call.resolve()
        } catch {
            stateLock.unlock()
            call.reject("Could not remove download", nil, error)
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        stateLock.lock()
        let user = authorizedUserId
        var all = tracks()
        let removed = all.filter { $0.userId == user }
        all.removeAll { $0.userId == user }
        do {
            for track in removed {
                try? FileManager.default.removeItem(at: rootDirectory.appendingPathComponent(track.fileName))
            }
            try write(all, to: tracksFile)
            stateLock.unlock()
            call.resolve()
        } catch {
            stateLock.unlock()
            call.reject("Could not clear downloads", nil, error)
        }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let job = job(for: downloadTask), totalBytesExpectedToWrite > 0 else { return }
        updateJob(job.id) { value in
            value.progress = min(0.99, Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
        }
    }

    public func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let job = job(for: downloadTask) else { return }
        guard let response = downloadTask.response as? HTTPURLResponse,
              (200...299).contains(response.statusCode) else {
            updateJob(job.id) { value in
                value.status = "error"
                value.error = "Server rejected the download"
            }
            return
        }
        let contentType = response.value(forHTTPHeaderField: "Content-Type") ?? job.requestedContentType ?? "audio/mpeg"
        let ext = fileExtension(contentType: contentType, response: response)
        let fileName = "\(safeName(job.userId))-\(safeName(job.trackId)).\(ext)"
        let destination = rootDirectory.appendingPathComponent(fileName)
        let partial = destination.appendingPathExtension("part")

        stateLock.lock()
        do {
            try prepareStorage()
            try? FileManager.default.removeItem(at: partial)
            try FileManager.default.moveItem(at: location, to: partial)
            let size = (try FileManager.default.attributesOfItem(atPath: partial.path)[.size] as? NSNumber)?.int64Value ?? 0
            guard size > 0 else { throw NSError(domain: "PolarrOffline", code: 1, userInfo: [NSLocalizedDescriptionKey: "Downloaded file was empty"]) }
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: partial, to: destination)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: destination.path)
            var resource = URLResourceValues()
            resource.isExcludedFromBackup = true
            var protectedFile = destination
            try? protectedFile.setResourceValues(resource)

            var allTracks = tracks()
            allTracks.removeAll { $0.trackId == job.trackId && $0.userId == job.userId }
            allTracks.insert(OfflineTrack(
                trackId: job.trackId,
                title: job.title,
                artist: job.artist,
                album: job.album,
                coverUrl: job.coverUrl,
                duration: job.duration,
                contentType: contentType,
                userId: job.userId,
                fileName: fileName,
                downloadedAt: Date().timeIntervalSince1970
            ), at: 0)
            try write(allTracks, to: tracksFile)
            stateLock.unlock()
            updateJob(job.id) { value in
                value.status = "done"
                value.progress = 1
                value.error = nil
            }
        } catch {
            stateLock.unlock()
            try? FileManager.default.removeItem(at: partial)
            updateJob(job.id) { value in
                value.status = "error"
                value.error = error.localizedDescription
            }
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = job(for: task), let error else { return }
        updateJob(job.id) { value in
            if value.status != "done" && value.status != "cancelled" {
                value.status = "error"
                value.error = error.localizedDescription
            }
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            Self.backgroundCompletionHandler?()
            Self.backgroundCompletionHandler = nil
        }
    }
}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
