import { create } from 'zustand';
import { io } from 'socket.io-client';

const BACKEND = import.meta.env.DEV ? 'http://localhost:8000' : '';

let socket = null;

function getSocket() {
  if (!socket) {
    socket = io(BACKEND, {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
    });
  }
  return socket;
}

export const useStore = create((set, get) => ({
  // State
  ships: [],
  zones: [],
  alerts: [],
  weatherZones: [],
  history: [],
  pendingDirectives: [],
  selectedShipId: null,
  role: null,          // 'command' | 'captain'
  captainShipId: null,
  tick: 0,
  connected: false,
  rttMs: null,         // WebSocket round-trip time in ms (null = not yet measured)
  playbackMode: false,
  playbackIndex: 0,
  isAutoPlaying: false,
  playbackSpeed: 2,   // frames per second
  routeOptions: null,      // { ship_id, destination, routes: [...] } | null
  previewRouteId: null,    // id of the route being highlighted on the map

  // Actions
  setRole: (role, captainShipId = null) => set({ role, captainShipId }),
  setSelectedShipId: (id) => set({ selectedShipId: id }),

  initSocket: () => {
    const sock = getSocket();

    sock.on('connect', () => {
      set({ connected: true });
      // Start periodic WebSocket RTT measurement (every 5 s)
      const pingInterval = setInterval(() => {
        if (!sock.connected) return;
        sock.emit('ping_latency', { t: performance.now() });
      }, 5000);
      // Kick off first ping immediately
      sock.emit('ping_latency', { t: performance.now() });
      // Store interval id so we can clear on disconnect
      sock._pingInterval = pingInterval;
    });
    sock.on('disconnect', () => {
      set({ connected: false, rttMs: null });
      if (sock._pingInterval) clearInterval(sock._pingInterval);
    });
    sock.on('pong_latency', ({ t }) => {
      const rtt = Math.round(performance.now() - t);
      set({ rttMs: rtt });
    });

    sock.on('fleet_update', (data) => {
      if (get().playbackMode) return;
      set({
        ships: data.ships || [],
        zones: data.zones || [],
        alerts: data.alerts || [],
        weatherZones: data.weather_zones || [],
        tick: data.tick || 0,
      });
    });

    sock.on('zone_update', (data) => {
      if (data.action === 'created') {
        set(s => ({ zones: [...s.zones.filter(z => z.id !== data.zone.id), data.zone] }));
      } else if (data.action === 'deleted') {
        set(s => ({ zones: s.zones.filter(z => z.id !== data.zone_id) }));
      }
    });

    sock.on('directive', (d) => {
      set(s => ({ pendingDirectives: [...(s.pendingDirectives || []), d] }));
    });

    sock.on('directive_response', (data) => {
      set(s => ({ pendingDirectives: s.pendingDirectives.filter(d => d.id !== data.id) }));
      if (data.ai_extraction) {
        set(s => ({ alerts: [{ id: data.alert_id, type: 'distress', message: data.ai_extraction.summary, severity: data.ai_extraction.severity, ship_ids: [data.ship_id], created_at: Date.now()/1000, acknowledged: false }, ...s.alerts] }));
      }
    });

    sock.on('new_alert', (alert) => {
      set(s => ({ alerts: [alert, ...s.alerts] }));
      // Sound alert for severity >= 4
      if (alert.severity >= 4) {
        try {
          const ctx = new AudioContext();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain); gain.connect(ctx.destination);
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.3, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          osc.start(); osc.stop(ctx.currentTime + 0.5);
        } catch(e) {}
      }
    });

    sock.on('geofence_breach', (payload) => {
      const alert = payload?.alert;
      if (!alert) return;
      set(s => (s.alerts.some(a => a.id === alert.id) ? s : { alerts: [alert, ...s.alerts] }));
    });

    // Fallback: fetch initial fleet state via REST in case socket fails or initial emit is missed
    (async () => {
      try {
        const r = await fetch(`${BACKEND}/api/fleet`);
        if (!r.ok) return;
        const data = await r.json();
        if (get().playbackMode) return;
        set({
          ships: data.ships || [],
          zones: data.zones || [],
          alerts: data.alerts || [],
          weatherZones: data.weather_zones || [],
          tick: data.tick || 0,
        });
      } catch (e) {
        // ignore network errors, socket listeners remain primary
        // console.warn('[initSocket] REST fallback failed:', e.message);
      }
    })();

    sock.on('alert_ack', ({ alert_id }) => {
      set(s => ({ alerts: s.alerts.filter(a => a.id !== alert_id) }));
    });
  },

  // API calls
  createZone: async (name, polygon) => {
    const r = await fetch(`${BACKEND}/api/zones`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, polygon }),
    });
    return r.json();
  },

  deleteZone: async (id) => {
    await fetch(`${BACKEND}/api/zones/${id}`, { method: 'DELETE' });
  },

  sendDirective: async (shipId, type, payload = {}, message = '') => {
    const r = await fetch(`${BACKEND}/api/directives`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ship_id: shipId, type, payload, message }),
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(data.error || `Directive failed (HTTP ${r.status})`);
    }
    return data;
  },

  respondDirective: async (directive, response, distressMsg = '') => {
    set(s => ({ pendingDirectives: s.pendingDirectives.filter(d => d.id !== directive.id) }));
    const r = await fetch(`${BACKEND}/api/directives/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ship_id: directive.ship_id, type: directive.type,
        payload: directive.payload, response, distress_message: distressMsg }),
    });
    return r.json();
  },

  sendDistress: async (shipId, message) => {
    const r = await fetch(`${BACKEND}/api/distress`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ship_id: shipId, message }),
    });
    if (r.status === 429) {
      const err = await r.json().catch(() => ({}));
      return { _rateLimited: true, cooldown_sec: err.cooldown_sec || 30 };
    }
    return r.json();
  },

  ackAlert: async (alertId) => {
    await fetch(`${BACKEND}/api/alerts/${alertId}/acknowledge`, { method: 'POST' });
  },

  fetchRoutes: async (shipId) => {
    const r = await fetch(`${BACKEND}/api/ships/${shipId}/routes`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    set({ routeOptions: data, previewRouteId: data.routes?.[0]?.id ?? null });
    return data;
  },

  setPreviewRoute: (routeId) => set({ previewRouteId: routeId }),

  clearRoutePreview: () => set({ routeOptions: null, previewRouteId: null }),

  loadHistory: async () => {
    const r = await fetch(`${BACKEND}/api/history`);
    const data = await r.json();
    set({ history: data.snapshots || [], playbackMode: true, playbackIndex: 0 });
  },

  setPlaybackIndex: (idx) => {
    const { history } = get();
    if (!history[idx]) return;
    set({ playbackIndex: idx, ships: history[idx].ships });
  },

  setPlaybackSpeed: (speed) => set({ playbackSpeed: speed }),

  startAutoPlay: () => {
    const store = get();
    if (store._autoPlayTimer) clearInterval(store._autoPlayTimer);
    const timer = setInterval(() => {
      const { history, playbackIndex, playbackMode } = get();
      if (!playbackMode) { clearInterval(timer); return; }
      const next = playbackIndex + 1;
      if (next >= history.length) {
        // reached end — stop
        clearInterval(timer);
        set({ isAutoPlaying: false, _autoPlayTimer: null });
        return;
      }
      set({ playbackIndex: next, ships: history[next].ships });
    }, Math.round(1000 / get().playbackSpeed));
    set({ isAutoPlaying: true, _autoPlayTimer: timer });
  },

  stopAutoPlay: () => {
    const { _autoPlayTimer } = get();
    if (_autoPlayTimer) clearInterval(_autoPlayTimer);
    set({ isAutoPlaying: false, _autoPlayTimer: null });
  },

  exitPlayback: () => {
    const { _autoPlayTimer } = get();
    if (_autoPlayTimer) clearInterval(_autoPlayTimer);
    set({ playbackMode: false, isAutoPlaying: false, _autoPlayTimer: null });
  },

  // Helpers
  getShip: (id) => get().ships.find(s => s.id === id),
  getMyCaptainShip: () => {
    const { ships, captainShipId } = get();
    return ships.find(s => s.id === captainShipId);
  },
}));
