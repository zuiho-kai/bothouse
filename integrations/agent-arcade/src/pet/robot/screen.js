// The selected round screen uses Ju's levelled portrait. The rectangular
// screen uses the same drawn face as the desktop pet (src/pet/face.js).
//
// Two steps, because a real device does them at different times:
//   content  the face as drawn, with a margin around the visible area
//   present  that content shifted and turned a little (her head never sits
//            perfectly still) and cropped to the visible pixels
// The app sends content only when the face changes; the device presents it
// every frame with whatever shift and turn it was last told.
import {Face, NEUTRAL} from '../face.js';

// The firmware's sleeping portrait is generated offline as well as drawn in
// the app. Keep its two letter shapes independent of installed fonts.
function sleepLetter(c, x, y, w, h, bar) {
  c.beginPath();
  c.moveTo(x, y); c.lineTo(x + w, y); c.lineTo(x + w, y + bar);
  c.lineTo(x + bar * 1.4, y + h - bar); c.lineTo(x + w, y + h - bar);
  c.lineTo(x + w, y + h); c.lineTo(x, y + h); c.lineTo(x, y + h - bar);
  c.lineTo(x + w - bar * 1.4, y + bar); c.lineTo(x, y + bar);
  c.closePath(); c.fill();
}

// Screens the robot firmware knows. `window` is the part of the face, in the
// model's units, that fills the screen's width; `margin` is extra content
// kept around the visible area so a shift or turn never shows an empty edge.
export const SCREENS = Object.freeze({
  // H0's levelled Ju portrait, at the working resolution for the 53 mm face.
  'ju-portrait-480': Object.freeze({width: 480, height: 480, margin: 12, round: true, portrait: './assets/ju-portrait.webp'}),
  // 2.0 inch IPS, 320 x 240 (M5Stack CoreS3 class).
  'lcd-320x240': Object.freeze({width: 320, height: 240, margin: 16, round: false, window: Object.freeze({cx: 0, cy: 0.656, w: 0.33})}),
  // 1.28 inch round, 240 x 240 (GC9A01 class).
  'round-240': Object.freeze({width: 240, height: 240, margin: 12, round: true, window: Object.freeze({cx: 0, cy: 0.652, w: 0.32})}),
});

export const rgb565 = (r, g, b) => ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
export function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const TOUCH_LABELS = {
  en: {pat: 'Pat', poke: 'Poke', huff: 'Hmph'},
  zh: {pat: '摸摸', poke: '轻戳', huff: '哼'},
};

// Mouth landmarks in the selected 466 px Ju crop. Lift the ink and shading
// together at the corners of her closed mouth. The falloff reaches zero
// before the edges of the patch. Eyes and the strands across them stay intact.
function makeJuSmile(context, {width, height, margin}) {
  const sx = width / 466, sy = height / 466;
  const x = margin + Math.floor(185 * sx), y = margin + Math.floor(284 * sy);
  const w = Math.ceil(148 * sx), h = Math.ceil(70 * sy);
  const patch = context.getImageData(x, y, w, h);
  const original = patch.data.slice();
  const falloff = t => Math.max(0, 1 - t * t) ** 2;
  for (let col = 0; col < w; col++) {
    const u = (x - margin + col) / sx;
    const lift = 10 * (falloff((u - 221) / 34) + falloff((u - 294) / 34)) - 2 * falloff((u - 257) / 33);
    for (let row = 0; row < h; row++) {
      const v = (y - margin + row) / sy;
      const sample = row + sy * lift * falloff((v - 318) / 31);
      const low = Math.floor(sample), t = sample - low;
      if (t === 0 && low === row) continue;
      const from = 4 * (low * w + col), to = 4 * (row * w + col);
      for (let ch = 0; ch < 3; ch++) {
        patch.data[to + ch] = original[from + ch] * (1 - t) + original[from + 4 * w + ch] * t;
      }
    }
  }
  return {patch, x, y};
}

