import fs from 'fs';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vertex { x: number; y: number; }

export interface ExtractedRoom {
  name: string;
  area: number;      // m²
  perimeter: number; // m
  layer: string;
}

interface TextEntity { x: number; y: number; text: string; }

interface Polyline {
  vertices: Vertex[];
  closed: boolean;
  layer: string;
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

// $INSUNITS values → meters
const UNIT_FACTORS: Record<number, number> = {
  1: 0.0254,    // inches
  2: 0.3048,    // feet
  4: 0.001,     // millimeters (most common in Brazilian architecture)
  5: 0.01,      // centimeters
  6: 1.0,       // meters
  7: 1000.0,    // kilometers
};

function detectUnitFactor(insunits: number, vertices: Vertex[][]): number {
  if (UNIT_FACTORS[insunits]) return UNIT_FACTORS[insunits];

  // Unitless (0) — infer from coordinate magnitude
  // Typical room in mm: thousands of units; in m: single digits
  const allCoords = vertices.flat().flatMap(v => [Math.abs(v.x), Math.abs(v.y)]).filter(v => v > 0);
  if (allCoords.length === 0) return 0.001;
  const median = allCoords.sort((a, b) => a - b)[Math.floor(allCoords.length / 2)];
  if (median > 500) return 0.001;  // likely mm
  if (median > 5) return 0.01;     // likely cm
  return 1.0;                       // likely m
}

// ─── Geometry ────────────────────────────────────────────────────────────────

function shoelaceArea(verts: Vertex[]): number {
  let area = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += verts[i].x * verts[j].y - verts[j].x * verts[i].y;
  }
  return Math.abs(area) / 2;
}

function calcPerimeter(verts: Vertex[], closed: boolean): number {
  let p = 0;
  const n = verts.length;
  const limit = closed ? n : n - 1;
  for (let i = 0; i < limit; i++) {
    const j = (i + 1) % n;
    const dx = verts[j].x - verts[i].x;
    const dy = verts[j].y - verts[i].y;
    p += Math.sqrt(dx * dx + dy * dy);
  }
  return p;
}

function boundingBox(verts: Vertex[]) {
  const xs = verts.map(v => v.x);
  const ys = verts.map(v => v.y);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

function isInsideBB(p: Vertex, bb: ReturnType<typeof boundingBox>): boolean {
  return p.x >= bb.minX && p.x <= bb.maxX && p.y >= bb.minY && p.y <= bb.maxY;
}

// ─── DXF group code parser ───────────────────────────────────────────────────

interface Group { code: number; value: string; }

function parseGroups(content: string): Group[] {
  const lines = content.split(/\r?\n/);
  const groups: Group[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!isNaN(code)) groups.push({ code, value: lines[i + 1].trim() });
  }
  return groups;
}

// ─── Entity extractors ───────────────────────────────────────────────────────

function extractLWPolyline(groups: Group[], start: number): { poly: Polyline; end: number } {
  const poly: Polyline = { vertices: [], closed: false, layer: '0' };
  const xs: number[] = [];
  const ys: number[] = [];
  let i = start;
  while (i < groups.length && groups[i].code !== 0) {
    const { code, value } = groups[i];
    if (code === 8) poly.layer = value;
    if (code === 70) poly.closed = (parseInt(value, 10) & 1) === 1;
    if (code === 10) xs.push(parseFloat(value));
    if (code === 20) ys.push(parseFloat(value));
    i++;
  }
  poly.vertices = xs.slice(0, ys.length).map((x, k) => ({ x, y: ys[k] }));
  return { poly, end: i };
}

