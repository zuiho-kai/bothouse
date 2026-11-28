import { BufferGeometry, Group, Mesh, Uint16BufferAttribute } from 'three';
import type { Material } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { libraryMaterials } from '../assets/claude-geometry/blueprint/parts/kit.ts';
import type { KitMaterial } from '../assets/claude-geometry/blueprint/parts/kit.ts';
import type { StyleLibrary } from '../assets/claude-geometry/style/materials.ts';
import { edgeKey, partTransform, pivotOf, rotDir } from '../shared/blueprint-model.ts';
import type { PartPlacement } from '../shared/blueprint-model.ts';
import { PARTS } from '../shared/blueprint-parts.ts';
import { townMeshPieces } from './authored-town-mesh.ts';
import { CAMERA_PART_ATTRIBUTE } from './camera-blueprint-model.ts';

type Accent = { mesh: 'frame' | 'dormer'; host: PartPlacement };
const cell = (x: number, z: number, level: number) => `${x},${z},${level}`;
const isFloor = (p: PartPlacement) => p.part === 'floor.deck' || p.part === 'floor.grate';
const isSlope = (p: PartPlacement) => p.part === 'roof.slope' || p.part === 'roof.slope.long';

/** Select occupied room facades; courtyards, openings and mounted signs keep their original silhouette. */
export function planTownExterior(parts: readonly PartPlacement[]): Accent[] {
  const floors = parts.filter(isFloor);
  if (!floors.length) return [];
  const cells = new Set(floors.map(p => cell(p.x, p.z, p.level)));
  const atEdge = (p: PartPlacement) => edgeKey(p.x, p.z, p.rot, p.level);
  const fixtures = new Set(parts.filter(p => PARTS[p.part].role === 'fixture' || PARTS[p.part].role === 'trim').map(atEdge));
  const ground = floors.filter(p => p.level === 0);
  const accents: Accent[] = [];
  const ordered = [...parts].sort((a, b) => a.n - b.n);
  const sides = new Set<number>();
  for (const p of ordered) {
    if (p.part !== 'wall.solid' || p.level !== 0 || sides.has(p.rot) || fixtures.has(atEdge(p)) || !cells.has(cell(p.x, p.z, 0))) continue;
    const [dx, dz] = rotDir(p.rot);
    // An uninterrupted view out beyond this wall also excludes dividers between rooms.
    if (ground.some(f => dx ? f.z === p.z && (f.x - p.x) * dx > 0 : f.x === p.x && (f.z - p.z) * dz > 0)) continue;
    accents.push({ mesh: 'frame', host: p });
    sides.add(p.rot);
    if (sides.size === 2) break;
  }

  const top = Math.max(...parts.map(p => p.level));
  const slopes = ordered.filter(p => isSlope(p) && p.level === top);
  const dormer = slopes.find(p => {
    if (!cells.has(cell(p.x, p.z, p.level - 1))) return false;
    const [dx, dz] = rotDir(p.rot + 1);
    // An interior bay of a continuous gable has room for the existing mesh on either side.
    return [-1, 1].every(sign => slopes.some(q => q.part === p.part && q.rot === p.rot &&
      q.x === p.x + dx * sign && q.z === p.z + dz * sign));
  });
  if (dormer) accents.push({ mesh: 'dormer', host: dormer });
  return accents;
}

/** Geometry lives under its ordinary blueprint; the parent owns its disposal and the shared village palette. */
export function addTownExterior(parent: Group, parts: readonly PartPlacement[], lib: StyleLibrary, cameraSlots?: ReadonlyMap<number, number>) {
  if (lib.look !== 'village') return;
  const accents = planTownExterior(parts);
  if (!accents.length) return;
  const pivot = pivotOf(parts), palette = libraryMaterials(lib);
  const batches = new Map<Material, BufferGeometry[]>();
  for (const { mesh, host } of accents) {
    const transform = partTransform(host, pivot);
    for (const { slot, geometry } of townMeshPieces(mesh)) {
      // The dormer's cut follows the 1:2 pitch. Bed it into the tile courses;
      // the timber brace similarly bites into the 90 mm outer plaster face.
      if (mesh === 'dormer') geometry.translate(0, -.10, 0);
      else geometry.translate(0, 0, -.004);
      geometry.rotateY(transform.yaw).translate(...transform.position);
      if (cameraSlots) geometry.setAttribute(CAMERA_PART_ATTRIBUTE, new Uint16BufferAttribute(
        new Uint16Array(geometry.getAttribute('position').count).fill(cameraSlots.get(host.n) ?? 0), 1));
      const material = palette.get(slot as KitMaterial);
      const batch = batches.get(material) ?? [];
      batch.push(geometry);
      batches.set(material, batch);
    }
  }
  for (const [material, batch] of batches) {
    const geometry = mergeGeometries(batch, false);
    for (const part of batch) part.dispose();
    if (!geometry) throw new Error('Unable to batch town exterior mesh.');
    const mesh = new Mesh(geometry, material);
    mesh.name = 'town-exterior';
    mesh.receiveShadow = true;
    parent.add(mesh);
  }
}
