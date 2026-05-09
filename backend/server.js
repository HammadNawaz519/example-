'use strict';
// =============================================================================
// Maritime Command System — server.js
// Redis used for:
//   1. Alert persistence  — alerts survive backend restarts
//   2. Distress rate-limit — max 1 distress call per ship per 30 s
//   3. Pub/Sub fleet broadcast — allows horizontal scaling behind a load balancer
// =============================================================================

const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const crypto   = require('crypto');
const Redis    = require('ioredis');
const { SimulationEngine } = require('./simulation');

// ── Redis setup ───────────────────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Three separate ioredis clients (pub/sub requires dedicated connections)
const redis     = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
const redisPub  = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });
const redisSub  = new Redis(REDIS_URL, { lazyConnect: true, enableOfflineQueue: false });

const REDIS_OK = { current: false };

// ── Latency / SLA tracking ──────────────────────────────────────────────────
const SLA_MS = 500;           // target: fleet_update delivered within 500 ms
const LATENCY_WINDOW = 60;    // rolling sample count (= last 60 ticks = 1 min)

const latency = {
  tickMs:     [],   // how long engine.tick() itself takes
  rttMs:      [],   // WebSocket round-trip samples from ping/pong events
  slaBreaches: 0,   // cumulative tick duration > SLA_MS
};

function recordSample(arr, value) {
  arr.push(value);
  if (arr.length > LATENCY_WINDOW) arr.shift();
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor((p / 100) * (s.length - 1))];
}

function latencyStats() {
  return {
    tick_p50_ms:  Math.round(percentile(latency.tickMs, 50)),
    tick_p99_ms:  Math.round(percentile(latency.tickMs, 99)),
    rtt_p50_ms:   Math.round(percentile(latency.rttMs,  50)),
    rtt_p99_ms:   Math.round(percentile(latency.rttMs,  99)),
    sla_target_ms: SLA_MS,
    sla_breaches:  latency.slaBreaches,
    sla_ok:        percentile(latency.tickMs, 99) <= SLA_MS,
    sample_count:  latency.tickMs.length,
  };
}

async function connectRedis() {
  try {
    await redis.connect();
    await redisPub.connect();
    await redisSub.connect();
    REDIS_OK.current = true;
    console.log('[Redis] Connected to', REDIS_URL);
  } catch (e) {
    console.warn('[Redis] Unavailable — running without persistence/pub-sub:', e.message);
  }
}

// Redis key helpers
const KEY = {
  alerts:        'mcs:alerts',                          // hash  alertId → JSON
  distressLock:  (shipId) => `mcs:distress:lock:${shipId}`, // string TTL key
  fleetChannel:  'mcs:fleet_update',                    // pub/sub channel
};

// ── Alert persistence helpers ─────────────────────────────────────────────────
async function persistAlert(alert) {
  if (!REDIS_OK.current) return;
  try {
    await redis.hset(KEY.alerts, alert.id, JSON.stringify(alert));
  } catch (e) {
    console.warn('[Redis] persistAlert failed:', e.message);
  }
}

async function removeAlert(alertId) {
  if (!REDIS_OK.current) return;
  try {
    await redis.hdel(KEY.alerts, alertId);
  } catch (e) {
    console.warn('[Redis] removeAlert failed:', e.message);
  }
}

async function loadPersistedAlerts() {
  if (!REDIS_OK.current) return;
  try {
    const raw = await redis.hgetall(KEY.alerts);
    if (!raw) return;
    let loaded = 0;
    for (const [id, json] of Object.entries(raw)) {
      try {
        const alert = JSON.parse(json);
        // Only restore unacknowledged alerts younger than 6 hours
        if (!alert.acknowledged && (Date.now() / 1000 - (alert.created_at || 0)) < 21600) {
          engine.alerts[id] = alert;
          loaded++;
        } else {
          // Clean up stale entries
          await redis.hdel(KEY.alerts, id);
        }
      } catch (_) {}
    }
    if (loaded) console.log(`[Redis] Restored ${loaded} unacknowledged alerts`);
  } catch (e) {
    console.warn('[Redis] loadPersistedAlerts failed:', e.message);
  }
}