export class RobotScreen {
  constructor(meta, spec, portrait, language = 'en') {
    this.spec = spec; this.skin = meta.skin || '#ffe4d2';
    this.contentWidth = spec.width + spec.margin * 2; this.contentHeight = spec.height + spec.margin * 2;
    this.canvas = document.createElement('canvas'); this.canvas.width = this.contentWidth; this.canvas.height = this.contentHeight;
    this.context = this.canvas.getContext('2d', {willReadFrequently: true});
    this.drawn = false; this.cue = ''; this.touch = null;
    if (spec.portrait) {
      if (!portrait?.naturalWidth) throw Error('Robot portrait did not load');
      this.portrait = portrait;
      this.touchLabels = language === 'zh' ? TOUCH_LABELS.zh : TOUCH_LABELS.en;
      return;
    }
    const b = meta.face; this.bounds = b;
    this.scale = spec.width / spec.window.w;
    this.face = new Face(b, Math.round((b.x1 - b.x0) * this.scale));
    // Where the content's top-left corner sits on the face canvas.
    const visibleHeight = spec.window.w * spec.height / spec.width;
    this.sourceX = (spec.window.cx - spec.window.w / 2 - b.x0) * this.scale - spec.margin;
    this.sourceY = (b.y1 - (spec.window.cy + visibleHeight / 2)) * this.scale - spec.margin;
  }
  // The caption and expression are independent of the activity/unread mark.
  draw(params, cue = '', touch = null) {
    const faceChanged = this.face?.draw({...NEUTRAL, ...params});
    if (!faceChanged && this.drawn && cue === this.cue && touch === this.touch) return false;
    const c = this.context;
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = this.skin; c.fillRect(0, 0, this.contentWidth, this.contentHeight);
    if (this.portrait) {
      this.drawPortrait();
      if (this.spec.portrait === SCREENS['ju-portrait-480'].portrait && (touch === 'pat' || touch === 'poke')) {
        this.smile ??= makeJuSmile(c, this.spec);
        c.putImageData(this.smile.patch, this.smile.x, this.smile.y);
      }
    }
    else c.drawImage(this.face.canvas, this.sourceX, this.sourceY, this.contentWidth, this.contentHeight, 0, 0, this.contentWidth, this.contentHeight);
    if (cue) this.drawCue(cue);
    if (this.portrait && touch) this.drawCue(this.touchLabels[touch], true);
    this.cue = cue; this.touch = touch; this.drawn = true;
    return true;
  }
  drawPortrait() {
    const c = this.context, image = this.portrait, {width, height, margin} = this.spec;
    const w = image.naturalWidth, h = image.naturalHeight;
    // The visible centre preserves the phone crop. Extend its edge pixels into
    // the motion margin so a small shift never exposes an empty crescent.
    c.drawImage(image, 0, 0, w, 1, margin, 0, width, margin);
    c.drawImage(image, 0, h - 1, w, 1, margin, margin + height, width, margin);
    c.drawImage(image, 0, 0, 1, h, 0, margin, margin, height);
    c.drawImage(image, w - 1, 0, 1, h, margin + width, margin, margin, height);
    c.drawImage(image, margin, margin, width, height);
  }
  drawCue(cue, touch = false) {
    const c = this.context, {width, height, margin, round} = this.spec, size = Math.round(width * (touch ? 0.11 : 0.13));
    c.font = `700 ${Math.round(size * 0.7)}px -apple-system, "PingFang SC", "Segoe UI", sans-serif`;
    const badgeWidth = touch ? c.measureText(cue).width + size * 0.65 : size * (cue.length === 1 ? 1.15 : 1.65);
    // Leave room for the bezel, moving viewport and round screen's clipped corners.
    const x = margin + (touch ? (width - badgeWidth) / 2 : width * (round ? 0.78 : 0.91) - badgeWidth);
    const y = margin + height * (touch ? 0.76 : round ? 0.18 : 0.10);
    c.fillStyle = '#fffaf3'; c.strokeStyle = '#5a2f22'; c.lineWidth = Math.max(2, size * 0.09);
    c.beginPath(); c.roundRect(x, y, badgeWidth, size, size * 0.42); c.fill(); c.stroke();
    c.fillStyle = '#5a2f22';
    if (cue === 'Zz' && this.portrait) {
      const middle = x + badgeWidth / 2, bottom = y + size * 0.72;
      sleepLetter(c, middle - size * 0.35, bottom - size * 0.48, size * 0.36, size * 0.48, size * 0.082);
      sleepLetter(c, middle + size * 0.07, bottom - size * 0.34, size * 0.30, size * 0.34, size * 0.068);
      return;
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(cue, x + badgeWidth / 2, y + size * (cue === '…' ? 0.42 : 0.54));
  }
  // The content as RGBA bytes (row-major), for encoding.
  pixels() { return this.context.getImageData(0, 0, this.contentWidth, this.contentHeight).data; }
}

// Presents content on a visible-size canvas the way the device does: shifted
// by (dx, dy) pixels and turned by `roll` degrees about the screen centre, on
// the skin colour. `content` is any canvas or image of the content size.
export function present(context, content, spec, skin, {dx = 0, dy = 0, roll = 0, dim = 1} = {}) {
  const {width, height, margin} = spec;
  context.setTransform(1, 0, 0, 1, 0, 0); context.globalAlpha = 1;
  context.fillStyle = skin; context.fillRect(0, 0, width, height);
  context.save();
  if (spec.round) { context.beginPath(); context.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2); context.clip(); }
  context.translate(width / 2 + dx, height / 2 + dy); context.rotate(roll * Math.PI / 180);
  context.drawImage(content, -(width / 2 + margin), -(height / 2 + margin));
  context.restore();
  if (dim < 1) { context.fillStyle = `rgba(0,0,0,${1 - dim})`; context.fillRect(0, 0, width, height); }
  if (spec.round) {
    context.globalCompositeOperation = 'destination-in'; context.fillStyle = '#000'; context.beginPath(); context.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2); context.fill(); context.globalCompositeOperation = 'source-over';
  }
}
