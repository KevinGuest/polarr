export const PLAYBACK_SETTINGS_KEY = "polarr-playback-settings-v1";
export const PLAYBACK_SETTINGS_EVENT = "polarr-playback-settings-changed";

export const EQ_FREQUENCIES = [60, 150, 400, 1000, 2400, 15000] as const;

export type EqPreset = "flat" | "bass" | "treble" | "vocal" | "acoustic";
export type VolumeLevel = "quiet" | "normal" | "loud";

export type PlaybackSettings = {
  equalizerEnabled: boolean;
  equalizerPreset: EqPreset;
  equalizerBands: number[];
  crossfadeEnabled: boolean;
  crossfadeSeconds: number;
  gaplessEnabled: boolean;
  volumeLevel: VolumeLevel;
  monoAudio: boolean;
  outputDeviceId: string;
};

export const EQ_PRESETS: Record<EqPreset, { label: string; bands: number[] }> = {
  flat: { label: "Flat", bands: [0, 0, 0, 0, 0, 0] },
  bass: { label: "Bass Boost", bands: [5, 4, 2, 0, -1, -2] },
  treble: { label: "Treble Boost", bands: [-2, -1, 0, 2, 4, 5] },
  vocal: { label: "Vocal", bands: [-2, -1, 1, 4, 3, 1] },
  acoustic: { label: "Acoustic", bands: [2, 1, 0, 2, 3, 2] },
};

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  equalizerEnabled: false,
  equalizerPreset: "flat",
  equalizerBands: [...EQ_PRESETS.flat.bands],
  crossfadeEnabled: false,
  crossfadeSeconds: 5,
  gaplessEnabled: true,
  volumeLevel: "normal",
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
