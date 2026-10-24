#!/bin/sh
# bothouse installer: downloads the prebuilt binary (with the setup wizard)
# from the GitHub Release and puts it in ~/.local/bin. No Go or Node needed.
#
#   curl -fsSL https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.sh | sh
#
# Environment:
#   BOTHOUSE_VERSION   tag to install (default: the newest release, pre-releases included)
#   INSTALL_DIR      where to put bothouse (default: ~/.local/bin)
# macOS and Linux (arm64, amd64). On Windows use install.ps1 (PowerShell):
#   irm https://raw.githubusercontent.com/zuiho-kai/bothouse/main/install.ps1 | iex
set -eu

# Everything runs from main, called on the last line: if a `curl | sh` download is cut
# short, the shell never reaches the call and runs nothing.
main() {
  REPO="zuiho-kai/bothouse"
  INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

  say() { printf '%s\n' "$*"; }
  die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW*|MSYS*|CYGWIN*) die "this is Windows: in PowerShell run   irm https://raw.githubusercontent.com/$REPO/main/install.ps1 | iex   (see docs/GETTING_STARTED.md step 1)" ;;
    *) die "unsupported OS $(uname -s): this script is for macOS and Linux; on Windows use install.ps1 (docs/GETTING_STARTED.md)" ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=amd64 ;;
    *) die "unsupported CPU $(uname -m): arm64 and amd64 only" ;;
  esac

  have() { command -v "$1" >/dev/null 2>&1; }
  use_gh() { have gh && gh auth status >/dev/null 2>&1; }

  tmp=$(mktemp -d)
  asset=""
  trap 'rm -f "$tmp/bothouse" "$tmp/SHA256SUMS" "$tmp/curl.err" 2>/dev/null; [ -n "$asset" ] && rm -f "$tmp/$asset"; rmdir "$tmp" 2>/dev/null || true' EXIT

  # 1. which release: public API first; if that is unavailable (a 404 or a proxy), fall back to the logged-in gh
  tag="${BOTHOUSE_VERSION:-${CONEST_VERSION:-}}"  # CONEST_VERSION: old name, still honored
  via=curl
  if [ -z "$tag" ]; then
    api="https://api.github.com/repos/$REPO/releases?per_page=1"
    if have curl && body=$(curl -fsSL "$api" 2>/dev/null); then
      tag=$(printf '%s' "$body" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
    fi
    if [ -z "$tag" ] && use_gh; then
      tag=$(gh api "repos/$REPO/releases?per_page=1" --jq '.[0].tag_name' 2>/dev/null || true)
      via=gh
    fi
    [ -n "$tag" ] || die "no release found for $REPO. Check the network or proxy; if the GitHub API is blocked, install the GitHub CLI (gh) and run 'gh auth login', then run this again."
  fi

  case "$os/$arch" in
    darwin/*) asset=bothouse-mac.dmg ;;
    linux/amd64) asset=bothouse-linux-x64 ;;
    linux/arm64) asset=bothouse-linux-arm64 ;;
  esac
  say "Installing bothouse $tag ($os/$arch) into $INSTALL_DIR"
  say "Downloading $asset"

  # 2. download
  # A 404 on the public URL means the asset is not served there; that one error stays quiet and the
  # gh fallback below says what happens instead. Any other curl error (network, proxy, TLS) is shown.
  public404=0
  fetch_curl() {
    have curl || return 1
    base="https://github.com/$REPO/releases/download/$tag"
    for f in "$asset" SHA256SUMS; do
      if ! curl -fsSL -o "$tmp/$f" "$base/$f" 2>"$tmp/curl.err"; then
        if grep -q 'error: 404' "$tmp/curl.err"; then public404=1; else cat "$tmp/curl.err" >&2; fi
        return 1
      fi
    done
  }
  fetch_gh() {
    use_gh || return 1
    gh release download "$tag" -R "$REPO" -p "$asset" -p SHA256SUMS -D "$tmp" --clobber
  }
  if [ "$via" = gh ]; then
    fetch_gh || die "download failed: gh release download $tag -R $REPO -p $asset"
  else
    if ! fetch_curl; then
      if ! use_gh; then
        [ "$public404" = 1 ] || die "download failed: $asset of $tag (curl error above). Check the network or proxy and run this again."
        die "download failed: $asset of $tag is not on the public URL. If GitHub is blocked, install the GitHub CLI (gh), run 'gh auth login', and run this again."
      fi
      if [ "$public404" = 1 ]; then
        say "Not on the public download URL; downloading with gh instead."
      else
        say "Public download failed (error above); trying gh instead."
      fi
      fetch_gh || die "download failed: gh release download $tag -R $REPO -p $asset"
    fi
  fi

  # 3. verify and install
  expected=$(grep " $asset\$" "$tmp/SHA256SUMS" | cut -d' ' -f1)
  if have shasum; then actual=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); else actual=$(sha256sum "$tmp/$asset" | cut -d' ' -f1); fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "checksum mismatch for $asset"
  say "Checksum OK ($asset sha256 $actual)"
  if [ "$os" = darwin ]; then
    mkdir -p "$tmp/volume"
    hdiutil attach -readonly -nobrowse -mountpoint "$tmp/volume" "$tmp/$asset" >/dev/null
    if ! cp "$tmp/volume/Bothouse.app/Contents/MacOS/bothouse" "$tmp/bothouse"; then
      hdiutil detach "$tmp/volume" >/dev/null
      die "Bothouse.app binary missing in $asset"
    fi
    hdiutil detach "$tmp/volume" >/dev/null
    rmdir "$tmp/volume"
  else
    cp "$tmp/$asset" "$tmp/bothouse"
  fi
  mkdir -p "$INSTALL_DIR"
  mv -f "$tmp/bothouse" "$INSTALL_DIR/bothouse"
  chmod 755 "$INSTALL_DIR/bothouse"
  "$INSTALL_DIR/bothouse" --version >/dev/null || die "installed, but $INSTALL_DIR/bothouse does not run"

  say "Installed: $INSTALL_DIR/bothouse ($tag)"
  run="$INSTALL_DIR/bothouse"
  first=$(command -v bothouse 2>/dev/null || true)
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) on_path=1 ;;
    *) on_path=0 ;;
  esac
  if [ "$on_path" = 1 ] && [ "$first" = "$INSTALL_DIR/bothouse" ]; then
    run=bothouse
  else
    say ""
    if [ -n "$first" ] && [ "$first" != "$INSTALL_DIR/bothouse" ]; then
      say "WARNING: typing 'bothouse' runs another copy first: $first"
      say "  ($("$first" --version 2>/dev/null | head -n 1 || echo 'unknown version')) — an older or upstream build without the setup wizard."
      say "  Remove it, or put $INSTALL_DIR first on your PATH:"
    else
      say "$INSTALL_DIR is not on your PATH. Add it:"
    fi
    case "${SHELL:-}" in
      */bash) rc="$HOME/.bashrc" ;;
      *) rc="$HOME/.zshrc" ;;
    esac
    say "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> $rc && . $rc"
    say "Until then, use the full path: $INSTALL_DIR/bothouse"
  fi
  say ""
  say "Next: run   $run"
  say "It opens the setup wizard in your browser. Guide (for this version): https://github.com/$REPO/blob/$tag/docs/GETTING_STARTED.md"
}

main "$@"
