import { expect, it } from 'vitest';
import { InstancedMesh, Mesh, Vector3 } from 'three';
import type { TerrainField } from '../src/assets/claude-geometry/terrain/field.ts';
import { TerrainKit } from '../src/assets/claude-geometry/terrain/kit.ts';
import { disposeObject3D } from '../src/assets/claude-geometry/core/dispose.ts';
import { measure } from '../src/assets/claude-geometry/style/geometry.ts';
import { replaceTerrainNature } from '../src/client/nature-art.ts';
import { builtObject, disposeGeometry } from '../src/client/build-art.ts';
import { rebasedTerrainFlora } from '../src/client/sample-landscape.ts';
import { fieldOf } from '../src/shared/terrain.ts';
import { HOME_ENVIRONMENT } from '../src/shared/home-layout.ts';
import { objectHeight, objectRadius } from '../src/shared/planets.ts';

it('keeps the saved planet positions, normals, counts and geometry budget while replacing outdoor scenery', () => {
  const kit = new TerrainKit('medium', { look: 'village' });
  const radius = 21.6, field = fieldOf(HOME_ENVIRONMENT, radius) as TerrainField;
  const { object } = rebasedTerrainFlora(field, radius, kit, 'medium', [], 60_000);
  const originals = object.children.filter(o => o instanceof InstancedMesh);
  const old = new Map(originals.map(o => [o.name.split(':')[1], o]));
  const budget = measure(object);
  try {
    replaceTerrainNature(object, 'medium');
    expect(measure(object).triangles).toBeLessThanOrEqual(budget.triangles);
    for (const kind of ['broadleaf', 'shrub', 'boulder']) {
      const reference = old.get(kind)!;
      const replacements = object.children.filter((o): o is InstancedMesh => o instanceof InstancedMesh && o.name === 'nature:' + kind);
      expect(reference.count).toBeGreaterThan(0);
      expect(replacements.length).toBeGreaterThan(0);
      for (const instance of replacements) {
        expect(instance.count).toBe(reference.count);
        expect(instance.instanceMatrix.array).toEqual(reference.instanceMatrix.array);
        expect(instance.geometry.index!.count).toBeGreaterThan(0);
        expect(instance.geometry.userData.sharedResource).toBe(true);
      }
    }
  } finally { disposeObject3D(object); kit.dispose(); }
});

it.each(['tree', 'flowers'] as const)('anchors legacy and new %s inside the saved height and width contract', kind => {
  for (const version of [1, 2]) {
    const placed = builtObject(kind, version);
    const another = builtObject(kind, version);
    const meta = { kind, ...(version === 2 ? { assetVersion: 2 as const } : {}) };
    const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity);
    placed.updateMatrixWorld(true);
    try {
      for (const [i, mesh] of placed.children.entries()) {
        if (!(mesh instanceof Mesh)) continue;
        expect(mesh.geometry).toBe((another.children[i] as Mesh).geometry);
        const vertices = mesh.geometry.getAttribute('position');
        for (let n = 0; n < vertices.count; n++) {
          const p = new Vector3().fromBufferAttribute(vertices, n).applyMatrix4(mesh.matrixWorld);
          min.min(p); max.max(p);
        }
      }
      expect(min.y).toBeCloseTo(0);
      expect(max.y).toBeLessThanOrEqual(objectHeight(meta) + 1e-5);
      expect(max.x - min.x).toBeLessThanOrEqual(objectRadius(meta) * 2 + 1e-4);
      expect(max.z - min.z).toBeLessThanOrEqual(objectRadius(meta) * 2 + 1e-4);
    } finally { disposeGeometry(placed); disposeGeometry(another); }
  }
});
