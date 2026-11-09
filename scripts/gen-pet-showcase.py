# Generates bridge/core/pet_showcase.json from a checkout of hunmer/aboutme-pets at the pinned commit (#549).
# Usage: python3 gen-pet-showcase.py <checkout of pets/ at COMMIT> <out.json> [pets.json of the same commit]
import hashlib, json, os, sys
root, out = sys.argv[1], sys.argv[2]
COMMIT = "cb205c271517336b500981a2cca050a1759bceaa"
cat_path = sys.argv[3] if len(sys.argv) > 3 else os.path.join(root, "pets.json")
catalog = {p["manifest"].split("/")[1]: p for p in json.load(open(cat_path))["pets"]} if os.path.exists(cat_path) else {}
META = {
  "dsh1": ("DeepSeek", "禁止商用；公开二创须署名 PC2005-cloud/dsh-pet（包内 NOTICE.txt）。形象为社区二创「大肥鱼」，非 DeepSeek 官方，形象授权 CC BY-NC-SA 4.0（dsh-pet README）。"),
  "claude": ("Claude", "作者仓库没有许可文件；动作说明里写「Non-commercial; attribution required」。只供个人非商用，转存或商用前先问作者。"),
  "gpt": ("GPT", "作者仓库没有许可文件；动作说明里写「Non-commercial; attribution required」。只供个人非商用，转存或商用前先问作者。"),
  "gemini": ("Gemini", "作者仓库没有许可文件；动作说明里写「Non-commercial; attribution required」。只供个人非商用，转存或商用前先问作者。"),
}
packs = []
for pid in ["dsh1", "claude", "gpt", "gemini"]:
    d = os.path.join(root, "pets", pid)
    files, total = {}, 0
    for base, _, names in os.walk(d):
        for n in names:
            p = os.path.join(base, n)
            rel = os.path.relpath(p, d).replace(os.sep, "/")
            b = open(p, "rb").read()
            files[rel] = hashlib.sha256(b).hexdigest(); total += len(b)
    m = json.load(open(os.path.join(d, "manifest.json")))
    c = catalog.get(pid, {})
    packs.append({"id": pid, "dir": "pets/" + pid, "name": c.get("name") or m.get("name") or pid,
                  "description": c.get("description", ""), "forRole": META[pid][0], "license": META[pid][1],
                  "bytes": total, "files": dict(sorted(files.items()))})
json.dump({"_comment": "#549：bothouse 只带这份清单，素材按固定提交从作者仓库下载并逐个校验 sha256，不转存。重新生成：scripts/gen-pet-showcase.py（见 docs/plugins/pet-packs.md）",
           "upstream": "hunmer/aboutme-pets", "commit": COMMIT, "packs": packs}, open(out, "w"), ensure_ascii=False, indent=1)
print({p["id"]: (len(p["files"]), p["bytes"]) for p in packs})
