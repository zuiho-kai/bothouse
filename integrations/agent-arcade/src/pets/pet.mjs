import * as THREE from 'three';
import {GLTFLoader} from '/three/examples/jsm/loaders/GLTFLoader.js';

const canvas = document.getElementById('model');
const status = document.getElementById('status');
const name = document.getElementById('name');
const close = document.getElementById('close');
const bridge = window.pet;
const media = window.matchMedia('(prefers-reduced-motion: reduce)');

// Actual conversation metadata controls a brief nod and a quieter busy pose.
// The window displays only the selected role and an activity label.
let state;
let replyAt = -Infinity, replyTimer;
let loadGeneration = 0;
let renderer, model, modelResources, scene, camera, pivot;
let displayScale, displayScaleQuery;
let blinkTargets = [], blinkStart = 0;
let frame = 0, last = 0, rotation = 0, target = 0, drag = null, disposed = false;
const moving = () => !media.matches && !state?.quiet;
const copy = {
  en: {close: 'Close desktop pet', spin: 'Drag or use arrow keys to turn the 3D character', loading: 'Loading', idle: 'Idle', busy: 'Replying', reply: 'Reply received', failed: '3D model unavailable'},
  zh: {close: '关闭桌宠', spin: '拖动或按方向键旋转 3D 角色', loading: '正在加载', idle: '待机', busy: '正在回复', reply: '收到回复', failed: '无法载入 3D 模型'},
};

function updateLabel(failed = false) {
  const language = state?.language === 'zh' ? 'zh' : 'en';
  const words = copy[language];
  document.documentElement.lang = language;
  name.textContent = state?.provider ? state.name + ' · ' + state.provider : state?.name || 'Agent Arcade';
  close.setAttribute('aria-label', words.close);
  canvas.setAttribute('aria-label', words.spin);
  canvas.title = words.spin;
  const mode = failed ? 'failed' : !model ? 'loading' :
    performance.now() - replyAt < 1900 ? 'reply' : state?.busy ? 'busy' : 'idle';
  document.body.dataset.mode = mode;
  if (status.textContent !== words[mode]) status.textContent = words[mode];
}

function render(now) {
  frame = 0;
  if (disposed || document.hidden || !model || !renderer) return;
  if (now - last < 39 && moving()) {
    queue();
    return;
  }
  last = now;
  const animate = moving();
  const replyTime = (now - replyAt) / 1000;
  const replying = replyTime >= 0 && replyTime < 1.9;
  const idleBodyMotion = animate && blinkTargets.length === 0;
  rotation = animate ? THREE.MathUtils.lerp(rotation, target, .27) : target;
  pivot.rotation.y = rotation + (idleBodyMotion && !drag ? .085 * Math.sin(now / 2900) : 0);
  pivot.rotation.x = animate && replying ? -.13 * Math.sin(Math.PI * replyTime / 1.9) : 0;
  pivot.position.y = idleBodyMotion ? Math.sin(now / (state?.busy ? 510 : 980)) * .023 : 0;
  if (blinkTargets.length) {
    const phase = (now - blinkStart) % 4400;
    const weight = animate && !replying && !state?.busy
      ? THREE.MathUtils.smoothstep(phase, 1200, 1290) * (1 - THREE.MathUtils.smoothstep(phase, 1320, 1470))
      : 0;
    for (const {mesh, index} of blinkTargets) mesh.morphTargetInfluences[index] = weight;
  }
  renderer.render(scene, camera);
  updateLabel();
  if (animate) queue();
}

function queue() {
  if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(render);
}

function stopFrame() {
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
}

function clearReply() {
  clearTimeout(replyTimer);
  replyTimer = undefined;
  replyAt = -Infinity;
}

function syncDisplayScale() {
  if (disposed) return;
  const current = window.devicePixelRatio || 1;
  if (displayScale !== current) {
    // A resolution query stops matching when this window changes display scale.
    displayScaleQuery?.removeEventListener('change', syncDisplayScale);
    displayScale = current;
    displayScaleQuery = window.matchMedia(`(resolution: ${current}dppx)`);
    displayScaleQuery.addEventListener('change', syncDisplayScale);
  }
  const pixelRatio = Math.min(current, 2);
  if (renderer.getPixelRatio() === pixelRatio) return;
  renderer.setPixelRatio(pixelRatio);
  queue();
}

async function start() {
  close.onclick = () => {
    disposePet();
    void bridge.close();
  };
  bridge.onState(next => {
    if (disposed || (state && next.bindingRevision < state.bindingRevision)) return;
    if (!renderer) {
      state = next;
      return;
    }
    const differentModel = next.modelPath !== state.modelPath;
    if (next.bindingRevision !== state.bindingRevision) clearReply();
    state = next;
    if (differentModel) void loadModel();
    updateLabel();
    queue();
  });
  const initial = await bridge.init();
  if (disposed) return;
  if (!state || initial.bindingRevision > state.bindingRevision) state = initial;
  bridge.onReply(reply => {
    if (disposed || reply?.bindingRevision !== state.bindingRevision) return;
    clearReply();
    replyAt = performance.now();
    updateLabel();
    queue();
    replyTimer = setTimeout(() => {
      clearReply();
      updateLabel();
      queue();
    }, 1900);
  });
  document.body.dataset.pet = state.id;
  updateLabel();
  renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: 'low-power'});
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  syncDisplayScale();
  window.addEventListener('resize', syncDisplayScale);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff4f1, 0xb2abc4, 2.2));
  const key = new THREE.DirectionalLight(0xffe8d5, 2.45);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb5d9ff, 1.0);
  fill.position.set(3, 2, -3);
  scene.add(fill);
  await loadModel();
}

