#!/bin/bash
# Usage: package-dmg.sh UNIVERSAL_BINARY OUTPUT TAG (run on macOS).
# Needs the release signing identity, like the step that calls it: SIGN_ID and SIGN_HASH
# (release.yml:93-94) plus the keychain at $HOME/.config/bothouse-signing (release.yml:169-170).
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
mkdir -p "$app/Contents/Resources"
cp "$(cd "$(dirname "$0")/../.." && pwd)/bridge/assets/brand/bothouse.icns" "$app/Contents/Resources/bothouse.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>bothouse</string>
<key>CFBundleIdentifier</key><string>ai.bothouse.desktop</string>
<key>CFBundleIconFile</key><string>bothouse</string>
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
# Sign the assembled bundle, not only the executable. Until v0.1.50 the only codesign call was
# release.yml:175 on build/bothouse-universal, so the .app shipped without Contents/_CodeSignature
# and `codesign -v --strict Bothouse.app` failed with "code has no resources but signature
# indicates they must be present" (measured on the v0.1.50 dmg, 2026-11).
# Everything that ends up in the seal must exist first: signing with no Info.plist yet seals the
# executable plus the icon, and writing the plist afterwards makes strict verification fail with
# "a sealed resource is missing or invalid" (measured), so the plist is written above, before here.
# Identity, hash and keychain are the same ones the calling step uses (release.yml:169-174), but
# that step locks the keychain again before it gets here, so unlock it for this signature and lock
# it right after: password from stdin, never in argv, exactly as release.yml:173. --force is needed
# because the copied-in executable still carries release.yml:175's signature.
signdir="$HOME/.config/bothouse-signing"
keychain="$signdir/bothouse-signing.keychain-db"
security unlock-keychain "$keychain" < "$signdir/keychain.pass" >/dev/null
trap 'security lock-keychain "$keychain"' EXIT
codesign --force --keychain "$keychain" --sign "$SIGN_HASH" --identifier "$SIGN_ID" "$app"
security lock-keychain "$keychain"
# The bundle signing re-signs Contents/MacOS/bothouse with the same identity and adds an Info.plist
# binding to it (measured: nSpecial slots go 2 -> 3, the binary's cdhash changes). Inside the app it
# still satisfies the update guard's requirement (bridge/core/update_sign.go:66 verifies with
# --ignore-resources), but the same file copied out of the app no longer passes a plain
# `codesign --verify` because its plist binding has nothing to bind to. Verify the bundle here:
# that is the artifact this script ships, and nothing may modify it after this line.
codesign --verify --strict "$app"
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
