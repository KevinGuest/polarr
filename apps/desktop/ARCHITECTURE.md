# Polarr desktop UI migration

Polarr Server and Polarr Desktop are independently released products. The web
application remains available from the server, while Desktop progressively
bundles the same React UI source and reads data through the server API.

## Non-negotiable constraints

- Do not fork the visual design or duplicate feature implementations.
- Keep the server web application fully functional throughout the migration.
- Keep the remote server webview as Desktop's production content until the
  bundled route has feature parity.
- Do not require a Desktop release for ordinary server, database, scanner, or
  transcoder updates.
- Do not require a server release for ordinary Desktop chrome or native
  integration updates.
- Offline media downloads are outside this migration. Existing download code
  is unchanged.

## Compatibility handshake

Desktop reads `GET /api/v1/desktop` before opening a server. The response
declares the server version, supported desktop protocol range, capabilities,
and web-app entry path. Protocol version changes are reserved for breaking
desktop/server contract changes; product versions may advance independently.

Servers predating the handshake continue through the legacy status probe. A
known incompatible protocol is rejected with an actionable update message.

## Native API transport

Bundled pages call the configured server through the Rust
`desktop_api_request` command. This avoids browser CORS, mixed-content, and
LAN-cookie differences between WebView2, WKWebView, and WebKitGTK.

The transport:

- accepts only `/api/` paths on the configured server;
- allows only normal application HTTP methods;
- preserves server session cookies in the native client;
- does not follow redirects off-origin;
- limits response size and accepts text/JSON data only;
- identifies notification metadata as Polarr Desktop without using that hint
  for authentication.

## Migration order

1. Extract framework-neutral UI primitives and data types without changing
   their styling or current Next.js consumers.
2. Bundle authentication/bootstrap and establish a persisted native session.
3. Move the application shell, library navigation, search, and home feed.
4. Move playback and queue while keeping streaming authoritative on the
   server.
5. Move album, artist, playlist, profile, requests, and settings routes.
6. Move staff/admin routes last.
7. Remove the remote content webview only after a route-by-route parity pass on
   Windows and macOS.

Each screen should use a small data adapter so the same UI component can read
from Next.js on the web and the native API transport on Desktop. Switching the
default before parity would trade known working functionality for an
incomplete rewrite and is intentionally prohibited.
