#!/usr/bin/env bash
# Install the CoNest DSH plugins (conest-collab + Discord UI) into a DSH profile.
# Usage: dsh/install.sh [profile] [--lang zh|en]   (default profile: web; honours $DSH_HOME)
#   --lang  default UI language of the profile (the setup wizard passes its own choice)
set -euo pipefail
PROFILE=web
LANG_PREF=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG_PREF="${2:-}"; shift 2 ;;
    --lang=*) LANG_PREF="${1#--lang=}"; shift ;;
    -*) echo "unknown option: $1" >&2; exit 1 ;;
    *) PROFILE="$1"; shift ;;
  esac
done
case "$LANG_PREF" in ""|zh|en) ;; *) echo "--lang must be zh or en" >&2; exit 1 ;; esac
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI="$HERE/packages/client-ui-discord"

echo "== step: download"
# Resolve dsh the same way the bridge does (bridge/core/setup_dsh_platform.go LookDSH):
# a desktop-only install ships dsh.cmd, and Git Bash's `command -v dsh` never matches it
# because MSYS only appends .exe when searching (#161 ①). Falling back in the same order as
# LookDSH keeps one list of install locations instead of a second copy here.
DSH_EXE="$(command -v dsh 2>/dev/null || true)"
if [ -z "$DSH_EXE" ] && command -v dsh.cmd >/dev/null 2>&1; then
  DSH_EXE="$(command -v dsh.cmd)"
fi
if [ -z "$DSH_EXE" ]; then
  # Same candidate list as LookDSH; [ -f ] accepts the mixed C:\.../dir/file form Git Bash sees.
  # ProgramFiles(x86) is read through printenv: bash cannot expand a name with parentheses.
  PF86="$(printenv 'ProgramFiles(x86)' 2>/dev/null || true)"
  for c in \
    "${LOCALAPPDATA:-}/Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd" \
    "${LOCALAPPDATA:-}/Programs/DeepSeek Harness/bin/dsh.cmd" \
    "${LOCALAPPDATA:-}/DeepSeek Harness/bin/dsh.cmd" \
    "${ProgramFiles:-}/DeepSeek Harness/bin/dsh.cmd" \
    "${PF86}/DeepSeek Harness/bin/dsh.cmd" \
    "${APPDATA:-}/npm/dsh.cmd"; do
    if [ -f "$c" ]; then DSH_EXE="$c"; break; fi
  done
fi
if [ -z "$DSH_EXE" ]; then
  echo "dsh not found on PATH or in the DeepSeek Harness install directories; install DeepSeek Harness first" >&2
  exit 1
fi
echo "== dsh: $DSH_EXE"
# npm prints its global prefix in Windows form (C:\Users\...\npm) when run under Git Bash. Used
# as a PATH entry that string splits at the drive-letter colon (C + \Users\...), so pnpm stays
# "not found" right after npm i -g pnpm and the whole install only works when run a second time
# (#161). Convert it to the shell form first: cygpath -u when Git Bash provides it, otherwise
# map C:\x to /c/x.
shell_path() {
  local converted
  case "${1:-}" in
    [A-Za-z]:[\\/]*)
      if command -v cygpath >/dev/null 2>&1; then
        converted="$(cygpath -u "$1" 2>/dev/null || true)"
        if [ -n "$converted" ]; then
          printf '%s\n' "$converted"
          return 0
        fi
      fi
      printf '/%s%s\n' "$(printf '%s' "$1" | cut -c1 | tr '[:upper:]' '[:lower:]')" \
        "$(printf '%s' "$1" | cut -c3- | tr '\\' '/')"
      ;;
    *) printf '%s\n' "${1:-}" ;;
  esac
}

if ! command -v pnpm >/dev/null; then
  # npm's global bin may simply be missing from PATH (pnpm already installed there).
  # On Windows, npm prefix -g is where .cmd files live (not in bin/). On Unix, it is in bin/.
  NPM_PREFIX="$(npm prefix -g 2>/dev/null || true)"
  NPM_DIR=""
  if [ -n "$NPM_PREFIX" ]; then
    NPM_DIR="$(shell_path "$NPM_PREFIX")"
    if [ -n "$NPM_DIR" ]; then
      export PATH="$NPM_DIR:$NPM_DIR/bin:$PATH"
    else
      echo "== could not convert npm prefix '$NPM_PREFIX' into a shell path; leaving PATH unchanged" >&2
    fi
  fi
  if ! command -v pnpm >/dev/null; then
    echo "== pnpm not found, installing with npm"
    npm i -g pnpm
    if [ -n "$NPM_DIR" ]; then
      export PATH="$NPM_DIR:$NPM_DIR/bin:$PATH"
    fi
    if ! command -v pnpm >/dev/null; then
      echo "pnpm is still not on PATH after npm i -g pnpm (npm prefix: ${NPM_PREFIX:-unknown}); install pnpm or add that directory to PATH and rerun" >&2
      exit 1
    fi
  fi
