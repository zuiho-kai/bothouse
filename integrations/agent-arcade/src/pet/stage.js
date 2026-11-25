// Loads a pet model and owns the three.js scene: toon material, outline pass,
// the face decal texture and the camera. No behaviour lives here.
import * as THREE from '../vendor/three/build/three.module.js';
import {GLTFLoader} from '../vendor/three/examples/jsm/loaders/GLTFLoader.js';
import {Face} from './face.js';

const VERTEX = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
uniform float uOutline;
varying vec3 vColor; varying vec3 vNormal; varying vec3 vView; varying vec2 vData;
void main() {
  vColor = color; vData = uv;
  vec3 objectNormal = normal;
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vec3 transformed = position;
  #include <skinning_vertex>
  objectNormal = normalize(objectNormal);
  transformed += objectNormal * uOutline * uv.x;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vNormal = normalize(normalMatrix * objectNormal);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// Two-tone cel shading from the vertex colour. vData.y carries the surface
// kind: 0 cloth, 1 skin, 2 hair, 3 shiny (metal, gems).
const FRAGMENT = /* glsl */`
uniform vec3 uLight; uniform float uOutline; uniform float uDim;
varying vec3 vColor; varying vec3 vNormal; varying vec3 vView; varying vec2 vData;
void main() {
  float kind = floor(vData.y * 8.0 + 0.5);
  vec3 color;
  if (uOutline > 0.0) {
    color = vColor * vec3(0.34, 0.24, 0.27);
  } else {
    vec3 n = normalize(vNormal), v = normalize(vView), l = normalize(uLight);
    float lit = smoothstep(0.0, 0.05, dot(n, l) + 0.18);
    vec3 shade = kind == 1.0 ? vec3(0.97, 0.80, 0.76) : kind == 2.0 ? vec3(0.80, 0.60, 0.58) : vec3(0.72, 0.62, 0.70);
    color = vColor * mix(shade, vec3(1.0), lit);
    float rim = smoothstep(0.58, 0.66, 1.0 - dot(n, v)) * lit;
    if (kind == 2.0) {
      // A soft band of light across the hair, broken up along the strands.
      float band = smoothstep(0.30, 0.36, n.y) * smoothstep(0.62, 0.52, n.y) * smoothstep(0.1, 0.4, n.z);
      color += vec3(0.30, 0.20, 0.08) * band * lit;
    }
    if (kind == 3.0) color += vec3(0.5, 0.42, 0.25) * smoothstep(0.86, 0.92, dot(n, normalize(l + v)));
    color += vColor * rim * (kind == 1.0 ? 0.0 : 0.22);
  }
  gl_FragColor = vec4(color * uDim, 1.0);
  #include <colorspace_fragment>
}`;

// Height the camera looks at; chosen so her feet sit just above the window's
// bottom edge and she can stand on the Dock or the screen's lower border.
export const CENTRE_Y = 0.545;

function toon(outline) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX, fragmentShader: FRAGMENT, vertexColors: true,
    side: outline ? THREE.BackSide : THREE.FrontSide,
    uniforms: {uOutline: {value: outline}, uLight: {value: new THREE.Vector3(-0.45, 0.55, 0.75)}, uDim: {value: 1}},
  });
}

function read(url, type) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url); request.responseType = type;
    request.onload = () => (request.response ? resolve(request.response) : reject(Error(`Could not read ${url}`)));
    request.onerror = () => reject(Error(`Could not read ${url}`));
    request.send();
  });
}

export async function createStage(canvas, id) {
  const base = new URL(`./models/${id}`, import.meta.url).href;
  const [meta, bytes] = await Promise.all([read(`${base}.json`, 'json'), read(`${base}.glb`, 'arraybuffer')]);
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(bytes, '', resolve, reject));

  const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power'});
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(21, 1, 0.5, 12);
  const pivot = new THREE.Group();             // turns and tilts the whole character
  pivot.add(gltf.scene); scene.add(pivot);

  const face = new Face(meta.face), faceTexture = new THREE.CanvasTexture(face.canvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace; faceTexture.flipY = false; faceTexture.anisotropy = 4;
  const body = toon(0), outline = toon(0.0042), bones = {};
  let skinned = null;
  gltf.scene.traverse(node => {
    if (node.isBone) bones[node.name] = node;
    if (!node.isSkinnedMesh) return;
    node.frustumCulled = false;
    if (node.material.name === 'face') {
      node.material = new THREE.MeshBasicMaterial({map: faceTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, toneMapped: false});
      node.renderOrder = 2;
    } else { node.material = body; skinned = node; }
  });
  // Outline pass: the same geometry and skeleton, back faces pushed outward.
  const shell = new THREE.SkinnedMesh(skinned.geometry, outline);
  shell.bind(skinned.skeleton, skinned.bindMatrix); shell.frustumCulled = false;
  skinned.parent.add(shell);

  const stage = {
    THREE, renderer, scene, camera, pivot, bones, face, faceTexture, meta, root: gltf.scene, skeleton: skinned.skeleton,
    resize(width, height, ratio) {
      renderer.setPixelRatio(ratio); renderer.setSize(width, height, false);
      camera.aspect = width / height;
      // Frame the whole figure with room above for the ahoge and at the sides
      // for hair and ribbons in motion.
      const tall = 1.16, wide = 0.9, half = Math.tan(camera.fov * Math.PI / 360);
      const distance = Math.max(tall / (2 * half), wide / (2 * half * camera.aspect));
      camera.position.set(0, CENTRE_Y + distance * 0.11, distance); camera.lookAt(0, CENTRE_Y, 0);
      camera.updateProjectionMatrix();
    },
    setFace(params) { if (face.draw(params)) faceTexture.needsUpdate = true; },
    setDim(value) { body.uniforms.uDim.value = value; outline.uniforms.uDim.value = value; },
    render() { renderer.render(scene, camera); },
    // Alpha under a canvas pixel right after a render; used for click-through.
    alphaAt(x, y) {
      const gl = renderer.getContext(), pixel = new Uint8Array(4);
      gl.readPixels(Math.round(x), Math.round(gl.drawingBufferHeight - y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return pixel[3];
    },
  };
  return stage;
}