function extractPolyline(groups: Group[], start: number): { poly: Polyline; end: number } {
  const poly: Polyline = { vertices: [], closed: false, layer: '0' };
  let i = start;
  // Read POLYLINE header
  while (i < groups.length && !(groups[i].code === 0 && (groups[i].value === 'VERTEX' || groups[i].value === 'SEQEND'))) {
    const { code, value } = groups[i];
    if (code === 8) poly.layer = value;
    if (code === 70) poly.closed = (parseInt(value, 10) & 1) === 1;
    i++;
  }
  // Read VERTEXes
  while (i < groups.length && !(groups[i].code === 0 && groups[i].value === 'SEQEND')) {
    if (groups[i].code === 0 && groups[i].value === 'VERTEX') {
      i++;
      let vx = 0, vy = 0;
      while (i < groups.length && groups[i].code !== 0) {
        if (groups[i].code === 10) vx = parseFloat(groups[i].value);
        if (groups[i].code === 20) vy = parseFloat(groups[i].value);
        i++;
      }
      poly.vertices.push({ x: vx, y: vy });
    } else {
      i++;
    }
  }
  // Skip SEQEND
  if (i < groups.length && groups[i].value === 'SEQEND') i++;
  return { poly, end: i };
}

function extractText(groups: Group[], start: number): { txt: TextEntity; end: number } {
  const txt: TextEntity = { x: 0, y: 0, text: '' };
  let i = start;
  while (i < groups.length && groups[i].code !== 0) {
    const { code, value } = groups[i];
    if (code === 10) txt.x = parseFloat(value);
    if (code === 20) txt.y = parseFloat(value);
    // code 1 = text content; strip MTEXT formatting codes {\Fxxx;} \P etc.
    if (code === 1) txt.text = value.replace(/\{[^}]*\}|\\[A-Za-z][^;]*;|\\[PpNn]/g, '').trim();
    i++;
  }
  return { txt, end: i };
}

// ─── LINE segment extractor ──────────────────────────────────────────────────

interface Segment { x0: number; y0: number; x1: number; y1: number; }

function extractLineSegments(groups: Group[]): Segment[] {
  const segs: Segment[] = [];
  let i = 0;
  while (i < groups.length) {
    if (groups[i].code === 0 && groups[i].value === 'LINE') {
      i++;
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      while (i < groups.length && groups[i].code !== 0) {
        const { code, value } = groups[i];
        if (code === 10) x0 = parseFloat(value);
        if (code === 20) y0 = parseFloat(value);
        if (code === 11) x1 = parseFloat(value);
        if (code === 21) y1 = parseFloat(value);
        i++;
      }
      segs.push({ x0, y0, x1, y1 });
    } else {
      i++;
    }
  }
  return segs;
}

// ─── Planar face traversal: detect rooms from connected LINE segments ─────────

