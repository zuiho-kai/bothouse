// Zero-dependency ISO/IEC 18004 QR Code (Byte mode, Error Correction Level L, Versions 1–15)
// SVG generator used by the devices page to display relay connection strings (#2314 item 2.7).

// GF(256) with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d).
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const gen = rsGenerator(ecCount);
  const rem = new Uint8Array(ecCount);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecCount - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

// ISO/IEC 18004 Table 9 (Error Correction Level L) & Annex E alignment coordinates, Versions 1..15.
// Each entry: [version, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, alignCoords]
const VERSIONS_L = [
  [1, 7, 1, 19, 0, 0, []],
  [2, 10, 1, 34, 0, 0, [6, 18]],
  [3, 15, 1, 55, 0, 0, [6, 22]],
  [4, 20, 1, 80, 0, 0, [6, 26]],
  [5, 26, 1, 108, 0, 0, [6, 30]],
  [6, 18, 2, 68, 0, 0, [6, 34]],
  [7, 20, 2, 78, 0, 0, [6, 22, 38]],
  [8, 24, 2, 97, 0, 0, [6, 24, 42]],
  [9, 30, 2, 116, 0, 0, [6, 26, 46]],
  [10, 18, 2, 68, 2, 69, [6, 28, 50]],
  [11, 20, 4, 81, 0, 0, [6, 30, 54]],
  [12, 24, 2, 92, 2, 93, [6, 32, 58]],
  [13, 26, 4, 107, 0, 0, [6, 34, 62]],
  [14, 30, 3, 115, 1, 116, [6, 26, 46, 66]],
  [15, 22, 5, 87, 1, 88, [6, 26, 48, 70]],
];

function selectVersion(byteLen) {
  for (const spec of VERSIONS_L) {
    const [ver, , g1b, g1d, g2b, g2d] = spec;
    const totalData = g1b * g1d + g2b * g2d;
    const headerBits = 4 + (ver <= 9 ? 8 : 16);
    const maxBytes = Math.floor((totalData * 8 - headerBits) / 8);
    if (byteLen <= maxBytes) return { spec, totalData };
  }
  throw new Error('QR payload exceeds version 15 capacity');
}

function buildCodewords(bytes, spec, totalData) {
  const [ver, ecPerBlock, g1b, g1d, g2b, g2d] = spec;
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) pushBits(b, 8);
  const capBits = totalData * 8;
  for (let i = 0; i < 4 && bits.length < capBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    data.push(v);
  }
  const pad = [0xec, 0x11];
  let pi = 0;
  while (data.length < totalData) data.push(pad[pi++ & 1]);

  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1b; i++) {
    const blk = data.slice(offset, offset + g1d);
    offset += g1d;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }
  for (let i = 0; i < g2b; i++) {
    const blk = data.slice(offset, offset + g2d);
    offset += g2d;
    dataBlocks.push(blk);
    ecBlocks.push(rsEncode(blk, ecPerBlock));
  }

  const out = [];
  const maxDataLen = Math.max(g1d, g2d);
  for (let i = 0; i < maxDataLen; i++) {
    for (const blk of dataBlocks) if (i < blk.length) out.push(blk[i]);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const blk of ecBlocks) out.push(blk[i]);
  }
  return out;
}

