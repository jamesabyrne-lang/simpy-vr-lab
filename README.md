# Healthcare Treatment Centre VR Lab

A browser-based healthcare discrete-event simulation built with **SimPy**, **Pyodide**, **Three.js** and **WebXR**.

The project is inspired by the broad treatment-centre pathways used in the STARS healthcare simulation examples, but this prototype deliberately uses a smaller self-contained SimPy model so it can run reliably in a browser without the full STARS dependency stack.

## Live application

<https://jamesabyrne-lang.github.io/simpy-vr-lab/>

## Model

Patients arrive stochastically and all pass through triage.

**Trauma pathway**

```text
Arrival → Triage → Trauma stabilisation → Trauma treatment → Discharge
```

**Non-trauma pathway**

```text
Arrival → Triage → Registration → Examination → optional treatment → Discharge
```

SimPy determines arrivals, queues, resource acquisition, service durations, branching and departures. Three.js only visualises the resulting event trace.

## Architecture

```text
SimPy model
   ↓
Pyodide / browser Python
   ↓
JSON event trace
   ↓
Three.js visual state engine
   ↓
Desktop 3D / WebXR
```

## Features

- real SimPy resource queues and patient processes;
- configurable demand, trauma probability and optional-treatment probability;
- configurable triage, registration, examination, trauma and treatment capacities;
- configurable mean service times, seed and run duration;
- low-poly patient figures;
- spatial triage, registration, examination, trauma, treatment and discharge areas;
- live queues, occupied resources and patient movement;
- simulation clock, WIP, waiting, service and completion KPIs;
- resource utilisation cards;
- selectable patients and resources;
- event-trace panel;
- pause/play, speed controls and timeline scrubbing;
- desktop orbit/zoom and preset viewpoints;
- WebXR `Enter VR` support on compatible browsers/headsets.

## Browser execution

The page loads Pyodide and installs only `simpy==4.1.1`. No local Python installation or server-side backend is required.

## Important simplification

This is **STARS-inspired**, not an exact reproduction of `treat-sim`. It keeps the broad trauma/non-trauma structure and baseline-style parameters, but replaces the heavier scientific-package dependency chain with a compact educational SimPy model intended for visualisation and experimentation.

## Development

`simulation.py` contains the DES.

`app.js` contains the Three.js/WebXR visualisation and Pyodide bridge.

The GitHub Actions validation workflow runs fixed-seed model tests, JavaScript syntax checks, DOM checks and a headless-browser smoke test.