fi

# dsh-web-app must match the running dsh version. Resolve it from the real dsh package the
# way Node does: walk the ancestor node_modules, which covers nested and hoisted layouts.
DSH_BIN="$DSH_EXE"
DSH_DIR=""
WEB_APP=""
if [ -n "$DSH_BIN" ]; then
  DSH_JS="$(node -e 'try { console.log(require("fs").realpathSync(process.argv[1])) } catch(e){}' "$DSH_BIN" 2>/dev/null || true)"
  if [ -n "$DSH_JS" ]; then
    DSH_DIR="$(cd "$(dirname "$DSH_JS")/.." && pwd 2>/dev/null || true)"
  fi
fi
# On Windows npm writes `dsh` as a plain shim file, not a symlink, so realpath above lands in the
# npm prefix rather than the package; only then look the package up under the global node_modules.
if [ -z "$DSH_DIR" ] || [ ! -f "$DSH_DIR/package.json" ]; then
  if command -v npm >/dev/null; then
    NPM_ROOT="$(npm root -g 2>/dev/null || true)"
    if [ -n "$NPM_ROOT" ] && [ -f "$NPM_ROOT/@deepseek-ai/dsh/package.json" ]; then
      DSH_DIR="$NPM_ROOT/@deepseek-ai/dsh"
    fi
  fi
fi
if [ -n "$DSH_DIR" ]; then
  DIR="$DSH_DIR"
  while :; do
    if [ "$(basename "$DIR")" != "node_modules" ] && [ -f "$DIR/node_modules/@deepseek-ai/dsh-web-app/package.json" ]; then
      WEB_APP="$DIR/node_modules/@deepseek-ai/dsh-web-app"
      break
    fi
    PARENT="$(dirname "$DIR")"
    [ "$PARENT" = "$DIR" ] && break
    DIR="$PARENT"
  done
fi
# Never borrow a web-app from another DSH install: only a resolved local DSH that is
# missing its own web-app is an error. With no dsh at all (e.g. unit fixtures) the
# plugin step below still installs collab+ui, matching the pre-existing behavior.
if [ -n "$DSH_DIR" ] && [ -f "$DSH_DIR/package.json" ] && [ -z "$WEB_APP" ]; then
  echo "dsh is installed at $DSH_DIR but its matching dsh-web-app is missing; install a matching dsh-web-app instead of reusing another DSH" >&2
  exit 1
fi

echo "== step: deps"
# Reinstall when deps are missing or package.json/pnpm-lock.yaml changed since the last install
# (an upgrade refreshes these files in place); the stamp is a copy of both files.
DEPS_STAMP="$HERE/collab/node_modules/.bothouse-deps"
if [ ! -d "$HERE/collab/node_modules" ] || ! cat "$HERE/collab/package.json" "$HERE/collab/pnpm-lock.yaml" | cmp -s - "$DEPS_STAMP"; then
  echo "== install collab dependencies"
  (cd "$HERE/collab" && pnpm install --frozen-lockfile --config.minimum-release-age=0)
  cat "$HERE/collab/package.json" "$HERE/collab/pnpm-lock.yaml" > "$DEPS_STAMP"
fi

CLIENT_JS="$UI/lib/client.js"
STYLE_CSS="$UI/lib/style.css"
BUILD_JSON="$UI/lib/build.json"
if [ ! -f "$CLIENT_JS" ] || [ ! -f "$STYLE_CSS" ] || [ ! -f "$BUILD_JSON" ]; then
  echo "client-ui-discord bundle is incomplete: need lib/client.js, lib/style.css and lib/build.json" >&2
  exit 1
