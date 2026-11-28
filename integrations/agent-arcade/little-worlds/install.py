"""Reconstruct the signed Little Worlds source from the public baseline and this delta."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
SPEC = json.loads((HERE / "manifest.json").read_text("utf8"))
TAG = "refs/tags/final-project-submission"
PNPM = "11.9.0"


def run(args, cwd, **options):
    return subprocess.run([str(x) for x in args], check=True, cwd=cwd, **options)


def tool(name):
    executable = shutil.which(name)
    if not executable:
        raise SystemExit(f"Required command not found: {name}")
    return executable


def package_manager():
    for name, extra in (("pnpm", []), ("corepack", ["pnpm@" + PNPM])):
        binary = shutil.which(name + ".cmd" if os.name == "nt" else name)
        if not binary:
            continue
        cmd = [binary, *extra]
        version = subprocess.run([*cmd, "--version"], capture_output=True, text=True)
        if version.returncode == 0 and version.stdout.strip() == PNPM:
            return cmd
    raise SystemExit("Install pnpm " + PNPM + " or Corepack, then run again.")


def install(dest, source=None, offline=False):
    git, node, pnpm = tool("git"), tool("node"), package_manager()
    major = int(subprocess.check_output([node, "-p","process.versions.node.split('.')[0]"], text=True))
    if major < 24:
        raise SystemExit("This world needs Node.js 24 or newer.")
    if dest.exists() and any(dest.iterdir()):
        raise SystemExit("Choose a new or empty install folder. The existing folder was left alone.")
    state = dest / ".data" / "resident-preview"
    release = state / "releases" / SPEC["worldRevision"]
    patch = HERE / "integration.patch"
    if hashlib.sha256(patch.read_bytes()).hexdigest() != SPEC["patchSHA256"]:
        raise SystemExit("The integration patch does not match manifest.json.")
    release.mkdir(parents=True)
    run([git, "init", "-q"], release)
    # Reference the public course release without prompting for a GitHub account.
    run([git,"config","core.autocrlf","true" if os.name == "nt" else "false"],release)
    if os.name == "nt":
        run([git, "config", "core.longpaths", "true"], release)
    run([git,"-c","credential.helper=","fetch","--depth=1","--no-tags",str(source or SPEC["repository"]),
         SPEC["baseCommit"] if source else TAG],release,env={**os.environ,"GIT_TERMINAL_PROMPT":"0"})
    run([git,"checkout","-q","--detach","FETCH_HEAD"],release)
    for reference, expected in (("HEAD","baseCommit"),("HEAD^{tree}","baseTree")):
        if subprocess.check_output([git,"rev-parse",reference],cwd=release,text=True).strip()!=SPEC[expected]:
            raise SystemExit("The fetched course source does not match the pinned public release.")
    run([git, "apply", "--index","--whitespace=nowarn", patch], release)
    additions = []
    for row in SPEC["files"]:
        if row["action"] != "A":
            continue
        name = row["path"]
        destfile = release / name
        if release not in destfile.resolve().parents or destfile.exists():
            raise SystemExit("Unexpected overlay destination: " + name)
        data = (HERE / "additions" / name).read_bytes()
        if hashlib.sha256(data).hexdigest() != row["sha256"]:
            raise SystemExit("Overlay file differs from its pinned bytes: " + name)
        blob = subprocess.check_output([git,"hash-object","-w","--stdin"],cwd=release,input=data).decode().strip()
        if blob != row["blob"]:
            raise SystemExit("Overlay Git object mismatch: " + name)
        run([git,"update-index","--add","--cacheinfo","100644",blob,name],release)
        additions.append(name)
    actual = subprocess.check_output([git,"write-tree"],cwd=release,text=True).strip()
    if actual != SPEC["worldTree"]:
        raise SystemExit("Reconstructed game tree differs from the approved source.")
    # Force normal Git checkout filters, including Windows publisher file bytes.
    run([git,"checkout-index","--",*additions],release)
    # Dependencies and their licences come from the unchanged upstream lockfile.
    run([*pnpm,"install","--frozen-lockfile","--ignore-scripts",*(["--offline"] if offline else [])],release)
    if os.name == "nt":
        windows_pins = SPEC["windowsPublisherSHA256"]
        for name, expected in windows_pins.items():
            if hashlib.sha256((release/"scripts"/name).read_bytes()).hexdigest() != expected:
                raise SystemExit("Windows publisher bytes differ from the signed release: " + name)
    run([node,"node_modules/vite/bin/vite.js","build","--configLoader","runner"],release)
    run([node,"scripts/build-worker.ts"],release)
    (release/"dist"/"resident-preview.json").write_text(json.dumps({
        "kind":"windows-resident-preview","commit":SPEC["worldRevision"]}),encoding="utf8")
    for name in ("星球居民.cmd","scripts/resident_preview.py","scripts/resident_host.py",
                 "scripts/publish-residents.py","scripts/resident_portraits.py"):
        destination=dest/name
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(release/name,destination)
    shutil.copyfile(HERE/"serve.py",dest/"serve.py")
    (state/"current.txt").write_text(SPEC["worldRevision"]+"\n",encoding="ascii")
    print("Verified complete world tree:",actual,flush=True)
    print("Installed at:",dest,flush=True)


if __name__ == "__main__":
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("destination",type=Path)
    ap.add_argument("--source",type=Path,help="Fetch the exact baseline from your existing Git checkout instead of GitHub")
    ap.add_argument("--offline",action="store_true",help="Use packages already present in your pnpm store. Combine with --source for a fully offline install.")
    ap.add_argument("--run",action="store_true",help="Start the installed loopback world in this terminal")
    ap.add_argument("--port",default=18746,type=int)
    selection=ap.add_mutually_exclusive_group()
    selection.add_argument("--friends-origin",help="Pair this save with your Friends service origin")
    selection.add_argument("--desktop-service",type=Path,help="Use the service.json from your trusted Agent Arcade desktop build")
    ap.add_argument("--world-origin",help="Origin configured in Friends, if different from the local listener")
    args=ap.parse_args()
    if args.world_origin and not (args.friends_origin or args.desktop_service):
        ap.error("--world-origin requires --friends-origin or --desktop-service")
    if not 1024<=args.port<=65535: ap.error("Choose a port from 1024 to 65535.")
    dest=args.destination.resolve()
    install(dest,args.source.resolve() if args.source else None,args.offline)
    if args.friends_origin or args.desktop_service:
        state=dest / ".data" / "resident-preview"
        release=state / "releases" / SPEC["worldRevision"]
        database=state / ("world.sqlite" if args.port==18746 else f"world-{args.port}.sqlite")
        source=["--desktop-service",args.desktop_service.resolve()] if args.desktop_service else ["--friends-origin",args.friends_origin]
        audience=args.world_origin or (None if args.desktop_service else f"http://127.0.0.1:{args.port}")
        run([tool("node"),release/"scripts/configure-friends-world.ts","--database",database,
             *(["--world-origin",audience] if audience else []),*source],dest)
    if args.run:
        sys.exit(subprocess.call([sys.executable,"-I","-B",str(dest/"serve.py"),"--port",str(args.port)]))

