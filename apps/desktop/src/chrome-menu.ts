import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type MenuItem =
  | { kind: "label"; text: string }
  | { kind: "separator" }
  | { kind: "action"; id: string; text: string; danger?: boolean };

type MenuPayload = {
  items: MenuItem[];
};

const root = document.querySelector<HTMLDivElement>("#root")!;
const win = getCurrentWindow();
let closing = false;

async function closeMenu() {
  if (closing) return;
  closing = true;
  try {
    await win.close();
  } catch {
    /* already closed */
  }
}

function render(payload: MenuPayload) {
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  for (const item of payload.items) {
    if (item.kind === "label") {
      const el = document.createElement("div");
      el.className = "label";
      el.textContent = item.text;
      menu.appendChild(el);
      continue;
    }
    if (item.kind === "separator") {
      const el = document.createElement("div");
      el.className = "sep";
      el.setAttribute("role", "separator");
      menu.appendChild(el);
      continue;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = item.danger ? "item danger" : "item";
    btn.setAttribute("role", "menuitem");
    btn.textContent = item.text;
    btn.addEventListener("click", () => {
      void emit("polarr-chrome-menu-action", { id: item.id });
      void closeMenu();
    });
    menu.appendChild(btn);
  }

  root.replaceChildren(menu);
  // Focus the menu shell (not an item) so nothing looks "selected" until hover/keyboard.
  menu.tabIndex = -1;
  menu.focus({ preventScroll: true });
}

void listen<MenuPayload>("polarr-chrome-menu-open", (event) => {
  render(event.payload);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    void closeMenu();
  }
});

void win.onFocusChanged(({ payload: focused }) => {
  if (!focused) void closeMenu();
});

// Ready handshake so the opener can send the payload.
void emit("polarr-chrome-menu-ready");
