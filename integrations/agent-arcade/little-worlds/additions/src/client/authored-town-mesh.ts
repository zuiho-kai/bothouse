import { BufferGeometry, Float32BufferAttribute } from 'three';
import models from '../assets/town-exterior/kenney.json' with { type: 'json' };

type TownMesh = keyof typeof models;
type Piece = { slot: string; geometry: BufferGeometry };
const templates = new Map<TownMesh, Piece[]>();

/** The authored OBJ palette chooses the material. UVs remain in local metres for the village materials. */
export function townMeshPieces(name: TownMesh): Piece[] {
  let pieces = templates.get(name);
  if (!pieces) {
    const model = models[name];
    pieces = Object.entries(model.groups).map(([slot, indices]) => {
      const vertices = indices.flatMap(i => [
        model.points[i * 3] / 10000,
        model.points[i * 3 + 1] / 10000,
        model.points[i * 3 + 2] / 10000,
      ]);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      geometry.computeVertexNormals();
      const normal = geometry.getAttribute('normal');
      const uv = new Float32Array(indices.length * 2);
      for (let i = 0; i < indices.length; i++) {
        const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
        const horizontal = Math.abs(normal.getY(i)) > .65;
        uv[i * 2] = horizontal || Math.abs(normal.getZ(i)) > .65 ? x : z;
        uv[i * 2 + 1] = horizontal ? z : y;
      }
      geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      return { slot, geometry };
    });
    templates.set(name, pieces);
  }
  // Scene owners may transform, merge and release their clones independently.
  return pieces.map(({ slot, geometry }) => ({ slot, geometry: geometry.clone() }));
}
