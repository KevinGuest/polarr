#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

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