function detectRoomsFromLines(segs: Segment[], factor: number): Polyline[] {
  // Estimate median coordinate magnitude to set snap tolerance
  const mags = segs.flatMap(s => [Math.abs(s.x0), Math.abs(s.y0)]).filter(v => v > 0).sort((a, b) => a - b);
  const medMag = mags[Math.floor(mags.length / 2)] ?? 1000;

  // Dynamic snap tolerance: ~0.05% of coordinate magnitude, min 0.5 max 20
  const TOL = Math.max(0.5, Math.min(20, medMag * 0.0005));

  // Min segment length filter: removes annotation/hatch detail lines
  // Heuristic: at least 1.5% of the median coordinate magnitude
  const MIN_LEN = medMag * 0.015;

  const snap = (v: number) => Math.round(v / TOL) * TOL;
  const ptKey = (x: number, y: number) => `${snap(x)}_${snap(y)}`;

  type AdjEntry = { to: string; angle: number };
  const adj = new Map<string, AdjEntry[]>();
  const pts = new Map<string, Vertex>();

  for (const { x0, y0, x1, y1 } of segs) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    if (len < MIN_LEN) continue;

    const ak = ptKey(x0, y0);
    const bk = ptKey(x1, y1);
    if (ak === bk) continue;

    const sx0 = snap(x0), sy0 = snap(y0), sx1 = snap(x1), sy1 = snap(y1);
    pts.set(ak, { x: sx0, y: sy0 });
    pts.set(bk, { x: sx1, y: sy1 });

    const aToB = Math.atan2(sy1 - sy0, sx1 - sx0);
    const bToA = Math.atan2(sy0 - sy1, sx0 - sx1);

    if (!adj.has(ak)) adj.set(ak, []);
    if (!adj.has(bk)) adj.set(bk, []);
    adj.get(ak)!.push({ to: bk, angle: aToB });
    adj.get(bk)!.push({ to: ak, angle: bToA });
  }

  // Sort neighbors by angle at each vertex
  for (const neighbors of adj.values()) neighbors.sort((a, b) => a.angle - b.angle);

  // Face traversal (DCEL-style): for each directed edge, walk the face to its left
  const visited = new Set<string>();
  const results: Polyline[] = [];
  const seenAreas = new Set<string>(); // deduplicate

  for (const uk of adj.keys()) {
    for (const { to: vk } of adj.get(uk)!) {
      const ek = `${uk}→${vk}`;
      if (visited.has(ek)) continue;

      const face: Vertex[] = [];
      let cur = uk, nxt = vk;
      const maxSteps = adj.size + 5;

      for (let step = 0; step < maxSteps; step++) {
        const ek2 = `${cur}→${nxt}`;
        if (visited.has(ek2) && face.length > 0) break;
        visited.add(ek2);
        face.push(pts.get(cur)!);

        // At `nxt`, find the most-clockwise outgoing edge from the arrival direction
        const arrAngle = Math.atan2(
          pts.get(cur)!.y - pts.get(nxt)!.y,
          pts.get(cur)!.x - pts.get(nxt)!.x,
        );
        const neighbors = adj.get(nxt) ?? [];
        let bestNext: string | null = null;
        let bestDiff = Infinity;
        for (const { to, angle } of neighbors) {
          let diff = arrAngle - angle;
          while (diff < 0) diff += 2 * Math.PI;
          if (diff < 1e-9) continue;
          if (diff < bestDiff) { bestDiff = diff; bestNext = to; }
        }
        if (!bestNext || bestNext === cur) break;
        cur = nxt;
        nxt = bestNext;
      }

      if (face.length < 3) continue;
      const rawArea = shoelaceArea(face);
      const areaM2 = rawArea * factor * factor;

      // Filter by plausible room size
      if (areaM2 < 0.3 || areaM2 > 500) continue;

      // Deduplicate (same area to 2 decimal places)
      const areaKey = areaM2.toFixed(2);
      if (seenAreas.has(areaKey)) continue;
      seenAreas.add(areaKey);

      results.push({ vertices: face, closed: true, layer: '0' });
    }
  }

  return results;
}

// ─── HATCH boundary extractor ────────────────────────────────────────────────
// Parses a HATCH entity and returns one polygon per boundary loop (LINE edges only).
// ARC edges are approximated with 8 sample points.