fi
node - "$CLIENT_JS" "$STYLE_CSS" "$BUILD_JSON" <<'JS'
const fs = require("fs");
const crypto = require("crypto");
const [clientPath, stylePath, buildPath] = process.argv.slice(2);
const client = fs.readFileSync(clientPath, "utf8");
const lines = client.split("\n", 3);
const sourcePrefix = "// dsh-client-source-sha256: ";
const stylePrefix = "// dsh-style-sha256: ";
if (!lines[0]?.startsWith(sourcePrefix) || !lines[1]?.startsWith(stylePrefix)) {
  console.error("client.js is missing build stamps; rebuild and ship a consistent bundle");
  process.exit(1);
}
let build;
try {
  build = JSON.parse(fs.readFileSync(buildPath, "utf8"));
} catch (err) {
  console.error(`read ${buildPath}: ${err.message}`);
  process.exit(1);
}
const styleSha = crypto.createHash("sha256").update(fs.readFileSync(stylePath)).digest("hex");
const sourceSha = lines[0].slice(sourcePrefix.length);
const styleStamp = lines[1].slice(stylePrefix.length);
if (build.format !== 1 || sourceSha !== build.sourceDigest || styleStamp !== build.styleSha256 || styleStamp !== styleSha) {
  console.error("client-ui-discord build stamps do not match lib/build.json or style.css; rebuild and ship a consistent bundle");
  process.exit(1);
}
console.log(`client-ui-discord bundle verified: source ${sourceSha}, style ${styleSha}`);
JS

# When this script runs from the source checkout, compare the stamp with the actual
# source digest; the extracted one-click bundle has no src/, so lib/build.json is the
# only oracle available there.
SRC_PKG="$HERE/../../../dsh/packages/client-ui-discord"
if [ -d "$SRC_PKG/src" ] && [ -f "$SRC_PKG/scripts/wrap-client.mjs" ]; then
  WANT_SOURCE="$(cd "$SRC_PKG" && node scripts/wrap-client.mjs --print-source-digest)"
  HAVE_SOURCE="$(sed -n '1s/^\/\/ dsh-client-source-sha256: //p' "$CLIENT_JS")"
  if [ "$WANT_SOURCE" != "$HAVE_SOURCE" ]; then
    echo "client-ui-discord stamp $HAVE_SOURCE does not match source digest $WANT_SOURCE; rebuild the embedded bundle" >&2
    exit 1
  fi
fi

echo "== step: plugin"
echo "== install into profile $PROFILE"
# Git Bash on Windows: pwd gives /c/Users/...; pnpm (a Windows program) reads that as a missing
# directory, links nothing, and dsh then cannot resolve the bundles. Hand it C:/Users/... instead.
LINK_HERE="$HERE"
if pwd -W >/dev/null 2>&1; then LINK_HERE="$(cd "$HERE" && pwd -W)"; fi
LINK_UI="$LINK_HERE/packages/client-ui-discord"
if [ -n "$WEB_APP" ]; then
  "$DSH_EXE" plugin --profile "$PROFILE" add "link:$WEB_APP" "link:$LINK_HERE/collab" "link:$LINK_UI"
else
  echo "== dsh-web-app not found in local dsh path, linking collab and ui plugins"
  "$DSH_EXE" plugin --profile "$PROFILE" add "link:$LINK_HERE/collab" "link:$LINK_UI"
fi
if [ -n "$LANG_PREF" ] && command -v node >/dev/null; then
  # DSH keeps the UI language as config of the `locale` entry (dsh-client-locale, field
  # `preference`) in the profile's cordis.patch.yml; the Settings > Language row writes the same place.
  PATCH="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/cordis.patch.yml"
  echo "== set default UI language: $LANG_PREF ($PATCH)"
  NODE_PATH="$HERE/collab/node_modules" node - "$PATCH" "$LANG_PREF" <<'JS'
const fs = require("fs");
const YAML = require("yaml");
const [file, lang] = process.argv.slice(2);
const doc = YAML.parseDocument(fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "[]\n");
if (!YAML.isSeq(doc.contents)) doc.contents = doc.createNode([]);
const seq = doc.contents;
let entry = seq.items.find((it) => YAML.isMap(it) && it.get("id") === "locale" && !it.has("insert"));
if (!entry) { entry = doc.createNode({ id: "locale", config: {} }); seq.items.push(entry); }
if (!YAML.isMap(entry.get("config"))) entry.set("config", doc.createNode({}));
entry.get("config").set("preference", lang);
seq.flow = false;
fs.writeFileSync(file, doc.toString());
JS
fi
echo "== done; check with: dsh --profile $PROFILE --dump-config"
echo "== channel data: ${CONEST_COLLAB_DATA:-$HOME/.conest-collab} (collab.sqlite3; set CONEST_COLLAB_DATA before starting dsh to change it)"
