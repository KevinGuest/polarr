import path from "node:path";
import {
  createRequest,
  listRequests,
  requestStats,
  upsertTrack,
  updateRequestStatus,
} from "../src/lib/db";

process.env.POLARR_DATA_DIR = path.join(process.cwd(), "data");

const r1 = createRequest({
  title: "Demo Album",
  artist: "Demo Artist",
  album: "Demo Album",
  mediaType: "album",
  status: "queued",
  source: "lidarr",
});
const r2 = createRequest({
  title: "Demo Album",
  artist: "Demo Artist",
  album: "Demo Album",
  mediaType: "album",
  status: "queued",
  source: "lidarr",
});
console.log("dedupe", r1.id === r2.id, "status", r1.status);

upsertTrack({
  id: "t-demo",
  title: "Track A",
  artist: "Demo Artist",
  album: "Demo Album",
  duration: 0,
  path: path.join(process.cwd(), "music", "demo-mark.mp3"),
  coverPath: null,
  source: "library",
  externalId: null,
  fileSize: 10,
  mtimeMs: Date.now(),
});

const after = listRequests(20).find((r) => r.id === r1.id);
console.log("after scan/library match status", after?.status);

const r3 = createRequest({
  title: "Other Album",
  artist: "Other",
  mediaType: "album",
  status: "queued",
  source: "lidarr",
});
console.log("other", r3.status);
updateRequestStatus(r3.id, "failed", { error: "test fail", message: "unit" });
console.log("stats", requestStats());
