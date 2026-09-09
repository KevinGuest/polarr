import { cn } from "@/lib/utils";

/** Brand marks for playlist import service picker. */
export function SpotifyMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="12" fill="#1DB954" />
      <path
        fill="#121212"
        d="M17.5 17.1c-.25.4-.7.55-1.1.3-3-1.85-6.75-2.25-11.15-1.25-.45.1-.9-.2-1-.65-.1-.45.2-.85.65-.95 4.8-1.1 8.95-.6 12.3 1.45.4.25.55.75.3 1.1zm1.45-3.2c-.3.45-.85.6-1.3.35-3.4-2.1-8.6-2.7-12.6-1.5-.5.15-1.05-.15-1.2-.65-.15-.5.15-1.05.65-1.2 4.6-1.4 10.35-.7 14.2 1.7.45.25.6.85.25 1.3zm.15-3.35C15.55 8.35 8.95 8.1 5.2 9.25c-.6.2-1.25-.15-1.45-.75-.2-.6.15-1.25.75-1.45 4.35-1.3 11.7-1.05 16.2 1.65.55.3.75 1.05.45 1.6-.3.5-1.05.7-1.6.35z"
      />
    </svg>
  );
}

export function YoutubeMusicMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <circle cx="12" cy="12" r="12" fill="#FF0033" />
      <path
        fill="#fff"
        d="M16.2 11.4 10 7.6c-.5-.3-1.1.1-1.1.7v7.4c0 .6.6 1 1.1.7l6.2-3.8c.5-.3.5-1.1 0-1.4z"
      />
    </svg>
  );
}

export function DeezerMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="24" height="24" rx="6" fill="#121212" />
      <rect x="3.2" y="14.2" width="2.4" height="5.2" rx="0.4" fill="#FF0092" />
      <rect x="6.8" y="11.4" width="2.4" height="8" rx="0.4" fill="#FF6A00" />
      <rect x="10.4" y="8.6" width="2.4" height="10.8" rx="0.4" fill="#FFE800" />
      <rect x="14" y="11.4" width="2.4" height="8" rx="0.4" fill="#00C7F2" />
      <rect x="17.6" y="9.8" width="2.4" height="9.6" rx="0.4" fill="#A238FF" />
    </svg>
  );
}

export function AppleMusicMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={cn("size-7 shrink-0", className)}
    >
      <rect width="24" height="24" rx="5.5" fill="#FA243C" />
      <path
        fill="#fff"
        d="M15.6 5.2c-.2 0-.5.1-.8.2l-4.6 1.5c-.5.2-.8.6-.8 1.1v6.7c-.4-.2-.9-.3-1.4-.3-1.5 0-2.7 1-2.7 2.2s1.2 2.2 2.7 2.2 2.7-1 2.7-2.2V10l4.2-1.3v4.3c-.4-.2-.9-.3-1.4-.3-1.5 0-2.7 1-2.7 2.2s1.2 2.2 2.7 2.2 2.7-1 2.7-2.2V6.4c0-.7-.5-1.2-1.2-1.2z"
      />
    </svg>
  );
}
