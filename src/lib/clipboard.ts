/**
 * Copy text to the clipboard.
 *
 * Prefers `navigator.clipboard.writeText` in a secure context. If that is
 * missing or rejects (common when a dropdown/context menu closes and steals
 * focus mid-await), falls back to a temporary textarea +
 * `document.execCommand("copy")`.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;

  const canUseClipboardApi =
    typeof navigator !== "undefined" &&
    !!navigator.clipboard?.writeText &&
    // Clipboard API requires a secure context (https or localhost).
    !!window.isSecureContext;

  if (canUseClipboardApi) {
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
 * Synchronous copy for click/select handlers where awaiting the Clipboard API
 * would lose user activation (Radix dropdown/context menus).
 */
export function copyTextToClipboardSync(text: string): boolean {
  if (typeof window === "undefined" || !text) return false;
  return copyTextWithExecCommand(text);
}

function copyTextWithExecCommand(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
