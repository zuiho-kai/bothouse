"""Export only the CC0 HairSample_Female face into the local synchronous mesh format."""
import base64
import hashlib
import json
import pathlib
import struct
import subprocess
import sys

raw = pathlib.Path(sys.argv[1]).read_bytes()
if hashlib.sha256(raw).hexdigest() != "d9ef39f04e54b3684d31a8db47efe4c2537b80f1bc15dedce3ae3d1d2acebda2":
    raise ValueError("Expected pixiv CC0 HairSample_Female.vrm")
out = pathlib.Path(__file__).resolve().parents[1] / "src/assets/resident-face"
out.mkdir(parents=True, exist_ok=True)
size = struct.unpack_from("<I", raw, 12)[0]
doc = json.loads(raw[20:20+size])
data = memoryview(raw)[28+size:]
def view(i):
    b = doc["bufferViews"][i]
    start = b.get("byteOffset", 0)
    return data[start:start+b["byteLength"]]

def attribute(i):
    a = doc["accessors"][i]
    width = {"SCALAR":1,"VEC2":2,"VEC3":3}[a["type"]]
    fmt = {5126:"f",5125:"I",5123:"H",5121:"B"}[a["componentType"]]
    record = struct.Struct("<" + fmt*width)
    values = [(0,)*width]*a["count"]
    if "bufferView" in a:
        source = view(a["bufferView"])
        stride = doc["bufferViews"][a["bufferView"]].get("byteStride",record.size)
        values = [record.unpack_from(source,a.get("byteOffset",0)+j*stride) for j in range(a["count"])]
    if "sparse" in a:
        s = a["sparse"]
        ids = s["indices"]
        idx = struct.iter_unpack("<"+{5121:"B",5123:"H",5125:"I"}[ids["componentType"]],view(ids["bufferView"])[ids.get("byteOffset",0):])
        body = view(s["values"]["bufferView"])
        for j,(k,) in zip(range(s["count"]),idx):
            values[k]=record.unpack_from(body,s["values"].get("byteOffset",0)+j*record.size)
    return values

def encode(values,fmt):
    return base64.b64encode(b"".join(struct.pack("<"+fmt,*v) for v in values)).decode()

prims = doc["meshes"][0]["primitives"]
p = prims[0]
mesh = {}
for dest,name,fmt in [("position","POSITION","fff"),("normal","NORMAL","fff"),("uv","TEXCOORD_0","ff")]:
    mesh[dest]=encode(attribute(p["attributes"][name]),fmt)
mesh["groups"]=[]
indices=[]
pos=attribute(0)
for prim in prims:
    m=prim["material"]
    if m==8:  # Special-effect eyes are hidden in the default expression.
        continue
    ids=attribute(prim["indices"])
    coords=list(zip(*(pos[i] for i, in ids)))
    print(m, len(ids), [(round(min(v),3),round(max(v),3)) for v in coords])
    mesh["groups"].append([len(indices),len(ids),m])
    indices.extend(ids)
mesh["index"]=encode(indices,"H")
mesh["morphs"]={}
for name,target in [("blink",13),("speech",37),("joy",3),("calm",4),("focus",1)]:
    values=attribute(p["targets"][target]["POSITION"])
    # Sparse target deltas in source metres, quantized to 10 micrometres.
    moved=[(i,*(round(x*100000) for x in v)) for i,v in enumerate(values) if any(round(x*100000) for x in v)]
    mesh["morphs"][name]=encode(moved,"Hhhh")
(out/"face.json").write_text(json.dumps(mesh,separators=(",",":")), encoding="ascii")
for mat,name in enumerate(["mouth","white","liner","lash","brow","iris","glint","skin"]):
    tex=doc["materials"][mat]["pbrMetallicRoughness"]["baseColorTexture"]["index"]
    im=doc["images"][doc["textures"][tex]["source"]]
    scale=512 if name=="skin" else 256
    filters=f"scale={scale}:{scale}:flags=lanczos"
    if name=="iris":
        filters+=",hue=s=0,curves=all='0/0 .08/.07 .17/.40 .32/.76 .6/.94 1/1'"
    if name=="glint":
        filters+=",hue=s=0"
    subprocess.run(["ffmpeg","-v","error","-y","-i","pipe:0","-vf",filters,"-frames:v","1","-threads","1","-pix_fmt","rgba",str(out/(name+".png"))],input=view(im["bufferView"]),check=True)
