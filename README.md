# SimPy VR Lab

A browser-based discrete-event simulation demonstrator that runs a real **SimPy 4.1.2** model in the browser with **Pyodide**, then visualises the event trace in **Three.js** with optional **WebXR/VR**.

## Demo model

The included model is a finite-horizon airport/security-style multi-server queue:

- exponential interarrival times;
- configurable number of screening resources;
- Gamma service times with independently configurable mean and coefficient of variation;
- SimPy `Resource` contention;
- animated arrivals, queueing, resource allocation, processing and departures;
- live queue size plus end-of-run throughput, waiting-time and utilisation KPIs.

The Python model remains the source of truth. The Three.js scene only visualises the timestamps and resource assignments returned by SimPy.

## Run locally

Because the page loads ES modules and `simulation.py`, use a local web server rather than opening `index.html` as a `file://` URL.

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## GitHub Pages

1. Put these files in the root of a public GitHub repository.
2. In **Settings → Pages**, set the source to **Deploy from a branch**.
3. Choose `main` and `/ (root)`.
4. Open the Pages URL shown by GitHub.

GitHub Pages uses HTTPS, which is required for WebXR on a remote headset.

## VR

Open the GitHub Pages URL in a WebXR-capable headset browser. The Three.js VR button is shown when immersive VR is available. Desktop browsers retain orbit/zoom controls for normal 3D use.

## Main files

- `simulation.py` — the SimPy model and KPI calculation.
- `app.js` — Three.js scene, animation, Pyodide bridge and WebXR setup.
- `styles.css` — responsive interface styling.
- `index.html` — application shell and CDN/import-map configuration.

## CDN versions

- Pyodide `0.29.5`
- SimPy `4.1.2`
- Three.js `r186` / npm `0.186.0`
