import { cn } from "@/lib/utils";

export function SheetHandle({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "mx-auto mb-2 mt-1.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30",
        className,
      )}
      aria-hidden
    />
  );
}

/** Bottom sheet panel — no boxed border, large iOS-style top radius. */
export const SHEET_PANEL = cn(
  "fixed inset-x-0 bottom-0 flex flex-col rounded-t-[1.75rem] bg-background text-foreground shadow-2xl outline-none",
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
  "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
  "duration-300",
);
