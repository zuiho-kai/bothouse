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
hdiutil create -volname Bothouse -srcfolder "$stage" -format UDZO -ov "$output"
