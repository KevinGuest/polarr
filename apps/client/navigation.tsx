import {
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

const ROUTE_KEY = "polarr_native_route";
const CHANGE_EVENT = "polarr-native-navigation";

function normalizeRoute(value: string): string {
  const raw = value.replace(/^#/, "") || "/";
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

function currentRoute(): string {
  if (typeof window === "undefined") return "/";
  const fromHash = normalizeRoute(window.location.hash);
  if (window.location.hash) return fromHash;
  return normalizeRoute(localStorage.getItem(ROUTE_KEY) || "/");
}

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function navigate(href: string, replace = false) {
  if (/^https?:\/\//i.test(href)) {
    window.location.assign(href);
    return;
  }
  const route = normalizeRoute(href);
  localStorage.setItem(ROUTE_KEY, route);
  const hash = `#${route}`;
  if (replace) window.history.replaceState({}, "", hash);
  else window.history.pushState({}, "", hash);
  notify();
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
  };
}

function useRoute() {
  return useSyncExternalStore(subscribe, currentRoute, () => "/");
}

export function usePathname() {
  return useRoute().split("?")[0] || "/";
}

export function useSearchParams() {
  const route = useRoute();
  return useMemo(
    () => new URLSearchParams(route.includes("?") ? route.slice(route.indexOf("?") + 1) : ""),
    [route],
  );
}

export function useRouter() {
  return {
    push: (href: string, options?: { scroll?: boolean }) => {
      void options;
      navigate(href);
    },
    replace: (href: string, options?: { scroll?: boolean }) => {
      void options;
      navigate(href, true);
    },
    refresh: () => notify(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    prefetch: async () => undefined,
  };
}

export function redirect(href: string): never {
  navigate(href, true);
  throw new Error(`Native navigation redirected to ${href}`);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | { pathname?: string; query?: Record<string, string> };
  children?: ReactNode;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean;
};

function hrefString(href: LinkProps["href"]): string {
  if (typeof href === "string") return href;
  const params = new URLSearchParams(href.query || {});
  return `${href.pathname || "/"}${params.size ? `?${params}` : ""}`;
}

export default function Link({
  href,
  replace,
  scroll,
  prefetch,
  onClick,
  target,
  children,
  ...props
}: LinkProps) {
  void scroll;
  void prefetch;
  const value = hrefString(href);
  function click(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      target === "_blank" ||
      /^https?:\/\//i.test(value)
    ) return;
    event.preventDefault();
    navigate(value, replace);
  }
  return (
    <a {...props} target={target} href={`#${normalizeRoute(value)}`} onClick={click}>
      {children}
    </a>
  );
}
