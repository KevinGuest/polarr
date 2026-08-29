#!/usr/bin/env node
/**
 * Regenerates the iOS home-screen icon and launch splash from public/polarr-icon.png.
 *
 * Apple's 1024×1024 App Store icon must be RGB with no alpha. The previous
 * Capacitor default was a white-on-white mark, which looks like a missing icon
 * on the Simulator home screen.
 *
 * Requires ffmpeg (macOS: brew install ffmpeg).
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const mobileRoot = resolve(scriptDir, "..");
const repoRoot = resolve(mobileRoot, "../..");

const SRC = resolve(repoRoot, "public/polarr-icon.png");
const ICON_DIR = resolve(
  mobileRoot,
  "ios/App/App/Assets.xcassets/AppIcon.appiconset",
);
const SPLASH_DIR = resolve(
  mobileRoot,
  "ios/App/App/Assets.xcassets/Splash.imageset",
);

const ICON_OUT = resolve(ICON_DIR, "AppIcon-512@2x.png");
const SPLASH_FILES = [
  "splash-2732x2732.png",
  "splash-2732x2732-1.png",
  "splash-2732x2732-2.png",
];

function run(args) {
  const r = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "").trim() || `exit ${r.status}`;
    throw new Error(`ffmpeg failed: ${err}`);
  }
}

if (!existsSync(SRC)) {
  console.error(`Missing brand mark: ${SRC}`);
  process.exit(1);
}

const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (ffmpeg.status !== 0) {
  console.error("ffmpeg is required (macOS: brew install ffmpeg).");
  process.exit(1);
}

mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(SPLASH_DIR, { recursive: true });

// Flatten any transparency onto black, then scale to the 1024 marketing icon.
run([
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-i",
  SRC,
  "-filter_complex",
  "color=c=black:s=512x512,format=rgba[bg];[0:v]format=rgba[fg];[bg][fg]overlay=0:0,scale=1024:1024:flags=lanczos,format=rgb24",
  "-frames:v",
  "1",
  "-pix_fmt",
  "rgb24",
  ICON_OUT,
]);

const splashTmp = resolve(SPLASH_DIR, SPLASH_FILES[0]);
run([
  "-y",
  "-hide_banner",
  "-loglevel",
  "error",
  "-f",
  "lavfi",
  "-i",
  "color=c=0x09090b:s=2732x2732:r=1",
  "-i",
  SRC,
  "-filter_complex",
  "[1:v]format=rgba,scale=640:640:flags=lanczos[logo];[0:v][logo]overlay=(W-w)/2:(H-h)/2,format=rgb24",
  "-frames:v",
  "1",
  "-pix_fmt",
  "rgb24",
  splashTmp,
]);

for (const name of SPLASH_FILES.slice(1)) {
  copyFileSync(splashTmp, resolve(SPLASH_DIR, name));
}

console.log(`Wrote ${ICON_OUT}`);
console.log(`Wrote ${SPLASH_FILES.length} splash images in ${SPLASH_DIR}`);
