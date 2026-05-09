'use strict';
const fs = require('fs');
const crypto = require('crypto');
const turf = require('@turf/turf');
const { haversine, bearing, AStarRouter } = require('./router');

const path = require('path');
const FLEET_JSON = process.env.FLEET_JSON || path.join(__dirname, '..', 'fleet.json');

const HISTORY_INTERVAL = 30;  // seconds
const MAX_HISTORY = 120;
const KM_PER_LAT = 111.32;

function zoneToPolygon(zone) {
  if (!zone || !Array.isArray(zone.polygon) || zone.polygon.length < 3) return null;
  const ring = zone.polygon.map(([lat, lng]) => [lng, lat]);
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  return turf.polygon([ring]);
}

class SimulationEngine {
  constructor() {
    const data = JSON.parse(fs.readFileSync(FLEET_JSON, 'utf-8'));
    const bb = data.boundingBox || data.bounding_box || {};
    this.bbox = {
      min_lat: bb.south ?? bb.min_lat, max_lat: bb.north ?? bb.max_lat,
      min_lng: bb.west  ?? bb.min_lng, max_lng: bb.east  ?? bb.max_lng,
    };
    this.ports = {};
    for (const p of data.ports) this.ports[p.id] = p;
    this._portIds = Object.keys(this.ports);

    this.router = new AStarRouter(data.navigable_polygon, this.bbox);

    this.ships = {};
    for (const s of data.ships) {
      this.ships[s.id] = { ...s, path: [], path_index: 0, weather_penalty: false, alert_ids: [] };
    }

    this.zones = {};
    this.alerts = {};
    this.weatherZones = [];
    this.history = [];
    this._proximityWarned = new Set();
    this._geofenceInside = {};
    this._predictiveFuelAlerted = new Set();
    for (const sid of Object.keys(this.ships)) this._geofenceInside[sid] = new Set();
    this._lastHistory = 0;
    this._lastWeather = 0;
    this._lastPredictive = 0;
    this._lastRescue = 0;   // wall-clock seconds of last rescue sweep
    this._tick = 0;
    this._geofenceEmitter = null;

    // Compute initial routes
    for (const ship of Object.values(this.ships)) this._computeRoute(ship);
    console.log(`[Sim] Initialized ${Object.keys(this.ships).length} ships, ${Object.keys(this.ports).length} ports`);
  }

  setGeofenceEmitter(fn) {
    this._geofenceEmitter = fn;
  }

  _emitGeofenceBreach(payload) {
    if (typeof this._geofenceEmitter === 'function') this._geofenceEmitter(payload);
  }