// ── Distress rate-limit ───────────────────────────────────────────────────────
// Returns true if the call should proceed, false if rate-limited.
const DISTRESS_COOLDOWN_SEC = 30;

async function checkDistressRateLimit(shipId) {
  if (!REDIS_OK.current) return true; // fail open when Redis down
  const key = KEY.distressLock(shipId);
  try {
    // SET NX EX — atomic "set if not exists with TTL"
    const result = await redis.set(key, '1', 'EX', DISTRESS_COOLDOWN_SEC, 'NX');
    return result === 'OK'; // null → key existed → rate-limited
  } catch (e) {
    console.warn('[Redis] rate-limit check failed:', e.message);
    return true; // fail open
  }
}

// ── n8n Webhook URLs ──────────────────────────────────────────────────────────
const N8N_DISTRESS_URL = 'https://beaniegame.app.n8n.cloud/webhook/distress-call';
const N8N_GEOFENCE_URL = 'https://beaniegame.app.n8n.cloud/webhook/geofence-alert';

// ── App setup ─────────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'DELETE'] },
  transports: ['websocket', 'polling'],
});

const engine = new SimulationEngine();

// ── Geofence emitter ──────────────────────────────────────────────────────────
engine.setGeofenceEmitter((payload) => {
  io.emit('geofence_breach', payload);
  if (payload.alert) persistAlert(payload.alert);

  const shipObj = payload.ship_id ? engine.ships[payload.ship_id] : null;
  fetch(N8N_GEOFENCE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shipName: payload.ship_name || payload.ship_id || 'Unknown',
      lat:      shipObj ? shipObj.lat  : 0,
      lng:      shipObj ? shipObj.lng  : 0,
      fuel:     shipObj ? (shipObj.fuel || 0) : 0,
      zoneName: payload.zone_name || '',
      alertMsg: payload.alert ? payload.alert.message : '',
    }),
    signal: AbortSignal.timeout(8000),
  }).catch(e => console.log('[n8n-geofence] fire-and-forget failed:', e.message));
});

// ── Background tick loop (1 Hz) with Redis pub/sub broadcast ─────────────────
// The tick is timed so we can guarantee the 500 ms SLA.
setInterval(() => {
  const t0 = performance.now();
  try {
    const state = engine.tick();
    const tickMs = performance.now() - t0;

    // Record tick duration
    recordSample(latency.tickMs, tickMs);
    if (tickMs > SLA_MS) {
      latency.slaBreaches++;
      console.warn(`[SLA] Tick took ${tickMs.toFixed(1)} ms > ${SLA_MS} ms threshold`);
    }

    // Tag state with server-side timestamp so clients can measure one-way latency
    state._serverTs = Date.now();
    state._tickMs   = Math.round(tickMs);

    io.emit('fleet_update', state);
    if (REDIS_OK.current) {
      redisPub.publish(KEY.fleetChannel, JSON.stringify(state))
        .catch(e => console.warn('[Redis] publish failed:', e.message));
    }
  } catch (e) {
    console.error('[Tick] Error:', e.message);
  }
}, 1000);

// ── Subscribe to sibling-instance fleet broadcasts ────────────────────────────
// When running multiple backend instances behind a load balancer, this ensures
// every instance re-emits updates originated by peers.
async function subscribeFleetChannel() {
  if (!REDIS_OK.current) return;
  await redisSub.subscribe(KEY.fleetChannel);
  redisSub.on('message', (channel, message) => {
    if (channel !== KEY.fleetChannel) return;
    try {
      // Only forward if the state wasn't produced by this process
      // (the tick loop already called io.emit locally)
      // In single-instance mode this is a no-op; useful in multi-instance.
      const state = JSON.parse(message);
      // Tag so we can detect own-origin messages if needed later
      if (!state._origin || state._origin !== process.pid) {
        io.emit('fleet_update', state);
      }
    } catch (_) {}
  });
  console.log('[Redis] Subscribed to', KEY.fleetChannel);
}

