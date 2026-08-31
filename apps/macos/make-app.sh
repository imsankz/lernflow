#!/bin/bash
# Bundle lernapp into a double-clickable .app (no Xcode needed — CLT env).
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
APP=.build/Lernapp.app
BIN=$(swift build -c release --show-bin-path)
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN/lernapp" "$APP/Contents/MacOS/lernapp"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Lernapp</string>
  <key>CFBundleDisplayName</key><string>Lernapp</string>
  <key>CFBundleIdentifier</key><string>com.sankz.lernapp</string>
  <key>CFBundleVersion</key><string>0.2.0</string>
  <key>CFBundleShortVersionString</key><string>0.2.0</string>
  <key>CFBundleExecutable</key><string>lernapp</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.education</string>
</dict></plist>
PLIST
codesign --force --deep -s - "$APP" 2>/dev/null || true
echo "built $APP"
