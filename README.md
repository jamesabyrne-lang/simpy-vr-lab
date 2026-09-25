# STARS Treatment Centre VR Lab

A browser-based 3D and WebXR visualisation of the **STARS treatment-centre SimPy model**. The published Python DES remains the source of truth: Three.js visualises its patient records and event timings rather than reproducing the model logic in JavaScript.

## Live application

GitHub Pages: <https://jamesabyrne-lang.github.io/simpy-vr-lab/>

## Underlying model

This project uses the published `treat-sim==3.0.0` package from the STARS healthcare work:

- upstream repository: `pythonhealthdatascience/stars-treat-sim`
- release: `v3.0.0`
- source commit: `e4a8c548d9ff7b36baa4fa117c492b66adcd78fa`
- licence: MIT

The model represents a treatment centre with a common triage step and two patient pathways:

```text
                           ┌─ Trauma stabilisation ─ Trauma treatment ─┐
Arrival ─ Triage ──────────┤                                           ├─ Discharge
                           └─ Registration ─ Examination ─ optional treatment ┘
```

The current published STARS Streamlit application also depends on `treat-sim==3.0.0`.

## Architecture

```text
STARS treat-sim 3.0.0
        ↓
SimPy running in CPython/Pyodide
        ↓
patient records and STARS KPIs
        ↓
stars_bridge.py event trace
        ↓
visual-state engine
        ↓
Three.js
        ↓
Desktop 3D / WebXR
```

`stars_bridge.py` imports and executes the published package. It reconstructs absolute queue/service timestamps from the records produced by `TreatmentCentreModel` and emits an explicit event trace. The 3D layer never determines when service begins or ends.

## Features

- genuine STARS/SimPy treatment-centre logic executed in the browser;
- baseline Nelson time-varying arrival profile;
- trauma and non-trauma patient pathways;
- all six constrained resource types represented spatially;
- configurable demand, pathway probabilities and resource capacities;
- selected service-time assumptions exposed for experimentation;
- exact reset to the published STARS baseline;
- patient figures forming queues and occupying resources according to SimPy timings;
- live simulation clock, WIP, queue, service and completion counts;
- per-resource occupancy and cumulative utilisation displays;
- selectable patients with full queue/service timeline;
- selectable resources with occupancy and queue state;
- recent SimPy event log;
- pause, replay, speed control and timeline scrubbing without rerunning the model;
- desktop orbit/zoom viewpoints;
- WebXR `Enter VR` support on compatible headset browsers;
- an in-world status board designed to remain visible in VR.

## STARS baseline

The interface resets to the package defaults:

| Parameter | Baseline |
|---|---:|
| Triage bays | 1 |
| Registration clerks | 1 |
| Examination rooms | 3 |
| Trauma bays | 2 |
| Non-trauma treatment cubicles | 1 |
| Trauma treatment cubicles | 1 |
| Mean triage duration | 3 min |
| Mean registration duration | 5 min |
| Mean examination duration | 16 min |
| Mean trauma stabilisation duration | 90 min |
| Mean non-trauma treatment | 13.3 min |
| Mean trauma treatment | 30 min |
| Probability trauma | 0.12 |
| Probability non-trauma treatment | 0.60 |
| Results collection period | 1,140 min |

The model retains the upstream distributional assumptions; the UI does not replace them with deterministic durations.

## Browser execution

The page loads Pyodide, then loads the scientific packages required by the model and installs the pure-Python packages used by STARS. No local Python installation is required.

First load can take noticeably longer because the Python/WebAssembly runtime and packages must be downloaded.

## VR

Open the GitHub Pages URL in a WebXR-capable headset browser. When `immersive-vr` is available, an **Enter VR** control is shown. The initial VR implementation is observational: users can stand within the facility and watch the same event-driven model that is available on desktop.

## Validation

A GitHub Actions validation workflow installs `treat-sim==3.0.0`, executes fixed-seed scenarios through `stars_bridge.py`, and checks event/model consistency, pathway forcing and resource-unit non-overlap. The browser build workflow remains separate from these tests.

## Provenance and limitations

See [STARS_PROVENANCE.md](STARS_PROVENANCE.md) for the exact source/version mapping, adaptations and limitations, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution.

This project is an independent educational visualisation and is **not an official STARS product**.