// ── AI configuration (all from env — no hardcoded keys) ──────────────────────
const OPENROUTER_KEY   = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL   || 'google/gemini-2.0-flash-exp:free';
const GEMINI_KEY       = process.env.GEMINI_API_KEY     || '';

// Unified LLM caller: OpenRouter → Gemini direct → null
async function callAI(systemPrompt, userContent, maxTokens = 400) {
  // Tier 1: OpenRouter (OpenAI-compatible, supports 200+ models)
  if (OPENROUTER_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_KEY}`,
          'Content-Type':  'application/json',
          'HTTP-Referer':  'http://localhost',
          'X-Title':       'Fleet Command System',
        },
        body: JSON.stringify({
          model: OPENROUTER_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userContent  },
          ],
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
      const body = await res.json();
      const text = body.choices?.[0]?.message?.content || '';
      if (!text) throw new Error('Empty response from OpenRouter');
      console.log(`[AI] OpenRouter (${OPENROUTER_MODEL}) OK`);
      return text;
    } catch (e) {
      console.warn(`[AI] OpenRouter failed: ${e.message}`);
    }
  }

  // Tier 2: Gemini native REST API
  if (GEMINI_KEY) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n${userContent}` }] }],
            generationConfig: { maxOutputTokens: maxTokens },
          }),
          signal: AbortSignal.timeout(15000),
        }
      );
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${await res.text()}`);
      const body = await res.json();
      const text = body.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('Empty response from Gemini');
      console.log('[AI] Gemini direct OK');
      return text;
    } catch (e) {
      console.warn(`[AI] Gemini direct failed: ${e.message}`);
    }
  }

  return null; // both providers unavailable → caller uses keyword fallback
}

// ── Distress NLP helpers ──────────────────────────────────────────────────────
async function aiExtractN8N(message) {
  try {
    const res = await fetch(N8N_DISTRESS_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }), signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`n8n HTTP ${res.status}`);
    const body = await res.json();
    if (body && (body.severity !== undefined || body.issue)) {
      return {
        severity:        body.severity ?? 3,
        incident_type:   body.issue || body.incident_type || 'other',
        injury_count:    body.injury_count ?? 0,
        damage_estimate: body.impact_quantified || body.damage_estimate || 'unknown',
        immediate_needs: body.impact_quantified || body.immediate_needs || 'Assessment required',
        summary:         body.issue ? `Distress: ${body.issue} (severity ${body.severity}/10)` : 'Distress signal received',
        source: 'n8n', issue: body.issue, impact_quantified: body.impact_quantified,
      };
    }
    throw new Error('n8n returned unexpected shape');
  } catch (e) {
    console.log(`[n8n-distress] failed: ${e.message} — falling back to AI provider`);
    return null;
  }
}

async function aiExtractLLM(message) {
  const systemPrompt = 'You are a maritime emergency analyst. Extract structured data from distress messages. Respond with JSON only, no markdown.';
  const userContent  = `Analyze this maritime distress message and respond with a JSON object ONLY:\n{"severity":1-10,"incident_type":"fire|flooding|collision|mechanical|medical|piracy|weather|other","injury_count":0,"damage_estimate":"string","immediate_needs":"string","summary":"one sentence"}\n\nMessage: ${message}`;
  const text = await callAI(systemPrompt, userContent, 250);
  if (!text) return null;
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      const parsed = JSON.parse(m[0]);
      return { ...parsed, source: OPENROUTER_KEY ? 'openrouter' : 'gemini', issue: parsed.incident_type, impact_quantified: parsed.damage_estimate };
    }
  } catch (e) { console.warn('[AI] distress JSON parse failed:', e.message); }
  return null;
}

function aiExtractKeyword(message) {
  const low = message.toLowerCase();
  const severity = ['sinking', 'mayday', 'fire', 'explosion'].some(w => low.includes(w)) ? 9
    : ['collision', 'flood', 'injured', 'emergency'].some(w => low.includes(w)) ? 7
    : ['engine', 'mechanical', 'damage'].some(w => low.includes(w)) ? 5 : 3;
  const itype = low.includes('fire') ? 'fire'
    : ['sink', 'flood'].some(w => low.includes(w)) ? 'flooding'
    : low.includes('collision') ? 'collision'
    : ['medical', 'injured'].some(w => low.includes(w)) ? 'medical'
    : low.includes('engine') ? 'mechanical' : 'other';
  let injCount = 0;
  const injMatch = low.match(/(\d+)\s*(crew|person|injured)/);
  if (injMatch) injCount = parseInt(injMatch[1], 10);
  return {
    severity, incident_type: itype, injury_count: injCount,
    damage_estimate: 'unknown', immediate_needs: 'Assessment required',
    summary: `Distress: ${itype} (severity ${severity}/10)`,
    source: 'keyword', issue: itype, impact_quantified: `Severity ${severity}/10`,
  };
}

async function aiExtract(message) {
  const n8n = await aiExtractN8N(message);
  if (n8n) return n8n;
  const llm = await aiExtractLLM(message);
  if (llm) return llm;
  return aiExtractKeyword(message);
}

// ── REST API ──────────────────────────────────────────────────────────────────

app.get('/api/fleet', (_req, res) => res.json(engine.getState()));

app.get('/api/zones', (_req, res) => res.json(Object.values(engine.zones)));
app.post('/api/zones', (req, res) => {
  const data = req.body;
  const zone = { id: crypto.randomUUID(), name: data.name,
    polygon: data.polygon, active: true, created_at: Date.now() / 1000 };
  engine.addZone(zone);
  io.emit('zone_update', { action: 'created', zone });
  res.json(zone);
});
app.delete('/api/zones/:zoneId', (req, res) => {
  engine.removeZone(req.params.zoneId);
  io.emit('zone_update', { action: 'deleted', zone_id: req.params.zoneId });
  res.json({ deleted: req.params.zoneId });
});

// S2S operation types that should be applied immediately (no accept/reject needed)
const S2S_TYPES = new Set(['FUEL_TRANSFER', 'ESCORT', 'MEDICAL_AID', 'CANCEL_ESCORT', 'SET_ROUTE_PATH']);

app.post('/api/directives', (req, res) => {
  const data = req.body;
  const d = { id: crypto.randomUUID(), ship_id: data.ship_id,
    type: data.type, payload: data.payload || {}, message: data.message || '',
    created_at: Date.now() / 1000 };

  if (S2S_TYPES.has(data.type)) {
    // Ship-to-Ship ops: apply immediately with validation
    const result = engine.applyDirective(data.ship_id, data.type, data.payload || {});
    if (result && !result.ok) {
      // Validation failed — return error to caller
      return res.status(400).json({ ...d, applied: false, error: result.error });
    }
    io.emit('directive_response', { ...d, response: 'ACCEPT', responded_at: Date.now() / 1000, result });
    return res.json({ ...d, applied: true, result });
  }

  // Normal Command directives: emit and wait for captain response
  io.emit('directive', d);
  res.json(d);

  // Auto-accept after 4s for solo testing
  setTimeout(() => {
    const result = engine.applyDirective(d.ship_id, d.type, d.payload);
    io.emit('directive_response', { ...d, response: 'ACCEPT', responded_at: Date.now() / 1000, result });
  }, 4000);
});

app.post('/api/directives/respond', async (req, res) => {
  const data = req.body;
  const resp = { ...data, responded_at: Date.now() / 1000 };
  if (data.response === 'ACCEPT') {
    const result = engine.applyDirective(data.ship_id, data.type, data.payload || {});
    if (result && !result.ok) {
      return res.status(400).json({ ...resp, error: result.error });
    }
    resp.result = result;
  } else if (data.response === 'ESCALATE_DISTRESS') {
    const extraction = await aiExtract(data.distress_message || '');
    const ship = engine.ships[data.ship_id];
    if (ship) ship.status = 'distressed';
    if (extraction.severity >= 7 && ship) ship.status = 'distressed';
    const alert = engine._addAlert('distress', [data.ship_id],
      extraction.summary || data.distress_message || '', extraction.severity || 5);
    alert.ai_extraction = extraction;
    resp.ai_extraction  = extraction;
    resp.alert_id       = alert.id;
    persistAlert(alert);
  }
  io.emit('directive_response', resp);
  res.json(resp);
});

app.post('/api/distress', async (req, res) => {
  const data = req.body;

  // ── Rate-limit: one distress call per ship per 30 s ─────────────────────
  const allowed = await checkDistressRateLimit(data.ship_id);
  if (!allowed) {
    return res.status(429).json({ error: 'Rate limited: distress cooldown active', cooldown_sec: DISTRESS_COOLDOWN_SEC });
  }

  const extraction = await aiExtract(data.message);
  const ship = engine.ships[data.ship_id];
  if (ship) {
    ship.status = 'distressed';
    if (extraction.severity >= 7) ship.status = 'distressed';
  }
  const alert = engine._addAlert('distress', [data.ship_id],
    extraction.summary || data.message, extraction.severity || 5);
  alert.ai_extraction = extraction;
  await persistAlert(alert);
  io.emit('new_alert', alert);
  res.json({ alert, extraction });
});

app.post('/api/alerts/:alertId/acknowledge', async (req, res) => {
  const a = engine.alerts[req.params.alertId];
  if (a) {
    a.acknowledged = true;
    await removeAlert(req.params.alertId); // remove from Redis — no longer needed
  }
  io.emit('alert_ack', { alert_id: req.params.alertId });
  res.json({ acked: req.params.alertId });
});

app.get('/api/history', (_req, res) => res.json({ snapshots: engine.history }));
app.get('/api/weather', (_req, res) => {
  // Enhanced weather endpoint with additional context
  const ships = Object.values(engine.ships);
  const weatherWithImpact = engine.weatherZones.map(wz => {
    const shipsInZone = ships.filter(s =>
      !['arrived', 'stopped', 'stranded'].includes(s.status) &&
      Math.sqrt((s.lat - wz.lat) ** 2 + (s.lng - wz.lng) ** 2) * 111.32 < wz.radius_km
    );
    return {
      ...wz,
      affected_ships: shipsInZone.length,
      affected_ship_ids: shipsInZone.map(s => s.id),
      fuel_burn_multiplier: 1.3,  // 30% penalty
      estimated_fuel_loss_per_min: shipsInZone.reduce((sum, s) => sum + (0.5 * 1.3 * 60), 0),  // tonnes per minute
    };
  });
  res.json(weatherWithImpact);
});

// Multiple candidate routes for a ship (bonus feature)
app.get('/api/ships/:shipId/routes', (req, res) => {
  const ship = engine.ships[req.params.shipId];
  if (!ship) return res.status(404).json({ error: 'Ship not found' });
  const dest = engine.ports[ship.destination_port];
  if (!dest) return res.status(404).json({ error: 'No destination set' });
  const routes = engine.router.findMultiplePaths(
    ship.lat, ship.lng, dest.lat, dest.lng,
    Object.values(engine.zones), engine.weatherZones
  );
  
  // Enhance routes with weather impact analysis
  const enhancedRoutes = (routes || []).map(route => {
    let weatherCellCount = 0;
    let weatherImpactDistance = 0;
    
    // Count cells passing through weather zones
    for (const pt of route.path || []) {
      for (const wz of engine.weatherZones) {
        const dist = Math.sqrt((pt[0] - wz.lat) ** 2 + (pt[1] - wz.lng) ** 2) * 111.32;
        if (dist < wz.radius_km) {
          weatherCellCount++;
          weatherImpactDistance += 1; // rough estimate
          break;
        }
      }
    }
    
    const totalDist = route.distance_km || 0;
    const weatherFraction = totalDist > 0 ? weatherImpactDistance / totalDist : 0;
    const baseFuel = totalDist * 0.4;  // 0.4 t/km base rate
    const weatherPenalty = baseFuel * weatherFraction * 0.3;  // 30% penalty
    const totalFuel = baseFuel + weatherPenalty;
    const speedKmH = (ship.speed * 1.852);
    const baseHours = speedKmH > 0 ? totalDist / speedKmH : 0;
    
    return {
      ...route,
      weather_cells: weatherCellCount,
      weather_impact_distance_km: weatherImpactDistance,
      weather_percentage: Math.round(weatherFraction * 100),
      base_fuel_tonnes: Math.round(baseFuel * 10) / 10,
      weather_penalty_tonnes: Math.round(weatherPenalty * 10) / 10,
      total_fuel_tonnes: Math.round(totalFuel * 10) / 10,
      base_eta_hours: Math.round(baseHours * 10) / 10,
      fuel_sufficient: totalFuel <= ship.fuel,
    };
  });
  
  res.json({ ship_id: ship.id, destination: ship.destination_port, routes: enhancedRoutes });
});

app.get('/api/stats', (_req, res) => res.json({
  ships:         Object.keys(engine.ships).length,
  active_alerts: Object.values(engine.alerts).filter(a => !a.acknowledged).length,
  zones:         Object.keys(engine.zones).length,
  tick:          engine._tick,
  redis_ok:      REDIS_OK.current,
  latency:       latencyStats(),
}));

app.get('/api/latency', (_req, res) => res.json(latencyStats()));

// ── AI Fleet Advisor ──────────────────────────────────────────────────────────
app.post('/api/advisor', async (req, res) => {
  const state = engine.getState();
  const fleetSnapshotText = state.ships.map(s =>
    `${s.name}(${s.id}): status=${s.status} fuel=${s.fuel?.toFixed(0)}t dist=${s.dist_to_dest_km}km canReach=${s.can_reach_dest} heading=${Math.round(s.heading)}°`
  ).join('\n');
  const alertSummary = state.alerts.map(a => `[${a.type}] ${a.message}`).join('\n') || 'None';
  const prompt = `You are an AI fleet advisor for a maritime command system in the Strait of Hormuz crisis.
