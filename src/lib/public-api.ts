/** API routes reachable without a Polarr session (setup, auth, health). */

type PublicRoute = {
  path: string;
  methods: string[];
};

const PUBLIC_API_ROUTES: PublicRoute[] = [
  { path: "/api/auth/login", methods: ["POST"] },
  { path: "/api/auth/register", methods: ["POST"] },
  { path: "/api/auth/join", methods: ["POST"] },
  { path: "/api/auth/forgot-password", methods: ["POST"] },
  { path: "/api/auth/reset-password", methods: ["GET", "POST"] },
  { path: "/api/discord/login", methods: ["GET"] },
  { path: "/api/discord/callback", methods: ["GET"] },
  { path: "/api/v1/status", methods: ["GET"] },
  { path: "/api/status", methods: ["GET"] },
];

export function isPublicApiRoute(pathname: string, method: string): boolean {
  const m = method.toUpperCase();
  return PUBLIC_API_ROUTES.some(
    (route) => route.path === pathname && route.methods.includes(m),
  );
}
