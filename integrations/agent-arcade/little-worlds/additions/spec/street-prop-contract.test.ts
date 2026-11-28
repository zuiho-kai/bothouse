import { expect, it, vi } from 'vitest';
import { Box3, MeshStandardMaterial } from 'three';
import { builtObject, disposeGeometry } from '../src/client/build-art.ts';
import { StyleLibrary } from '../src/assets/claude-geometry/style/materials.ts';
import { PART_COLLIDERS } from '../src/shared/physics/parts.ts';
import { townMeshPieces } from '../src/client/authored-town-mesh.ts';

// The v1 backrest uses only these two harbour materials. It needs no
// generated facade textures (which are painted on a browser canvas).
vi.mock('../src/client/harbour-materials.ts', () => {
  const edge = new MeshStandardMaterial(), dark = new MeshStandardMaterial();
  return { harbourMaterials: () => ({ edge, dark }) };
});

it('fits the authored seat to the existing bench and preserves the historical backrest and street light', () => {
  const lib = new StyleLibrary('medium', {look: 'village'});
  const bench = builtObject('bench', 2, 'medium', lib), oldBench = builtObject('bench', 1, 'medium', lib);
  const lamp = builtObject('lamp', 1, 'medium', lib), cottage = builtObject('cottage', 1, 'medium', lib);
  try {
    const box = new Box3().setFromObject(bench), collider = PART_COLLIDERS['furniture.bench']()[0];
    expect(box.max.y).toBeCloseTo(collider.center[1] + collider.half[1], 2);
    expect(box.max.x).toBeCloseTo(collider.half[0], 2);
    expect(box.max.z).toBeCloseTo(collider.half[2], 2);
    expect(new Box3().setFromObject(oldBench).max.y).toBeGreaterThan(.8);
    expect(bench.getObjectByName('asset:0:furniture.bench')).toBeDefined();
    expect(lamp.userData.emitters).toHaveLength(1);
    const fitting = lamp.userData.emitters[0];
    expect(fitting.kind).toBe('street');
    for (const [i, value] of [0, 1.96, 0].entries()) expect(fitting.position[i]).toBeCloseTo(value, 5);
    expect(fitting.direction).toEqual([0, -1, 0]);
    expect(new Box3().setFromObject(lamp).max.y).toBeLessThanOrEqual(2.1);
    expect(cottage.userData.emitters.some((e: {kind: string}) => e.kind === 'door')).toBe(true);
    expect(new Box3().setFromObject(cottage).max.y).toBeLessThanOrEqual(2.5);
  } finally {
    for (const object of [bench, oldBench, lamp, cottage]) disposeGeometry(object);
    lib.dispose();
  }
});

it('keeps every triangle of the authored canopy above the full bilingual sign', () => {
  for (const { geometry } of townMeshPieces('canopy')) {
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.y + .10).toBeGreaterThan(2.37 + .33 / 2);
    geometry.dispose();
  }
});
