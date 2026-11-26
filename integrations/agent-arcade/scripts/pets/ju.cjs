'use strict';
// Ju (橘) as a desktop pet, built from src/ui/portraits/claude-ju-anime-v2.png.
// What carries over from the portrait: long wavy orange hair with a centre lock
// between the eyes, the orange blossom with charcoal ribbon and amber drops on
// her right, the small braid under it, the terracotta double capelet with gold
// piping, the frilled cream blouse and the charcoal bow with a sun brooch.
// The portrait stops at the chest; skirt, tights and boots are designed here in
// the same palette. Eyes, brows, mouth and the mole are drawn at run time on the
// face decal (src/pet/face.js).
const {Model, SURFACE, spline, frame, add, sub, mul, norm, cross, lerp, lerp3, clamp, smooth, rad} = require('./kit.cjs');

const C = {
  skin: '#ffe4d2', hair: '#f47a2a', hairLight: '#fb8d3c', hairDeep: '#e2651d', hairUnder: '#cc5518',
  cape: '#c4472d', capeTop: '#d0553a', cream: '#fbf1df', creamShade: '#f0e1c8', charcoal: '#2f2c32',
  gold: '#e3ad42', amber: '#f7a01c', petal: '#f88f33', petalCore: '#ffc655', leaf: '#56612f',
  tights: '#3b353a', boot: '#6e3c28',
};
const HEAD = {center: [0, 0.70, 0], radii: [0.205, 0.19, 0.195]};
// The face canvas covers this square of the front view, in model units.
const FACE = {x0: -0.21, x1: 0.21, y0: 0.49, y1: 0.91};

function headShape(d) {
  let [x, y, z] = d;
  if (y < 0) { const s = Math.pow(-y, 1.7); x *= 1 - 0.2 * s; z *= 1 - 0.1 * s; }
  return [x, y, z];
}
// A point on the head: azimuth 0 is the front and grows toward her left,
// elevation 90 is the crown; scale lifts the point off the skull.
function H(azimuth, elevation, scale = 1) {
  const az = rad(azimuth), el = rad(elevation);
  const d = headShape([Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)]);
  return [HEAD.center[0] + d[0] * HEAD.radii[0] * scale, HEAD.center[1] + d[1] * HEAD.radii[1] * scale, HEAD.center[2] + d[2] * HEAD.radii[2] * scale];
}
const outward = p => norm(sub(p, HEAD.center));
// Weights for something hanging off the head: head above the first joint, then
// each bone of the chain takes over below its own height.
function hanging(chain, heights, blend = 0.035) {
  return y => {
    const f = heights.map(h => smooth(h + blend, h - blend, y)), out = [['head', 1 - f[0]]];
    chain.forEach((name, i) => out.push([name, f[i] - (f[i + 1] || 0)]));
    return out;
  };
}

