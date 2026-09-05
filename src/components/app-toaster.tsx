"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { TOAST_CLASS_NAMES } from "@/lib/toast-styles";

/**
 * Desktop: compact top-center toasts with close.
 * Mobile: edge-to-edge dropdown banner, no close X (tap / auto-dismiss).
 */
export function AppToaster() {
  const [mobile, setMobile] = useState(false);
  const [ios, setIOS] = useState(false);

  useEffect(() => {
    if (document.documentElement.dataset.polarrNative === "ios") {
      setIOS(true);
      setMobile(true);
      return;
    }
    if (
      document.documentElement.getAttribute("data-polarr-desktop") === "1" ||
      sessionStorage.getItem("polarr-desktop") === "1"
    ) {
      setMobile(false);
      return;
    }
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  if (ios) {
    return (
      <Toaster
        theme="dark"
        closeButton={false}
        position="top-center"
        offset="calc(env(safe-area-inset-top, 0px) + 12px)"
        gap={8}
        visibleToasts={2}
        toastOptions={{
          duration: 3800,
          classNames: {
            toast:
              "toast-polarr-ios group !w-full !rounded-2xl !border !border-white/10 !bg-zinc-900/95 !px-4 !py-3.5 !shadow-2xl !backdrop-blur-xl",
            title: "!pr-1 !text-[15px] !font-semibold !leading-5 !text-zinc-50",
            description: "!pr-1 !text-sm !leading-5 !text-zinc-300",
            icon: "!text-zinc-200",
            closeButton: "!hidden",
          },
        }}
      />
    );
  }

  if (mobile) {
    return (
      <Toaster
        theme="dark"
        closeButton={false}
        position="top-center"
        offset={0}
        gap={0}
        visibleToasts={3}
        toastOptions={{
          classNames: {
            toast:
              "toast-polarr-mobile group !mx-0 !mb-0 !w-screen !max-w-none !rounded-none !border-x-0 !border-b !border-t-0 !border-white/10 !bg-zinc-900/95 !px-4 !py-3.5 !shadow-none !backdrop-blur-xl",
            title: "!text-[15px] !font-semibold !text-zinc-50",
            description: "!text-sm !text-zinc-400",
            icon: "!text-zinc-300",
            closeButton: "!hidden",
          },
        }}
      />
    );
  }

  return (
    <Toaster
      theme="dark"
      closeButton
      position="top-center"
      toastOptions={{
        classNames: { ...TOAST_CLASS_NAMES },
      }}
    />
  );
}
