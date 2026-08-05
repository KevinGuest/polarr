export function QRCodePlaceholder({ value }: { value: string }) {
  // Lightweight visual stand-in; real QR can plug into the iOS app later.
  return (
    <div
      className="grid size-40 grid-cols-5 gap-1 rounded-lg border border-border bg-background p-2"
      title={value}
      aria-label={`Connection payload ${value}`}
    >
      {Array.from({ length: 25 }).map((_, i) => {
        const on =
          value.charCodeAt(i % Math.max(value.length, 1)) % 3 !== 0 ||
          i % 7 === 0;
        return (
          <div
            key={i}
            className={on ? "rounded-sm bg-foreground/90" : "rounded-sm bg-muted"}
          />
        );
      })}
    </div>
  );
}
