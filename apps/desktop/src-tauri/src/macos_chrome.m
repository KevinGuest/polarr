#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static const CGFloat kTitlebarH = 48.0;

void polarr_macos_paint_window(void *ns_window) {
  if (ns_window == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSColor *color = [NSColor colorWithSRGBRed:(9.0 / 255.0)
                                       green:(9.0 / 255.0)
                                        blue:(11.0 / 255.0)
                                       alpha:1.0];
  window.opaque = YES;
  window.backgroundColor = color;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleHidden;
}

void polarr_macos_paint_webview(void *wk_webview) {
  if (wk_webview == NULL) {
    return;
  }
  WKWebView *view = (__bridge WKWebView *)wk_webview;
  [view setValue:@NO forKey:@"drawsBackground"];
  if (@available(macOS 12.0, *)) {
    view.underPageBackgroundColor = [NSColor colorWithSRGBRed:(9.0 / 255.0)
                                                         green:(9.0 / 255.0)
                                                          blue:(11.0 / 255.0)
                                                         alpha:1.0];
  }
}

static void polarr_collect_wk(NSView *root, NSMutableArray<WKWebView *> *out) {
  if ([root isKindOfClass:[WKWebView class]]) {
    [out addObject:(WKWebView *)root];
  }
  for (NSView *child in root.subviews) {
    polarr_collect_wk(child, out);
  }
}

static BOOL polarr_is_shell_url(NSString *s) {
  NSString *lower = (s ?: @"").lowercaseString;
  // Do not treat about:blank / empty as the shell — a new server webview
  // has no URL yet and was being pinned to the 48px strip.
  return [lower containsString:@"tauri.localhost"] || [lower containsString:@"tauri://"] ||
         [lower containsString:@"localhost:1420"] || [lower containsString:@"asset.localhost"];
}

static NSView *polarr_content_child(NSView *content, NSView *inner) {
  NSView *v = inner;
  while (v && v.superview && v.superview != content) {
    v = v.superview;
  }
  return v ?: inner;
}

static void polarr_clear_constraints(NSView *view) {
  NSView *parent = view.superview;
  if (!parent) {
    return;
  }
  NSMutableArray<NSLayoutConstraint *> *drop = [NSMutableArray array];
  for (NSLayoutConstraint *c in parent.constraints) {
    if (c.firstItem == view || c.secondItem == view) {
      [drop addObject:c];
    }
  }
  if (drop.count > 0) {
    [NSLayoutConstraint deactivateConstraints:drop];
  }
  view.translatesAutoresizingMaskIntoConstraints = YES;
}

static void polarr_set_container_frame(NSView *view, NSRect frame, NSAutoresizingMaskOptions mask) {
  if (!view) {
    return;
  }
  polarr_clear_constraints(view);
  view.hidden = NO;
  view.autoresizingMask = mask;
  view.frame = frame;
}

static void polarr_paint_content(NSView *content) {
  if (!content) {
    return;
  }
  NSColor *color = [NSColor colorWithSRGBRed:(9.0 / 255.0)
                                       green:(9.0 / 255.0)
                                        blue:(11.0 / 255.0)
                                       alpha:1.0];
  content.wantsLayer = YES;
  content.layer.backgroundColor = color.CGColor;
}

static BOOL polarr_host_matches(NSString *href, const char *server_url) {
  if (!server_url || server_url[0] == '\0' || href.length == 0) {
    return NO;
  }
  NSURL *have = [NSURL URLWithString:href];
  NSURL *want = [NSURL URLWithString:[NSString stringWithUTF8String:server_url]];
  if (have.host.length == 0 || want.host.length == 0) {
    return NO;
  }
  return [have.host.lowercaseString isEqualToString:want.host.lowercaseString];
}

static NSInteger polarr_effective_port(NSURL *url) {
  if (url.port != nil) {
    return url.port.integerValue;
  }
  NSString *scheme = url.scheme.lowercaseString;
  if ([scheme isEqualToString:@"http"]) {
    return 80;
  }
  if ([scheme isEqualToString:@"https"]) {
    return 443;
  }
  return -1;
}

static BOOL polarr_same_origin(NSURL *have, NSURL *want) {
  if (!have || !want || have.host.length == 0 || want.host.length == 0) {
    return NO;
  }
  return [have.scheme.lowercaseString isEqualToString:want.scheme.lowercaseString] &&
         [have.host.lowercaseString isEqualToString:want.host.lowercaseString] &&
         polarr_effective_port(have) == polarr_effective_port(want);
}

static void polarr_classify_webviews(NSView *content, const char *server_url, WKWebView **shellOut,
                                     WKWebView **serverOut) {
  NSMutableArray<WKWebView *> *all = [NSMutableArray array];
  polarr_collect_wk(content, all);
  WKWebView *shell = nil;
  WKWebView *server = nil;
  for (WKWebView *wv in all) {
    NSString *href = wv.URL.absoluteString ?: @"";
    if (polarr_is_shell_url(href)) {
      if (!shell) {
        shell = wv;
      }
    } else if (polarr_host_matches(href, server_url)) {
      server = wv;
    } else if (!server) {
      server = wv;
    }
  }
  if (!shell && all.count > 0) {
    for (WKWebView *wv in all) {
      if (wv != server) {
        shell = wv;
        break;
      }
    }
    if (!shell) {
      shell = all.firstObject;
    }
  }
  if (!server && all.count > 1) {
    for (WKWebView *wv in all) {
      if (wv != shell) {
        server = wv;
        break;
      }
    }
  }
  if (shellOut) {
    *shellOut = shell;
  }
  if (serverOut) {
    *serverOut = server;
  }
}

static void polarr_fill_inside(NSView *box, NSView *leaf) {
  if (!box || !leaf || leaf == box) {
    return;
  }
  NSMutableArray<NSView *> *path = [NSMutableArray array];
  NSView *v = leaf;
  while (v && v != box) {
    [path insertObject:v atIndex:0];
    v = v.superview;
  }
  NSView *parent = box;
  for (NSView *node in path) {
    polarr_clear_constraints(node);
    node.translatesAutoresizingMaskIntoConstraints = YES;
    node.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    node.hidden = NO;
    node.frame = parent.bounds;
    parent = node;
  }
}

void polarr_macos_layout_connected(void *ns_window, double titlebar_h, const char *server_url) {
  if (ns_window == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSView *content = window.contentView;
  if (!content) {
    return;
  }
  polarr_paint_content(content);

  WKWebView *shellWV = nil;
  WKWebView *serverWV = nil;
  polarr_classify_webviews(content, server_url, &shellWV, &serverWV);
  if (!shellWV) {
    return;
  }

  CGFloat bar = titlebar_h > 1.0 ? (CGFloat)titlebar_h : kTitlebarH;
  NSRect bounds = content.bounds;
  CGFloat width = NSWidth(bounds);
  CGFloat height = NSHeight(bounds);
  CGFloat bodyH = MAX(1.0, height - bar);

  NSView *shellBox = polarr_content_child(content, shellWV);
  NSView *serverBox = serverWV ? polarr_content_child(content, serverWV) : nil;

  // Resize wry's contentView children in place. Do not reparent WKWebViews —
  // pulling them out of their wrappers leaves a full-size hole that covers the
  // server view (black pane after Connect).
  polarr_set_container_frame(shellBox, NSMakeRect(0, height - bar, width, bar),
                             NSViewWidthSizable | NSViewMinYMargin);
  polarr_fill_inside(shellBox, shellWV);

  if (serverBox && serverBox != shellBox) {
    polarr_set_container_frame(serverBox, NSMakeRect(0, 0, width, bodyH),
                                NSViewWidthSizable | NSViewHeightSizable);
    polarr_fill_inside(serverBox, serverWV);
    [content addSubview:serverBox positioned:NSWindowAbove relativeTo:shellBox];
    serverWV.hidden = NO;
    polarr_macos_paint_webview((__bridge void *)serverWV);
    // Start navigation only after add_child's wrapper and WKWebView have been
    // attached and sized. Deferring one main-queue cycle avoids racing the
    // initial NSURLRequest against WebKit view attachment. Origin comparison
    // prevents resize/layout retries from reloading a live session.
    NSString *href = server_url && server_url[0] != '\0'
                         ? [NSString stringWithUTF8String:server_url]
                         : @"";
    NSURL *dest = href.length ? [NSURL URLWithString:href] : nil;
    if (dest && !polarr_same_origin(serverWV.URL, dest)) {
      __weak WKWebView *weakServerWV = serverWV;
      dispatch_async(dispatch_get_main_queue(), ^{
        WKWebView *liveServerWV = weakServerWV;
        if (!liveServerWV) {
          return;
        }
        if (!polarr_same_origin(liveServerWV.URL, dest)) {
          NSURLRequest *req =
              [NSURLRequest requestWithURL:dest
                               cachePolicy:NSURLRequestUseProtocolCachePolicy
                           timeoutInterval:30.0];
          [liveServerWV loadRequest:req];
        }
      });
    }
  }
}

void polarr_macos_fill_shell(void *ns_window) {
  if (ns_window == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSView *content = window.contentView;
  if (!content) {
    return;
  }
  WKWebView *shellWV = nil;
  polarr_classify_webviews(content, NULL, &shellWV, NULL);
  if (!shellWV) {
    return;
  }
  NSView *shellBox = polarr_content_child(content, shellWV);
  polarr_set_container_frame(shellBox, content.bounds,
                             NSViewWidthSizable | NSViewHeightSizable);
  polarr_fill_inside(shellBox, shellWV);
  [content addSubview:shellBox positioned:NSWindowAbove relativeTo:nil];
}
