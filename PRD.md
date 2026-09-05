# PRD — OceanEmbed

**Version:** 1.0  
**Status:** Prototype shipped  
**Last updated:** September 2026

---

## 1. Problem

Subsurface ocean temperature data is scientifically critical — it drives climate models, fisheries forecasting, naval planning, and marine heatwave detection. The only way to measure it directly is with ARGO floats: physical instruments that take weeks to resurface and cover only ~0.5% of the ocean at any time.

Satellite imagery covers 100% of the ocean surface every 1–3 days, but surface observables alone (SST, SSH) are not the same as the subsurface structure. There is no deployed, publicly accessible tool that takes a surface-observable snapshot and returns a full depth profile on demand.

Existing research solves this as a batch science problem — producing retrospective gridded datasets. Nobody has productized it as a real-time queryable service with a usable interface.

---

## 2. Goal

Build a working end-to-end system that:

- Accepts any ocean coordinate and month
- Returns a predicted 23-depth temperature profile (0–2000 m) derived purely from satellite data
- Exposes this as a REST API any tool can call
- Visualizes the result interactively on a 3D globe
- Allows users to set threshold-based alarms on specific subsurface depths with Telegram delivery

---

## 3. Users

| User | Need |
|---|---|
| **Oceanography researcher** | Quick subsurface estimate at an arbitrary coordinate without downloading ARGO data |
| **Climate / environmental analyst** | Monitor whether a specific depth at a region of interest is warming over time |
| **Fisheries / marine operations** | Know whether the thermocline at a fishing ground is shallower or deeper than expected |
| **Developer / student** | A working, open reference implementation of satellite-to-subsurface inference with a real API |

---

## 4. Non-goals

- This is not a numerical ocean model (no fluid dynamics, no physics simulation)
- Does not aim to replace ARGO — it supplements it
- Does not currently support real-time satellite data ingestion (uses pre-downloaded NetCDF grids)
- Salinity prediction is out of scope for v1
- No user authentication or multi-tenancy

---

## 5. System overview

```
Satellite grids (SST, SSH)
        │
        ▼
  FastAPI Backend
  ┌─────────────────────────────────┐
  │  TemporalService                │  resolves required months
  │  SSTRepo / SSHRepo              │  load + reindex NetCDF → 180×360
  │  Preprocessor                   │  fill NaN, normalize
  │  ConvLSTM Model                 │  (1,3,180,360,2) → (1,180,360,23)
  │  LocationService                │  extract profile at lat/lon cell
  │  AlarmService (poll loop)       │  threshold checks + Telegram
  └─────────────────────────────────┘
        │  JSON  { depths_m, temperature_celsius }
        ▼
  React + Three.js Frontend
  ┌─────────────────────────────────┐
  │  3D Earth globe                 │  click → lat/lon
  │  Animated depth layer viz       │  23 wavy strata, color by temp
  │  Alarm panel                    │  CRUD + status badges
  └─────────────────────────────────┘
```

---

## 6. Model

| Property | Value |
|---|---|
| Architecture | ConvLSTM |
| Inputs | SST + SSH/SLA, 3 consecutive monthly global grids |
| Input tensor | `(1, 3, 180, 360, 2)` |
| Output tensor | `(1, 180, 360, 23)` — global temp field |
| Depths | 30, 50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1750, 2000 m |
| Grid | 1° × 1°, lat −89.5…89.5, lon 0.5…359.5 |
| Training data | Jan–Mar 2020 (prototype) |
| Ground truth | ARGO float profiles |
| Current limitation | Supports only `2020-03` as target month |

The model runs one global inference per request. The per-coordinate cost is a grid lookup, not a separate inference call.

---

## 7. API

All endpoints are prefixed `/api/v1`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + model status |
| `GET` | `/model-info` | Tensor shapes, depth list, version |
| `POST` | `/predict` | Main prediction endpoint |
| `POST` | `/alarms` | Create alarm |
| `GET` | `/alarms` | List alarms |
| `GET` | `/alarms/{id}` | Get single alarm |
| `DELETE` | `/alarms/{id}` | Delete alarm |
| `POST` | `/alarms/{id}/trigger` | Frontend reports mock threshold crossing |
| `GET` | `/telegram-recipients` | List subscribed chat IDs |
| `POST` | `/telegram-recipients` | Subscribe a chat ID |
| `DELETE` | `/telegram-recipients/{id}` | Unsubscribe |

### Predict request / response

