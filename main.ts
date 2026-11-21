// VELMARA — a travel poster for a place that does not exist.
//
// main.ts generates /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png)
// entirely from code: a flat, vintage-style travel poster drawn pixel by
// pixel with the Node standard library only. No network, no image files,
// no randomness — every run produces byte-identical output.
//
// The invented place: VELMARA, a lagoon city at golden dusk whose one
// landmark is the Lantern Spire, a tower crowned with a glowing orb that
// gathers the last light of the day. Small lantern islands drift on a
// mirror-calm lagoon; the sun sets straight down the spire's reflection.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------- canvas
const W = 1024;
const H = 1024;
const SS = 2; // supersample factor: render at 2048, downsample for smooth edges
const RW = W * SS;
const RH = H * SS;

type RGB = [number, number, number];

const buf = Buffer.alloc(RW * RH * 3);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Fill [x0, x1) of render row y with a solid colour. Buffer.fill repeats
// a multi-byte pattern, so one 3-byte pattern fills the whole span.
function spanR(y: number, x0: number, x1: number, c: RGB): void {
  const a = clamp(Math.round(x0), 0, RW);
  const b = clamp(Math.round(x1), 0, RW);
  if (b <= a || y < 0 || y >= RH) return;
  const off = (y * RW + a) * 3;
  buf.fill(Buffer.from(c), off, off + (b - a) * 3);
}

// Fill one final-resolution row (SS render rows) across [x0, x1).
function spanF(yF: number, x0: number, x1: number, c: RGB): void {
  const y0 = Math.round(yF * SS);
  const y1 = Math.round((yF + 1) * SS);
  for (let y = y0; y < y1; y++) spanR(y, x0 * SS, x1 * SS, c);
}

// Fill a final-resolution rectangle [x0, x1) x [y0, y1).
function rectF(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  for (let y = Math.round(y0); y < Math.round(y1); y++) spanF(y, x0, x1, c);
}

// Scanline polygon fill, in final-resolution coordinates, sampled at
// render resolution so diagonal edges anti-alias when downsampled.
function polyF(pts: number[][], c: RGB): void {
  const p = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of p) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const yStart = Math.max(0, Math.ceil(minY));
  const yEnd = Math.min(RH, Math.floor(maxY));
  for (let y = yStart; y < yEnd; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      if ((y1 > yc) !== (y2 > yc)) {
        xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      spanR(y, xs[i], xs[i + 1], c);
    }
  }
}

function circleF(cx: number, cy: number, r: number, c: RGB): void {
  const cxr = cx * SS;
  const cyr = cy * SS;
  const rr = r * SS;
  const yStart = Math.max(0, Math.ceil(cyr - rr));
  const yEnd = Math.min(RH, Math.floor(cyr + rr));
  for (let y = yStart; y < yEnd; y++) {
    const dy = y + 0.5 - cyr;
    const dx = Math.sqrt(Math.max(0, rr * rr - dy * dy));
    spanR(y, cxr - dx, cxr + dx, c);
  }
}

function ellipseF(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const cxr = cx * SS;
  const cyr = cy * SS;
  const rxr = rx * SS;
  const ryr = ry * SS;
  const yStart = Math.max(0, Math.ceil(cyr - ryr));
  const yEnd = Math.min(RH, Math.floor(cyr + ryr));
  for (let y = yStart; y < yEnd; y++) {
    const dy = (y + 0.5 - cyr) / ryr;
    const dx = rxr * Math.sqrt(Math.max(0, 1 - dy * dy));
    spanR(y, cxr - dx, cxr + dx, c);
  }
}

// ------------------------------------------------------- colour helpers
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// Piecewise-linear gradient: stops are [position, colour].
function gradientAt(stops: [number, RGB][], y: number): RGB {
  if (y <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (y <= stops[i][0]) {
      const [y0, c0] = stops[i - 1];
      const [y1, c1] = stops[i];
      return mix(c0, c1, (y - y0) / (y1 - y0));
    }
  }
  return stops[stops.length - 1][1];
}