function formatBits(maskPattern) {
  // EC Level L = 01 (2 bits) + 3-bit maskPattern.
  const data = (0b01 << 3) | (maskPattern & 7);
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function penalty(grid, size) {
  let score = 0;
  // Rule 1: runs of 5+ same-colored modules in rows and columns.
  for (let r = 0; r < size; r++) {
    let run = 1;
    for (let c = 1; c < size; c++) {
      if (grid[r][c] === grid[r][c - 1]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  for (let c = 0; c < size; c++) {
    let run = 1;
    for (let r = 1; r < size; r++) {
      if (grid[r][c] === grid[r - 1][c]) {
        run++;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else run = 1;
    }
  }
  // Rule 2: 2x2 blocks of same color.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r][c];
      if (v === grid[r][c + 1] && v === grid[r + 1][c] && v === grid[r + 1][c + 1]) score += 3;
    }
  }
  // Rule 3: finder-like patterns 10111010000 or 00001011101.
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c]) dark++;
      if (c + 10 < size) {
        const a = grid[r][c] && !grid[r][c + 1] && grid[r][c + 2] && grid[r][c + 3] && grid[r][c + 4] && !grid[r][c + 5] && grid[r][c + 6] && !grid[r][c + 7] && !grid[r][c + 8] && !grid[r][c + 9] && !grid[r][c + 10];
        const b = !grid[r][c] && !grid[r][c + 1] && !grid[r][c + 2] && !grid[r][c + 3] && grid[r][c + 4] && !grid[r][c + 5] && grid[r][c + 6] && grid[r][c + 7] && grid[r][c + 8] && !grid[r][c + 9] && grid[r][c + 10];
        if (a || b) score += 40;
      }
      if (r + 10 < size) {
        const a = grid[r][c] && !grid[r + 1][c] && grid[r + 2][c] && grid[r + 3][c] && grid[r + 4][c] && !grid[r + 5][c] && grid[r + 6][c] && !grid[r + 7][c] && !grid[r + 8][c] && !grid[r + 9][c] && !grid[r + 10][c];
        const b = !grid[r][c] && !grid[r + 1][c] && !grid[r + 2][c] && !grid[r + 3][c] && grid[r + 4][c] && !grid[r + 5][c] && grid[r + 6][c] && grid[r + 7][c] && grid[r + 8][c] && !grid[r + 9][c] && grid[r + 10][c];
        if (a || b) score += 40;
      }
    }
  }
  // Rule 4: balance of dark modules.
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** Generate a QR matrix (`size x size` array of 0/1) for UTF-8 text. */
export function encodeQRMatrix(text) {
  const bytes = Buffer.from(String(text), 'utf8');
  const { spec, totalData } = selectVersion(bytes.length);
  const [ver, , , , , , align] = spec;
  const size = 17 + 4 * ver;
  const codewords = buildCodewords(bytes, spec, totalData);

  const base = Array.from({ length: size }, () => new Uint8Array(size));
  const func = Array.from({ length: size }, () => new Uint8Array(size));
  const setFunc = (r, c, v) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      base[r][c] = v ? 1 : 0;
      func[r][c] = 1;
    }
  };

  // Finder patterns + 1-module white separators.
  const drawFinder = (r0, c0) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const onBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
        const inCore = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunc(r0 + dr, c0 + dc, inOuter && (onBorder || inCore) ? 1 : 0);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0 ? 1 : 0);
    setFunc(i, 6, i % 2 === 0 ? 1 : 0);
  }

  // Alignment patterns.
  for (const ar of align) {
    for (const ac of align) {
      if ((ar === 6 && ac === 6) || (ar === 6 && ac === size - 7) || (ar === size - 7 && ac === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunc(ar + dr, ac + dc, dark ? 1 : 0);
        }
      }
    }
  }

  // Reserve format info + dark module.
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { setFunc(8, i, 0); setFunc(i, 8, 0); }
  }
  for (let i = 0; i < 8; i++) setFunc(8, size - 1 - i, 0);
  for (let i = 0; i < 7; i++) setFunc(size - 1 - i, 8, 0);
  setFunc(size - 8, 8, 1); // Dark module

  // Version info (versions >= 7).
  if (ver >= 7) {
    const vb = versionBits(ver);
    for (let i = 0; i < 18; i++) {
      const bit = (vb >>> i) & 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data bits in zigzag columns right-to-left.
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (func[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
          bitIdx++;
        }
        base[r][c] = bit;
      }
    }
  }

  const placeFormat = (grid, maskIdx) => {
    const fb = formatBits(maskIdx);
    // Bit 14 -> (8,0)... Bit 0 -> (0,8) around top-left finder.
    const tlRow = [8, 8, 8, 8, 8, 8, 8, 8, 7, 5, 4, 3, 2, 1, 0];
    const tlCol = [0, 1, 2, 3, 4, 5, 7, 8, 8, 8, 8, 8, 8, 8, 8];
    for (let i = 0; i < 15; i++) {
      const bit = (fb >>> (14 - i)) & 1;
      grid[tlRow[i]][tlCol[i]] = bit;
      if (i < 7) grid[size - 1 - i][8] = bit;
      else grid[8][size - 15 + i] = bit;
    }
  };

  let bestGrid;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    const maskFn = MASKS[m];
    const grid = base.map((row, r) => {
      const copy = Uint8Array.from(row);
      for (let c = 0; c < size; c++) {
        if (!func[r][c] && maskFn(r, c)) copy[c] ^= 1;
      }
      return copy;
    });
    placeFormat(grid, m);
    const s = penalty(grid, size);
    if (s < bestScore) { bestScore = s; bestGrid = grid; }
  }
  return { version: ver, size, matrix: bestGrid };
}

/** Render a crisp inline SVG with a 4-module white quiet zone (exact integer px/module for scanning). */
export function renderQRSvg(text, { minPixelSize = 220 } = {}) {
  const { size, matrix } = encodeQRMatrix(text);
  const quiet = 4;
  const total = size + quiet * 2;
  const scale = Math.max(4, Math.ceil(minPixelSize / total));
  const pixelSize = total * scale;
  let path = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (!matrix[r][c]) { c++; continue; }
      const start = c;
      while (c < size && matrix[r][c]) c++;
      path += `M${start + quiet},${r + quiet}h${c - start}v1h-${c - start}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${pixelSize}" height="${pixelSize}" role="img" aria-label="QR Code" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
