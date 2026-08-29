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

  // Same formula tao uses for trafficLightPosition: grow the title-bar
  // container so AppKit sits the buttons `y` pt from the window top.
  // Re-applied after theme/title/resize because AppKit resets the frames.
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

static void polarr_set_webview_frame(WKWebView *view, NSRect frame, NSAutoresizingMaskOptions mask) {
  if (!view) {
    return;
  }
  view.translatesAutoresizingMaskIntoConstraints = YES;
  view.autoresizingMask = mask;
  view.frame = frame;
}

void polarr_macos_layout_webviews(void *ns_window, void *shell_wv, void *server_wv,
                                  double titlebar_h) {
  if (ns_window == NULL || shell_wv == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSView *content = window.contentView;
  if (!content) {
    return;
  }

  CGFloat bar = titlebar_h > 1.0 ? (CGFloat)titlebar_h : kTitlebarH;
  NSRect bounds = content.bounds;
  CGFloat width = NSWidth(bounds);
  CGFloat height = NSHeight(bounds);
  CGFloat bodyH = MAX(1.0, height - bar);

  WKWebView *shell = (__bridge WKWebView *)shell_wv;
  // NSView origin is bottom-left. Keep the shell strip at the top.
  polarr_set_webview_frame(shell,
                           NSMakeRect(0, height - bar, width, bar),
                           NSViewWidthSizable | NSViewMinYMargin);
  [content addSubview:shell positioned:NSWindowAbove relativeTo:nil];

  if (server_wv != NULL) {
    WKWebView *server = (__bridge WKWebView *)server_wv;
    polarr_set_webview_frame(server, NSMakeRect(0, 0, width, bodyH),
                             NSViewWidthSizable | NSViewHeightSizable);
    [content addSubview:server positioned:NSWindowAbove relativeTo:shell];
  }
}

void polarr_macos_fill_shell(void *ns_window, void *shell_wv) {
  if (ns_window == NULL || shell_wv == NULL) {
    return;
  }
  NSWindow *window = (__bridge NSWindow *)ns_window;
  NSView *content = window.contentView;
  if (!content) {
    return;
  }
  WKWebView *shell = (__bridge WKWebView *)shell_wv;
  polarr_set_webview_frame(shell, content.bounds,
                            NSViewWidthSizable | NSViewHeightSizable);
  [content addSubview:shell positioned:NSWindowAbove relativeTo:nil];
}
