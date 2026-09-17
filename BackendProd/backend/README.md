# OceanEmbed Prediction Backend

Subsurface ocean temperature prediction for the North Indian Ocean using the
**OceanEmbedNet** deep-learning model.

---

## 1. What it does

Accepts a **date + latitude + longitude** and returns predicted
**subsurface ocean temperature at 14 depths** (5 m – 1 000 m).

The model was trained on GLORYS/Copernicus reanalysis data for 2000–2004 and
tested on 2005.  Inference is performed against the pre-trained checkpoint
`models/OceanEmbed_best.pth`.

---

## 2. Project structure

```
BackendProd/
├── backend/
│   ├── app/
│   │   ├── main.py                  FastAPI app + lifespan
│   │   ├── api/routes.py            /health  /api/v1/predict
│   │   ├── schemas/prediction.py    Pydantic request/response
│   │   ├── model/ocean_embed.py     OceanEmbedNet architecture
│   │   ├── services/
│   │   │   ├── data_service.py      NetCDF I/O
│   │   │   ├── preprocessing.py     masks + normalisation + patching
│   │   │   ├── model_service.py     checkpoint loading + inference
│   │   │   └── prediction_service.py full pipeline
│   │   └── core/config.py           all constants + paths
│   ├── tests/
│   │   ├── conftest.py
│   │   ├── test_health.py
│   │   ├── test_preprocessing.py
│   │   ├── test_model.py
│   │   └── test_prediction.py
│   ├── requirements.txt
│   ├── .env.example
│   └── README.md
├── configs/
│   ├── train_normalization_stats(1).json
│   └── target_normalization_stats(1).json
├── data/surface/surface_2000.nc … surface_2005.nc
└── models/OceanEmbed_best.pth
```

---

## 3. Python environment

- **Python**: 3.12
- **PyTorch**: 2.14.0+cu130 (CUDA 13.0)
- Existing venv at `BackendProd/.venv/`

---

## 4. Installation

```bash
# From BackendProd/
source .venv/bin/activate

# Install/verify deps
python -m pip install -r backend/requirements.txt
```

---

## 5. Starting the server

```bash
# From BackendProd/backend/
source ../.venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Or from `BackendProd/`:

```bash
source .venv/bin/activate
cd backend
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

---

## 6. Health endpoint

```
GET /health
```

Response:
```json
{
  "status": "ok",
  "model_loaded": true,
  "device": "cuda"
}
```

---

## 7. Prediction endpoint

```
POST /api/v1/predict
Content-Type: application/json
```

Request:
```json
{
  "date":      "2005-06-15",
  "latitude":  20.5,
  "longitude": 75.25
}
```

Response:
```json
{
  "date": "2005-06-15",
  "latitude": 20.5,
  "longitude": 75.25,
  "grid_latitude": 20.375,
  "grid_longitude": 75.125,
  "depths_m": [5,10,20,30,50,75,100,125,150,200,300,500,700,1000],
  "temperature_c": [27.1, 26.8, 26.4, 25.9, 25.1, 24.3, 23.5, 22.8,
                    21.9, 20.7, 18.4, 15.2, 11.8, 8.7]
}
```

---

## 8. Example curl

```bash
curl -X POST "http://localhost:8000/api/v1/predict" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2005-06-15",
    "latitude": 20.5,
    "longitude": 75.25
  }'
```

---

## 9. CPU / GPU behaviour

- **CUDA available**: model runs on GPU; `/health` returns `"device": "cuda"`.
- **CPU only**: model runs on CPU; `/health` returns `"device": "cpu"`.
- The device is selected automatically at startup; no configuration needed.

---

## 10. Model input construction

For a request on date **D** the pipeline constructs a 3-timestep sequence:

```
D-2, D-1, D
```

For each timestep, 7 raw surface variables are loaded from
`data/surface/surface_YYYY.nc`:

```
sst, sss, sla, uo, vo, wind_u, wind_v
```

Each variable is processed into 2 channels (physical + mask) → **14 channels**.

The full spatial grid is processed as 32×32 patches (stride 32).

Final tensor shape: `[N_patches, 3, 14, 32, 32]`

---

## 11. Normalisation

Training-only statistics are loaded from
`configs/train_normalization_stats(1).json`.

Per variable:

```
mask = isfinite(raw_value)          # 1.0 valid / 0.0 missing
x_norm = (raw - train_mean) / train_std
x_norm[invalid] = 0.0               # fill NaN after normalisation
```

Statistics from the requested date are **never** used.

---

## 12. Target denormalisation

Model output is in normalised space.  Physical temperatures are recovered using
`configs/target_normalization_stats(1).json`:

```
temperature_°C = normalised_output × target_std + target_mean
```

One mean/std pair per depth level (14 depths, 0 m excluded).

---

## 13. Running tests

```bash
cd backend
source ../.venv/bin/activate
python -m pytest tests/ -v
```

---

## 14. Known limitations

| Limitation | Detail |
|---|---|
| Data range | Only years 2000–2005 are supported |
| Minimum date | Dates before Jan 3 of any year (within the available data) require the previous year's file |
| Spatial domain | 5.125°N–29.875°N, 45.125°E–104.875°E (North Indian Ocean) |
| Temporal resolution | Daily only |
| Grid coverage | Predictions at land/marginal grid cells may be unreliable (mask=0) |
| Sequence length | Exactly 3 consecutive daily timesteps required |
