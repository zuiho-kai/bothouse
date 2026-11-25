// A screen and a moving head for the portrait preview. Dimensions describe
// the visual proportions only, in millimetres at the 53 mm reference size.
import * as THREE from '../../vendor/three/build/three.module.js';

const HEAD_RADIUS = 50, SCREEN_RADIUS = 26.5, RIM_RADIUS = 28.3;
const RAD = Math.PI / 180;
export const ROUND_META = Object.freeze({skin: '#211713'});

export function createRoundStage(canvas) {
  const renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true, powerPreference: 'low-power'});
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-60, 60, 60, -60, 1, 600);
  camera.position.set(0, 74, 300);
  camera.lookAt(0, 51, 0);

  const pivot = new THREE.Group(), head = new THREE.Group();
  scene.add(pivot);
  pivot.add(head);
  head.position.y = 53;
  head.rotation.order = 'YXZ';

  // Remove the front cap. The glass and bezel sit on its cut plane and the
  // shell can occlude them naturally when the viewer moves around the head.
  const cut = Math.asin(RIM_RADIUS / HEAD_RADIUS);
  const front = Math.cos(cut) * HEAD_RADIUS;
  const sphere = new THREE.SphereGeometry(HEAD_RADIUS, 96, 48, 0, Math.PI * 2, cut, Math.PI - cut);
  sphere.rotateX(Math.PI / 2);
  const shell = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({color: 0xe9e3db, roughness: 0.72}));
  head.add(shell);
  const rim = new THREE.Mesh(new THREE.RingGeometry(SCREEN_RADIUS, RIM_RADIUS, 96), new THREE.MeshStandardMaterial({color: 0x27252a, roughness: 0.55}));
  rim.position.z = front;
  head.add(rim);
  const texture = new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const screen = new THREE.Mesh(new THREE.CircleGeometry(SCREEN_RADIUS, 96), new THREE.MeshBasicMaterial({map: texture, toneMapped: false}));
  screen.position.z = front;
  head.add(screen);

  // Revolve the cross-section of the low stand, including the inside lip
  // that seats the ball. Only the head and its display move with the motors.
  const profile = [[32, 0], [45, 0], [47, 1.5], [47, 7.5], [45, 10], [34, 12], [31, 11], [31, 2], [32, 0]];
  const base = new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 96),
    new THREE.MeshStandardMaterial({color: 0x48454a, roughness: 0.78}));
  pivot.add(base);
  scene.add(new THREE.HemisphereLight(0xfffaf3, 0xbdb5bc, 1.5));
  const key = new THREE.DirectionalLight(0xfff8ed, 1.8);
  key.position.set(-3, 5, 4);
  scene.add(key);

  return {
    renderer, scene, camera, pivot, meta: ROUND_META,
    resize(width, height, ratio) {
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      const aspect = width / height, halfHeight = Math.max(59, 56 / aspect);
      camera.top = halfHeight; camera.bottom = -halfHeight;
      camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect;
      camera.updateProjectionMatrix();
    },
    setSideView(side) { pivot.rotation.y = side ? 42 * RAD : 0; },
    setHeadPose(pan, tilt) { head.rotation.set(tilt * RAD, pan * RAD, 0); },
    setScreenCanvas(visible) {
      texture.image = visible;
      texture.needsUpdate = true;
    },
    render() { renderer.render(scene, camera); },
  };
}