function extractHatch(groups: Group[], start: number): { polys: Polyline[]; end: number } {
  let layer = '0';
  const polys: Polyline[] = [];
  let i = start;

  // Read entity header up to first boundary loop
  while (i < groups.length && groups[i].code !== 91 && groups[i].code !== 0) {
    if (groups[i].code === 8) layer = groups[i].value;
    i++;
  }

  if (i >= groups.length || groups[i].code !== 91) return { polys, end: i };

  const numLoops = parseInt(groups[i].value, 10);
  i++;

  for (let loop = 0; loop < numLoops; loop++) {
    // Skip loop header (92 = loop type, 93 = edge count)
    while (i < groups.length && groups[i].code !== 93 && groups[i].code !== 72 && groups[i].code !== 0) i++;
    if (i >= groups.length || groups[i].code === 0) break;

    let edgeCount = 0;
    if (groups[i].code === 93) { edgeCount = parseInt(groups[i].value, 10); i++; }

    const vertices: Vertex[] = [];

    for (let edge = 0; edge < edgeCount; edge++) {
      if (i >= groups.length || groups[i].code === 0) break;
      if (groups[i].code !== 72) { i++; edge--; continue; } // skip non-edge-type codes

      const edgeType = parseInt(groups[i].value, 10);
      i++;

      if (edgeType === 1) {
        // LINE edge: 10,20 = start; 11,21 = end
        let x0 = 0, y0 = 0;
        while (i < groups.length && groups[i].code !== 72 && groups[i].code !== 97 && groups[i].code !== 0) {
          if (groups[i].code === 10) x0 = parseFloat(groups[i].value);
          if (groups[i].code === 20) y0 = parseFloat(groups[i].value);
          i++;
        }
        vertices.push({ x: x0, y: y0 }); // only collect start points; end = next start
      } else if (edgeType === 2) {
        // ARC edge: 10,20 = center; 40 = radius; 50 = startAngle; 51 = endAngle; 73 = CCW
        let cx = 0, cy = 0, r = 0, a0 = 0, a1 = 0, ccw = 1;
        while (i < groups.length && groups[i].code !== 72 && groups[i].code !== 97 && groups[i].code !== 0) {
          const { code, value } = groups[i];
          if (code === 10) cx = parseFloat(value);
          if (code === 20) cy = parseFloat(value);
          if (code === 40) r = parseFloat(value);
          if (code === 50) a0 = parseFloat(value);
          if (code === 51) a1 = parseFloat(value);
          if (code === 73) ccw = parseInt(value, 10);
          i++;
        }
        if (!ccw && a1 > a0) a1 -= 360;
        if (ccw && a1 < a0) a1 += 360;
        const steps = 8;
        for (let s = 0; s <= steps; s++) {
          const ang = (a0 + (a1 - a0) * s / steps) * Math.PI / 180;
          vertices.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
        }
      } else {
        // Unsupported edge type — skip until next edge type or end
        while (i < groups.length && groups[i].code !== 72 && groups[i].code !== 97 && groups[i].code !== 0) i++;
      }
    }

    if (vertices.length >= 3) {
      polys.push({ vertices, closed: true, layer });
    }

    // Skip to next loop (97 = number of source boundary objects)
    while (i < groups.length && groups[i].code !== 91 && groups[i].code !== 92 && groups[i].code !== 0) i++;
  }

  // Advance past remaining HATCH groups
  while (i < groups.length && groups[i].code !== 0) i++;

  return { polys, end: i };
}

// ─── Layer name → human-readable room label ──────────────────────────────────