// Deterministic PRNG (mulberry32) — fixed seed, so output never varies.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- palette
const INK: RGB = [36, 29, 62]; // deep plum silhouette
const INK2: RGB = [42, 33, 72]; // spire body
const TIER: RGB = [58, 46, 94]; // balcony rings
const GOLD: RGB = [247, 196, 115]; // lantern gold
const GOLD_DEEP: RGB = [232, 168, 94];
const CREAM: RGB = [255, 241, 207]; // poster type
const SUN: RGB = [255, 217, 138];
const SUN_CORE: RGB = [255, 240, 190];
const SHADOW: RGB = [30, 35, 66]; // type shadow
const SHORE: RGB = [18, 22, 46];
const SEA_DARK: RGB = [22, 48, 62];

const SKY: [number, RGB][] = [
  [0, [35, 42, 77]],
  [180, [58, 58, 110]],
  [360, [122, 90, 140]],
  [500, [217, 138, 107]],
  [640, [242, 181, 107]],
];

const SEA: [number, RGB][] = [
  [640, [226, 148, 90]],
  [740, [94, 116, 110]],
  [880, [23, 63, 77]],
  [1024, [15, 47, 61]],
];

// -------------------------------------------------------------- sky
const HORIZON = 640;

for (let y = 0; y < RH; y++) {
  const c = gradientAt(SKY, y / SS);
  const off = y * RW * 3;
  buf.fill(Buffer.from(c), off, off + RW * 3);
}

// Stars in the deep part of the sky.
{
  const rnd = mulberry32(20261121);
  for (let i = 0; i < 90; i++) {
    const x = 30 + rnd() * 964;
    const y = 30 + rnd() * 220;
    const r = 1.2 + rnd() * 1.5;
    circleF(x, y, r, rnd() < 0.25 ? SUN : [255, 255, 255]);
  }
}

// Low sunset clouds, kept clear of the sun and the spire.
const CLOUD: RGB = [222, 146, 104];
ellipseF(190, 352, 150, 24, CLOUD);
ellipseF(262, 338, 110, 20, CLOUD);
ellipseF(138, 366, 90, 18, CLOUD);
ellipseF(826, 330, 140, 22, [229, 154, 110]);
ellipseF(884, 346, 96, 18, [229, 154, 110]);
ellipseF(768, 316, 84, 16, [229, 154, 110]);

// The setting sun, low over the lagoon.
circleF(512, 498, 118, [246, 180, 92]);
circleF(512, 498, 96, SUN);
circleF(512, 498, 72, SUN_CORE);

// Birds heading home across the dusk.
function bird(x: number, y: number, s: number): void {
  polyF(
    [
      [x - s, y - 6],
      [x - s + 5, y - 11],
      [x, y - 1],
      [x - 4, y + 2],
    ],
    INK,
  );
  polyF(
    [
      [x + s, y - 6],
      [x + s - 5, y - 11],
      [x, y - 1],
      [x + 4, y + 2],
    ],
    INK,
  );
}
bird(300, 316, 20);
bird(346, 292, 16);
bird(688, 304, 18);
bird(736, 330, 15);
bird(648, 288, 14);

// -------------------------------------------------------------- sea
for (let y = Math.round(HORIZON * SS); y < RH; y++) {
  const c = gradientAt(SEA, y / SS);
  const off = y * RW * 3;
  buf.fill(Buffer.from(c), off, off + RW * 3);
}

// Sun path shimmering down the lagoon, gently widening and fading
// into the deep water as it falls away from the horizon.
for (let y = 652; y < 1000; y += 4) {
  const t = (y - 652) / 348;
  const w = 120 + 30 * Math.sin((y - 652) * 0.018);
  const c = mix([247, 200, 115], [23, 63, 77], t * 0.7);
  rectF(512 - w / 2, y, 512 + w / 2, y + 3, c);
}

// Dark reflection of the spire over the sun path, tapering to a point.
polyF(
  [
    [494, 668],
    [530, 668],
    [516, 820],
    [508, 820],
  ],
  SEA_DARK,
);

// ------------------------------------------------- floating islands
function lanternPost(x: number, topY: number, baseY: number): void {
  rectF(x - 1.5, topY, x + 1.5, baseY, INK);
  circleF(x, topY - 4, 5, SUN);
}

