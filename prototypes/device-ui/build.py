"""Rebuild the standalone preview and CSP-safe bundles with Python's standard library only."""

import argparse
from pathlib import Path

BASE_PAGE_CSS = """\
:root {
  color-scheme: light dark;
  --page-bg: light-dark(#f4f5f2, #111614);
  --page-fg: light-dark(#1f2d28, #e5ece8);
}
html, body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  background: var(--page-bg);
  color: var(--page-fg);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
}
body {
  padding: 16px 20px 32px;
  box-sizing: border-box;
}
@media (max-width: 520px) {
  body {
    padding: 10px 8px 24px;
  }
}
"""


def extract_parts(source: str):
    style_start = source.find("<style>")
    style_end = source.find("</style>")
    if style_start == -1 or style_end == -1:
        raise ValueError("source.html must contain a <style>...</style> block")

    script_start = source.find("<script>")
    script_end = source.rfind("</script>")
    if script_start == -1 or script_end == -1:
        raise ValueError("source.html must contain a <script>...</script> block")

    html_markup = source[:style_start].strip()
    component_css = source[style_start + len("<style>"):style_end].strip()
    js_code = source[script_start + len("<script>"):script_end].strip()

    combined_css = BASE_PAGE_CSS + "\n" + component_css + "\n"
    combined_js = js_code + "\n"
    return html_markup, combined_css, combined_js


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail if built files are stale")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent

    template = (root / "preview-shell.html").read_text(encoding="utf-8")
    marker = "__CONEST_DEVICE_UI_SOURCE__"
    if template.count(marker) != 1:
        parser.error("preview-shell.html must contain exactly one source placeholder")

    source = (root / "source.html").read_text(encoding="utf-8")
    html_markup, css_content, js_content = extract_parts(source)
    document = template.replace(marker, html_markup)

    screen_dir = root / "screen"
    screen_dir.mkdir(parents=True, exist_ok=True)

    expected_files = {
        root / "index.html": document,
        root / "screen.css": css_content,
        root / "screen.js": js_content,
        screen_dir / "screen.css": css_content,
        screen_dir / "screen.js": js_content,
    }

    if args.check:
        stale = []
        for path, expected in expected_files.items():
            if not path.exists() or path.read_text(encoding="utf-8") != expected:
                stale.append(str(path.relative_to(root)))
        if stale:
            parser.exit(1, f"stale files detected ({', '.join(stale)}); run python3 prototypes/device-ui/build.py\n")
        print("all built files match source.html + preview-shell.html")
    else:
        for path, content in expected_files.items():
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path}")


if __name__ == "__main__":
    main()
