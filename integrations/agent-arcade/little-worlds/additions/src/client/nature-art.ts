import * as T from 'three';
import models from '../assets/nature/meshes.json';
import type { LodTier } from '../assets/claude-geometry/style/lod.ts';
import type { FloraKind } from '../assets/claude-geometry/terrain/styles/program.ts';
import { disposeObject3D, markShared } from '../assets/claude-geometry/core/dispose.ts';
import { applyArtMaterial } from './art-profile.ts';
import { HARBOUR_SURFACES } from './presentation-materials.ts';
import { objectHeight, objectRadius } from '../shared/planets.ts';

type Shape = keyof typeof models;
type Detail = 'low' | 'distant' | 'close';
const white = new T.Color(0xffffff);
interface PieceData {
  t: string;
  mask: boolean;
  p: string;
  n: string;
  u: string;
  i: string;
  triangles: number;
}
interface Piece {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}

const images = import.meta.glob<string>('../assets/nature/*.webp', { eager: true, query: '?url', import: 'default' });
const maps = new Map<string, T.Texture>();
const materials = new Map<string, T.MeshStandardMaterial>();
const geometries = new Map<readonly PieceData[], Piece[]>();

function bytes(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;
}

function materialFor(name: string, mask: boolean) {
  const key = name + ':' + mask;
  let material = materials.get(key);
  if (!material) {
    let map = maps.get(name);
    if (!map && typeof document !== 'undefined') {
      map = markShared(new T.TextureLoader().load(images['../assets/nature/' + name + '.webp']));
      map.flipY = false; // Source glTF UVs use the top-left texture origin.
      map.colorSpace = T.SRGBColorSpace;
      maps.set(name, map);
    }
    material = markShared(applyArtMaterial(new T.MeshStandardMaterial({
      map, roughness: .96, side: mask ? T.DoubleSide : T.FrontSide, alphaTest: mask ? .42 : 0,
    })));
    // The village pen reads depth from a single-sample target. Hard cutouts
    // keep that depth and the colour edge aligned on small leaves.
    material.alphaToCoverage = false;
    materials.set(key, material);
  }
  return material;
}

function shapeData(shape: Shape, detail: Detail) {
  const model: Partial<Record<Detail, readonly PieceData[]>> = models[shape];
  return model[detail] ?? model.distant!;
}

function pieces(data: readonly PieceData[]) {
  let parts = geometries.get(data);
  if (!parts) {
    parts = data.map(piece => {
      const geometry = markShared(new T.BufferGeometry());
      geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(bytes(piece.p)), 3));
      geometry.setAttribute('normal', new T.BufferAttribute(new Float32Array(bytes(piece.n)), 3));
      geometry.setAttribute('uv', new T.BufferAttribute(new Float32Array(bytes(piece.u)), 2));
      geometry.setIndex(new T.BufferAttribute(new Uint16Array(bytes(piece.i)), 1));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return { geometry, material: materialFor(piece.t, piece.mask) };
    });
    geometries.set(data, parts);
  }
  return parts;
}

const terrainShapes: Partial<Record<FloraKind, Shape>> = {
  broadleaf: 'leafy', cypress: 'pine', spruce: 'pine', shrub: 'bush', boulder: 'stone',
};

/** Keep the planner's instance matrices (ground height, normal, yaw and seed).
 * Replace only the draw batches, keeping the original per-kind triangle cap. */
export function replaceTerrainNature(flora: T.Object3D, lod: LodTier) {
  for (const [kind, shape] of Object.entries(terrainShapes)) {
    const originals = flora.children.filter((o): o is T.InstancedMesh =>
      o instanceof T.InstancedMesh && o.name.startsWith('flora:' + kind + ':'));
    if (!originals.length) continue;
    const source = originals[0], replacement = shapeData(shape, lod === 'low' ? 'low' : 'distant');
    const oldCost = originals.reduce((total, mesh) => total + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count), 0);
    const newCost = replacement.reduce((total, piece) => total + piece.triangles * 3, 0);
    if (newCost > oldCost) continue;
    // All pieces of one flora kind already share the same local transforms.
    for (const { geometry, material } of pieces(replacement)) {
      const mesh = new T.InstancedMesh(geometry, material, source.count);
      mesh.name = 'nature:' + kind;
      mesh.instanceMatrix.array.set(source.instanceMatrix.array);
      mesh.instanceMatrix.needsUpdate = true;
      if (source.instanceColor) {
        const tint = new T.Color();
        for (let i = 0; i < source.count; i++) {
          source.getColorAt(i, tint);
          mesh.setColorAt(i, tint.lerp(white, .8));
        }
        mesh.instanceColor!.needsUpdate = true;
      }
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      mesh.computeBoundingSphere();
      flora.add(mesh);
    }
    for (const original of originals) disposeObject3D(original);
  }
}

let pot: T.LatheGeometry | undefined;
let potMaterial: T.MeshStandardMaterial | undefined;
function flowerPot() {
  return pot ??= markShared(new T.LatheGeometry([
    [0, 0], [.64, 0], [.79, .91], [.94, .91], [.94, 1], [.76, 1], [.75, .90], [0, .90],
  ].map(([x, y]) => new T.Vector2(x, y)), 12));
}

/** A rendering-only upgrade for both generations of standalone saved plants.
 * Scale within the old size contract; the caller still seats, picks and edits
 * the normal object root and the server still owns planting clearance. */
export function plantedNature(kind: 'tree' | 'flowers', assetVersion: number, lod: LodTier) {
  const meta = { kind, assetVersion: assetVersion === 2 ? 2 as const : undefined };
  const height = objectHeight(meta), radius = objectRadius(meta);
  const root = new T.Group();
  root.userData.assetVersion = assetVersion;
  const shape = kind === 'tree' ? 'leafy' : 'flowers';
  const potHeight = kind === 'flowers' ? height * .42 : 0;
  if (potHeight) {
    potMaterial ??= markShared(applyArtMaterial(new T.MeshStandardMaterial(HARBOUR_SURFACES.copper)));
    const container = new T.Mesh(flowerPot(), potMaterial);
    container.scale.set(radius, potHeight, radius);
    container.castShadow = container.receiveShadow = true;
    root.add(container);
  }
  const width = Math.min(height - potHeight, radius * 2 / Math.max(models[shape].span[0], models[shape].span[2]));
  for (const { geometry, material } of pieces(shapeData(shape, lod === 'low' ? 'distant' : 'close'))) {
    const mesh = new T.Mesh(geometry, material);
    mesh.name = 'nature:planted-' + kind;
    mesh.position.y = potHeight * .9;
    mesh.scale.set(width, height - mesh.position.y, width);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}
