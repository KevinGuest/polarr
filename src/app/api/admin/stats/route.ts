import { json, getStaffUser } from "@/lib/api";
import {
  countUsers,
  getSettings,
  inviteStatus,
  libraryStats,
  listInvites,
  listenDashboard,
  requestStats,
  smtpConfigured,
} from "@/lib/db";
import { LidarrClient } from "@/lib/lidarr";
import { ffmpegAvailable, ytDlpAvailable } from "@/lib/tools";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await getStaffUser();
  if (!admin) return json({ error: "Admin only" }, { status: 403 });

  const lib = libraryStats();
  const req = requestStats();
  const openInvites = listInvites(200).filter(
    (i) => inviteStatus(i) === "open",
  ).length;

  let lidarr = "Offline";
  try {
    const client = LidarrClient.fromSettings();
    if (client) {
      const status = await client.status();
      lidarr = status.version
        ? `Connected · v${status.version}`
        : "Connected";
    }
  } catch {
    lidarr = "Offline";
  }

  const yt = await ytDlpAvailable();
  const ff = await ffmpegAvailable();
  const uptimeSec = Math.floor(process.uptime());
  const email = smtpConfigured(getSettings()) ? "Configured" : "Not set up";
  const listening = listenDashboard(14);

  return json({
    version: "0.1.0",
    uptimeSec,
    users: countUsers(),
    tracks: lib.tracks,
    albums: lib.albums,
    artists: lib.artists,
    requestsTotal: req.total,
    requestsByStatus: req.byStatus,
    openInvites,
    lidarr,
    email,
    ytDlp: yt ? "Ready" : "Installing…",
    ffmpeg: ff === false ? "Missing" : ff ? "Ready" : "…",
    listening,
  });
}
