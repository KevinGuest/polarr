#!/bin/sh

# Xcode Cloud runs this after clone, before resolving the workspace/Pods.
# The default image has neither Node nor (reliably) a usable CocoaPods.

set -eux

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

REPOSITORY_PATH="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../../../.." && pwd)}"

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    node -v
    npm -v
    return 0
  fi

  # Prefer unversioned node so Homebrew puts it on PATH without a fragile link step.
  brew install node

  # Some images still need the opt prefix on PATH even after install.
  if [ -d "$(brew --prefix)/opt/node/bin" ]; then
    export PATH="$(brew --prefix)/opt/node/bin:$PATH"
  fi
  export PATH="$(brew --prefix)/bin:$PATH"

  command -v node
  command -v npm
  node -v
  npm -v
}

ensure_pods() {
  if command -v pod >/dev/null 2>&1; then
    pod --version
    return 0
  fi
  brew install cocoapods
  export PATH="$(brew --prefix)/bin:$PATH"
  command -v pod
  pod --version
}

ensure_node
ensure_pods

# Xcode Cloud npm can wedge on high concurrency:
# https://developer.apple.com/forums/thread/738136
npm config set maxsockets 3

cd "$REPOSITORY_PATH/apps/mobile"
npm ci
npm run cap:sync

# Make sure the archive's base xcconfig exists before Xcode opens the project.
test -f "$REPOSITORY_PATH/apps/mobile/ios/App/Pods/Target Support Files/Pods-App/Pods-App.release.xcconfig"