ellipseF(168, 588, 92, 16, INK);
polyF(
  [
    [168, 540],
    [146, 588],
    [190, 588],
  ],
  INK,
);
lanternPost(206, 550, 576);

ellipseF(856, 606, 78, 14, INK);
rectF(830, 576, 862, 606, INK);
polyF(
  [
    [826, 578],
    [866, 578],
    [846, 556],
  ],
  INK,
);
rectF(842, 586, 850, 596, SUN);
lanternPost(885, 578, 606);

// ------------------------------------------------- the Lantern Spire
// The island the spire stands on.
ellipseF(512, 646, 212, 26, INK);

// Terraced houses flanking the spire.
rectF(330, 606, 372, 646, INK);
polyF(
  [
    [324, 608],
    [378, 608],
    [351, 582],
  ],
  INK,
);
rectF(346, 616, 356, 628, SUN);
rectF(652, 610, 694, 646, INK);
polyF(
  [
    [646, 612],
    [700, 612],
    [673, 586],
  ],
  INK,
);
rectF(668, 620, 678, 632, SUN);
rectF(262, 622, 292, 646, INK);
polyF(
  [
    [258, 624],
    [296, 624],
    [277, 604],
  ],
  INK,
);
lanternPost(299, 606, 646);
lanternPost(725, 610, 646);

// The tower itself, tapering up into the dusk.
polyF(
  [
    [476, 642],
    [548, 642],
    [530, 302],
    [494, 302],
  ],
  INK2,
);

// Three lantern rings around the tower.
const TIERS: [number, number, number][] = [
  [384, 458, 566],
  [462, 450, 574],
  [540, 442, 582],
];
for (const [y, x0, x1] of TIERS) {
  rectF(x0, y, x1, y + 14, TIER);
  rectF(x0, y, x1, y + 3, GOLD_DEEP);
}

// Lit windows climbing the tower.
for (let i = 0; i < 6; i++) {
  const y = 330 + i * 44;
  rectF(506, y, 518, y + 16, SUN);
}

// Crown: a glowing orb on a golden halo, with a finial.
circleF(512, 284, 46, GOLD);
circleF(512, 284, 30, [255, 243, 214]);
polyF(
  [
    [506, 238],
    [518, 238],
    [512, 206],
  ],
  GOLD,
);

// ------------------------------------------------- lanterns on the water
{
  const rnd = mulberry32(777);
  let placed = 0;
  while (placed < 14) {
    const x = 80 + rnd() * 864;
    const y = 700 + rnd() * 260;
    if (x > 420 && x < 604) continue; // keep the sun path clear
    const r = 3.5 + rnd() * 3;
    circleF(x, y, r, SUN);
    rectF(x - 1, y + r + 2, x + 1, y + r + 12, GOLD_DEEP);
    placed++;
  }
}

// ------------------------------------------------- foreground headlands
polyF(
  [
    [0, 1024],
    [0, 936],
    [110, 962],
    [230, 996],
    [290, 1024],
  ],
  SHORE,
);
polyF(
  [
    [1024, 1024],
    [1024, 946],
    [920, 968],
    [810, 998],
    [750, 1024],
  ],
  SHORE,
);
circleF(60, 948, 5, SUN);
circleF(150, 970, 4, SUN);
circleF(960, 956, 5, SUN);
circleF(860, 978, 4, SUN);

