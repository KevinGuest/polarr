import * as React from "react";
import { cn } from "@/lib/utils";

const Badge = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "secondary" | "outline" | "success" | "warn";
  }
>(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
      variant === "default" &&
        "border-transparent bg-muted text-foreground",
      variant === "secondary" &&
        "border-transparent bg-muted text-muted-foreground",
      variant === "outline" && "text-foreground",
      variant === "success" &&
        "border-transparent bg-muted text-foreground",
      variant === "warn" &&
        "border-transparent bg-destructive/15 text-destructive",
      className,
    )}
    {...props}
  />
));
Badge.displayName = "Badge";

export { Badge };
