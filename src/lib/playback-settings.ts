export const PLAYBACK_SETTINGS_KEY = "polarr-playback-settings-v1";
export const PLAYBACK_SETTINGS_EVENT = "polarr-playback-settings-changed";
export const PLAYBACK_OUTPUT_EVENT = "polarr-playback-output-result";

export type PlaybackOutputResult =
  | { ok: true; deviceId: string }
  | { ok: false; deviceId: string; error: string };

export const EQ_FREQUENCIES = [60, 150, 400, 1000, 2400, 15000] as const;

export type EqPreset =
  | "flat"
  | "bass"
  | "treble"
  | "vocal"
  | "acoustic"
  | "custom";
export type VolumeLevel = "quiet" | "normal" | "loud";

/** Client stream/download encode preference (used heavily on iOS). */
export type StreamQuality = "lossless" | "high" | "standard" | "compact";

export type PlaybackSettings = {
  equalizerEnabled: boolean;
  equalizerPreset: EqPreset;
  equalizerBands: number[];
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  gaplessEnabled: boolean;
  volumeLevel: VolumeLevel;
  /** How aggressively to encode for phones / bandwidth. Default high. */
  streamQuality: StreamQuality;
  monoAudio: boolean;
  outputDeviceId: string;
};

export const STREAM_QUALITIES: {
  id: StreamQuality;
  label: string;
  detail: string;
}[] = [
  {
    id: "lossless",
    label: "Lossless",
    detail:
      "Original when the phone can play it; otherwise ALAC from FLAC/WAV",
  },
  {
    id: "high",
    label: "High",
    detail: "AAC ~256 kbps — near-transparent, sensible default",
  },
  {
    id: "standard",
    label: "Standard",
    detail: "AAC ~160 kbps — good quality, less data",
  },
  {
    id: "compact",
    label: "Compact",
    detail: "AAC ~96 kbps — smallest files / weakest networks",
  },
];

export function isStreamQuality(v: string): v is StreamQuality {
  return STREAM_QUALITIES.some((q) => q.id === v);
}

export const EQ_PRESETS: Record<EqPreset, { label: string; bands: number[] }> = {
  flat: { label: "Flat", bands: [0, 0, 0, 0, 0, 0] },
  bass: { label: "Bass Boost", bands: [5, 4, 2, 0, -1, -2] },
  treble: { label: "Treble Boost", bands: [-2, -1, 0, 2, 4, 5] },
  vocal: { label: "Vocal", bands: [-2, -1, 1, 4, 3, 1] },
  acoustic: { label: "Acoustic", bands: [2, 1, 0, 2, 3, 2] },
  custom: { label: "Custom", bands: [0, 0, 0, 0, 0, 0] },
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  equalizerEnabled: false,
  equalizerPreset: "flat",
  equalizerBands: [...EQ_PRESETS.flat.bands],
  crossfadeEnabled: false,
  crossfadeSeconds: 5,
  gaplessEnabled: true,
  volumeLevel: "normal",
  streamQuality: "high",
  monoAudio: false,
  outputDeviceId: "default",
};

export function readPlaybackSettings(): PlaybackSettings {
  if (typeof window === "undefined") return DEFAULT_PLAYBACK_SETTINGS;
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PLAYBACK_SETTINGS_KEY) || "{}",
    ) as Partial<PlaybackSettings>;
    return {
      ...DEFAULT_PLAYBACK_SETTINGS,
      ...parsed,
      streamQuality: isStreamQuality(String(parsed.streamQuality || ""))
        ? (parsed.streamQuality as StreamQuality)
        : DEFAULT_PLAYBACK_SETTINGS.streamQuality,
      equalizerBands:
        Array.isArray(parsed.equalizerBands) &&
        parsed.equalizerBands.length === EQ_FREQUENCIES.length
          ? parsed.equalizerBands.map((value) =>
              Math.max(-12, Math.min(12, Number(value) || 0)),
            )
          : [...DEFAULT_PLAYBACK_SETTINGS.equalizerBands],
    };
  } catch {
    return DEFAULT_PLAYBACK_SETTINGS;
  }
}

export function writePlaybackSettings(settings: PlaybackSettings): void {
  localStorage.setItem(PLAYBACK_SETTINGS_KEY, JSON.stringify(settings));
  window.dispatchEvent(
    new CustomEvent<PlaybackSettings>(PLAYBACK_SETTINGS_EVENT, {
      detail: settings,
    }),
  );
}

export function volumeLevelGain(level: VolumeLevel): number {
  if (level === "quiet") return 0.75;
  if (level === "loud") return 1.2;
  return 1;
}

/** True when playback must route through Web Audio (EQ / mono / loudness / sink). */
export function playbackNeedsWebAudio(settings: PlaybackSettings): boolean {
  if (settings.equalizerEnabled) return true;
  if (settings.monoAudio) return true;
  if (settings.volumeLevel !== "normal") return true;
  if (settings.outputDeviceId && settings.outputDeviceId !== "default") {
    return true;
  }
  return false;
}