function layerToLabel(layer: string): string {
  if (!layer || layer === '0') return '';
  return layer
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

// ─── Main processor ──────────────────────────────────────────────────────────

export function processDXFFile(filePath: string): ExtractedRoom[] {
  const content = fs.readFileSync(filePath, { encoding: 'utf8' });
  return processDXFContent(content);
}

export function processDXFContent(content: string): ExtractedRoom[] {
  const groups = parseGroups(content);

  // Read $INSUNITS from HEADER
  let insunits = 0;
  for (let i = 0; i < groups.length - 1; i++) {
    if (groups[i].code === 9 && groups[i].value === '$INSUNITS') {
      insunits = parseInt(groups[i + 1].value, 10) || 0;
      break;
    }
  }

  const polylines: Polyline[] = [];
  const hatches: Polyline[] = [];
  const texts: TextEntity[] = [];
  const lineSegments: Segment[] = [];

  // Walk entities section
  let inEntities = false;
  let i = 0;
  while (i < groups.length) {
    const g = groups[i];

    if (g.code === 0 && g.value === 'SECTION') {
      i++;
      if (i < groups.length && groups[i].code === 2) {
        inEntities = groups[i].value === 'ENTITIES' || groups[i].value === 'BLOCKS';
      }
      continue;
    }
    if (g.code === 0 && g.value === 'ENDSEC') { inEntities = false; i++; continue; }

    if (!inEntities) { i++; continue; }

    if (g.code === 0 && g.value === 'LWPOLYLINE') {
      const { poly, end } = extractLWPolyline(groups, i + 1);
      if (poly.vertices.length >= 3) polylines.push(poly);
      i = end;
      continue;
    }

    if (g.code === 0 && g.value === 'POLYLINE') {
      const { poly, end } = extractPolyline(groups, i + 1);
      if (poly.vertices.length >= 3) polylines.push(poly);
      i = end;
      continue;
    }

    if (g.code === 0 && g.value === 'HATCH') {
      const { polys, end } = extractHatch(groups, i + 1);
      for (const p of polys) if (p.vertices.length >= 3) hatches.push(p);
      i = end;
      continue;
    }

    if (g.code === 0 && (g.value === 'TEXT' || g.value === 'MTEXT')) {
      const { txt, end } = extractText(groups, i + 1);
      if (txt.text) texts.push(txt);
      i = end;
      continue;
    }

    if (g.code === 0 && g.value === 'LINE') {
      // Inline LINE collection — extractLineSegments would re-parse all groups,
      // so we collect here directly during the single entity walk
      let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      i++;
      while (i < groups.length && groups[i].code !== 0) {
        const c = groups[i];
        if (c.code === 10) x0 = parseFloat(c.value);
        else if (c.code === 20) y0 = parseFloat(c.value);
        else if (c.code === 11) x1 = parseFloat(c.value);
        else if (c.code === 21) y1 = parseFloat(c.value);
        i++;
      }
      lineSegments.push({ x0, y0, x1, y1 });
      continue;
    }

    i++;
  }

  // Prefer polylines → hatches → LINE-based face detection
  let candidates: Polyline[];
  let factor: number;

  if (polylines.length > 0) {
    candidates = polylines;
    factor = detectUnitFactor(insunits, candidates.map(p => p.vertices));
  } else if (hatches.length > 0) {
    candidates = hatches;
    factor = detectUnitFactor(insunits, candidates.map(p => p.vertices));
  } else {
    // LINE-only file: auto-detect unit factor from segment endpoints.
    // $INSUNITS is often wrong in exported DXF — use coordinate magnitude instead.
    const segVerts = lineSegments.flatMap(s => [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y1 }]);
    factor = detectUnitFactor(0, [segVerts]);
    candidates = detectRoomsFromLines(lineSegments, factor);
  }

  // Build rooms from closed polygons
  const nameCounts: Record<string, number> = {};
  const rooms: ExtractedRoom[] = [];

  for (const poly of candidates) {
    const verts = poly.vertices;

    // Check closure for polylines (hatches are always closed)
    if (!poly.closed) {
      const last = verts[verts.length - 1];
      const isClosed =
        Math.abs(verts[0].x - last.x) < 1e-4 &&
        Math.abs(verts[0].y - last.y) < 1e-4;
      if (!isClosed) continue;
    }

    const rawArea = shoelaceArea(verts);
    const rawPerimeter = calcPerimeter(verts, true);
    const area = rawArea * factor * factor;
    const perimeter = rawPerimeter * factor;

    // Filter: must be a plausible room size (0.1 m² to 2000 m²)
    if (area < 0.1 || area > 2000) continue;

    // Prefer TEXT entity inside bounding box as room name
    const bb = boundingBox(verts);
    const match = texts.find(t => isInsideBB({ x: t.x, y: t.y }, bb));
    const baseName = match?.text || layerToLabel(poly.layer) || 'Ambiente';

    nameCounts[baseName] = (nameCounts[baseName] ?? 0) + 1;
    const name = nameCounts[baseName] > 1 ? `${baseName} ${nameCounts[baseName]}` : baseName;

    rooms.push({ name, area: Math.round(area * 100) / 100, perimeter: Math.round(perimeter * 100) / 100, layer: poly.layer });
  }

  // Sort largest area first (main rooms first)
  return rooms.sort((a, b) => b.area - a.area);
}
