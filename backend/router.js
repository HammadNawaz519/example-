'use strict';

// ── Geo helpers ──────────────────────────────────────────────────────────────

function rad(d) { return d * Math.PI / 180; }
function deg(r) { return r * 180 / Math.PI; }

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371.0;
  const p1 = rad(lat1), p2 = rad(lat2);
  const dp = rad(lat2 - lat1), dl = rad(lng2 - lng1);
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearing(lat1, lng1, lat2, lng2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lng2 - lng1);
  const x = Math.sin(dl) * Math.cos(p2);
  const y = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(x, y)) + 360) % 360;
}

// Ray-casting point-in-polygon.  polygon = [[lng, lat], ...]
function pointInPoly(lng, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi))
      inside = !inside;
  }
  return inside;
}

// Segment-segment intersection test
function segsHit(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  const d = (ax2 - ax1) * (by2 - by1) - (ay2 - ay1) * (bx2 - bx1);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((bx1 - ax1) * (by2 - by1) - (by1 - ay1) * (bx2 - bx1)) / d;
  const u = ((bx1 - ax1) * (ay2 - ay1) - (by1 - ay1) * (ax2 - ax1)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

// ── A* grid router ──────────────────────────────────────────────────────────

const RES = 120;
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

// Cost multiplier for a cell that sits inside a weather zone.
// 8.0 means any detour shorter than 8 grid-cells is preferred over cutting
// straight through the storm — ships will go visibly around weather.
const WEATHER_COST = 8.0;

class AStarRouter {
  constructor(navCoords, bbox) {
    this.bbox = { min_lat: bbox.south || bbox.min_lat, max_lat: bbox.north || bbox.max_lat,
                  min_lng: bbox.west  || bbox.min_lng, max_lng: bbox.east  || bbox.max_lng };
    // navCoords are [lat, lng] from fleet.json → store as [lng, lat] for geometry
    this.navPoly = navCoords.map(c => [c[1], c[0]]);
    this.base = new Set();
    this._buildBase();
  }

  _key(r, c) { return r * 256 + c; }   // fast integer key (RES < 256)

  _toLatLng(r, c) {
    const bb = this.bbox;
    return [ bb.min_lat + (r / RES) * (bb.max_lat - bb.min_lat),
             bb.min_lng + (c / RES) * (bb.max_lng - bb.min_lng) ];
  }

  _toCell(lat, lng) {
    const bb = this.bbox;
    let r = Math.floor((lat - bb.min_lat) / (bb.max_lat - bb.min_lat) * RES);
    let c = Math.floor((lng - bb.min_lng) / (bb.max_lng - bb.min_lng) * RES);
    return [Math.max(0, Math.min(RES - 1, r)), Math.max(0, Math.min(RES - 1, c))];
  }

  _buildBase() {
    for (let r = 0; r < RES; r++)
      for (let c = 0; c < RES; c++) {
        const [lat, lng] = this._toLatLng(r, c);
        if (pointInPoly(lng, lat, this.navPoly)) this.base.add(this._key(r, c));
      }
    console.log(`[Router] Grid built: ${this.base.size} passable cells out of ${RES * RES}`);
  }

  _snap(passable, r, c) {
    if (passable.has(this._key(r, c))) return [r, c];
    for (let d = 1; d < 15; d++)
      for (let dr = -d; dr <= d; dr++)
        for (let dc = -d; dc <= d; dc++) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < RES && nc >= 0 && nc < RES && passable.has(this._key(nr, nc)))
            return [nr, nc];
        }
    return null;
  }

  findPath(slat, slng, elat, elng, zones, weatherZones) {
    // ── Build zone polygons [lng,lat] ─────────────────────────────────────────
    const zPolys = [];
    for (const z of zones) {
      if (z.active === false) continue;
      try { zPolys.push(z.polygon.map(p => [p[1], p[0]])); } catch (_) {}
    }

    // ── Classify every navigable cell ─────────────────────────────────────────
    // zoneBlocked  → removed from passable entirely (hard wall)
    // weatherCells → set of keys inside a weather zone
    const weatherCells = new Set();
    const passableAll  = new Set();   // navigable minus restricted zones
    for (const key of this.base) {
      const r = Math.floor(key / 256), c = key % 256;
      const [lat, lng] = this._toLatLng(r, c);
      let zoneBlocked = false;
      for (const poly of zPolys) {
        if (pointInPoly(lng, lat, poly)) { zoneBlocked = true; break; }
      }
      if (zoneBlocked) continue;
      passableAll.add(key);
      for (const wz of weatherZones) {
        if (haversine(lat, lng, wz.lat, wz.lng) < (wz.radius_km || 80)) {
          weatherCells.add(key);
          break;
        }
      }
    }

    // ── Pass 1: hard-block weather cells (true avoidance) ────────────────────
    const passableClean = new Set();
    for (const key of passableAll) {
      if (!weatherCells.has(key)) passableClean.add(key);
    }

    const path1 = this._astar(passableClean, slat, slng, elat, elng);
    if (path1) return path1;

    // ── Pass 2: weather impassable for this route → cost-weighted fallback ────
    // Weather cells re-enter the passable set but carry a heavy multiplier so
    // A* still takes the least-weather path available.
    console.log('[Router] No weather-clear path; falling back to cost-weighted routing');
    const path2 = this._astar(passableAll, slat, slng, elat, elng, weatherCells);
    if (path2) return path2;

    // ── Pass 3: completely ignore weather (emergency / ship stranded) ─────────
    console.log('[Router] Cost-weighted also failed; routing without weather constraint');
    return this._astar(passableAll, slat, slng, elat, elng);
  }

  // Internal A* worker.
  // passable   – Set of integer cell keys to treat as navigable
  // softCells  – optional Set of keys with cost penalty
  // costMult   – penalty multiplier for softCells (default WEATHER_COST)
  _astar(passable, slat, slng, elat, elng, softCells = null, costMult = WEATHER_COST) {
    const start = this._snap(passable, ...this._toCell(slat, slng));
    const goal  = this._snap(passable, ...this._toCell(elat, elng));
    if (!start || !goal) return null;

    const sKey = this._key(...start);
    const gKey = this._key(...goal);
    const [gLat, gLng] = this._toLatLng(...goal);

    const g    = new Map([[sKey, 0]]);
    const from = new Map();
    const open = [[0, start, sKey]];

    while (open.length) {
      // min-heap pop by linear scan (small enough for our grid sizes)
      let mi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[mi][0]) mi = i;
      const [, cur, ck] = open.splice(mi, 1)[0];

      if (ck === gKey) {
        const path = [];
        let n = cur, nk = ck;
        while (from.has(nk)) {
          path.push(n);
          const prev = from.get(nk);
          n = prev; nk = this._key(...n);
        }
        path.push(start);
        path.reverse();
        
        // Remove the 3-node skip simplification to strictly follow passable water cells
        return path.map(cell => this._toLatLng(...cell));
      }

      const [r, c] = cur;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= RES || nc < 0 || nc >= RES) continue;
        const nk = this._key(nr, nc);
        if (!passable.has(nk)) continue;

        const mult     = (softCells && softCells.has(nk)) ? costMult : 1.0;
        const edgeCost = Math.hypot(dr, dc) * mult;
        const ng = (g.get(ck) ?? Infinity) + edgeCost;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          from.set(nk, cur);
          const [la, lna] = this._toLatLng(nr, nc);
          // Inflate heuristic if this cell is in a soft/weather area so A*
          // steers clear of weather even when estimating remaining distance.
          const hMult = (softCells && softCells.has(nk)) ? costMult : 1.0;
          const h = haversine(la, lna, gLat, gLng) * hMult;
          open.push([ng + h, [nr, nc], nk]);
        }
      }
    }
    return null;
  }

  // ── Multiple candidate routes ──────────────────────────────────────────────────────
  // Returns up to 3 candidate paths with different cost trade-offs.
  // Each entry: { label, description, path [[lat,lng]...], distKm, weatherCells }
  findMultiplePaths(slat, slng, elat, elng, zones, weatherZones) {
    // ── Shared zone classification (same as findPath) ─────────────────────
    const zPolys = [];
    for (const z of zones) {
      if (z.active === false) continue;
      try { zPolys.push(z.polygon.map(p => [p[1], p[0]])); } catch (_) {}
    }

    const weatherCells = new Set();
    const passableAll  = new Set();
    for (const key of this.base) {
      const r = Math.floor(key / 256), c = key % 256;
      const [lat, lng] = this._toLatLng(r, c);
      let zb = false;
      for (const poly of zPolys) { if (pointInPoly(lng, lat, poly)) { zb = true; break; } }
      if (zb) continue;
      passableAll.add(key);
      for (const wz of weatherZones) {
        if (haversine(lat, lng, wz.lat, wz.lng) < (wz.radius_km || 80)) { weatherCells.add(key); break; }
      }
    }

    // passable without weather
    const passableClean = new Set();
    for (const k of passableAll) { if (!weatherCells.has(k)) passableClean.add(k); }

    // Helper: path length in km
    const pathKm = (path) => {
      let d = 0;
      for (let i = 1; i < path.length; i++) d += haversine(path[i-1][0], path[i-1][1], path[i][0], path[i][1]);
      return Math.round(d);
    };

    // Helper: count weather cells on path
    const weatherExposure = (path) => {
      let count = 0;
      for (const [lat, lng] of path) {
        const [r, c] = this._toCell(lat, lng);
        if (weatherCells.has(this._key(r, c))) count++;
      }
      return count;
    };

    const results = [];

    // ── Option 1: SAFE — hard-block weather (prioritises crew safety) ─────
    const safePath = this._astar(passableClean.size ? passableClean : passableAll, slat, slng, elat, elng)
                  ?? this._astar(passableAll, slat, slng, elat, elng, weatherCells);
    if (safePath) {
      results.push({
        id: 'safe', label: 'Safe', description: 'Avoids weather zones — slower but safest for crew',
        path: safePath, distKm: pathKm(safePath), weatherCells: weatherExposure(safePath), color: '#2e7d6e',
      });
    }

    // ── Option 2: FAST — ignore weather, pure shortest path ──────────────
    const fastPath = this._astar(passableAll, slat, slng, elat, elng);
    if (fastPath) {
      const fastKm = pathKm(fastPath);
      // Only add if meaningfully different from safe path (> 5 km shorter)
      const safeKm = results[0]?.distKm ?? Infinity;
      if (!results.length || safeKm - fastKm > 5) {
        results.push({
          id: 'fast', label: 'Fast', description: 'Shortest path — may pass through adverse weather',
          path: fastPath, distKm: fastKm, weatherCells: weatherExposure(fastPath), color: '#c07c2b',
        });
      }
    }

    // ── Option 3: ECO — moderate weather penalty (balance fuel & time) ────
    // Use WEATHER_COST / 2 so it takes longer detours than Fast but won't
    // go as far around as Safe.
    const ECO_COST = WEATHER_COST / 2;
    const ecoPath  = this._astar(passableAll, slat, slng, elat, elng, weatherCells, ECO_COST);
    if (ecoPath) {
      const ecoKm = pathKm(ecoPath);
      const existing = results.map(r => r.distKm);
      // Add only if it's a distinct path (distance differs by > 5 km from others)
      if (existing.every(d => Math.abs(d - ecoKm) > 5)) {
        results.push({
          id: 'eco', label: 'Eco', description: 'Balanced route — partial weather avoidance, fuel-efficient',
          path: ecoPath, distKm: ecoKm, weatherCells: weatherExposure(ecoPath), color: '#1a6b95',
        });
      }
    }

    return results.length ? results : null;
  }

  intersectsAnyZone(path, zones) {
    if (!path || path.length < 2) return false;
    const line = path.map(p => [p[1], p[0]]);  // [lat,lng] → [lng,lat]
    for (const z of zones) {
      if (z.active === false) continue;
      let poly;
      try { poly = z.polygon.map(p => [p[1], p[0]]); } catch (_) { continue; }
      // Point-in-poly check for line vertices
      for (const pt of line) if (pointInPoly(pt[0], pt[1], poly)) return true;
      // Segment-edge intersection
      for (let i = 0; i < line.length - 1; i++)
        for (let j = 0, k = poly.length - 1; j < poly.length; k = j++)
          if (segsHit(line[i][0], line[i][1], line[i + 1][0], line[i + 1][1],
                      poly[j][0], poly[j][1], poly[k][0], poly[k][1])) return true;
    }
    return false;
  }
}

module.exports = { haversine, bearing, pointInPoly, AStarRouter };
