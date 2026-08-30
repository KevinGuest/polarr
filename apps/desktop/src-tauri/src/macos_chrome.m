#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static const CGFloat kTrafficLightX = 16.0;
static const CGFloat kTitlebarH = 48.0;

static BOOL polarr_traffic_aligning = NO;

static void polarr_install_traffic_observers(NSWindow *window);
static void polarr_observe_titlebar_views(NSWindow *window, NSView *titleBar, NSView *container);

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
  polarr_install_traffic_observers(window);
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
  if (ns_window == NULL || polarr_traffic_aligning) {
    return;
  }
  polarr_traffic_aligning = YES;

  NSWindow *window = (__bridge NSWindow *)ns_window;
  window.titleVisibility = NSWindowTitleHidden;
  window.titlebarAppearsTransparent = YES;
  if (@available(macOS 11.0, *)) {
    window.titlebarSeparatorStyle = NSTitlebarSeparatorStyleNone;
  }
  polarr_install_traffic_observers(window);

  NSButton *closeBtn = [window standardWindowButton:NSWindowCloseButton];
  NSButton *minBtn = [window standardWindowButton:NSWindowMiniaturizeButton];
  NSButton *zoomBtn = [window standardWindowButton:NSWindowZoomButton];
  if (!closeBtn || !minBtn || !zoomBtn) {
    polarr_traffic_aligning = NO;
    return;
  }

  NSView *titleBar = closeBtn.superview;
  NSView *titleBarContainer = titleBar.superview;
  if (!titleBarContainer) {
    polarr_traffic_aligning = NO;
    return;
  }

  polarr_observe_titlebar_views(window, titleBar, titleBarContainer);

  // Match the 48px HTML title bar and center the 12pt lights on that line.
  // Only growing the container (tao's trafficLightPosition trick) leaves
  // NSTitlebarView at ~22pt, so the buttons stay glued to the top edge.
  NSView *parent = titleBarContainer.superview;
  NSRect containerFrame = titleBarContainer.frame;
  containerFrame.size.height = kTitlebarH;
  if (parent) {
    CGFloat parentH = NSHeight(parent.bounds);
    containerFrame.origin.y = parent.isFlipped ? 0.0 : (parentH - kTitlebarH);
    titleBarContainer.autoresizingMask = parent.isFlipped
                                             ? (NSViewWidthSizable | NSViewMaxYMargin)
                                             : (NSViewWidthSizable | NSViewMinYMargin);
  }

  NSRect titleBarFrame = NSMakeRect(0, 0, NSWidth(containerFrame), kTitlebarH);

  CGFloat spaceBetween = NSMinX(minBtn.frame) - NSMinX(closeBtn.frame);
  if (spaceBetween < 8.0) {
    spaceBetween = 20.0;
  }

  CGFloat buttonHeight = NSHeight(closeBtn.frame);
  CGFloat btnY = floor((kTitlebarH - buttonHeight) / 2.0);
  CGFloat expectedOriginY = parent ? (parent.isFlipped ? 0.0 : (NSHeight(parent.bounds) - kTitlebarH))
                                   : NSMinY(titleBarContainer.frame);
  BOOL already =
      ABS(NSHeight(titleBarContainer.frame) - kTitlebarH) < 0.5 &&
      ABS(NSMinY(titleBarContainer.frame) - expectedOriginY) < 0.5 &&
      ABS(NSHeight(titleBar.frame) - kTitlebarH) < 0.5 &&
      ABS(NSMinY(closeBtn.frame) - btnY) < 0.5 &&
      ABS(NSMinX(closeBtn.frame) - kTrafficLightX) < 0.5;
  if (already) {
    polarr_traffic_aligning = NO;
    return;
  }

  BOOL containerPosts = titleBarContainer.postsFrameChangedNotifications;
  BOOL titleBarPosts = titleBar.postsFrameChangedNotifications;
  titleBarContainer.postsFrameChangedNotifications = NO;
  titleBar.postsFrameChangedNotifications = NO;

  titleBarContainer.frame = containerFrame;
  titleBar.frame = titleBarFrame;

  NSButton *buttons[3] = {closeBtn, minBtn, zoomBtn};
  for (NSInteger i = 0; i < 3; i++) {
    NSRect rect = buttons[i].frame;
    rect.origin.x = kTrafficLightX + (CGFloat)i * spaceBetween;
    rect.origin.y = btnY;
    buttons[i].frame = rect;
  }

  titleBarContainer.postsFrameChangedNotifications = containerPosts;
  titleBar.postsFrameChangedNotifications = titleBarPosts;
  polarr_traffic_aligning = NO;
}

static void polarr_observe_titlebar_views(NSWindow *window, NSView *titleBar, NSView *container) {
  static const void *kPolarrViewObs = &kPolarrViewObs;
  if (objc_getAssociatedObject(container, kPolarrViewObs)) {
    return;
  }
  objc_setAssociatedObject(container, kPolarrViewObs, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  titleBar.postsFrameChangedNotifications = YES;
  container.postsFrameChangedNotifications = YES;

  __weak NSWindow *weakWindow = window;
  void (^realign)(NSNotification *) = ^(NSNotification *note) {
    (void)note;
    NSWindow *w = weakWindow;
    if (w && !polarr_traffic_aligning) {
      polarr_macos_align_traffic_lights((__bridge void *)w);
    }
  };

  NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
  [nc addObserverForName:NSViewFrameDidChangeNotification
                  object:container
                   queue:[NSOperationQueue mainQueue]
              usingBlock:realign];
  [nc addObserverForName:NSViewFrameDidChangeNotification
                  object:titleBar
                   queue:[NSOperationQueue mainQueue]
              usingBlock:realign];
}

static void polarr_install_traffic_observers(NSWindow *window) {
  static const void *kPolarrTrafficObs = &kPolarrTrafficObs;
  if (objc_getAssociatedObject(window, kPolarrTrafficObs)) {
    return;
  }
  objc_setAssociatedObject(window, kPolarrTrafficObs, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
  void (^realign)(NSNotification *) = ^(NSNotification *note) {
    NSWindow *w = note.object;
    if (w) {
      polarr_macos_align_traffic_lights((__bridge void *)w);
    }
  };
  for (NSNotificationName name in @[
         NSWindowDidBecomeKeyNotification,
         NSWindowDidBecomeMainNotification,
         NSWindowDidResizeNotification,
         NSWindowDidEndLiveResizeNotification,
         NSWindowDidDeminiaturizeNotification,
         NSWindowDidChangeBackingPropertiesNotification
       ]) {
    [nc addObserverForName:name
                      object:window
                       queue:[NSOperationQueue mainQueue]
                  usingBlock:realign];
  }

  dispatch_async(dispatch_get_main_queue(), ^{
    polarr_macos_align_traffic_lights((__bridge void *)window);
  });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(80 * NSEC_PER_MSEC)),
                 dispatch_get_main_queue(), ^{
                   polarr_macos_align_traffic_lights((__bridge void *)window);
                 });
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(250 * NSEC_PER_MSEC)),
                 dispatch_get_main_queue(), ^{
                   polarr_macos_align_traffic_lights((__bridge void *)window);
                 });
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

  polarr_macos_align_traffic_lights(ns_window);
  dispatch_async(dispatch_get_main_queue(), ^{
    polarr_macos_align_traffic_lights(ns_window);
  });
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
  polarr_macos_align_traffic_lights(ns_window);
}
