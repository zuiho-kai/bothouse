import * as T from 'three';
import type { HomeItemKind } from '../shared/home.ts';
import table from '../assets/kenney-furniture/tableRound.glb?url';
import chair from '../assets/kenney-furniture/chairCushion.glb?url';
import shelf from '../assets/kenney-furniture/bookcaseOpen.glb?url';
import books from '../assets/kenney-furniture/books.glb?url';
import box from '../assets/kenney-furniture/cardboardBoxClosed.glb?url';
import shelfPlant from '../assets/kenney-furniture/plantSmall2.glb?url';
import radio from '../assets/kenney-furniture/radio.glb?url';
import plant from '../assets/kenney-furniture/pottedPlant.glb?url';

type FurnitureModel = { url: string; size: [number, number, number]; turn?: number };

const models: Record<HomeItemKind, FurnitureModel> = {
  table: { url: table, size: [.60, .75, .60] },
  chair: { url: chair, size: [.40, .78, .40], turn: Math.PI },
  shelf: { url: shelf, size: [.68, 1.815, .33], turn: Math.PI },
  plant: { url: plant, size: [.44, .66, .44] },
};

async function fitModel(model: FurnitureModel) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const response = await fetch(model.url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) throw new Error('Room model could not be loaded');
  const { scene } = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const oriented = new T.Group();
  oriented.add(scene);
  scene.rotation.y = model.turn ?? 0;
  const bounds = new T.Box3().setFromObject(oriented);
  const center = bounds.getCenter(new T.Vector3());
  const extent = bounds.getSize(new T.Vector3());
  if (!extent.toArray().every(value => Number.isFinite(value) && value > 0)) {
    throw new Error('Invalid room model dimensions');
  }
  const [width, height, depth] = model.size;
  const root = new T.Group();
  root.add(oriented);
  // Preserve the saved floor anchor and fit inside the existing hitbox.
  oriented.scale.set(width / extent.x, height / extent.y, depth / extent.z);
  oriented.position.set(-center.x * oriented.scale.x, -bounds.min.y * oriented.scale.y, -center.z * oriented.scale.z);
  return root;
}

async function addShelfContents(root: T.Group) {
  // The original GLB's three shelf surfaces are at y=.13, .37 and .61 of .88.
  const [lower, middle, upper] = [.13, .37, .61].map(y => y * models.shelf.size[1] / .88);
  const [bookStack, storageBox, pottedHerb, tabletopRadio] = await Promise.all([
    fitModel({ url: books, size: [.24, .17, .15], turn: Math.PI }),
    fitModel({ url: box, size: [.21, .17, .17] }),
    fitModel({ url: shelfPlant, size: [.14, .26, .14] }),
    fitModel({ url: radio, size: [.23, .17, .12], turn: Math.PI }),
  ]);
  // Keep the stoneware jar silhouette from the original room's open shelf.
  const jarProfile = [[.07, 0], [.095, .08], [.09, .17], [.06, .215], [.065, .24], [0, .24]];
  const jar = new T.Mesh(new T.LatheGeometry(jarProfile.map(([radius, y]) => new T.Vector2(radius, y)), 12),
    new T.MeshStandardMaterial({color: '#6e9c88', roughness: .85}));
  const lowerBooks = bookStack.clone(true);
  storageBox.position.set(-.13, lower, -.035);
  lowerBooks.position.set(.10, lower, -.042);
  jar.position.set(-.15, middle, -.035);
  tabletopRadio.position.set(.10, middle, -.043);
  bookStack.position.set(-.125, upper, -.042);
  pottedHerb.position.set(.14, upper, -.035);
  root.add(storageBox, lowerBooks, jar, tabletopRadio, bookStack, pottedHerb);
}

const templates = new Map<HomeItemKind, Promise<T.Group | null>>();

function loadModel(kind: HomeItemKind) {
  const cached = templates.get(kind);
  if (cached) return cached;
  const loading = (async () => {
    const root = await fitModel(models[kind]);
    if (kind === 'shelf') await addShelfContents(root);
    root.traverse(node => {
      if (!(node instanceof T.Mesh)) return;
      node.castShadow = node.receiveShadow = true;
      node.geometry.userData.sharedResource = true;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        material.userData.sharedResource = true;
      }
    });
    return root;
  })().catch(() => {
    // A damaged or unavailable asset must not trap the player outside.
    templates.delete(kind);
    return null;
  });
  templates.set(kind, loading);
  return loading;
}

export async function loadHomeFurniture(kinds: Iterable<HomeItemKind>) {
  const entries = await Promise.all([...new Set(kinds)].map(async kind => [kind, await loadModel(kind)] as const));
  return new Map(entries);
}
