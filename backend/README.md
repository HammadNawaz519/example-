# Fleet Command System — Strait of Hormuz Crisis Ops

Real-time maritime command system. 15 ships. 1 Hz updates. AI distress NLP. Weather-aware A\* routing.

## Stack

| Layer | Tech |
|---|---|
| Backend | Node.js 20, Express, Socket.IO, ioredis, @turf/turf |
| Frontend | React 18, Vite, Mapbox GL JS, Mapbox GL Draw, Zustand |
| Infra | Docker Compose (Node backend + Nginx + Redis) |
| AI | OpenRouter (Supports Gemini 2.0 Flash, GPT-4o, etc.) → n8n webhook → keyword fallback |
| Weather | Open-Meteo API (free, no key needed) — real-time wind, waves, precipitation, visibility |

## Features

### Weather System ⛈
- **Real-time weather data**: Open-Meteo API provides current conditions (wind speed, wave height, precipitation, visibility)
- **Weather zones**: Automatically generated danger areas with intensity tracking (0-100%)
- **Fuel impact**: Ships in adverse weather incur +30% fuel burn penalty
- **Route optimization**: A* router factors weather into path costs (8x multiplier for weather cells)
- **Weather panel**: Command interface includes dedicated Weather tab showing:
  - Live storm data (wind knots, wave height, precip, visibility)
  - Intensity indicators with color coding (yellow → orange → red)
  - Ships affected in each zone
  - Estimated fuel loss calculations
- **Predictive alerts**: Warns ships when they'll enter weather zones within 3 minutes
- **Enhanced routes API**: Returns weather impact analysis for candidate routes (fuel needed, ETA, weather percentage)

## Quick Start (Docker)

```bash
# 1. Copy and configure environment variables
cp .env.example .env
# Edit .env — at minimum set OPENROUTER_API_KEY and VITE_MAPBOX_TOKEN

# 2. Build and start all services
docker compose up -d --build

# 3. Open the command interface
open http://localhost
```

## Local Development (without Docker)

```bash
# Terminal 1 — Redis (requires Docker for Redis only)
docker run -p 6379:6379 redis:7-alpine

# Terminal 2 — Backend
cd backend
npm install
OPENROUTER_API_KEY=your_key REDIS_URL=redis://localhost:6379 node server.js

# Terminal 3 — Frontend
cd frontend
npm install
VITE_MAPBOX_TOKEN=your_token npm run dev
# → http://localhost:5173
```

## Environment Variables

All variables are optional — the system degrades gracefully without them.

### Backend (`backend/` process or Docker `backend` service)

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | *(none)* | Enables AI distress NLP and Fleet Advisor via OpenRouter. Falls back to keyword extraction if omitted. |
| `OPENROUTER_MODEL` | `google/gemini-2.0-flash-exp:free` | The specific model string to invoke via OpenRouter. |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string. Used for alert persistence, distress rate-limiting, and pub/sub fleet broadcast. System runs in degraded mode (no persistence) if Redis is unavailable. |
| `FLEET_JSON` | `../fleet.json` | Absolute or relative path to the fleet configuration file (ships, ports, navigable polygon, bounding box). |
| `PORT` | `8000` | HTTP/WebSocket port the backend listens on. |

### Frontend (build-time Vite args or `.env`)

