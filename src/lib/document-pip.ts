/**
 * Document Picture-in-Picture — float UI while audio stays in the opener.
 * https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API
 */

export type DocumentPipWindow = Window & {
  document: Document;
};

type DpiGlobal = Window & {
  documentPictureInPicture?: {
    window?: Window | null;
    requestWindow?: (opts?: {
      width?: number;
      height?: number;
    }) => Promise<Window>;
  };
};

export function supportsDocumentPip(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof (window as DpiGlobal).documentPictureInPicture?.requestWindow ===
      "function"
  );
}

/** Active Document PiP window, if any. */
export function getDocumentPipWindow(): DocumentPipWindow | null {
  if (!supportsDocumentPip()) return null;
  const w = (window as DpiGlobal).documentPictureInPicture?.window;
  if (!w || w.closed) return null;
  return w as DocumentPipWindow;
}

/** Clone stylesheets/styles so Tailwind + app CSS apply inside the PiP document. */
export function copyDocumentStyles(from: Document, to: Document) {
  to.documentElement.className = from.documentElement.className;
  to.documentElement.style.cssText = from.documentElement.style.cssText;
  to.body.className = from.body.className;
  to.body.style.cssText = [
    from.body.style.cssText,
    "margin:0",
    "height:100%",
    "overflow:hidden",
    "background:hsl(var(--background))",
    "color:hsl(var(--foreground))",
  ]
    .filter(Boolean)
    .join(";");
  to.documentElement.style.height = "100%";

  const head = to.head;
  while (head.firstChild) head.removeChild(head.firstChild);

  const base = to.createElement("base");
  base.href = from.baseURI;
  head.appendChild(base);

  from.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    head.appendChild(node.cloneNode(true));
  });
}

export async function openDocumentPip(options?: {
  width?: number;
  height?: number;
}): Promise<DocumentPipWindow | null> {
  if (!supportsDocumentPip()) return null;

  const existing = getDocumentPipWindow();
  if (existing) {
    try {
      existing.focus();
    } catch {
      /* ignore */
    }
    return existing;
  }

  const dpi = (window as DpiGlobal).documentPictureInPicture;
  if (!dpi?.requestWindow) return null;

  try {
    const win = await dpi.requestWindow({
      width: options?.width ?? 360,
      height: options?.height ?? 560,
    });
    copyDocumentStyles(document, win.document);
    return win as DocumentPipWindow;
  } catch {
    return null;
  }
}

/** Mount node for React portal; reuses one if already present. */
export function ensurePipMount(
  win: DocumentPipWindow,
  id = "polarr-miniplayer-root",
): HTMLElement {
  const found = win.document.getElementById(id);
  if (found) return found;
  const root = win.document.createElement("div");
  root.id = id;
  root.style.cssText = "height:100%;width:100%;min-height:0;";
  win.document.body.appendChild(root);
  return root;
}
