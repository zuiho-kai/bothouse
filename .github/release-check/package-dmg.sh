#!/bin/bash
# Usage: package-dmg.sh UNIVERSAL_BINARY OUTPUT TAG (run on macOS).
set -euo pipefail
binary=$1
output=$2
tag=$3
lipo "$binary" -verify_arch arm64
lipo "$binary" -verify_arch x86_64
stage=$(mktemp -d)
app="$stage/Bothouse.app"
mkdir -p "$app/Contents/MacOS"
cp "$binary" "$app/Contents/MacOS/bothouse"
chmod 755 "$app/Contents/MacOS/bothouse"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>bothouse</string>
<key>CFBundleIdentifier</key><string>ai.bothouse.desktop</string>
<key>CFBundleName</key><string>Bothouse</string>
<key>CFBundleDisplayName</key><string>Bothouse</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${tag#v}</string>
<key>CFBundleVersion</key><string>${tag#v}</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
ln -s /Applications "$stage/Applications"
# hdiutil's own size estimate for -srcfolder came out too small once the DSH
# plugin was embedded in the binary (release run 39881299879 failed with
# "hdiutil: create failed - No space left on device"), so size it ourselves.
stage_kb=$(du -sk "$stage" | cut -f1)
# Margin: +25% plus a fixed 16 MiB covers HFS+ catalog/journal/allocation
# overhead, which is a fixed cost plus a few percent of volume size; the
# padding is free in the final image because UDZO compresses empty blocks.
size_kb=$(( stage_kb + stage_kb / 4 + 16 * 1024 ))
hdiutil create -volname Bothouse -srcfolder "$stage" -fs HFS+ -size "${size_kb}k" -format UDZO -ov "$output"