| Variable | Default | Description |
|---|---|---|
| `VITE_MAPBOX_TOKEN` | *(hardcoded demo token)* | Mapbox GL JS public access token. The hardcoded demo token works for development but has rate limits — replace with your own for production. Get one free at [mapbox.com](https://mapbox.com). |

> **Security note:** Never commit real API keys to source control. The `.env` file is git-ignored. Use `.env.example` as the template.

## Architecture

```
Browser <-> Nginx :80
              |-- /           -> React SPA (Vite build, served by Nginx)
              |-- /api/*      -> Node.js backend :8000
              \-- /socket.io  -> Socket.IO (WebSocket + polling fallback)

Node.js / Express + Socket.IO
  \-- setInterval 1 Hz -- SimulationEngine.tick()
        |-- Advance ships via A* grid router (120×120 grid, @turf/turf)
        |-- _escortTick()      -- shadow escorting ships 3 km behind target
        |-- _checkGeofence()   -- point-in-polygon per restricted zone
        |-- _checkProximity()  -- haversine pair scan, alert < 2 km
        |-- _checkPredictive() -- fuel runway & zone-entry prediction (every 30 s)
        |-- _rescueStrandedShips() -- refuel/reroute stopped ships (every 5 min)
        \-- Broadcast fleet_update -> Socket.IO + Redis pub/sub

Redis (optional)
  |-- mcs:alerts          -- Hash: persisted unacknowledged alerts (survive restarts)
  |-- mcs:distress:lock:* -- String TTL: 30 s distress rate-limit per ship
  \-- mcs:fleet_update    -- Pub/sub channel for multi-instance horizontal scaling
```

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/fleet` | Full fleet state snapshot |
| GET | `/api/ships/:id/routes` | Up to 3 candidate routes (Safe / Fast / Eco) |
| POST | `/api/directives` | Issue directive to a ship |
| POST | `/api/directives/respond` | Captain accepts or escalates a directive |
| POST | `/api/distress` | Submit distress signal (AI-analysed, rate-limited) |
| GET | `/api/zones` | List restricted zones |
| POST | `/api/zones` | Create restricted zone |
| DELETE | `/api/zones/:id` | Remove restricted zone |
| POST | `/api/alerts/:id/acknowledge` | Acknowledge alert |
| GET | `/api/history` | 30 s snapshot history (up to 1 hour) |
| GET | `/api/weather` | Current weather zones |
| POST | `/api/advisor` | AI fleet advisor recommendations |
| GET | `/api/stats` | Ship/alert/zone counts + SLA latency stats |
| GET | `/health` | Health check (200 OK / 503 Degraded) |

### Directive types

| `type` | Payload | Description |
|---|---|---|
| `HOLD_POSITION` | — | Stop ship in place |
| `REROUTE_PORT` | `{ port_id }` | Reroute to a different port |
| `DIVERT_WAYPOINT` | `{ lat, lng }` | Insert a temporary waypoint |
| `FUEL_TRANSFER` | `{ target_ship_id, amount_tonnes }` | Transfer fuel (max 50 km range) |
| `ESCORT` | `{ target_ship_id }` | Shadow a ship 3 km behind |
| `CANCEL_ESCORT` | — | Stop escorting |
| `MEDICAL_AID` | `{ target_ship_id }` | Dispatch ship to target's position |

## Features

- **15 ships** moving at 1 Hz along A\* computed paths through the navigable water polygon
- **Route Options**: 3 candidate routes per ship (Safe / Fast / Eco) with live map preview
- **Ship-to-Ship Ops**: Fuel transfer (proximity-enforced), escort formation, medical aid dispatch
- **Geofencing**: Draw restricted zones on map → ships reroute automatically within 1 tick (1 s)
- **Proximity alerts**: Any two ships within 2 km → alert fires with severity badge
- **Weather**: Live Open-Meteo data → 30% fuel penalty inside storm zones, A\* penalises bad weather cells
- **AI distress**: Free-form text → n8n webhook → OpenRouter → keyword fallback extracts severity, type, injuries
- **Fleet Advisor**: AI-generated fleet-wide action recommendations on demand
- **Role-based**: Command = full fleet view + zone drawing + directives; Captain = own ship + directive response
- **Playback**: 1 hour of 30 s snapshots, scrubbable timeline with auto-play and variable speed

## Assumptions

- Navigable polygon from `fleet.json` is used as-is for A\* grid (no real coastline data needed per spec)
- Weather zones refresh every 5 minutes; if Open-Meteo is unreachable, a simulated Gulf storm is used as fallback
- Fuel burns at 0.5 t/s base rate with a ×1.3 penalty inside weather zones (configurable in `simulation.js`)
- Mapbox demo token is embedded in `MapBox.jsx` as a fallback; replace `VITE_MAPBOX_TOKEN` for production