// ------------------------------------------------------------- the name
// Bold geometric capitals, drawn as polygons so the type is part of the
// picture: V E L M A R A, one invented name, nothing else written.
const LETTERS: Record<string, { w: number; polys: number[][][] }> = {
  V: {
    w: 92,
    polys: [
      [
        [0, 0],
        [26, 0],
        [58, 150],
        [32, 150],
      ],
      [
        [66, 0],
        [92, 0],
        [60, 150],
        [34, 150],
      ],
    ],
  },
  E: {
    w: 88,
    polys: [
      [
        [0, 0],
        [26, 0],
        [26, 150],
        [0, 150],
      ],
      [
        [0, 0],
        [88, 0],
        [88, 26],
        [0, 26],
      ],
      [
        [0, 62],
        [70, 62],
        [70, 88],
        [0, 88],
      ],
      [
        [0, 124],
        [88, 124],
        [88, 150],
        [0, 150],
      ],
    ],
  },
  L: {
    w: 88,
    polys: [
      [
        [0, 0],
        [26, 0],
        [26, 150],
        [0, 150],
      ],
      [
        [0, 124],
        [88, 124],
        [88, 150],
        [0, 150],
      ],
    ],
  },
  M: {
    w: 108,
    polys: [
      [
        [0, 0],
        [26, 0],
        [26, 150],
        [0, 150],
      ],
      [
        [82, 0],
        [108, 0],
        [108, 150],
        [82, 150],
      ],
      [
        [24, 0],
        [50, 0],
        [68, 90],
        [42, 90],
      ],
      [
        [58, 0],
        [84, 0],
        [66, 90],
        [40, 90],
      ],
    ],
  },
  A: {
    w: 96,
    polys: [
      [
        [0, 150],
        [28, 150],
        [62, 0],
        [36, 0],
      ],
      [
        [68, 150],
        [96, 150],
        [60, 0],
        [34, 0],
      ],
      [
        [26, 96],
        [70, 96],
        [70, 122],
        [26, 122],
      ],
    ],
  },
  R: {
    w: 92,
    polys: [
      [
        [0, 0],
        [26, 0],
        [26, 150],
        [0, 150],
      ],
      [
        [0, 0],
        [92, 0],
        [92, 26],
        [0, 26],
      ],
      [
        [66, 26],
        [92, 26],
        [92, 76],
        [66, 76],
      ],
      [
        [0, 62],
        [80, 62],
        [80, 88],
        [0, 88],
      ],
      [
        [46, 80],
        [72, 80],
        [92, 150],
        [66, 150],
      ],
    ],
  },
};

function drawName(word: string, y0: number, gap: number, color: RGB, dy: number): void {
  const totalW =
    word.split("").reduce((s, ch) => s + LETTERS[ch].w, 0) + gap * (word.length - 1);
  let x = (W - totalW) / 2;
  for (const ch of word) {
    const letter = LETTERS[ch];
    for (const poly of letter.polys) {
      polyF(
        poly.map(([px, py]) => [x + px, y0 + dy + py]),
        color,
      );
    }
    x += letter.w + gap;
  }
}

// Soft drop shadow first, then the cream capitals.
drawName("VELMARA", 72, 22, SHADOW, 7);
drawName("VELMARA", 72, 22, CREAM, 0);

// A thin gold rule under the name, in two lengths that leave the
// spire's crown orb standing clear between them.
rectF(362, 252, 462, 258, GOLD_DEEP);
rectF(562, 252, 662, 258, GOLD_DEEP);
polyF(
  [
    [352, 250],
    [358, 256],
    [352, 262],
    [346, 256],
  ],
  GOLD,
);
polyF(
  [
    [672, 250],
    [678, 256],
    [672, 262],
    [666, 256],
  ],
  GOLD,
);

// ------------------------------------------------------------- border
rectF(20, 20, 1004, 25, CREAM);
rectF(20, 999, 1004, 1004, CREAM);
rectF(20, 20, 25, 1004, CREAM);
rectF(999, 20, 1004, 1004, CREAM);

// ------------------------------------------------------- downsample
const out = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 3;
    for (let ch = 0; ch < 3; ch++) {
      const s00 = ((2 * y * RW + 2 * x) * 3) + ch;
      const s01 = s00 + 3;
      const s10 = s00 + RW * 3;
      const s11 = s10 + 3;
      out[o + ch] = (buf[s00] + buf[s01] + buf[s10] + buf[s11] + 2) >> 2;
    }
  }
}

// ------------------------------------------------------------ PNG out
const CRC_TABLE: number[] = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // colour type 2: RGB
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const raw = Buffer.alloc(H * (1 + W * 3));
for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter: none
  out.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "entry.png");
writeFileSync(outPath, png);
console.log(`Wrote ${outPath} (${png.length} bytes, ${W}x${H})`);
