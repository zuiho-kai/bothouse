"""Extract fitted mesh pieces from Kenney Fantasy Town Kit 2.0 (OBJ format, CC0)."""
import hashlib
import json
import pathlib
import sys
import zipfile

archive_path = pathlib.Path(sys.argv[1])
archive_sha = hashlib.sha256(archive_path.read_bytes()).hexdigest()
if archive_sha != "1a7530c09f4d2fa2cdee259876f089334f8b1f27fa86a0c4f54ef86cdd8676ef":
    raise SystemExit("Expected the original Kenney Fantasy Town Kit 2.0 archive listed in provenance.json.")
archive = zipfile.ZipFile(archive_path)
target = pathlib.Path(__file__).resolve().parents[1] / "src/assets/town-exterior"
target.mkdir(parents=True, exist_ok=True)
source_hashes = {}

def read(name):
    data = archive.read("Models/OBJ format/" + name + ".obj")
    source_hashes[name] = hashlib.sha256(data).hexdigest()
    vertices, uvs, faces = [], [], []
    for line in data.decode().splitlines():
        fields = line.split()
        if not fields:
            continue
        if fields[0] == "v":
            vertices.append(tuple(map(float, fields[1:4])))
        elif fields[0] == "vt":
            uvs.append(tuple(map(float, fields[1:3])))
        elif fields[0] == "f":
            corners = [tuple(map(int, field.split("/")[:2])) for field in fields[1:]]
            assert len(corners) == 3
            u, v = uvs[corners[0][1]-1]
            faces.append(((round(u*16), int(v*4)), tuple(vertices[i-1] for i,_ in corners)))
    return faces

plain = {tuple(sorted(points)) for _, points in read("roof")}
def export(name, fit, slots, keep=lambda slot,points: True):
    vertices, indices, groups = [], {}, {}
    for slot, points in read(name):
        if slot not in slots or not keep(slot, points):
            continue
        dest = groups.setdefault(slots[slot], [])
        for xyz in points:
            pos = tuple(round(n*10000) for n in fit(*xyz))
            if pos not in indices:
                indices[pos] = len(vertices)
                vertices.append(pos)
            dest.append(indices[pos])
    return {"points":[n for point in vertices for n in point], "groups":groups}

models = {
    "dormer": export("roof-window", lambda x,y,z:(z,y+.089,-x),
        {(4,0):"corrugated",(10,0):"post",(12,0):"leaf"},
        lambda _,points: tuple(sorted(points)) not in plain and all(abs(p[2])<.31 for p in points)),
    "frame": export("wall-detail-cross",lambda x,y,z:(z*.89,.86+y*1.06,.092+(.5-x)*.12),
        {(10,0):"tread"}),
    "bench": export("stall-bench",lambda x,y,z:(z*1.23,y*(.44/.226),-x*1.44),
        {(10,0):"tread"}),
    "canopy": export("overhang",lambda x,y,z:(z*1.63,2.47+(y-.67)*.74,-(x-.425)*.76-.06),
        {(10,0):"post",(12,0):"leaf"}),
}
(target/"kenney.json").write_text(json.dumps(models,separators=(",",":")),encoding="ascii")
(target/"provenance.json").write_text(json.dumps({"author":"Kenney","license":"CC0-1.0","release":"Fantasy Town Kit 2.0",
    "url":"https://opengameart.org/content/fantasy-town-kit","zipSha256":archive_sha,
    "objSha256":source_hashes},indent=2)+"\n",encoding="ascii")
