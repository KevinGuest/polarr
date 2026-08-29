#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

static const CGFloat kTrafficLightX = 16.0;
static const CGFloat kTrafficLightY = 18.0;
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

void polarr_macos_align_traffic_lights(void *ns_window) {
  if (ns_window == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  window.titleVisibility = NSWindowTitleHidden;
  window.titlebarAppearsTransparent = YES;

  NSButton *closeBtn = [window standardWindowButton:NSWindowCloseButton];
  NSButton *minBtn = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoomBtn = [window standardWindowButton:NSWindowZoomButton];
  if (!closeBtn || !minBtn || !zoomBtn) {
    return;
  }

  NSView *titleBar = closeBtn.superview;
  NSView *titleBarContainer = titleBar.superview;
  if (!titleBarContainer) {
    return;
  }

  CGFloat buttonHeight = NSHeight(closeBtn.frame);
  CGFloat titleBarHeight = buttonHeight + kTrafficLightY;
  NSRect windowFrame = window.frame;
  NSRect containerFrame = titleBarContainer.frame;
  containerFrame.size.height = titleBarHeight;
  containerFrame.origin.y = NSHeight(windowFrame) - titleBarHeight;
  titleBarContainer.frame = containerFrame;

  CGFloat spaceBetween = NSMinX(minBtn.frame) - NSMinX(closeBtn.frame);
  if (spaceBetween < 8.0) {
    spaceBetween = 20.0;
  }

  NSButton *buttons[3] = {closeBtn, minBtn, zoomBtn};
  for (NSInteger i = 0; i < 3; i++) {
    NSRect rect = buttons[i].frame;
    rect.origin.x = kTrafficLightX + (CGFloat)i * spaceBetween;
    [buttons[i] setFrameOrigin:rect.origin];
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
  if (s.length == 0) {
    return YES;
  }
  NSString *lower = s.lowercaseString;
  return [lower containsString:@"tauri.localhost"] || [lower containsString:@"tauri://"] ||
         [lower containsString:@"localhost:1420"] || [lower containsString:@"asset.localhost"] ||
         [lower containsString:@"index.html"];
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

static void polarr_classify_webviews(NSView *content, WKWebView **shellOut, WKWebView **serverOut) {
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
    } else if (!server) {
      server = wv;
    }
  }
  if (!shell && all.count > 0) {
    shell = all.firstObject;
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

void polarr_macos_layout_connected(void *ns_window, double titlebar_h) {
  if (ns_window == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSView *content = window.contentView;
  if (!content) {
    return;
  }

  WKWebView *shellWV = nil;
  WKWebView *serverWV = nil;
  polarr_classify_webviews(content, &shellWV, &serverWV);
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

  if (serverBox && serverBox != shellBox) {
    polarr_set_container_frame(serverBox, NSMakeRect(0, 0, width, bodyH),
                                NSViewWidthSizable | NSViewHeightSizable);
    [content addSubview:serverBox positioned:NSWindowAbove relativeTo:shellBox];
    serverWV.hidden = NO;
    if (@available(macOS 12.0, *)) {
      serverWV.underPageBackgroundColor = [NSColor colorWithSRGBRed:(9.0 / 255.0)
                                                               green:(9.0 / 255.0)
                                                                blue:(11.0 / 255.0)
                                                               alpha:1.0];
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
  polarr_classify_webviews(content, &shellWV, NULL);
  if (!shellWV) {
    return;
  }
  NSView *shellBox = polarr_content_child(content, shellWV);
  polarr_set_container_frame(shellBox, content.bounds,
                             NSViewWidthSizable | NSViewHeightSizable);
  [content addSubview:shellBox positioned:NSWindowAbove relativeTo:nil];
}
