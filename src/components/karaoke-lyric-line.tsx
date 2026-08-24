"use client";

import { useEffect, useState } from "react";
import type { LyricLine } from "@/lib/lyrics/types";
import {
  lyricLineEndSec,
  lyricLineFill01,
  lyricWordFill01,
} from "@/lib/lyrics/parse-lrc";

/** Interpolate between player timeupdate ticks so the fill wipes smoothly. */
function useSmoothClock(clockSec: number, playing: boolean): number {
  const [smooth, setSmooth] = useState(clockSec);

  useEffect(() => {
    if (!playing) {
      setSmooth(clockSec);
      return;
    }
    const origin = clockSec;
    const t0 = performance.now();
    let id = 0;
    const loop = () => {
      setSmooth(origin + (performance.now() - t0) / 1000);
      id = requestAnimationFrame(loop);
    };
    setSmooth(origin);
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [clockSec, playing]);

  return playing ? smooth : clockSec;
}

function FilledToken({ text, fill }: { text: string; fill: number }) {
  const pct = Math.max(0, Math.min(1, fill));
  if (pct <= 0.001) {
    return <span className="text-white/38">{text}</span>;
  }
  if (pct >= 0.999) {
    return <span className="text-white">{text}</span>;
  }
  return (
    <span className="relative inline-block whitespace-pre">
      <span className="text-white/38">{text}</span>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 overflow-hidden text-white"
        style={{ width: `${pct * 100}%` }}
      >
        {text}
      </span>
    </span>
  );
}

function LineFill({ text, fill }: { text: string; fill: number }) {
  const total = Math.max(1, text.length);
  const filled = fill * total;
  const parts = text.split(/(\s+)/);
  let cursor = 0;
  return (
    <>
      {parts.map((part, i) => {
        const start = cursor;
        cursor += part.length;
        if (!part) return null;
        if (/^\s+$/.test(part)) {
          return <span key={i}>{part}</span>;
        }
        return (
          <FilledToken
            key={i}
            text={part}
            fill={(filled - start) / Math.max(1, part.length)}
          />
        );
      })}
    </>
  );
}

export function KaraokeLyricLine({
  line,
  lines,
  index,
  clockSec,
  playing,
}: {
  line: LyricLine;
  lines: LyricLine[];
  index: number;
  clockSec: number;
  playing: boolean;
}) {
  const smooth = useSmoothClock(clockSec, playing);
  const lineEnd = lyricLineEndSec(lines, index);

  const words = line.words;
  if (words && words.length >= 2) {
    return (
      <>
        {words.map((word, i) => {
          const last = i === words.length - 1;
          const nextStamp = last ? lineEnd : words[i + 1]!.time;
          // Last word holds until the next line, not a 40ms flash at its stamp.
          const nextTime = last
            ? Math.max(nextStamp, word.time + 0.45)
            : nextStamp;
          const fill = lyricWordFill01(smooth, word.time, nextTime);
          return (
            <span key={`${word.time}-${i}`}>
              {i > 0 ? " " : null}
              <FilledToken text={word.text} fill={fill} />
            </span>
          );
        })}
      </>
    );
  }

  const fill = lyricLineFill01(smooth, line.time, lineEnd);
  return <LineFill text={line.text} fill={fill} />;
}
