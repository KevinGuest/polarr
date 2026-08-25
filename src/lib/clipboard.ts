/**
 * Copy text to the clipboard.
 *
 * Prefers `navigator.clipboard.writeText` in a secure context. If that is
 * missing or rejects (common when a dropdown/context menu closes and steals
 * focus mid-await), falls back to `document.execCommand("copy")`.
 *
 * The execCommand path intercepts the `copy` event and sets `text/plain`
 * explicitly. A bare textarea + select often copies whatever was already
 * selected (e.g. the invite email field) even when execCommand returns true.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;

  if (canUseClipboardApi()) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through — e.g. Permissions Policy, or focus lost after a menu close */
    }
  }

  return copyTextWithExecCommand(text);
}

/**
 * Copy from a click/select handler. Tries the Clipboard API without awaiting
 * a prior hop so user activation is still valid, then falls back to execCommand.
 */
export function copyTextToClipboardSync(text: string): boolean {
  if (typeof window === "undefined" || !text) return false;

  if (canUseClipboardApi()) {
    try {
      const maybe = navigator.clipboard.writeText(text) as Promise<void> | void;
      if (maybe && typeof (maybe as Promise<void>).then === "function") {
        void (maybe as Promise<void>).catch(() => {
          copyTextWithExecCommand(text);
        });
      }
      return true;
    } catch {
      /* fall through */
    }
  }

  return copyTextWithExecCommand(text);
}

function canUseClipboardApi() {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.clipboard?.writeText &&
    !!window.isSecureContext
  );
}

function copyTextWithExecCommand(text: string): boolean {
  const onCopy = (e: ClipboardEvent) => {
    e.clipboardData?.setData("text/plain", text);
    e.preventDefault();
  };

  try {
    document.addEventListener("copy", onCopy);
    // Some browsers refuse execCommand("copy") unless something is selected.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.setAttribute("aria-hidden", "true");
    ta.tabIndex = -1;
    // Must stay in-viewport; off-screen nodes often copy the previous selection.
    Object.assign(ta.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "1px",
      height: "1px",
      padding: "0",
      border: "0",
      outline: "none",
      opacity: "0.01",
      pointerEvents: "none",
    });
    document.body.appendChild(ta);
    window.getSelection()?.removeAllRanges();
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  } finally {
    document.removeEventListener("copy", onCopy);
  }
}