  // ── Weather ──────────────────────────────────────────────────────────────
  async refreshWeather() {
    const pts = [[26.5,56.2],[25.0,57.8],[24.0,59.0],[25.5,54.5],[25.0,52.5]];
    const zones = [];
    try {
      // Use Open-Meteo API (free, no key needed)
      for (const pt of pts) {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${pt[0]}&longitude=${pt[1]}&current=weather_code,wind_speed_10m,wind_direction_10m,wave_height,precipitation,visibility&wind_speed_unit=ms&timezone=UTC`;
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) continue;
        const body = await res.json();
        const current = body.current || {};
        const windMs = current.wind_speed_10m || 0;
        const windKn = windMs * 1.94384;
        const waveM = current.wave_height || 0;
        const precip = current.precipitation || 0;
        const visibility = current.visibility || 10000;
        const weatherCode = current.weather_code || 0;

        // Adverse weather: wind >= 15 kn OR waves >= 2m OR heavy precip OR low visibility
        const isAdverse = windKn >= 15 || waveM >= 2.0 || precip >= 2.0 || visibility < 5000;
        if (isAdverse) {
          // Storm intensity based on multiple factors
          const intensity = Math.min(1.0, (windKn / 30) + (waveM / 4) + (precip / 5) + ((10000 - visibility) / 10000));
          const radiusKm = 80 + (intensity * 60);
          zones.push({
            lat: pt[0], lng: pt[1], radius_km: radiusKm,
            wind_knots: Math.round(windKn * 10) / 10,
            wave_height_m: Math.round(waveM * 10) / 10,
            precipitation_mm: Math.round(precip * 10) / 10,
            visibility_km: Math.round((visibility / 1000) * 10) / 10,
            weather_code: weatherCode,
            intensity: Math.round(intensity * 100),
            description: this._describeWeather(windKn, waveM, precip, weatherCode),
            updated_at: Date.now() / 1000,
          });
        }
      }
      // If weather is too calm everywhere, artificially lower the threshold for the windiest point
      if (zones.length === 0) {
        zones.push({
          lat: 24.5, lng: 58.5, radius_km: 120,
          wind_knots: 25, wave_height_m: 3.5, precipitation_mm: 1.5, visibility_km: 8.0,
          weather_code: 80, intensity: 60,
          description: 'Simulated storm (calm real weather)',
          updated_at: Date.now() / 1000,
        });
      }
    } catch (e) {
      console.log(`[Weather] Open-Meteo fetch failed: ${e.message}`);
      zones.push({
        lat: 24.5, lng: 58.5, radius_km: 120,
        wind_knots: 30, wave_height_m: 3.8, precipitation_mm: 2.0, visibility_km: 5.0,
        weather_code: 95, intensity: 80,
        description: 'Simulated storm (API unavailable)',
        updated_at: Date.now() / 1000,
      });
    }
    this.weatherZones = zones;
    // Reroute all active ships so they immediately go around new weather cells
    for (const ship of Object.values(this.ships)) {
      if (['arrived', 'stopped', 'stranded'].includes(ship.status)) continue;
      this._computeRoute(ship);
    }
  }

  _describeWeather(windKn, waveM, precip, code) {
    let desc = [];
    if (windKn >= 30) desc.push('severe wind');
    else if (windKn >= 20) desc.push('strong wind');
    else if (windKn >= 15) desc.push('adverse wind');
    if (waveM >= 3.5) desc.push('heavy seas');
    else if (waveM >= 2.5) desc.push('rough seas');
    else if (waveM >= 2.0) desc.push('moderate seas');
    if (precip >= 5) desc.push('heavy rain');
    else if (precip >= 2) desc.push('rain');
    // WMO Weather codes: 80-82 rain, 95-99 thunderstorm
    if (code >= 95) desc.push('thunderstorm');
    return desc.length > 0 ? desc.join(', ') : 'adverse weather';
  }
  _computeRoute(ship) {
    if (['arrived', 'stopped', 'stranded'].includes(ship.status)) return;
    const dest = this.ports[ship.destination_port];
    if (!dest) return;
    const path = this.router.findPath(ship.lat, ship.lng, dest.lat, dest.lng,
      Object.values(this.zones), this.weatherZones);
    if (!path) {
      ship.status = 'stranded';
      this._addAlert('stranded', [ship.id], `${ship.name} is stranded - no valid path`, 5);
    } else {
      ship.path = path;
      ship.path_index = 0;
      if (ship.status === 'rerouting') ship.status = 'normal';
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────
  tick() {
    const now = Date.now() / 1000;
    const dt = 1.0;

    // Refresh weather every 5 min
    if (now - this._lastWeather > 300) {
      this.refreshWeather().catch(() => {});
      this._lastWeather = now;
    }

    // ── Rescue stopped/stranded ships every 5 min ─────────────────────────
    // Prevents the fleet from draining over time as ships run out of fuel.
    if (now - this._lastRescue >= 300) {
      this._rescueStrandedShips();
      this._lastRescue = now;
    }

    this._tick++;

    for (const ship of Object.values(this.ships)) {
      // Arrived ships get respawned immediately on the next tick
      if (ship.status === 'arrived') {
        this._respawnShip(ship);
        continue;
      }
      // stopped/stranded ships are skipped until the rescue timer fires
      if (ship.status === 'stopped' || ship.status === 'stranded') continue;
      this._advance(ship, dt);
    }

    this._checkGeofence();
    this._checkProximity();
    this._escortTick();

    // Predictive alerts every 30s
    if (now - this._lastPredictive >= 30) {
      this._checkPredictive();
      this._lastPredictive = now;
    }

    // Snapshot every 30s
    if (now - this._lastHistory >= HISTORY_INTERVAL) {
      this._snapshot(now);
      this._lastHistory = now;
    }

    return this.getState();
  }

  // ── Rescue all stopped / stranded ships ───────────────────────────────────
  // Called every 5 minutes so no ship permanently leaves the simulation.
  _rescueStrandedShips() {
    let rescued = 0;
    for (const ship of Object.values(this.ships)) {
      if (ship.status !== 'stopped' && ship.status !== 'stranded') continue;
      ship.fuel   = 6000 + Math.random() * 2500; // emergency resupply
      ship.status = 'normal';
      this._computeRoute(ship);
      // If router still can't find a path, try every port until one works
      if (!ship.path.length) {
        for (const pid of this._portIds) {
          if (pid === ship.destination_port) continue;
          ship.destination_port = pid;
          this._computeRoute(ship);
          if (ship.path.length) break;
        }
      }
      if (ship.path.length) {
        rescued++;
        console.log(`[Sim] Rescued ${ship.name} → ${ship.destination_port}`);
      } else {
        // Complete fallback: teleport to nearest port and restart
        const port = Object.values(this.ports)[0];
        ship.lat = port.lat;
        ship.lng = port.lng;
        ship.destination_port = this._portIds[Math.floor(Math.random() * this._portIds.length)];
        this._computeRoute(ship);
        rescued++;
        console.log(`[Sim] Teleport-rescued ${ship.name} → ${ship.destination_port}`);
      }
    }
    if (rescued) console.log(`[Sim] Rescue sweep: ${rescued} ship(s) returned to service`);
  }

  // ── Respawn ship with new destination after arrival ───────────────────────
  _respawnShip(ship) {
    ship.fuel       = 5000 + Math.random() * 3500; // refuel 5000-8500t
    ship.path       = [];
    ship.path_index = 0;

    // Try up to 3 random destinations until a valid route is found
    const candidates = this._portIds
      .filter(pid => pid !== ship.destination_port)
      .sort(() => Math.random() - 0.5);

    for (const pid of candidates.slice(0, 3)) {
      ship.destination_port = pid;
      ship.status = 'normal';
      this._computeRoute(ship);
      if (ship.path.length) {
        console.log(`[Sim] ${ship.name} respawned → ${pid}`);
        return;
      }
    }

    // All attempts failed — hold at current position until next rescue sweep
    ship.status = 'stopped';
    console.warn(`[Sim] ${ship.name} could not find route after arrival — awaiting rescue`);
  }

  // ── Predictive alerts ────────────────────────────────────────────────────
  _checkPredictive() {
    for (const ship of Object.values(this.ships)) {
      if (['arrived','stopped','stranded','distressed'].includes(ship.status)) continue;
      const dest = ship.destination_port ? this.ports[ship.destination_port] : null;
      if (!dest) continue;
      const distLeft = haversine(ship.lat, ship.lng, dest.lat, dest.lng);
      const speedKmSec = (ship.speed * 1.852) / 3600;
      const etaSec = speedKmSec > 0 ? distLeft / speedKmSec : null;

      // Fuel predictive: will run out in < 20 min
      const fuelKmRemaining = ship.fuel / 0.5;
      const fuelRunwaySec = speedKmSec > 0 ? fuelKmRemaining / speedKmSec : null;
      const alertKey = `fuel-${ship.id}`;
      if (fuelRunwaySec && fuelRunwaySec < 1200 && !this._predictiveFuelAlerted.has(alertKey)) {
        const minLeft = Math.round(fuelRunwaySec / 60);
        this._addAlert('predictive', [ship.id],
          `⚡ PREDICTIVE: ${ship.name} will run out of fuel in ~${minLeft} min (${Math.round(fuelKmRemaining)} km runway)`, 4);
        this._predictiveFuelAlerted.add(alertKey);
      } else if (fuelRunwaySec && fuelRunwaySec >= 1800) {
        this._predictiveFuelAlerted.delete(alertKey); // reset once safe
      }

      // Zone entry predictive: ship heading toward a zone, ETA < 3 min
      for (const zone of Object.values(this.zones)) {
        if (!zone.active) continue;
        try {
          const poly = zoneToPolygon(zone);
          if (!poly) continue;
          // Project ship position forward 3 min
          const projLat = ship.lat + (speedKmSec * 180 * Math.cos(rad(ship.heading))) / KM_PER_LAT;
          const projLng = ship.lng + (speedKmSec * 180 * Math.sin(rad(ship.heading))) / (KM_PER_LAT * Math.cos(rad(ship.lat)));
          const projPoint = turf.point([projLng, projLat]);
          const nowPoint  = turf.point([ship.lng, ship.lat]);
          if (turf.booleanPointInPolygon(projPoint, poly) && !turf.booleanPointInPolygon(nowPoint, poly)) {
            const zoneAlertKey = `zone-pred-${ship.id}-${zone.id}`;
            if (!this._predictiveFuelAlerted.has(zoneAlertKey)) {
              this._addAlert('predictive', [ship.id],
                `⚡ PREDICTIVE: ${ship.name} will enter restricted zone '${zone.name}' in ~3 min`, 4);
              this._predictiveFuelAlerted.add(zoneAlertKey);
            }
          }
        } catch(_) {}
      }
    }
  }

  _advance(ship, dt) {
    if (ship.fuel <= 0) { ship.status = 'stopped'; ship.fuel = 0; return; }

    const inWeather = this.weatherZones.some(wz =>
      haversine(ship.lat, ship.lng, wz.lat, wz.lng) < wz.radius_km
    );
    ship.weather_penalty = inWeather;
    const burn = 0.5 * dt * (inWeather ? 1.3 : 1.0);
    ship.fuel = Math.max(0, ship.fuel - burn);

    // Fuel sufficiency check
    const dest = this.ports[ship.destination_port];
    if (dest) {
      const distLeft = haversine(ship.lat, ship.lng, dest.lat, dest.lng);
      const fuelNeeded = distLeft * 0.4;
      if (fuelNeeded > ship.fuel && ship.status === 'normal') ship.status = 'insufficient_fuel';
    }

    if (!ship.path.length || ship.path_index >= ship.path.length) {
      this._computeRoute(ship);
      return;
    }

    const target = ship.path[ship.path_index];
    const tlat = target[0], tlng = target[1];
    const dist = haversine(ship.lat, ship.lng, tlat, tlng);
    const stepKm = (ship.speed * 1.852 / 3600.0) * dt;

    if (stepKm >= dist) {
      ship.lat = tlat;
      ship.lng = tlng;
      ship.path_index++;
      if (ship.path_index >= ship.path.length) {
        if (dest && haversine(ship.lat, ship.lng, dest.lat, dest.lng) < 10.0) {
          ship.status = 'arrived';
          // Clear predictive alert cache for this ship
          this._predictiveFuelAlerted.delete(`fuel-${ship.id}`);
        } else {
          this._computeRoute(ship);
        }
      }
    } else {
      const brg = bearing(ship.lat, ship.lng, tlat, tlng);
      ship.heading = brg;
      const latStep = stepKm / KM_PER_LAT;
      const lngStep = stepKm / (KM_PER_LAT * Math.cos(rad(ship.lat)));
      ship.lat += latStep * Math.cos(rad(brg));
      ship.lng += lngStep * Math.sin(rad(brg));
    }
  }

  _checkGeofence() {
    for (const [sid, ship] of Object.entries(this.ships)) {
      if (['arrived', 'stopped', 'stranded'].includes(ship.status)) continue;
      const insideNow = new Set();
      const shipPoint = turf.point([ship.lng, ship.lat]);
      for (const [zid, zone] of Object.entries(this.zones)) {
        if (zone.active === false) continue;
        try {
          const poly = zoneToPolygon(zone);
          if (poly && turf.booleanPointInPolygon(shipPoint, poly)) insideNow.add(zid);
        } catch (_) {}
      }

      const prev = this._geofenceInside[sid] || new Set();
      for (const zid of insideNow) {
        if (!prev.has(zid)) {
          const zone = this.zones[zid];
          ship.status = 'rerouting';
          const alert = this._addAlert('geofence', [sid], `${ship.name} entered restricted zone '${zone.name}'`, 4, zid);
          this._emitGeofenceBreach({
            alert,
            ship_id: ship.id,
            ship_name: ship.name,
            zone_id: zone.id,
            zone_name: zone.name,
            timestamp: Date.now() / 1000,
          });
          this._computeRoute(ship);
        }
      }
      this._geofenceInside[sid] = insideNow;

      // Check if current path intersects any zone
      if (ship.path.length && this.router.intersectsAnyZone(
        ship.path.slice(ship.path_index), Object.values(this.zones))) {
        if (!['rerouting', 'distressed', 'stopped'].includes(ship.status)) {
          ship.status = 'rerouting';
          this._computeRoute(ship);
        }
      }
    }
  }

  _checkProximity() {
    const active = Object.values(this.ships).filter(s =>
      !['arrived', 'stopped', 'stranded'].includes(s.status)
    );
    const warnedThisTick = new Set();
    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const s1 = active[i], s2 = active[j];
        const dist = haversine(s1.lat, s1.lng, s2.lat, s2.lng);
        const pairKey = [s1.id, s2.id].sort().join('|');
        if (dist < 2.0) {
          warnedThisTick.add(pairKey);
          if (!this._proximityWarned.has(pairKey)) {
            this._addAlert('proximity', [s1.id, s2.id],
              `Proximity warning: ${s1.name} and ${s2.name} ${dist.toFixed(2)}km apart`, 3);
            this._proximityWarned.add(pairKey);
          }
        } else {
          this._proximityWarned.delete(pairKey);
        }
      }
    }
  }

  _addAlert(type, shipIds, message, severity, zoneId = null) {
    const alert = {
      id: crypto.randomUUID(), type, ship_ids: shipIds, message, severity,
      zone_id: zoneId, acknowledged: false, created_at: Date.now() / 1000,
    };
    this.alerts[alert.id] = alert;
    return alert;
  }

  _snapshot(ts) {
    const ships = Object.values(this.ships).map(s => ({ ...s }));
    this.history.push({ timestamp: ts, ships });
    if (this.history.length > MAX_HISTORY) this.history.shift();
  }

  // ── Zone management ────────────────────────────────────────────────────
  addZone(zone) {
    this.zones[zone.id] = zone;
    for (const ship of Object.values(this.ships)) {
      try {
        const poly = zoneToPolygon(zone);
        const shipPoint = turf.point([ship.lng, ship.lat]);
        if (poly && turf.booleanPointInPolygon(shipPoint, poly)) {
          const alert = this._addAlert('geofence', [ship.id],
            `${ship.name} already inside zone '${zone.name}'`, 5, zone.id);
          this._emitGeofenceBreach({
            alert,
            ship_id: ship.id,
            ship_name: ship.name,
            zone_id: zone.id,
            zone_name: zone.name,
            timestamp: Date.now() / 1000,
          });
          ship.status = 'rerouting';
          this._computeRoute(ship);
        } else if (ship.path.length && this.router.intersectsAnyZone(
          ship.path.slice(ship.path_index), [zone])) {
          ship.status = 'rerouting';
          this._computeRoute(ship);
        }
      } catch (_) {}
    }
  }

  removeZone(zoneId) {
    delete this.zones[zoneId];
    // Clear stale predictive keys for the deleted zone so they can re-fire
    // if the same area is re-zoned later (and to prevent Set growth).
    for (const key of [...this._predictiveFuelAlerted]) {
      if (key.includes(`-${zoneId}`)) this._predictiveFuelAlerted.delete(key);
    }
    for (const ship of Object.values(this.ships)) {
      if (ship.status === 'rerouting') this._computeRoute(ship);
    }
  }

  // ── Constants ──────────────────────────────────────────────────────────
  static FUEL_RESERVE_MIN  = 1000;  // Donor must keep at least this much fuel
  static FUEL_CAPACITY_MAX = 8500;  // Max fuel a ship can hold
  static FUEL_TRANSFER_MAX_DIST_KM = 50; // Ships must be within this range
  static FUEL_TRANSFER_MIN_AMOUNT  = 50; // Minimum meaningful transfer

  // ── Directives ─────────────────────────────────────────────────────────
  applyDirective(shipId, dtype, payload) {
    const ship = this.ships[shipId];
    if (!ship) return { ok: false, error: `Ship ${shipId} not found` };

    if (dtype === 'REROUTE_PORT') {
      const newPort = payload.port_id;
      if (!newPort || !this.ports[newPort]) {
        return { ok: false, error: `Port '${newPort}' not found` };
      }
      ship.destination_port = newPort;
      ship.status = 'rerouting';
      this._computeRoute(ship);
    } else if (dtype === 'SET_ROUTE_PATH') {
      const { path } = payload;
      if (Array.isArray(path) && path.length > 0) {
        ship.path = path;
        ship.path_index = 0;
        ship.status = 'normal';
        return { ok: true };
      }
      return { ok: false, error: 'Invalid or empty path provided' };

    } else if (dtype === 'HOLD_POSITION') {
      ship.status = 'stopped';
      ship.path = [];
      return { ok: true };

    } else if (dtype === 'DIVERT_WAYPOINT') {
      const { lat, lng } = payload;
      if (lat && lng) {
        ship.path = [[lat, lng], ...ship.path.slice(ship.path_index)];
        ship.path_index = 0;
      }
      return { ok: true };

    } else if (dtype === 'FUEL_TRANSFER') {
      return this._handleFuelTransfer(ship, shipId, payload);

    } else if (dtype === 'ESCORT') {
      // payload: { target_ship_id }
      const target = this.ships[payload.target_ship_id];
      if (!target) return { ok: false, error: `Target ship ${payload.target_ship_id} not found` };
      if (ship.id === payload.target_ship_id) return { ok: false, error: 'Cannot escort yourself' };
      if (['arrived', 'stranded', 'stopped'].includes(target.status)) {
        return { ok: false, error: `${target.name} is ${target.status} — cannot escort` };
      }
      ship._escorting = payload.target_ship_id;
      ship.status = 'rerouting';
      this._addAlert('directive', [shipId, payload.target_ship_id],
        `${ship.name} is now escorting ${target.name}`, 2);
      return { ok: true };

    } else if (dtype === 'CANCEL_ESCORT') {
      delete ship._escorting;
      ship.status = 'normal';
      this._computeRoute(ship);
      return { ok: true };

    } else if (dtype === 'MEDICAL_AID') {
      // payload: { target_ship_id }
      const target = this.ships[payload.target_ship_id];
      if (!target) return { ok: false, error: `Target ship ${payload.target_ship_id} not found` };
      if (ship.id === payload.target_ship_id) return { ok: false, error: 'Cannot send medical aid to yourself' };
      ship.path = [[target.lat, target.lng], ...ship.path.slice(ship.path_index)];
      ship.path_index = 0;
      ship.status = 'rerouting';
      ship._aiding = payload.target_ship_id;
      this._addAlert('directive', [shipId, payload.target_ship_id],
        `${ship.name} dispatched for medical aid to ${target.name}`, 3);
      return { ok: true };
    }
    return { ok: false, error: `Unknown directive type: ${dtype}` };
  }

  // ── Fuel Transfer Logic (with full validation) ──────────────────────────
  _handleFuelTransfer(donorShip, donorId, payload) {
    const { target_ship_id, amount_tonnes } = payload;
    const RESERVE   = SimulationEngine.FUEL_RESERVE_MIN;
    const CAPACITY  = SimulationEngine.FUEL_CAPACITY_MAX;
    const MAX_DIST  = SimulationEngine.FUEL_TRANSFER_MAX_DIST_KM;
    const MIN_AMT   = SimulationEngine.FUEL_TRANSFER_MIN_AMOUNT;

    // --- Validate target exists ---
    const target = this.ships[target_ship_id];
    if (!target) return { ok: false, error: `Target ship '${target_ship_id}' not found` };

    // --- Can't transfer to yourself ---
    if (donorId === target_ship_id) {
      return { ok: false, error: 'Cannot transfer fuel to yourself' };
    }

    // --- Distance check ---
    const dist = haversine(donorShip.lat, donorShip.lng, target.lat, target.lng);
    if (dist > MAX_DIST) {
      const msg = `Fuel transfer rejected: ${donorShip.name} is ${dist.toFixed(0)} km from ${target.name} (max ${MAX_DIST} km)`;
      this._addAlert('directive', [donorId], msg, 2);
      return { ok: false, error: msg };
    }

    // --- Requested amount validation ---
    const requested = amount_tonnes || 0;
    if (requested <= 0) {
      return { ok: false, error: 'Transfer amount must be greater than 0' };
    }
    if (requested < MIN_AMT) {
      return { ok: false, error: `Minimum transfer amount is ${MIN_AMT}t` };
    }

    // --- Donor has enough fuel (must keep RESERVE minimum) ---
    const donorAvailable = donorShip.fuel - RESERVE;
    if (donorAvailable <= 0) {
      const msg = `Fuel transfer rejected: ${donorShip.name} only has ${Math.round(donorShip.fuel)}t — must keep ${RESERVE}t reserve`;
      this._addAlert('directive', [donorId], msg, 3);
      return { ok: false, error: msg };
    }

    // --- Target capacity check ---
    const targetRoom = CAPACITY - target.fuel;
    if (targetRoom <= 0) {
      const msg = `Fuel transfer rejected: ${target.name} is already at max capacity (${CAPACITY}t)`;
      this._addAlert('directive', [donorId, target_ship_id], msg, 2);
      return { ok: false, error: msg };
    }

    // --- Clamp to actual transferable amount ---
    const actualAmount = Math.min(requested, donorAvailable, targetRoom);
    if (actualAmount < MIN_AMT) {
      const msg = `Fuel transfer rejected: only ${Math.round(actualAmount)}t could be transferred (below ${MIN_AMT}t minimum)`;
      this._addAlert('directive', [donorId], msg, 2);
      return { ok: false, error: msg };
    }

    // --- Execute the transfer ---
    const donorFuelBefore  = donorShip.fuel;
    const targetFuelBefore = target.fuel;

    donorShip.fuel -= actualAmount;
    target.fuel    += actualAmount;

    // Revive stopped/stranded targets if they now have usable fuel
    if (['stopped', 'stranded', 'insufficient_fuel'].includes(target.status) && target.fuel > RESERVE) {
      target.status = 'normal';
      this._computeRoute(target);
    }

    // Check if donor is now low on fuel
    if (donorShip.fuel < RESERVE * 1.5 && donorShip.status === 'normal') {
      donorShip.status = 'insufficient_fuel';
    }

    const wasReduced = actualAmount < requested;
    const alertMsg = wasReduced
      ? `${donorShip.name} transferred ${Math.round(actualAmount)}t fuel to ${target.name} (requested ${Math.round(requested)}t, clamped)`
      : `${donorShip.name} transferred ${Math.round(actualAmount)}t fuel to ${target.name}`;

    this._addAlert('directive', [donorId, target_ship_id], alertMsg, 2);

    console.log(`[Fuel] ${donorShip.name} (${Math.round(donorFuelBefore)}→${Math.round(donorShip.fuel)}t) → ${target.name} (${Math.round(targetFuelBefore)}→${Math.round(target.fuel)}t) | ${Math.round(actualAmount)}t transferred`);

    return {
      ok: true,
      actual_amount: Math.round(actualAmount),
      requested_amount: Math.round(requested),
      was_clamped: wasReduced,
      donor_fuel_after: Math.round(donorShip.fuel),
      target_fuel_after: Math.round(target.fuel),
    };
  }

  _escortTick() {
    for (const ship of Object.values(this.ships)) {
      if (!ship._escorting) continue;
      const target = this.ships[ship._escorting];
      if (!target || ['arrived', 'stopped', 'stranded'].includes(target.status)) {
        delete ship._escorting;
        ship.status = 'normal';
        this._computeRoute(ship);
        continue;
      }
      // Stay 3 km behind target
      const backBrg  = (target.heading + 180) % 360;
      const escortLat = target.lat + (3 / KM_PER_LAT) * Math.cos(rad(backBrg));
      const escortLng = target.lng + (3 / (KM_PER_LAT * Math.cos(rad(target.lat)))) * Math.sin(rad(backBrg));
      if (haversine(ship.lat, ship.lng, escortLat, escortLng) > 5) {
        ship.path = [[escortLat, escortLng]];
        ship.path_index = 0;
      }
    }
  }

  getState() {
    const activeAlerts = Object.values(this.alerts).filter(a => !a.acknowledged);

    // Enrich each ship with route path tail and predictive data for the frontend
    const ships = Object.values(this.ships).map(ship => {
      // Remaining waypoints from current path index (for drawing route line)
      const remainingPath = (ship.path || []).slice(ship.path_index || 0);

      // Fuel runway: how far can we go on current fuel at 0.5t/km equivalent
      const dest = ship.destination_port ? this.ports[ship.destination_port] : null;
      const distToDest = dest ? haversine(ship.lat, ship.lng, dest.lat, dest.lng) : null;
      const fuelKmRemaining = ship.fuel / 0.5;   // rough: 0.5t per km
      const canReach = distToDest !== null ? fuelKmRemaining >= distToDest : true;
      // ETA in seconds at current speed (1 knot = 1.852 km/h)
      const speedKmPerSec = (ship.speed * 1.852) / 3600;
      const etaSec = distToDest && speedKmPerSec > 0 ? distToDest / speedKmPerSec : null;

      return {
        ...ship,
        route_path: remainingPath,   // [[lat,lng], ...] for map polyline
        fuel_runway_km: Math.round(fuelKmRemaining),
        can_reach_dest: canReach,
        dist_to_dest_km: distToDest !== null ? Math.round(distToDest) : null,
        eta_seconds: etaSec !== null ? Math.round(etaSec) : null,
      };
    });

    return {
      type: 'fleet_update',
      timestamp: Date.now() / 1000,
      tick: this._tick,
      ships,
      zones: Object.values(this.zones),
      alerts: activeAlerts,
      weather_zones: this.weatherZones,
    };
  }
}

function rad(d) { return d * Math.PI / 180; }

module.exports = { SimulationEngine };
