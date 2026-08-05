"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatDuration } from "@/lib/utils";

export type PlayerTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  coverPath?: string | null;
};

type PlayerContextValue = {
  track: PlayerTrack | null;
  queue: PlayerTrack[];
  playing: boolean;
  progress: number;
  duration: number;
  play: (track: PlayerTrack, queue?: PlayerTrack[]) => void;
  toggle: () => void;
  seek: (ratio: number) => void;
  next: () => void;
  prev: () => void;
  progressLabel: string;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [track, setTrack] = useState<PlayerTrack | null>(null);
  const [queue, setQueue] = useState<PlayerTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setPlaying(false);
      // auto next
      setTrack((current) => {
        if (!current) return null;
        const idx = queue.findIndex((t) => t.id === current.id);
        const nextTrack = queue[idx + 1];
        if (nextTrack) {
          audio.src = `/api/stream/${nextTrack.id}`;
          void audio.play().then(() => setPlaying(true));
          return nextTrack;
        }
        return current;
      });
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("ended", onEnded);
    };
  }, [queue]);

  const play = useCallback((next: PlayerTrack, nextQueue?: PlayerTrack[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (nextQueue) setQueue(nextQueue);
    setTrack(next);
    audio.src = `/api/stream/${next.id}`;
    void audio.play().then(() => setPlaying(true));
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [track]);

  const seek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.max(0, Math.min(1, ratio)) * duration;
  }, [duration]);

  const next = useCallback(() => {
    if (!track) return;
    const idx = queue.findIndex((t) => t.id === track.id);
    const n = queue[idx + 1];
    if (n) play(n);
  }, [play, queue, track]);

  const prev = useCallback(() => {
    if (!track) return;
    const idx = queue.findIndex((t) => t.id === track.id);
    const p = queue[idx - 1];
    if (p) play(p);
  }, [play, queue, track]);

  const value = useMemo(
    () => ({
      track,
      queue,
      playing,
      progress,
      duration,
      play,
      toggle,
      seek,
      next,
      prev,
      progressLabel: `${formatDuration(progress)} / ${formatDuration(duration)}`,
    }),
    [track, queue, playing, progress, duration, play, toggle, seek, next, prev],
  );

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