```json
// POST /api/v1/predict
{ "latitude": 20.5, "longitude": 75.5, "target_month": "2020-03" }

// Response
{
  "latitude": 20.5, "longitude": 75.5,
  "grid_latitude": 20.5, "grid_longitude": 75.5,
  "target_month": "2020-03",
  "depths_m": [30, 50, ..., 2000],
  "temperature_celsius": [28.1, 27.4, ..., 2.3],
  "model_version": "prototype-v1"
}
```

### Error codes

| Situation | HTTP |
|---|---|
| Bad lat / lon / month format | 422 |
| Month not in supported set | 422 |
| Satellite file missing | 404 |
| Land cell or no ocean data | 404 |
| Model or preprocessing failure | 503 |

---

## 8. Alarm system

Alarms monitor a specific `(lat, lon, month, depth_index)` coordinate against a threshold continuously.

**Lifecycle:**

```
create → active → firing  (condition met, Telegram sent each cycle)
                → active  (condition cleared, resets)
         active → error   (poll threw, retries next cycle)
```

**Delivery:** Telegram bot message (HTML formatted) + browser `Notification` API.

**Poll interval:** configurable, default 2 s.

**Mock mode:** frontend polls `generateMockProfile()` locally and calls `/alarms/{id}/trigger` so Telegram fires server-side even without real satellite data loaded.

---

## 9. Frontend

| Component | Role |
|---|---|
| `App.jsx` | Canvas root, globe, camera zoom, state machine |
| `Earth` | GLTF globe with click → `classifyIntersection` → `pointToLatLon` |
| `GeologicalCrossSection` | 23 animated wavy 3D strata at the clicked point |
| `DataOverlay` | Depth labels (left) + temperature values (right) synced to layers |
| `InfoSidebar` | Lat/lon + surface/deep/range summary |
| `AlarmPanel` | Slide-in CRUD panel with form + live status badges |
| `StarField` | 2 200 static background stars |
| `ShootingStars` | 3 minimal shooting stars with staggered delays |
| `Asteroids` | 7 slowly drifting irregular rocky bodies |
| `CameraController` | Smooth zoom-in to clicked point, zoom-out back to globe |

**Config keys** (all overridable via `.env.local`):

| Key | Default |
|---|---|
| `VITE_USE_MOCK_DATA` | `true` |
| `VITE_API_ENDPOINT` | `/api/v1/predict` |
| `VITE_ALARM_POLL_INTERVAL_MS` | `2000` |

---

## 10. Novelty over prior work

Prior work (DORS, Western Pacific ConvLSTM, IEEE CNN) solves this as an **offline batch science problem** — producing static gridded datasets for retrospective analysis.

This project differs in:

1. **Live queryable API** — any coordinate answered on demand, not pre-computed
2. **Minimal input surface** — only SST + SSH (no SSS/SSW), validating the two-channel floor
3. **Operational alarm layer** — threshold monitoring on predicted *subsurface* depths, not surface fields
4. **Interactive 3D depth visualization** — full column rendered as strata on a live globe, not a static plot
5. **Global single-pass for interactive latency** — one inference covers all coordinates; per-request cost is O(1) grid lookup

---

## 11. Current limitations

| Limitation | Impact | Path forward |
|---|---|---|
| Trained on Jan–Mar 2020 only | Only `2020-03` predictions valid | Retrain on multi-year data; update `SUPPORTED_TARGET_MONTHS` |
| No real-time satellite ingestion | User must manually place NetCDF files | Add Copernicus / CMEMS download pipeline |
| In-memory alarm store | Alarms lost on restart | Swap `AlarmRepository` for SQLite / Redis |
| No user accounts | Single shared alarm list | Add auth layer (JWT or API key) |
| Land mask is heuristic | Edge coastal cells may misclassify | Improve with a proper ocean mask grid |
| 1° resolution | ~110 km spatial precision | Fine-tune or retrain on higher-res grids |

---

## 12. Tech stack

| Layer | Stack |
|---|---|
| Backend | Python 3.11, FastAPI, Uvicorn, Keras / TensorFlow, xarray, netCDF4, httpx, pydantic-settings |
| Frontend | React 19, Vite, TypeScript, Three.js, @react-three/fiber, @react-three/drei |
| Notifications | Telegram Bot API |
| Tests | pytest, httpx (no TF / real data required) |

---

## 13. Running locally

```bash
# Backend
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && cp .env.example .env
uvicorn app.main:app --reload

# Frontend
cd frontend && npm install
echo "VITE_USE_MOCK_DATA=false" >> .env.local
npm run dev
```

Swagger UI: `http://localhost:8000/docs`