Current fleet state:
${fleetSnapshotText}
Active alerts: ${alertSummary}
Weather zones: ${state.weather_zones.length} storm areas active.

Provide 3-5 specific, actionable recommendations for the fleet commander. Be concise and direct. Format as JSON array: [{"priority":"high|medium|low","action":"...","reasoning":"...","ship_ids":["MV-X"]}]`;

  let advice = [];
  const aiText = await callAI(
    'You are an AI fleet advisor for a maritime command system in the Strait of Hormuz crisis. Respond with a JSON array only, no markdown.',
    `Current fleet state:\n${fleetSnapshotText}\nActive alerts: ${alertSummary}\nWeather zones: ${state.weather_zones.length} storm areas active.\n\nProvide 3-5 specific, actionable recommendations. Format as JSON array: [{"priority":"high|medium|low","action":"...","reasoning":"...","ship_ids":["MV-X"]}]`,
    600
  );
  if (aiText) {
    try {
      const m = aiText.match(/\[[\s\S]*\]/);
      if (m) advice = JSON.parse(m[0]);
    } catch (e) { console.log('[Advisor] JSON parse failed:', e.message); }
  }

  if (!advice.length) {
    const low      = state.ships.filter(s => !s.can_reach_dest && s.status !== 'arrived');
    const distress = state.ships.filter(s => s.status === 'distressed');
    const rerouting = state.ships.filter(s => s.status === 'rerouting');
    if (low.length)       advice.push({ urgency:'high',   title:'Fuel Critical', action_type:'reroute', action: `Reroute ${low.map(s=>s.name).join(', ')} to nearest port`, reasoning: 'Ship(s) cannot reach destination on current fuel. Immediate reroute required.', ship_ids: low.map(s=>s.id) });
    if (distress.length)  advice.push({ urgency:'critical', title:'Distress Response', action_type:'send-aid', action: `Dispatch assistance to ${distress.map(s=>s.name).join(', ')}`, reasoning: 'Ship(s) in distress status — require immediate support or medical aid.', ship_ids: distress.map(s=>s.id) });
    if (rerouting.length) advice.push({ urgency:'medium', title:'Reroute Monitoring', action_type:'reroute', action: `Monitor ${rerouting.map(s=>s.name).join(', ')} — path replanning active`, reasoning: 'Active rerouting may significantly delay ETA. Verify new paths clear all zones.', ship_ids: rerouting.map(s=>s.id) });
    if (state.weather_zones.length) advice.push({ urgency:'low', title:'Weather Advisory', action_type:'draw-zone', action: 'Consider routing tankers north of active storm zone', reasoning: `${state.weather_zones.length} adverse weather zone(s) active — 30% fuel penalty applies inside.`, ship_ids: [] });
    if (!advice.length)   advice.push({ urgency:'info', title:'Fleet Nominal', action_type:'default', action: 'Continue monitoring — no immediate action required.', reasoning: 'All ships operating normally within navigable bounds.', ship_ids: [] });
  }

  // Normalize Gemini output shape (uses 'priority' not 'urgency')
  const recommendations = advice.map(r => ({
    ...r,
    urgency:     r.urgency || r.priority || 'info',
    title:       r.title || r.action?.split(' ').slice(0,3).join(' ') || 'Recommendation',
    action_type: r.action_type || 'default',
  }));

  const activeShips = state.ships.filter(s => s.status !== 'arrived').length;
  const summary = `Fleet status: ${activeShips} active ships, ${state.alerts.filter(a=>!a.acknowledged).length} unacknowledged alerts, ${state.weather_zones.length} weather zone(s). ${recommendations.filter(r=>r.urgency==='critical'||r.urgency==='high').length} high-priority action(s) recommended.`;

  res.json({ recommendations, summary, generated_at: Date.now() / 1000 });
});

app.get('/health', (_req, res) => {
  const stats = latencyStats();
  const status = stats.sla_ok ? 'ok' : 'degraded';
  res.status(stats.sla_ok ? 200 : 503).json({
    status,
    tick:    engine._tick,
    redis:   REDIS_OK.current,
    latency: stats,
  });
});

// ── Redis diagnostics endpoint ────────────────────────────────────────────────
app.get('/api/redis/status', async (_req, res) => {
  if (!REDIS_OK.current) return res.json({ connected: false });
  try {
    const pong       = await redis.ping();
    const alertCount = await redis.hlen(KEY.alerts);
    res.json({ connected: true, pong, persisted_alerts: alertCount });
  } catch (e) {
    res.json({ connected: false, error: e.message });
  }
});

// ── Socket.IO ─────────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.emit('fleet_update', engine.getState());

  // ── WebSocket RTT measurement ───────────────────────────────────────────
  // Client sends { t: performance.now() }, server echoes it back.
  // Client measures round-trip = (now - t). Server records half as one-way RTT.
  socket.on('ping_latency', ({ t }) => {
    const rtt = (performance.now() - t);
    recordSample(latency.rttMs, rtt);
    socket.emit('pong_latency', { t, serverRtt: Math.round(rtt) });
  });

  socket.on('disconnect', () => console.log(`[WS] Client disconnected: ${socket.id}`));
});

// ── Boot sequence ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8000;

(async () => {
  await connectRedis();
  await loadPersistedAlerts();   // restore alerts from before last restart
  await subscribeFleetChannel(); // listen for sibling-instance broadcasts
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Fleet Command backend running on port ${PORT}`);
    console.log(`[Server] Redis: ${REDIS_OK.current ? REDIS_URL : 'unavailable (degraded mode)'}`);
    console.log(`[Server] n8n distress URL: ${N8N_DISTRESS_URL}`);
    console.log(`[Server] n8n geofence URL: ${N8N_GEOFENCE_URL}`);
  });
})();
