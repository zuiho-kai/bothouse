// The pet's face, drawn on a canvas that is mapped onto the head's face decal.
// Everything is drawn in model units as seen from the front (x to the viewer's
// right, y up), so the numbers here line up with scripts/pets/<id>.cjs.
// Nothing in this file decides *when* an expression changes; motion.js does.

export const NEUTRAL = Object.freeze({
  blinkL: 0, blinkR: 0,   // 0 open .. 1 closed
  happy: 0,               // closed eyes curve upward instead of downward
  gazeX: 0, gazeY: 0,     // -1 .. 1, in the viewer's frame
  wide: 0,                // surprise: taller eyes, smaller pupils
  browL: 0, browR: 0,     // raise (+) or lower (-)
  mouthOpen: 0,           // 0 .. 1
  mouthRound: 0,          // 0 .. 1, an "o"
  smile: 0.35,            // -1 .. 1 corner height
  smirk: 0.5,             // 0 .. 1 asymmetry toward the viewer's right
  blush: 0,               // 0 .. 1 on top of the resting blush
});

const INK = '#3d1b14', LID = '#d79a84', BROW = '#b4541d', LIP = '#b9503f';
const mix = (a, b, t) => a + (b - a) * t;

export class Face {
  constructor(bounds, size = 512) {
    this.bounds = bounds; this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.context = this.canvas.getContext('2d');
    this.last = '';
    // Layout of Ju's face, in model units. A second character overrides these.
    this.layout = {eyeX: 0.084, eyeY: 0.652, eyeW: 0.044, eyeH: 0.052, browY: 0.742, mouthY: 0.594, cheekX: 0.126, cheekY: 0.622, mole: [-0.124, 0.612]};
    this.iris = ['#4b1c06', '#c7570f', '#f6a01e', '#ffd768'];
  }
  // Draws only when the rounded parameters changed; returns whether it drew.
  draw(params) {
    const key = Object.keys(NEUTRAL).map(name => Math.round((params[name] ?? NEUTRAL[name]) * 40)).join(',');
    if (key === this.last) return false;
    this.last = key;
    const p = {...NEUTRAL, ...params}, c = this.context, {x0, x1, y1} = this.bounds, scale = this.size / (x1 - x0), L = this.layout;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.size, this.size);
    c.setTransform(scale, 0, 0, -scale, -x0 * scale, y1 * scale);
    c.lineCap = 'round'; c.lineJoin = 'round';

    for (const side of [-1, 1]) {
      const blush = c.createRadialGradient(side * L.cheekX, L.cheekY, 0, side * L.cheekX, L.cheekY, 0.046);
      const strength = Math.min(0.75, 0.26 + 0.45 * p.blush);
      blush.addColorStop(0, `rgba(255,128,112,${strength})`); blush.addColorStop(1, 'rgba(255,128,112,0)');
      c.fillStyle = blush; c.fillRect(side * L.cheekX - 0.05, L.cheekY - 0.05, 0.1, 0.1);
    }
    c.strokeStyle = '#e2a48f'; c.lineWidth = 0.0032;
    c.beginPath(); c.moveTo(0.002, 0.632); c.lineTo(0.005, 0.626); c.stroke();
    c.fillStyle = '#6a3a2b'; c.beginPath(); c.arc(L.mole[0], L.mole[1], 0.0036, 0, Math.PI * 2); c.fill();