function releaseModel(resources) {
  if (!resources) return;
  const geometries = new Set(), materials = new Set(), bitmaps = new Set();
  const {roots, textures} = resources;
  for (const root of roots) {
    root.traverse(child => {
      if (child.geometry) geometries.add(child.geometry);
      if (child.material) {
        for (const material of [].concat(child.material)) if (material) materials.add(material);
      }
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value?.isTexture) textures.add(value);
    }
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) {
    // Texture clones inside a single glTF can share the same decoded image.
    if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}

function clearModel() {
  if (pivot) scene.remove(pivot);
  const previous = modelResources;
  modelResources = null;
  model = null;
  pivot = null;
  blinkTargets = [];
  releaseModel(previous);
}

function disposePet() {
  if (disposed) return;
  disposed = true;
  loadGeneration++;
  displayScaleQuery?.removeEventListener('change', syncDisplayScale);
  window.removeEventListener('resize', syncDisplayScale);
  stopFrame();
  clearReply();
  clearModel();
  renderer?.dispose();
}

async function embeddedTextureCount(gltf, textures) {
  const {images = [], materials = []} = gltf.parser.json;
  if (images.some(image => !Number.isInteger(image.bufferView) || image.uri !== undefined ||
      !['image/png', 'image/jpeg'].includes(image.mimeType))) {
    throw Error('Only raster textures embedded in the bundled model are supported.');
  }
  const indices = new Set(materials.map(material =>
    material.pbrMetallicRoughness?.baseColorTexture?.index).filter(Number.isInteger));
  const results = await Promise.allSettled([...indices].map(async index => gltf.parser.getDependency('texture', index)));
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value?.isTexture) textures.add(result.value);
  }
  if (results.some(result => result.status === 'rejected' || !result.value?.image?.width || !result.value.image.height)) {
    throw Error('An embedded desktop pet texture could not be decoded.');
  }
  return results.length;
}

async function loadModel() {
  const generation = ++loadGeneration;
  const modelPath = state.modelPath;
  const isCurrent = () => !disposed && generation === loadGeneration;
  let resources;
  try {
    clearModel();
    delete document.body.dataset.meshes;
    delete document.body.dataset.textures;
    clearReply();
    renderer.clear();
    updateLabel();
    const gltf = await new GLTFLoader().loadAsync(modelPath);
    const next = gltf.scene;
    resources = {roots: new Set([next, ...gltf.scenes]), textures: new Set()};
    if (!isCurrent()) return;
    const textureCount = await embeddedTextureCount(gltf, resources.textures);
    if (!isCurrent()) return;

    const box = new THREE.Box3().setFromObject(next);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (box.isEmpty() || !Number.isFinite(size.length()) || size.y <= 0) throw Error('Empty 3D model.');
    next.position.sub(center);
    const aspect = canvas.clientWidth / canvas.clientHeight;
    // Fit both the height and the diagonal of the mesh when the user turns it.
    const height = Math.max(size.y, Math.hypot(size.x, size.z) / aspect) * 1.11;
    camera = new THREE.OrthographicCamera(-height * aspect / 2, height * aspect / 2, height / 2, -height / 2, .01, 50);
    camera.position.set(0, Math.min(.09 * height, .27), 7);
    camera.lookAt(0, 0, 0);
    pivot = new THREE.Group();
    pivot.add(next);
    scene.add(pivot);
    model = next;
    modelResources = resources;
    resources = null;
    next.traverse(mesh => {
      const targets = mesh.morphTargetDictionary;
      const index = targets?.IdleBlink ?? targets?.JuBlink;
      if (Number.isInteger(index)) blinkTargets.push({mesh, index});
    });
    blinkStart = performance.now();
    document.body.dataset.model = modelPath;
    document.body.dataset.meshes = String(countMeshes(model));
    document.body.dataset.textures = String(textureCount);
    queue();
  } catch {
    if (isCurrent()) updateLabel(true);
  } finally {
    // A completed background load owns resources even if a newer turn or
    // window close prevented this scene from becoming visible.
    releaseModel(resources);
  }
}

function countMeshes(object) {
  let total = 0;
  object.traverse(child => {if (child.isMesh) total++;});
  return total;
}

canvas.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  drag = {x: e.clientX, target};
});
canvas.addEventListener('pointermove', e => {
  if (!drag) return;
  target = drag.target + ((e.clientX - drag.x) / canvas.clientWidth) * Math.PI * 2;
  queue();
});
canvas.addEventListener('lostpointercapture', () => {drag = null;queue();});
canvas.addEventListener('keydown', e => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  e.preventDefault();
  target += e.key === 'ArrowRight' ? -.34 : .34;
  queue();
});
document.addEventListener('visibilitychange', () => {if (document.hidden) stopFrame();else queue();});
media.addEventListener('change', queue);
window.addEventListener('pagehide', disposePet);
canvas.addEventListener('webglcontextlost', () => {
  disposePet();
  updateLabel(true);
});
start().catch(() => { if (!disposed) updateLabel(true); });
