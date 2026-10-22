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

command -v dsh >/dev/null || { echo "dsh not found on PATH; install DeepSeek Harness first" >&2; exit 1; }
if ! command -v pnpm >/dev/null; then
  # npm's global bin may simply be missing from PATH (pnpm already installed there).
  NPM_BIN="$(npm prefix -g)/bin"
  export PATH="$NPM_BIN:$PATH"
  if ! command -v pnpm >/dev/null; then
    echo "== pnpm not found, installing with npm"
    npm i -g pnpm
  fi
fi

# dsh-web-app must match the running dsh version, so take it from the local dsh install.
DSH_BIN="$(command -v dsh)"
DSH_JS="$(node -e 'console.log(require("fs").realpathSync(process.argv[1]))' "$DSH_BIN")"
DSH_DIR="$(cd "$(dirname "$DSH_JS")/.." && pwd)"
WEB_APP="$DSH_DIR/node_modules/@deepseek-ai/dsh-web-app"
[ -d "$WEB_APP" ] || { echo "dsh-web-app not found under $DSH_DIR" >&2; exit 1; }

if [ ! -d "$HERE/collab/node_modules" ]; then
  echo "== install collab dependencies"
  (cd "$HERE/collab" && pnpm install --frozen-lockfile --config.minimum-release-age=0)
fi

if [ -f "$UI/lib/client.js" ]; then
  echo "== client-ui-discord already bundled, skipping build"
else
  echo "== build client-ui-discord"
  (cd "$UI" && pnpm install --ignore-workspace && pnpm run bundle)
fi

echo "== install into profile $PROFILE"
dsh plugin --profile "$PROFILE" add "link:$WEB_APP" "link:$HERE/collab" "link:$UI"
if [ -n "$LANG_PREF" ]; then
  # DSH keeps the UI language as config of the `locale` entry (dsh-client-locale, field
  # `preference`) in the profile's cordis.patch.yml; the Settings > Language row writes the same place.
  PATCH="${DSH_HOME:-$HOME/.dsh}/profiles/$PROFILE/cordis.patch.yml"
  echo "== set default UI language: $LANG_PREF ($PATCH)"
  NODE_PATH="$DSH_DIR/node_modules" node - "$PATCH" "$LANG_PREF" <<'JS'
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
