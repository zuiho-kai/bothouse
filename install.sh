#!/bin/sh
# CoNest cc-connect installer: downloads the prebuilt binary (with the setup wizard)
# from the GitHub Release and puts it in ~/.local/bin. No Go or Node needed.
#
#   curl -fsSL https://raw.githubusercontent.com/Zssan12/conest/main/install.sh | sh      # public repo
#   gh api repos/Zssan12/conest/contents/install.sh -H 'Accept: application/vnd.github.raw' | sh   # private repo, gh logged in
#
# Environment:
#   CONEST_VERSION   tag to install (default: the newest release, pre-releases included)
#   INSTALL_DIR      where to put cc-connect (default: ~/.local/bin)
# macOS and Linux (arm64, amd64). Windows is not supported yet.
set -eu

# Everything runs from main, called on the last line: if a `curl | sh` download is cut
# short, the shell never reaches the call and runs nothing.
main() {
  REPO="Zssan12/conest"
  INSTALL_DIR="${INSTALL_DIR:-$HOME/.local/bin}"

  say() { printf '%s\n' "$*"; }
  die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "unsupported OS $(uname -s): macOS and Linux only for now (Windows is not supported yet)" ;;
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
  trap 'rm -f "$tmp/cc-connect" "$tmp/checksums.txt" 2>/dev/null; [ -n "$asset" ] && rm -f "$tmp/$asset"; rmdir "$tmp" 2>/dev/null || true' EXIT

  # 1. which release: public API first; a private repo answers 404 there, then the logged-in gh
  tag="${CONEST_VERSION:-}"
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
    [ -n "$tag" ] || die "no release found for $REPO. The repo may be private: install the GitHub CLI (gh), run 'gh auth login' with an account that can see the repo, and run this again."
  fi

  asset="cc-connect-$tag-$os-$arch.tar.gz"
  say "Installing cc-connect $tag ($os/$arch) into $INSTALL_DIR"

  # 2. download
  fetch_curl() {
    have curl || return 1
    base="https://github.com/$REPO/releases/download/$tag"
    curl -fsSL -o "$tmp/$asset" "$base/$asset" && curl -fsSL -o "$tmp/checksums.txt" "$base/checksums.txt"
  }
  fetch_gh() {
    use_gh || return 1
    gh release download "$tag" -R "$REPO" -p "$asset" -p checksums.txt -D "$tmp" --clobber
  }
  if [ "$via" = gh ]; then
    fetch_gh || die "download failed: gh release download $tag -R $REPO -p $asset"
  else
    fetch_curl || fetch_gh || die "download failed: $asset of $tag. Private repo? Install gh and run 'gh auth login' first."
  fi

  # 3. verify and install
  expected=$(grep " $asset\$" "$tmp/checksums.txt" | cut -d' ' -f1)
  if have shasum; then actual=$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1); else actual=$(sha256sum "$tmp/$asset" | cut -d' ' -f1); fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || die "checksum mismatch for $asset"
  tar -C "$tmp" -xzf "$tmp/$asset" cc-connect
  mkdir -p "$INSTALL_DIR"
  mv -f "$tmp/cc-connect" "$INSTALL_DIR/cc-connect"
  chmod 755 "$INSTALL_DIR/cc-connect"
  "$INSTALL_DIR/cc-connect" --version >/dev/null || die "installed, but $INSTALL_DIR/cc-connect does not run"

  say "Installed: $INSTALL_DIR/cc-connect ($tag)"
  run="$INSTALL_DIR/cc-connect"
  first=$(command -v cc-connect 2>/dev/null || true)
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) on_path=1 ;;
    *) on_path=0 ;;
  esac
  if [ "$on_path" = 1 ] && [ "$first" = "$INSTALL_DIR/cc-connect" ]; then
    run=cc-connect
  else
    say ""
    if [ -n "$first" ] && [ "$first" != "$INSTALL_DIR/cc-connect" ]; then
      say "WARNING: typing 'cc-connect' runs another copy first: $first"
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
    say "Until then, use the full path: $INSTALL_DIR/cc-connect"
  fi
  say ""
  say "Next: run   $run"
  say "It opens the setup wizard in your browser. Guide: https://github.com/$REPO/blob/main/docs/GETTING_STARTED.md"
}

main "$@"
