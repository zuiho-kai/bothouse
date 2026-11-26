'use strict';
// Character kit for the desktop pets: a few closed-surface primitives, a
// skeleton, and a glTF 2.0 binary writer. Each character script (ju.cjs, ...)
// describes its parts with these and gets one skinned mesh plus a face decal.
//
// Conventions: +Y up, the character faces +Z, her left hand is on +X. Bones have
// no rest rotation, so a pose is plain rotations about those axes. Colours are
// written per vertex; TEXCOORD_0 of the body carries [outline width scale,
// surface kind] for the toon shader, and real UVs only on the face decal.
const SURFACE = Object.freeze({cloth: 0, skin: 1, hair: 2, shiny: 3});

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a); return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 1, 0]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
// Works in either direction: smooth(0.6, 0.4, y) rises as y falls.
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const rad = degrees => degrees * Math.PI / 180;

function srgb(hex) {
  if (Array.isArray(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
}
// Uniform Catmull-Rom through the points, t in [0, 1].
function spline(points) {
  const n = points.length - 1;
  return t => {
    const x = clamp(t) * n, i = Math.min(n - 1, Math.floor(x)), u = x - i;
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u);
    return out;
  };
}
// An orthonormal frame whose Z axis is the given direction.
function frame(z, hint = [0, 1, 0]) {
  const Z = norm(z);
  let X = cross(hint, Z);
  if (len(X) < 1e-6) X = cross([1, 0, 0], Z);
  X = norm(X);
  return {x: X, y: cross(Z, X), z: Z};
}

class Model {
  constructor(name) {
    this.name = name; this.bones = []; this.index = new Map();
    this.parts = {body: {verts: [], tris: []}, face: {verts: [], tris: []}};
    // Every primitive is recorded as a piece of the current group, so that parts
    // (hair, flower, capelet, ...) can be exported on their own for printing.
    this.groupName = 'model'; this.pieces = [];
  }
  group(name) { if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw Error(`Invalid group ${name}`); this.groupName = name; return this; }
  bone(name, parent, position, extras) {
    if (this.index.has(name)) throw Error(`Duplicate bone ${name}`);
    if (parent !== null && !this.index.has(parent)) throw Error(`Unknown parent ${parent} for ${name}`);
    this.index.set(name, this.bones.length);
    this.bones.push({name, parent, position: position.slice(), extras: extras || null});
    return name;
  }
  bonePosition(name) { return this.bones[this.index.get(name)].position; }

  // verts: [{p, meta}], tris: [[a, b, c]]. Options: color, weights, data,
  // place {origin, x, y, z}, part, open (skip the outward-facing check).
  emit(verts, tris, options) {
    const {color = '#ffffff', weights = 'root', surface = SURFACE.cloth, outline = 1, place, part = 'body', open = false, uv} = options;
    const target = this.parts[part], base = target.verts.length;
    const world = verts.map(v => place ? add(place.origin, add(add(mul(place.x, v.p[0]), mul(place.y, v.p[1])), mul(place.z, v.p[2]))) : v.p);
    if (!open) {
      // Closed pieces must face outward for the outline pass; fix by volume sign.
      let volume = 0;
      for (const [a, b, c] of tris) volume += dot(world[a], cross(world[b], world[c]));
      if (volume < 0) for (const tri of tris) { const t = tri[1]; tri[1] = tri[2]; tri[2] = t; }
    }
    verts.forEach((v, i) => {
      const p = world[i];
      const c = typeof color === 'function' ? color(p, v.meta) : color;
      let w = typeof weights === 'function' ? weights(p, v.meta) : weights;
      if (typeof w === 'string') w = [[w, 1]];
      w = w.filter(entry => entry[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = w.reduce((sum, entry) => sum + entry[1], 0);
      if (!(total > 0)) throw Error('Vertex without weights');
      const o = typeof outline === 'function' ? outline(p, v.meta) : outline;
      target.verts.push({p, c: srgb(c), w: w.map(([name, value]) => { if (!this.index.has(name)) throw Error(`Unknown bone ${name}`); return [this.index.get(name), value / total]; }),
        d: uv ? uv(p, v.meta) : [o, surface / 8]});
    });
    this.pieces.push({group: this.groupName, part, closed: !open, triStart: target.tris.length, triCount: tris.length});
    for (const [a, b, c] of tris) target.tris.push([a + base, b + base, c + base]);
  }

  // A tube along a path with an elliptical section: radius(t, k) -> [width,
  // thickness]; `up` (vector or (t, p) => vector) is the thickness direction.
  // With transport, `up` only seeds the first ring and the section is carried
  // along the path without twisting, which keeps curls and hooks clean.
  sweep({path, rings = 12, sides = 8, radius, up = [0, 0, 1], transport = false, ...options}) {
    const at = typeof path === 'function' ? path : spline(path), verts = [], tris = [];
    const tangent = t => norm(sub(at(Math.min(1, t + 1e-3)), at(Math.max(0, t - 1e-3))));
    let carried = null;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, p = at(t), T = tangent(t), hint = transport && carried ? carried : typeof up === 'function' ? up(t, p) : up;
      let S = cross(hint, T);
      if (len(S) < 1e-6) S = cross([1, 0, 0], T);
      S = norm(S);
      const B = cross(T, S);
      carried = B;
      for (let k = 0; k < sides; k++) {
        const a = 2 * Math.PI * k / sides, r = radius(t, k, a);
        verts.push({p: add(p, add(mul(S, Math.max(1e-5, r[0]) * Math.cos(a)), mul(B, Math.max(1e-5, r[1]) * Math.sin(a)))), meta: {t, k, a}});
      }
    }
    for (let i = 0; i < rings; i++) for (let k = 0; k < sides; k++) {
      const a = i * sides + k, b = i * sides + (k + 1) % sides, c = a + sides, d = b + sides;
      tris.push([a, b, d], [a, d, c]);
    }
    const start = verts.length; verts.push({p: at(0), meta: {t: 0, k: -1, a: 0}});
    const end = verts.length; verts.push({p: at(1), meta: {t: 1, k: -1, a: 0}});
    for (let k = 0; k < sides; k++) {
      tris.push([start, (k + 1) % sides, k]);
      tris.push([end, rings * sides + k, rings * sides + (k + 1) % sides]);
    }
    this.emit(verts, tris, options);
  }

  // A UV sphere scaled to the radii; deform(direction) may reshape the unit
  // sphere before scaling. Poles are on the local Y axis.
  ellipsoid({center = [0, 0, 0], radii, segments = [14, 10], deform, place, ...options}) {
    const [U, Vn] = segments, verts = [], tris = [];
    const point = d => { const q = deform ? deform(d) : d; return [q[0] * radii[0], q[1] * radii[1], q[2] * radii[2]]; };
    verts.push({p: point([0, 1, 0]), meta: {dir: [0, 1, 0]}});
    for (let j = 1; j < Vn; j++) {
      const el = Math.PI / 2 - Math.PI * j / Vn;
      for (let i = 0; i < U; i++) {
        const az = 2 * Math.PI * i / U, d = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
        verts.push({p: point(d), meta: {dir: d}});
      }
    }
    const bottom = verts.length; verts.push({p: point([0, -1, 0]), meta: {dir: [0, -1, 0]}});
    for (let i = 0; i < U; i++) {
      tris.push([0, 1 + i, 1 + (i + 1) % U]);
      tris.push([bottom, 1 + (Vn - 2) * U + (i + 1) % U, 1 + (Vn - 2) * U + i]);
    }
    for (let j = 0; j < Vn - 2; j++) for (let i = 0; i < U; i++) {
      const a = 1 + j * U + i, b = 1 + j * U + (i + 1) % U, c = a + U, d = b + U;
      tris.push([a, c, d], [a, d, b]);
    }
    const local = place || {origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1]};
    this.emit(verts, tris, {...options, place: {...local, origin: add(local.origin, center)}});
  }

  // A surface of revolution about the Y axis. profile: [[r, y], ...]; theta 0
  // is the front (+Z) and grows toward +X. `shape(theta, i, r, y)` may return a
  // modified [r, y]; closed joins the last profile point back to the first.
  lathe({profile, sides = 24, closed = false, center = [0, 0, 0], depth = 1, shape, ...options}) {
    const verts = [], tris = [], n = profile.length;
    for (let i = 0; i < n; i++) for (let k = 0; k < sides; k++) {
      const theta = 2 * Math.PI * k / sides;
      const [r, y] = shape ? shape(theta, i, profile[i][0], profile[i][1]) : profile[i];
      verts.push({p: [center[0] + r * Math.sin(theta), center[1] + y, center[2] + r * Math.cos(theta) * depth], meta: {i, theta}});
    }
    const rows = closed ? n : n - 1;
    for (let i = 0; i < rows; i++) for (let k = 0; k < sides; k++) {
      const a = i * sides + k, b = i * sides + (k + 1) % sides, c = ((i + 1) % n) * sides + k, d = ((i + 1) % n) * sides + (k + 1) % sides;
      tris.push([a, c, d], [a, d, b]);
    }
    if (!closed) {
      const top = verts.length; verts.push({p: [center[0], center[1] + profile[0][1], center[2]], meta: {i: 0, theta: 0}});
      const bottom = verts.length; verts.push({p: [center[0], center[1] + profile[n - 1][1], center[2]], meta: {i: n - 1, theta: 0}});
      for (let k = 0; k < sides; k++) {
        tris.push([top, k, (k + 1) % sides]);
        tris.push([bottom, (n - 1) * sides + (k + 1) % sides, (n - 1) * sides + k]);
      }
    }
    this.emit(verts, tris, options);
  }

  // An open grid, used for the face decal. at(u, v) -> position.
  grid({at, size = [16, 16], flip = false, ...options}) {
    const [U, Vn] = size, verts = [], tris = [];
    for (let j = 0; j <= Vn; j++) for (let i = 0; i <= U; i++) verts.push({p: at(i / U, j / Vn), meta: {u: i / U, v: j / Vn}});
    for (let j = 0; j < Vn; j++) for (let i = 0; i < U; i++) {
      const a = j * (U + 1) + i, b = a + 1, c = a + U + 1, d = c + 1;
      if (flip) tris.push([a, c, b], [b, c, d]); else tris.push([a, b, c], [b, d, c]);
    }
    this.emit(verts, tris, {...options, open: true});
  }

  normals(part) {
    const {verts, tris} = this.parts[part], out = verts.map(() => [0, 0, 0]);
    for (const [a, b, c] of tris) {
      const n = cross(sub(verts[b].p, verts[a].p), sub(verts[c].p, verts[a].p));
      for (const i of [a, b, c]) { out[i][0] += n[0]; out[i][1] += n[1]; out[i][2] += n[2]; }
    }
    return out.map(norm);
  }

  groups() { return [...new Set(this.pieces.map(piece => piece.group))]; }
  // Binary STL of the closed pieces in the named groups (all groups when
  // omitted), in the rest pose. Printing convention: millimetres, Z up, the
  // character facing -Y; `scale` is millimetres per model unit.
  toSTL({groups, scale = 100} = {}) {
    const chosen = this.pieces.filter(piece => piece.closed && (!groups || groups.includes(piece.group)));
    const count = chosen.reduce((sum, piece) => sum + piece.triCount, 0), out = Buffer.alloc(84 + count * 50);
    out.write(`${this.name} ${(groups || ['all']).join('+')}`.slice(0, 79), 0, 'ascii'); out.writeUInt32LE(count, 80);
    let offset = 84;
    const place = p => [p[0] * scale, -p[2] * scale, p[1] * scale];
    for (const piece of chosen) {
      const {verts, tris} = this.parts[piece.part];
      for (let i = piece.triStart; i < piece.triStart + piece.triCount; i++) {
        const [a, b, c] = tris[i].map(index => place(verts[index].p)), n = norm(cross(sub(b, a), sub(c, a)));
        for (const v of [n, a, b, c]) { out.writeFloatLE(v[0], offset); out.writeFloatLE(v[1], offset + 4); out.writeFloatLE(v[2], offset + 8); offset += 12; }
        offset += 2;
      }
    }
    return out;
  }

  stats() {
    return {bones: this.bones.length, parts: Object.fromEntries(Object.entries(this.parts).map(([name, part]) => [name, {vertices: part.verts.length, triangles: part.tris.length}]))};
  }

  toGLB() {
    const chunks = [], views = [], accessors = [];
    let offset = 0;
    const view = (typed, target) => {
      const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - bytes.length % 4) % 4;
      views.push({buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? {target} : {})});
      chunks.push(bytes); if (pad) chunks.push(Buffer.alloc(pad));
      offset += bytes.length + pad;
      return views.length - 1;
    };
    const accessor = (typed, type, componentType, count, extra = {}, target) => {
      accessors.push({bufferView: view(typed, target), componentType, count, type, ...extra});
      return accessors.length - 1;
    };
    const primitives = [];
    for (const [name, part] of Object.entries(this.parts)) {
      if (!part.verts.length) continue;
      const count = part.verts.length, normals = this.normals(name);
      const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), uv = new Float32Array(count * 2), joints = new Uint8Array(count * 4), weights = new Float32Array(count * 4);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      part.verts.forEach((v, i) => {
        for (let k = 0; k < 3; k++) {
          pos[i * 3 + k] = v.p[k];
          // Cancellation in a unit normal can leave a few double-precision
          // rounding bits at zero. Float32 would preserve that tiny residue.
          const component = normals[i][k];
          nrm[i * 3 + k] = Math.abs(component) <= 2 * Number.EPSILON ? 0 : component;
          col[i * 3 + k] = v.c[k];
          min[k] = Math.min(min[k], pos[i * 3 + k]); max[k] = Math.max(max[k], pos[i * 3 + k]);
        }
        uv[i * 2] = v.d[0]; uv[i * 2 + 1] = v.d[1];
        v.w.forEach(([joint, weight], k) => { joints[i * 4 + k] = joint; weights[i * 4 + k] = weight; });
      });
      const indices = count > 65535 ? new Uint32Array(part.tris.flat()) : new Uint16Array(part.tris.flat());
      primitives.push({
        attributes: {
          POSITION: accessor(pos, 'VEC3', 5126, count, {min, max}, 34962),
          NORMAL: accessor(nrm, 'VEC3', 5126, count, {}, 34962),
          COLOR_0: accessor(col, 'VEC3', 5126, count, {}, 34962),
          TEXCOORD_0: accessor(uv, 'VEC2', 5126, count, {}, 34962),
          JOINTS_0: accessor(joints, 'VEC4', 5121, count, {}, 34962),
          WEIGHTS_0: accessor(weights, 'VEC4', 5126, count, {}, 34962),
        },
        indices: accessor(indices, 'SCALAR', count > 65535 ? 5125 : 5123, indices.length, {}, 34963),
        material: name === 'face' ? 1 : 0,
        mode: 4,
      });
    }
    // Nodes: one per bone, then the mesh node, then the scene root.
    const nodes = this.bones.map(bone => {
      const parent = bone.parent === null ? [0, 0, 0] : this.bonePosition(bone.parent);
      return {name: bone.name, translation: sub(bone.position, parent), ...(bone.extras ? {extras: bone.extras} : {})};
    });
    this.bones.forEach((bone, i) => { if (bone.parent !== null) { const parent = nodes[this.index.get(bone.parent)]; (parent.children ||= []).push(i); } });
    const inverse = new Float32Array(this.bones.length * 16);
    this.bones.forEach((bone, i) => { inverse.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -bone.position[0], -bone.position[1], -bone.position[2], 1], i * 16); });
    const roots = this.bones.map((bone, i) => bone.parent === null ? i : -1).filter(i => i >= 0);
    const meshNode = nodes.length; nodes.push({name: `${this.name}-mesh`, mesh: 0, skin: 0});
    const sceneRoot = nodes.length; nodes.push({name: this.name, children: [...roots, meshNode]});
    const json = {
      asset: {version: '2.0', generator: 'Agent Arcade pet kit'},
      scene: 0, scenes: [{name: this.name, nodes: [sceneRoot]}], nodes,
      meshes: [{name: this.name, primitives}],
      skins: [{name: `${this.name}-skin`, joints: this.bones.map((_, i) => i), skeleton: roots[0], inverseBindMatrices: accessor(inverse, 'MAT4', 5126, this.bones.length)}],
      materials: [
        {name: 'toon', pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1}},
        {name: 'face', pbrMetallicRoughness: {baseColorFactor: [1, 1, 1, 0], metallicFactor: 0, roughnessFactor: 1}, alphaMode: 'BLEND'},
      ],
      accessors, bufferViews: views, buffers: [{byteLength: offset}],
    };
    if (primitives.length < 2) json.materials.length = 1;
    let text = Buffer.from(JSON.stringify(json));
    if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - text.length % 4, 0x20)]);
    const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jsonHeader = Buffer.alloc(8), binHeader = Buffer.alloc(8);
    header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
    jsonHeader.writeUInt32LE(text.length, 0); jsonHeader.writeUInt32LE(0x4E4F534A, 4);
    binHeader.writeUInt32LE(bin.length, 0); binHeader.writeUInt32LE(0x004E4942, 4);
    return Buffer.concat([header, jsonHeader, text, binHeader, bin]);
  }
}

// Reads a GLB back into {json, bin}; used by the tests and the build check.
function readGLB(bytes) {
  if (bytes.readUInt32LE(0) !== 0x46546C67 || bytes.readUInt32LE(4) !== 2) throw Error('Not a glTF 2.0 binary');
  if (bytes.readUInt32LE(8) !== bytes.length) throw Error('GLB length does not match its header');
  const jsonLength = bytes.readUInt32LE(12);
  if (bytes.readUInt32LE(16) !== 0x4E4F534A) throw Error('First GLB chunk is not JSON');
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength, binLength = bytes.readUInt32LE(binStart);
  if (bytes.readUInt32LE(binStart + 4) !== 0x004E4942) throw Error('Second GLB chunk is not BIN');
  return {json, bin: bytes.subarray(binStart + 8, binStart + 8 + binLength)};
}

module.exports = {Model, SURFACE, readGLB, spline, frame, srgb, add, sub, mul, dot, cross, len, norm, lerp, lerp3, clamp, smooth, rad};
