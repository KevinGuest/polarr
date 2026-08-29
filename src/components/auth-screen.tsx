import type { ReactNode } from "react";

/** Transparent rows for the iOS grouped field stack. */
export const AUTH_CONTROL =
  "h-14 rounded-none border-0 bg-transparent px-4 text-[17px] shadow-none ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0";

export function AuthFieldGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-white/[0.06] [&>*+*]:border-t [&>*+*]:border-border">
      {children}
    </div>
  );
}

export function AuthScreen({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[22.5rem] flex-1 flex-col justify-center max-lg:max-w-none">
      <header className="mb-10 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/polarr-icon.png"
          alt=""
          aria-hidden
          className="mx-auto mb-6 size-[4.5rem] rounded-[1.35rem] object-cover"
        />
        <h1 className="text-[1.75rem] font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mx-auto mt-2 max-w-[18rem] text-[15px] leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </div>
  );
}

export const AUTH_SUBMIT =
  "mt-6 h-14 w-full rounded-full text-[17px] font-semibold";

export const AUTH_GHOST =
  "mt-2 h-12 w-full text-[15px] text-muted-foreground";
