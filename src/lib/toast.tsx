"use client";

import type { ReactNode } from "react";
import { Check, Heart, Info, X } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { TOAST_CLASS_NAMES } from "@/lib/toast-styles";

export { TOAST_CLASS_NAMES } from "@/lib/toast-styles";

function iconEl(
  Icon: typeof Check,
  className?: string,
  extra?: { fill?: boolean },
) {
  return (
    <Icon
      className={className ?? "size-4 shrink-0 text-zinc-300"}
      strokeWidth={2.5}
      aria-hidden
      {...(extra?.fill ? { fill: "currentColor" } : {})}
    />
  );
}

type ToastOpts = {
  description?: string;
  duration?: number;
  icon?: ReactNode;
};

function greyToast(message: string, opts?: ToastOpts) {
  return sonnerToast(message, {
    description: opts?.description,
    duration: opts?.duration,
    icon: opts?.icon,
    classNames: TOAST_CLASS_NAMES,
  });
}

/** Form save confirmation (check). */
export function toastSaved(message = "Saved", opts?: Omit<ToastOpts, "icon">) {
  return greyToast(message, {
    ...opts,
    icon: iconEl(Check),
  });
}

/** Generic success (check). */
export function toastSuccess(
  message: string,
  opts?: Omit<ToastOpts, "icon"> | string,
) {
  const o = typeof opts === "string" ? { description: opts } : opts;
  return greyToast(message, {
    ...o,
    icon: iconEl(Check),
  });
}

/** Alias for success. */
export const toastOk = toastSuccess;

/** Error (X). */
export function toastError(
  message: string,
  opts?: Omit<ToastOpts, "icon"> | string,
) {
  const o = typeof opts === "string" ? { description: opts } : opts;
  return greyToast(message, {
    ...o,
    icon: iconEl(X),
  });
}

/** Neutral info. */
export function toastInfo(
  message: string,
  opts?: Omit<ToastOpts, "icon"> | string,
) {
  const o = typeof opts === "string" ? { description: opts } : opts;
  return greyToast(message, {
    ...o,
    icon: iconEl(Info),
  });
}

const savingToLibraryKeys = new Set<string>();

/** Once per artist|title — live play kicked a background library save. */
export function toastSavingToLibrary(artist?: string, title?: string) {
  const key = `${(artist || "").trim().toLowerCase()}|${(title || "").trim().toLowerCase()}`;
  if (savingToLibraryKeys.has(key)) return;
  savingToLibraryKeys.add(key);
  if (savingToLibraryKeys.size > 200) savingToLibraryKeys.clear();
  return toastInfo("Saving to library…");
}

/** Like / heart actions. */
export function toastHeart(message: string, opts?: Omit<ToastOpts, "icon">) {
  return greyToast(message, {
    ...opts,
    icon: iconEl(Heart, "size-4 shrink-0 text-zinc-300", { fill: true }),
  });
}

/**
 * Pull a string error from a JSON body (or use fallback).
 * Common pattern after `const data = await res.json()`.
 */
export function toastApiError(data: unknown, fallback: string) {
  const msg =
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : fallback;
  return toastError(msg);
}