function build() {
  const m = new Model('ju');

  // --- Skeleton -----------------------------------------------------------
  m.bone('root', null, [0, 0, 0]);
  m.bone('hips', 'root', [0, 0.285, 0]);
  m.bone('spine', 'hips', [0, 0.335, 0]);
  m.bone('chest', 'spine', [0, 0.40, 0]);
  m.bone('neck', 'chest', [0, 0.487, 0]);
  m.bone('head', 'neck', [0, 0.525, 0]);
  const ARM = {shoulder: [0.078, 0.452, 0], elbow: [0.104, 0.371, 0.004], wrist: [0.130, 0.292, 0.01], hand: [0.138, 0.268, 0.013]};
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const flip = p => [p[0] * s, p[1], p[2]];
    m.bone(`${side}UpperArm`, 'chest', flip(ARM.shoulder));
    m.bone(`${side}LowerArm`, `${side}UpperArm`, flip(ARM.elbow));
    m.bone(`${side}Hand`, `${side}LowerArm`, flip(ARM.wrist));
    m.bone(`${side}UpperLeg`, 'hips', [0.04 * s, 0.275, 0]);
    m.bone(`${side}LowerLeg`, `${side}UpperLeg`, [0.04 * s, 0.16, 0]);
    m.bone(`${side}Foot`, `${side}LowerLeg`, [0.04 * s, 0.05, 0]);
  }
  const spring = (stiffness, drag, gravity, tail) => ({spring: {stiffness, drag, gravity, ...(tail ? {tail} : {})}});
  // Six directions of a regular hexagon. These bone offsets and spring tips
  // go into GLB JSON as doubles, where even a last-bit trig difference shows.
  const h = Math.sqrt(3) / 2;
  const skirtDirections = [[0, 1], [h, 0.5], [h, -0.5], [0, -1], [-h, -0.5], [-h, 0.5]];
  skirtDirections.forEach(([x, z], i) => {
    m.bone(`skirt${i}`, 'hips', [0.062 * x, 0.325, 0.057 * z], spring(0.55, 0.5, 0.25, [0.148 * x, 0.19, 0.136 * z]));
  });
  const chain = (prefix, parent, points, params) => {
    points.slice(0, -1).forEach((p, i) => m.bone(`${prefix}${i + 1}`, i ? `${prefix}${i}` : parent, p, spring(...params, i === points.length - 2 ? points[points.length - 1] : undefined)));
    return points.slice(0, -1).map((_, i) => `${prefix}${i + 1}`);
  };
  const BACK_HEIGHTS = [0.60, 0.5, 0.41];
  const backC = chain('hairBackC', 'head', [[0, 0.60, -0.19], [0, 0.5, -0.22], [0, 0.41, -0.23], [0, 0.32, -0.23]], [0.3, 0.45, 0.5]);
  const backL = chain('hairBackL', 'head', [[0.17, 0.60, -0.1], [0.215, 0.5, -0.12], [0.215, 0.41, -0.12], [0.21, 0.32, -0.12]], [0.3, 0.45, 0.5]);
  const backR = chain('hairBackR', 'head', [[-0.17, 0.60, -0.1], [-0.215, 0.5, -0.12], [-0.215, 0.41, -0.12], [-0.21, 0.32, -0.12]], [0.3, 0.45, 0.5]);
  const sideL = chain('hairSideL', 'head', [[0.185, 0.63, 0.07], [0.2, 0.55, 0.08], [0.192, 0.455, 0.085]], [0.4, 0.45, 0.45]);
  const sideR = chain('hairSideR', 'head', [[-0.185, 0.63, 0.07], [-0.2, 0.55, 0.08], [-0.192, 0.455, 0.085]], [0.4, 0.45, 0.45]);
  const ahoge = chain('ahoge', 'head', [[0.006, 0.9, 0.005], [0.03, 0.957, 0.02], [0.078, 0.94, 0.055]], [1.4, 0.35, 0.02]);
  m.bone('colliderHead', 'head', HEAD.center, {collider: {radius: 0.2}});
  m.bone('colliderChest', 'chest', [0, 0.42, 0], {collider: {radius: 0.105}});
  m.bone('colliderHips', 'hips', [0, 0.27, 0], {collider: {radius: 0.13}});

  // --- Head and face decal ------------------------------------------------
  m.group('head');
  m.ellipsoid({center: HEAD.center, radii: HEAD.radii, segments: [28, 20], deform: headShape, color: C.skin, weights: 'head', surface: SURFACE.skin});
  for (const s of [1, -1]) {
    m.ellipsoid({center: [0.2 * s, 0.675, 0.0], radii: [0.022, 0.036, 0.026], segments: [8, 6], color: C.skin, weights: 'head', surface: SURFACE.skin, outline: 0.6});
  }
  m.grid({
    part: 'face', size: [22, 22], flip: true, weights: 'head', color: '#ffffff',
    at: (u, v) => H(lerp(-64, 64, u), lerp(52, -72, v), 1.004),
    uv: p => [(p[0] - FACE.x0) / (FACE.x1 - FACE.x0), (FACE.y1 - p[1]) / (FACE.y1 - FACE.y0)],
  });

  // --- Hair ---------------------------------------------------------------
  m.group('hair');
  // Scalp shell: sits just above the skull and dives inside it across the face.
  m.ellipsoid({
    center: add(HEAD.center, [0, 0.006, -0.01]), radii: HEAD.radii.map(r => r * 1.075), segments: [28, 20], color: C.hair, weights: 'head', surface: SURFACE.hair,
    deform: d => {
      const q = headShape(d), face = smooth(0.12, 0.42, d[2]) * smooth(0.66, 0.5, d[1]);
      return mul(q, 1 - 0.2 * face);
    },
  });
  const lock = ({points, width, thickness = 0.016, color = C.hair, weights = 'head', rings = 12, sides = 8, taper = 0.75, root = 0.6, up, transport = false}) => m.sweep({
    path: points, rings, sides, color, weights, surface: SURFACE.hair, transport,
    up: up || ((t, p) => outward(p)),
    radius: t => { const w = (root + (1 - root) * smooth(0, 0.25, t)) * (1 - Math.pow(smooth(taper * 0.55, 1, t), 1.6)); return [width / 2 * w, thickness * Math.max(0.25, w)]; },
  });
  // Bangs, from the parting near the crown. The centre lock ends between the eyes.
  lock({points: [H(2, 82, 1.07), H(0, 58, 1.1), H(-3, 30, 1.1), H(-4, 4, 1.07), H(-3, -9, 1.05)], width: 0.062, color: C.hairLight});
  lock({points: [H(-6, 80, 1.07), H(-14, 52, 1.105), H(-20, 26, 1.1), H(-21, 6, 1.07)], width: 0.04, color: C.hair});
  lock({points: [H(10, 80, 1.07), H(17, 54, 1.105), H(22, 30, 1.1), H(22, 12, 1.07)], width: 0.046, color: C.hair});
  for (const s of [1, -1]) {
    lock({points: [H(14 * s, 78, 1.07), H(30 * s, 54, 1.11), H(43 * s, 32, 1.105), H(49 * s, 13, 1.075)], width: 0.074, color: C.hairDeep});
    lock({points: [H(30 * s, 72, 1.07), H(52 * s, 48, 1.115), H(66 * s, 24, 1.11), H(71 * s, 0, 1.08)], width: 0.082, color: C.hair});
    // Long face-framing locks that fall to the shoulders.
    const weights = hanging(s > 0 ? sideL : sideR, [0.63, 0.55]);
    lock({
      points: [H(56 * s, 60, 1.08), H(76 * s, 26, 1.12), H(85 * s, -8, 1.1), [0.208 * s, 0.6, 0.078], [0.222 * s, 0.54, 0.09], [0.204 * s, 0.48, 0.098], [0.186 * s, 0.44, 0.1], [0.2 * s, 0.415, 0.108]],
      width: 0.074, thickness: 0.022, rings: 20, color: C.hairLight, taper: 0.95, transport: true, weights: p => weights(p[1]),
    });
  }
  // Back hair: a ring of long wavy locks over a darker mass that closes the
  // gaps. The mass is widest at the shoulders and the ends curl outward.
  const backWeights = p => {
    const az = Math.atan2(p[0], p[2]) * 180 / Math.PI, centre = smooth(118, 172, Math.abs(az)), sideChain = az > 0 ? backL : backR, out = [];
    for (const [name, weight] of hanging(backC, BACK_HEIGHTS)(p[1])) if (name !== 'head') out.push([name, weight * centre]);
    const levels = hanging(sideChain, BACK_HEIGHTS)(p[1]);
    for (const [name, weight] of levels) out.push(name === 'head' ? [name, weight] : [name, weight * (1 - centre)]);
    return out;
  };
  m.ellipsoid({center: [0, 0.53, -0.085], radii: [0.2, 0.2, 0.1], segments: [18, 14], color: C.hairUnder, weights: backWeights, surface: SURFACE.hair,
    deform: d => [d[0] * (1 + 0.1 * Math.max(0, -d[1])), d[1], d[2]]});
  // [azimuth, lowest point, layer]: layer 0 is the outer ring, 1 fills between.
  const BACK = [[180, 0.33, 0], [152, 0.36, 0], [-152, 0.35, 0], [124, 0.32, 0], [-124, 0.33, 0], [98, 0.37, 0], [-98, 0.36, 0], [78, 0.41, 0], [-78, 0.42, 0],
    [166, 0.39, 1], [-166, 0.38, 1], [138, 0.4, 1], [-138, 0.39, 1], [111, 0.41, 1], [-111, 0.4, 1]];
  BACK.forEach(([azimuth, bottom, layer], n) => {
    const a = rad(azimuth), inner = layer === 1, side = Math.sin(a), back = Math.cos(a), phase = n * 2.1, top = 0.6;
    const column = k => {
      const y = lerp(top, bottom, k), settle = smooth(0.08, 0.5, k);
      const r = (inner ? 0.93 : 1) * (0.218 + 0.05 * Math.sin(Math.PI * Math.min(1, k * 1.25) * 0.8) + 0.018 * Math.sin(k * Math.PI * 1.8 + phase) * settle);
      const wave = 0.022 * Math.sin(k * Math.PI * 1.8 + phase + 1.3) * settle;
      return add([side * r, y, back * r * 0.86 - 0.012], mul([Math.cos(a), 0, -Math.sin(a)], wave));
    };
    const points = [H(azimuth, 54, inner ? 1.05 : 1.07), H(azimuth, 20, inner ? 1.08 : 1.115), H(azimuth, -20, inner ? 1.1 : 1.15)];
    for (const k of [0.1, 0.3, 0.5, 0.7, 0.88, 1]) points.push(column(k));
    // The end flicks outward.
    const end = points[points.length - 1];
    points.push(add(end, [side * 0.034, -0.022, back * 0.034]));
    m.sweep({path: points, rings: 26, sides: 8, transport: true, color: [C.hair, C.hairLight, C.hairDeep][n % 3], weights: backWeights, surface: SURFACE.hair,
      up: (t, p) => outward(p),
      radius: t => { const w = (0.7 + 0.3 * smooth(0, 0.2, t)) * (1 - 0.8 * Math.pow(smooth(0.74, 1, t), 1.3)); return [(inner ? 0.05 : 0.062) * w, 0.03 * Math.max(0.3, w)]; }});
  });
  // Ahoge.
  m.sweep({path: [[0.004, 0.89, 0.004], [0.012, 0.93, 0.008], [0.034, 0.96, 0.024], [0.064, 0.955, 0.046], [0.08, 0.932, 0.058]], rings: 12, sides: 6, color: C.hairLight, surface: SURFACE.hair,
    radius: t => { const r = 0.011 * (1 - Math.pow(t, 1.5)) + 0.0015; return [r, r * 0.7]; }, up: [0, 0, 1],
    weights: (p, {t}) => { const f1 = smooth(0.05, 0.35, t), f2 = smooth(0.4, 0.7, t); return [['head', 1 - f1], [ahoge[0], f1 - f2], [ahoge[1], f2]]; }});

  // --- Blossom, ribbon, braid and amber drops on her right ----------------
  m.group('flower');
  const flowerAt = H(-52, 44, 1.2), flowerOut = norm(add(outward(flowerAt), [0, 0, 0.55])), flower = frame(flowerOut, [0, 1, 0]);
  for (let i = 0; i < 5; i++) {
    const a = rad(90 + i * 72), radial = add(mul(flower.x, Math.cos(a)), mul(flower.y, Math.sin(a)));
    const along = norm(add(radial, mul(flower.z, 0.32))), across = norm(cross(flower.z, radial)), thick = cross(along, across);
    m.ellipsoid({
      radii: [0.034, 0.007, 0.026], segments: [10, 6], weights: 'head', outline: 0.7,
      place: {origin: add(flowerAt, add(mul(radial, 0.03), mul(flower.z, 0.006))), x: along, y: thick, z: across},
      deform: d => [d[0], d[1] + 0.5 * d[0] * d[0], d[2] * (1 - 0.3 * Math.max(0, d[0]) ** 2)],
      color: (p, {dir}) => lerp3([0.97, 0.56, 0.2], [1, 0.72, 0.3], clamp(-dir[0] * 0.9)).map(v => v ** 2.2),
    });
  }
  m.ellipsoid({center: add(flowerAt, mul(flower.z, 0.012)), radii: [0.0115, 0.0115, 0.0115], segments: [8, 6], color: C.petalCore, weights: 'head', surface: SURFACE.shiny, outline: 0.5});
  for (const [angle, reach] of [[128, 0.058], [58, 0.05]]) {
    const a = rad(angle), radial = add(mul(flower.x, Math.cos(a)), mul(flower.y, Math.sin(a))), across = norm(cross(flower.z, radial));
    m.ellipsoid({radii: [0.036, 0.005, 0.017], segments: [8, 6], color: C.leaf, weights: 'head', outline: 0.7,
      place: {origin: add(flowerAt, add(mul(radial, reach), mul(flower.z, -0.006))), x: radial, y: flower.z, z: across},
      deform: d => [d[0], d[1], d[2] * (1 - 0.75 * Math.max(0, d[0]) ** 2)]});
  }
  m.group('ribbon');
  const knot = add(H(-63, 22, 1.17), [0, 0, 0.012]), ribbonFace = norm([-0.55, 0.05, 0.83]);
  const ribbonColor = (p, {a}) => (Math.abs(Math.cos(a)) > 0.78 ? C.gold : C.charcoal);
  for (const [dx, dy, tilt] of [[-0.036, 0.016, 0.5], [0.03, 0.02, -0.45]]) {
    const along = norm(add(mul(cross([0, 1, 0], ribbonFace), Math.sign(dx) * -1), [0, Math.abs(tilt), 0]));
    m.ellipsoid({radii: [0.034, 0.022, 0.009], segments: [10, 6], color: C.charcoal, weights: 'head', outline: 0.8,
      place: {origin: add(knot, add(mul(along, 0.03), mul(ribbonFace, 0.002))), x: along, y: norm(cross(ribbonFace, along)), z: ribbonFace},
      deform: d => [d[0], d[1] * (0.55 + 0.45 * smooth(-1, 0.4, d[0])), d[2]]});
  }
  m.ellipsoid({center: add(knot, mul(ribbonFace, 0.004)), radii: [0.012, 0.014, 0.011], segments: [8, 6], color: C.charcoal, weights: 'head', outline: 0.7});
  const tail = (name, points, width, params) => {
    const bones = chain(name, 'head', [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]], params);
    const mid = points[Math.floor(points.length / 2)][1], top = points[0][1];
    m.sweep({path: points, rings: 12, sides: 10, color: ribbonColor, outline: 0.8, up: ribbonFace,
      radius: t => [width / 2 * (0.55 + 0.45 * smooth(0, 0.5, t)), 0.004],
      weights: p => { const f1 = smooth(top - 0.005, top - 0.04, p[1]), f2 = smooth(mid + 0.02, mid - 0.02, p[1]); return [['head', 1 - f1], [bones[0], f1 - f2], [bones[1], f2]]; }});
  };
  tail('ribbonA', [knot, add(knot, [-0.02, -0.07, 0.006]), add(knot, [-0.032, -0.15, 0.002]), add(knot, [-0.026, -0.225, 0.004])], 0.036, [0.5, 0.45, 0.4]);
  tail('ribbonB', [knot, add(knot, [0.006, -0.06, 0.012]), add(knot, [0.002, -0.12, 0.016]), add(knot, [0.012, -0.17, 0.018])], 0.03, [0.5, 0.45, 0.4]);
  m.group('drops');
  for (const [name, dx, drop] of [['dropA', -0.006, 0.105], ['dropB', 0.016, 0.15]]) {
    const top = add(knot, [dx, -0.012, 0.016]), bottom = add(top, [dx * 0.4, -drop, 0.006]);
    m.bone(name, 'head', top, spring(0.25, 0.3, 0.9, bottom));
    m.sweep({path: [top, lerp3(top, bottom, 0.5), bottom], rings: 4, sides: 5, color: C.gold, weights: name, surface: SURFACE.shiny, outline: 0.35, radius: () => [0.0028, 0.0028]});
    m.ellipsoid({center: add(bottom, [0, -0.014, 0]), radii: [0.0125, 0.018, 0.0125], segments: [8, 6], color: C.amber, weights: name, surface: SURFACE.shiny, outline: 0.6,
      deform: d => [d[0] * (1 - 0.35 * Math.max(0, d[1])), d[1], d[2] * (1 - 0.35 * Math.max(0, d[1]))]});
  }
  m.group('braid');
  // The small braid in front of the ribbon tails.
  const braidPath = spline([H(-70, 4, 1.13), [-0.212, 0.63, 0.1], [-0.214, 0.56, 0.108], [-0.204, 0.49, 0.112]]);
  const braid = chain('braid', 'head', [braidPath(0.1), braidPath(0.55), braidPath(1)], [0.45, 0.45, 0.45]);
  for (let i = 0; i < 8; i++) {
    const t = i / 7, p = braidPath(t), r = 0.021 * (1 - 0.4 * t), f1 = smooth(0.05, 0.3, t), f2 = smooth(0.45, 0.7, t);
    m.ellipsoid({center: add(p, [(i % 2 ? 1 : -1) * 0.006, 0, 0]), radii: [r, r * 1.05, r * 0.85], segments: [8, 6], color: i % 2 ? C.hair : C.hairDeep, surface: SURFACE.hair, outline: 0.7,
      weights: [['head', 1 - f1], [braid[0], f1 - f2], [braid[1], f2]]});
  }

  // --- Body ---------------------------------------------------------------
  m.group('torso');
  const torsoWeights = p => {
    const y = p[1], a = smooth(0.29, 0.325, y), b = smooth(0.35, 0.39, y), c = smooth(0.475, 0.5, y);
    return [['hips', 1 - a], ['spine', a - b], ['chest', b - c], ['neck', c]];
  };
  m.lathe({profile: [[0.045, 0.262], [0.062, 0.275], [0.058, 0.33], [0.066, 0.4], [0.06, 0.45], [0.034, 0.478], [0.027, 0.5], [0.026, 0.535]], sides: 16, depth: 0.82,
    color: p => (p[1] > 0.484 ? C.skin : C.cream), surface: SURFACE.cloth, weights: torsoWeights});
  m.group('collar');
  // Collar ruffle and jabot.
  m.lathe({profile: [[0.03, 0.487], [0.05, 0.489], [0.058, 0.512], [0.034, 0.516]], closed: true, sides: 28, depth: 0.92, color: C.cream, weights: 'neck', outline: 0.7,
    shape: (theta, i, r, y) => (i === 1 || i === 2 ? [r + 0.006 * Math.cos(theta * 12), y + 0.003 * Math.cos(theta * 12)] : [r, y])});
  m.ellipsoid({center: [0, 0.42, 0.058], radii: [0.046, 0.046, 0.02], segments: [14, 8], color: (p, {dir}) => (Math.cos(dir[0] * 16) > 0.2 ? C.cream : C.creamShade), weights: p => [['chest', smooth(0.38, 0.42, p[1])], ['spine', 1 - smooth(0.38, 0.42, p[1])]],
    deform: d => [d[0] * (1 + 0.25 * Math.max(0, -d[1])), d[1], d[2] + 0.12 * Math.cos(d[0] * 16) * (d[2] > 0 ? 1 : 0)], outline: 0.7});
  m.group('cape');
  // Capelet, two layers with gold piping and a raised front.
  const capeWeights = p => { const arm = smooth(0.05, 0.115, Math.abs(p[0])) * smooth(0.47, 0.41, p[1]) * 0.7; return [['chest', 1 - arm], [p[0] > 0 ? 'leftUpperArm' : 'rightUpperArm', arm]]; };
  const cape = (profile, hem, color, scallops, lift) => m.lathe({
    profile, closed: true, sides: 36, depth: 0.88, weights: capeWeights,
    color: (p, {i}) => (hem.gold.includes(i) ? C.gold : color),
    shape: (theta, i, r, y) => {
      const w = hem.full.includes(i) ? 1 : hem.half.includes(i) ? 0.5 : 0; if (!w) return [r, y];
      const front = Math.exp(-Math.pow((theta > Math.PI ? theta - 2 * Math.PI : theta) / 0.55, 2));
      return [r * (1 + 0.035 * Math.cos(theta * scallops) * w) * (1 - 0.12 * front * w), y + lift * front * w + 0.004 * Math.cos(theta * scallops) * w];
    },
  });
  cape([[0.036, 0.492], [0.07, 0.482], [0.098, 0.458], [0.122, 0.425], [0.1335, 0.396], [0.1345, 0.393], [0.136, 0.388], [0.128, 0.39], [0.112, 0.425], [0.09, 0.452], [0.064, 0.474], [0.034, 0.484]],
    {gold: [5, 6, 7], full: [4, 5, 6, 7], half: [3, 8]}, C.cape, 9, 0.04);
  cape([[0.036, 0.498], [0.068, 0.49], [0.095, 0.469], [0.113, 0.446], [0.1145, 0.443], [0.117, 0.438], [0.109, 0.441], [0.089, 0.463], [0.062, 0.483], [0.034, 0.491]],
    {gold: [4, 5, 6], full: [3, 4, 5, 6], half: [2, 7]}, C.capeTop, 9, 0.024);
  m.group('bow');
  // Collar bow with the sun brooch.
  const bow = [0, 0.47, 0.079];
  for (const s of [1, -1]) {
    const along = norm([s, 0.22, 0]);
    m.ellipsoid({radii: [0.033, 0.021, 0.011], segments: [10, 6], color: C.charcoal, weights: 'chest', outline: 0.8,
      place: {origin: add(bow, mul(along, 0.03)), x: along, y: [-along[1], along[0], 0], z: [0, 0, 1]},
      deform: d => [d[0], d[1] * (0.5 + 0.5 * smooth(-1, 0.3, d[0])), d[2]]});
    m.sweep({path: [bow, add(bow, [0.014 * s, -0.035, 0.004]), add(bow, [0.026 * s, -0.072, 0.0])], rings: 6, sides: 10, color: ribbonColor, weights: 'chest', outline: 0.8, up: [0, 0, 1],
      radius: t => [0.008 + 0.006 * t, 0.004]});
  }
  m.ellipsoid({center: add(bow, [0, 0, 0.01]), radii: [0.021, 0.021, 0.006], segments: [16, 6], color: C.gold, weights: 'chest', surface: SURFACE.shiny, outline: 0.6,
    deform: d => { const k = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(Math.atan2(d[1], d[0]) * 4)), 3); return [d[0] * k, d[1], d[2] * k]; },
    place: {origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0]}});
  m.ellipsoid({center: add(bow, [0, 0, 0.016]), radii: [0.009, 0.009, 0.007], segments: [8, 6], color: C.amber, weights: 'chest', surface: SURFACE.shiny, outline: 0.4});
  m.group('arms');
  // Arms: puffed cream sleeves with a flared cuff, then the hands.
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const flip = p => [p[0] * s, p[1], p[2]];
    m.sweep({path: [ARM.shoulder, lerp3(ARM.shoulder, ARM.elbow, 0.5), ARM.elbow, lerp3(ARM.elbow, ARM.wrist, 0.6), ARM.wrist].map(flip), rings: 14, sides: 10, color: C.cream, up: [0, 0, 1],
      radius: (t, k) => { const r = 0.028 + 0.007 * Math.sin(Math.min(1, t / 0.5) * Math.PI) * (t < 0.5 ? 1 : 0) + 0.014 * smooth(0.55, 1, t) + (t > 0.9 ? 0.004 * Math.cos(k * Math.PI) : 0); return [r, r]; },
      weights: (p, {t}) => { const f = smooth(0.4, 0.6, t); return [[`${side}UpperArm`, 1 - f], [`${side}LowerArm`, f]]; }});
    m.ellipsoid({center: flip(ARM.hand), radii: [0.026, 0.03, 0.026], segments: [10, 8], color: C.skin, weights: `${side}Hand`, surface: SURFACE.skin, outline: 0.8});
  }
  m.group('skirt');
  // Skirt over a cream petticoat, waist ribbon, and the bow at the back.
  const skirtWeights = p => {
    const t = clamp((0.335 - p[1]) / 0.15), s = smooth(0.1, 0.75, t), angle = ((Math.atan2(p[0], p[2]) * 180 / Math.PI) + 360) % 360, slot = angle / 60, i = Math.floor(slot) % 6, f = slot - Math.floor(slot);
    return [['hips', 1 - s], [`skirt${i}`, s * (1 - f)], [`skirt${(i + 1) % 6}`, s * f]];
  };
  m.lathe({profile: [[0.058, 0.34], [0.086, 0.312], [0.118, 0.262], [0.142, 0.212], [0.1465, 0.2015], [0.148, 0.198], [0.151, 0.19], [0.141, 0.192], [0.11, 0.26], [0.05, 0.332]], closed: true, sides: 40, depth: 0.92,
    color: (p, {i}) => ([5, 6, 7].includes(i) ? C.gold : C.cape), weights: skirtWeights,
    shape: (theta, i, r, y) => { const w = [4, 5, 6, 7].includes(i) ? 1 : i === 3 ? 0.5 : 0; return [r * (1 + 0.03 * Math.cos(theta * 10) * w), y + 0.004 * Math.cos(theta * 10) * w]; }});
  m.lathe({profile: [[0.05, 0.33], [0.108, 0.25], [0.147, 0.176], [0.137, 0.178], [0.1, 0.25], [0.045, 0.325]], closed: true, sides: 44, depth: 0.92, color: (p, {i}) => (i === 2 || i === 3 ? C.cream : C.creamShade), weights: skirtWeights, outline: 0.8,
    shape: (theta, i, r, y) => (i === 2 || i === 3 ? [r * (1 + 0.028 * Math.cos(theta * 22)), y + 0.004 * Math.cos(theta * 22)] : [r, y])});
  m.lathe({profile: [[0.058, 0.352], [0.066, 0.35], [0.067, 0.326], [0.058, 0.322]], closed: true, sides: 20, depth: 0.84, color: C.charcoal, weights: [['spine', 0.5], ['hips', 0.5]], outline: 0.7});
  for (const s of [1, -1]) {
    const along = norm([s, 0.3, -0.15]);
    m.ellipsoid({radii: [0.042, 0.028, 0.014], segments: [10, 6], color: C.charcoal, weights: 'hips', outline: 0.8,
      place: {origin: add([0, 0.338, -0.062], mul(along, 0.036)), x: along, y: norm(cross([0, 0, -1], along)), z: [0, 0, -1]},
      deform: d => [d[0], d[1] * (0.5 + 0.5 * smooth(-1, 0.3, d[0])), d[2]]});
    m.sweep({path: [[0, 0.336, -0.064], [0.03 * s, 0.29, -0.1], [0.05 * s, 0.235, -0.135]], rings: 6, sides: 10, color: ribbonColor, weights: [['hips', 0.4], ['skirt3', 0.6]], outline: 0.8, up: [0, 0.3, -1],
      radius: t => [0.012 + 0.008 * t, 0.004]});
  }
  m.group('legs');
  // Legs in charcoal tights and short boots with a gold cuff.
  for (const [side, s] of [['left', 1], ['right', -1]]) {
    const x = 0.04 * s;
    m.sweep({path: [[x, 0.29, 0], [x, 0.2, 0], [x, 0.11, 0], [x, 0.05, 0]], rings: 10, sides: 10, color: C.tights, up: [0, 0, 1],
      radius: t => { const r = lerp(0.037, 0.027, t); return [r, r]; },
      weights: (p, {t}) => { const f = smooth(0.42, 0.62, t); return [[`${side}UpperLeg`, 1 - f], [`${side}LowerLeg`, f]]; }});
    m.sweep({path: [[x, 0.118, 0], [x, 0.08, 0], [x, 0.04, 0.002]], rings: 6, sides: 10, up: [0, 0, 1],
      color: (p, {t}) => (t < 0.2 ? C.gold : C.boot), radius: t => { const r = 0.036 - 0.004 * smooth(0.1, 0.6, t) + (t < 0.2 ? 0.003 : 0); return [r, r]; },
      weights: p => { const f = smooth(0.07, 0.045, p[1]); return [[`${side}LowerLeg`, 1 - f], [`${side}Foot`, f]]; }});
    m.ellipsoid({center: [x, 0.03, 0.02], radii: [0.037, 0.03, 0.06], segments: [12, 8], color: C.boot, weights: `${side}Foot`,
      deform: d => [d[0], Math.max(-0.92, d[1]) * (1 - 0.25 * Math.max(0, d[2])), d[2]]});
  }
  return m;
}

module.exports = {build, COLORS: C, HEAD, FACE};