    this.eye(-1, p.blinkR, p.browR, p);   // her right eye is on the viewer's left
    this.eye(1, p.blinkL, p.browL, p);
    this.mouth(p);
    return true;
  }
  eye(side, blink, brow, p) {
    const c = this.context, L = this.layout, w = L.eyeW, h = L.eyeH * (1 + 0.14 * p.wide);
    c.save();
    c.translate(side * L.eyeX, L.eyeY); c.scale(side, 1);          // +x is now the outer corner
    const open = 1 - Math.min(1, Math.max(0, blink));
    const inner = [-w * 0.94, -h * 0.34], outer = [w * 1.02, h * 0.16], low = -h * 1.5;
    // The upper lid falls toward a closed line that bows down (asleep, blinking)
    // or up (smiling eyes).
    const closedBow = mix(-h * 0.55, h * 0.5, p.happy), apex = mix(closedBow, h * 1.42, open);
    const upper = () => c.bezierCurveTo(-w * 0.7, apex, w * 0.55, apex * 1.04 + h * 0.06, outer[0], outer[1]);
    if (open > 0.12) {
      c.save();
      c.beginPath(); c.moveTo(inner[0], inner[1]); upper(); c.quadraticCurveTo(w * 0.2, low, inner[0], inner[1]); c.closePath(); c.clip();
      c.fillStyle = '#fffaf5'; c.fillRect(-w * 1.2, -h * 1.2, w * 2.4, h * 2.4);
      const gx = side * p.gazeX * w * 0.26, gy = -h * 0.1 + p.gazeY * h * 0.2, rx = w * 0.7, ry = h * 0.9;
      const iris = c.createLinearGradient(0, gy + ry, 0, gy - ry);
      iris.addColorStop(0, this.iris[0]); iris.addColorStop(0.42, this.iris[1]); iris.addColorStop(0.74, this.iris[2]); iris.addColorStop(1, this.iris[3]);
      c.fillStyle = iris; c.beginPath(); c.ellipse(gx, gy, rx, ry, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = this.iris[0]; c.lineWidth = 0.0042; c.stroke();
      const pupil = 1 - 0.3 * p.wide;
      c.fillStyle = '#2a0f05'; c.beginPath(); c.ellipse(gx, gy + ry * 0.08, rx * 0.36 * pupil, ry * 0.4 * pupil, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,226,140,0.85)'; c.beginPath(); c.ellipse(gx, gy - ry * 0.62, rx * 0.5, ry * 0.2, 0, 0, Math.PI * 2); c.fill();
      // Lid shadow, then highlights. The light is on the viewer's left for both eyes.
      const shade = c.createLinearGradient(0, apex * 0.72, 0, apex * 0.72 - h * 0.7);
      shade.addColorStop(0, 'rgba(70,24,20,0.5)'); shade.addColorStop(1, 'rgba(70,24,20,0)');
      c.fillStyle = shade; c.fillRect(-w * 1.2, -h * 1.2, w * 2.4, h * 2.6);
      c.fillStyle = '#ffffff';
      c.beginPath(); c.ellipse(gx - side * rx * 0.4, gy + ry * 0.42, rx * 0.25, ry * 0.2, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(gx + side * rx * 0.36, gy - ry * 0.3, rx * 0.11, 0, Math.PI * 2); c.fill();
      c.restore();
      c.strokeStyle = '#9b5a45'; c.lineWidth = 0.0026;
      c.beginPath(); c.moveTo(w * 0.34, -h * 0.66); c.quadraticCurveTo(w * 0.8, -h * 0.52, outer[0] * 0.98, outer[1] - h * 0.2); c.stroke();
    }
    // Upper lash line with its outer wing.
    c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = mix(0.0062, 0.0096, open);
    c.beginPath(); c.moveTo(inner[0], inner[1]); upper(); c.stroke();
    c.beginPath(); c.moveTo(outer[0] - w * 0.3, outer[1] + h * 0.16 * open); c.lineTo(outer[0] + w * 0.3, outer[1] + h * (0.2 + 0.26 * open)); c.lineTo(outer[0] + w * 0.02, outer[1] - h * 0.06); c.closePath(); c.fill();
    if (open > 0.5) {
      c.strokeStyle = LID; c.lineWidth = 0.0024;
      c.beginPath(); c.moveTo(-w * 0.5, h * 1.3); c.quadraticCurveTo(w * 0.15, h * 1.62, w * 0.82, h * 1.02); c.stroke();
    }
    // Brow: the inner end sits a little lower, which is her composed, knowing look.
    const by = (L.browY - L.eyeY) + brow * h * 0.3 + p.wide * h * 0.2;
    c.strokeStyle = BROW; c.lineWidth = 0.0052;
    c.beginPath(); c.moveTo(-w * 0.78, by - h * 0.12 + brow * h * 0.1); c.quadraticCurveTo(w * 0.1, by + h * 0.2, w * 0.96, by + h * 0.04); c.stroke();
    c.restore();
  }
  mouth(p) {
    const c = this.context, y = this.layout.mouthY, open = Math.max(0, p.mouthOpen), round = Math.max(0, p.mouthRound);
    const half = mix(0.03, 0.013, round) * (1 - 0.25 * open), lift = p.smile * 0.012, tilt = p.smirk * 0.007;
    const left = [-half, y + lift - tilt * 0.3], right = [half + p.smirk * 0.004, y + lift + tilt];
    if (open < 0.06 && round < 0.06) {
      c.strokeStyle = LIP; c.lineWidth = 0.0042;
      c.beginPath(); c.moveTo(left[0], left[1]); c.quadraticCurveTo(0.002, y - lift * 1.5 - 0.002, right[0], right[1]); c.stroke();
      c.strokeStyle = 'rgba(226,128,112,0.55)'; c.lineWidth = 0.003;
      c.beginPath(); c.moveTo(-0.008, y - 0.014); c.quadraticCurveTo(0.002, y - 0.017, 0.012, y - 0.013); c.stroke();
      return;
    }
    const depth = mix(0.008, 0.034, Math.max(open, round * 0.7));
    c.save();
    c.beginPath(); c.moveTo(left[0], left[1]);
    c.quadraticCurveTo(0, y + lift * 0.4 + round * 0.012, right[0], right[1]);
    c.bezierCurveTo(right[0] * 0.9, y - depth * 1.25, left[0] * 0.9, y - depth * 1.25, left[0], left[1]);
    c.closePath();
    c.fillStyle = '#8f2f31'; c.fill();
    c.clip();
    c.fillStyle = '#f08a86'; c.beginPath(); c.ellipse(0.003, y - depth * 1.05, half * 0.75, depth * 0.5, 0, 0, Math.PI * 2); c.fill();
    c.restore();
    c.strokeStyle = LIP; c.lineWidth = 0.0036;
    c.beginPath(); c.moveTo(left[0], left[1]);
    c.quadraticCurveTo(0, y + lift * 0.4 + round * 0.012, right[0], right[1]);
    c.bezierCurveTo(right[0] * 0.9, y - depth * 1.25, left[0] * 0.9, y - depth * 1.25, left[0], left[1]);
    c.stroke();
  }
}
