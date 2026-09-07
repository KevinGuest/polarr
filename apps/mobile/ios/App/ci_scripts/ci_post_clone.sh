#!/bin/sh

# Xcode Cloud runs this after clone, before resolving the workspace/Pods.
# The default image has neither Node nor (reliably) a usable CocoaPods.

set -eu

export HOMEBREW_NO_AUTO_UPDATE=1
export HOMEBREW_NO_INSTALL_CLEANUP=1

REPOSITORY_PATH="${CI_PRIMARY_REPOSITORY_PATH:-$(cd "$(dirname "$0")/../../../../.." && pwd)}"

if ! command -v node >/dev/null 2>&1; then
  brew install node@22
  brew link node@22 --force --overwrite
fi

if ! command -v pod >/dev/null 2>&1; then
  brew install cocoapods
fi

# Xcode Cloud npm can wedge on high concurrency:
# https://developer.apple.com/forums/thread/738136
npm config set maxsockets 3

cd "$REPOSITORY_PATH/apps/mobile"
npm ci
npm run cap:sync
