import json
from collections import defaultdict

import pytest

from stars_bridge import run_stars_vr
from treat_sim.model import Scenario, TreatmentCentreModel, SimulationSummary


def run_bridge(**kwargs):
    config = {"seed": 42, "duration": 300}
    config.update(kwargs)
    return json.loads(run_stars_vr(json.dumps(config)))


def test_baseline_bridge_matches_upstream_summary():
    data = run_bridge()

    # Independent direct use of the published STARS classes for the same seed/run.
    scenario = Scenario(random_number_set=42)
    model = TreatmentCentreModel(scenario)
    model.run(results_collection_period=300)
    summary = SimulationSummary(model)
    summary.process_run_results()

    assert data["metrics"]["00_arrivals"] == summary.results["00_arrivals"]
    assert data["metrics"]["09_throughput"] == summary.results["09_throughput"]
    assert data["metrics"]["01a_triage_wait"] == pytest.approx(summary.results["01a_triage_wait"])
    assert len(data["patients"]) == summary.results["00_arrivals"]
    assert data["extra_metrics"]["completed"] == summary.results["09_throughput"]


def test_visual_trace_never_precedes_simpy_times():
    data = run_bridge()
    for patient in data["patients"]:
        assert patient["arrival"] >= 0
        last_end = patient["arrival"]
        for stage in patient["stages"]:
            assert stage["queue_enter"] >= last_end - 1e-8
            if stage["service_start"] is not None:
                assert stage["service_start"] >= stage["queue_enter"] - 1e-8
            if stage["service_end"] is not None:
                assert stage["service_end"] >= stage["service_start"] - 1e-8
                last_end = stage["service_end"]
        if patient["departure"] is not None:
            assert patient["departure"] >= last_end - 1e-8


def test_visual_resource_ids_do_not_overlap():
    data = run_bridge()
    intervals = defaultdict(list)
    for patient in data["patients"]:
        for stage in patient["stages"]:
            if stage["resource_id"] is not None and stage["service_start"] is not None:
                end = stage["service_end"] if stage["service_end"] is not None else data["config"]["duration"]
                intervals[(stage["stage"], stage["resource_id"])].append((stage["service_start"], end))

    for key, rows in intervals.items():
        rows.sort()
        for (_, previous_end), (next_start, _) in zip(rows, rows[1:]):
            assert next_start >= previous_end - 1e-7, key


def test_force_all_trauma():
    data = run_bridge(prob_trauma=1.0)
    assert data["patients"]
    assert {p["pathway"] for p in data["patients"]} == {"trauma"}
    assert all(any(s["stage"] == "trauma" for s in p["stages"]) for p in data["patients"])


def test_force_all_non_trauma_and_no_treatment():
    data = run_bridge(prob_trauma=0.0, non_trauma_treat_p=0.0)
    assert data["patients"]
    assert {p["pathway"] for p in data["patients"]} == {"non_trauma"}
    assert all(not any(s["stage"] == "non_trauma_treatment" for s in p["stages"]) for p in data["patients"])


def test_event_trace_matches_patient_stages():
    data = run_bridge()
    starts = {(e["id"], e.get("stage"), e["time"]) for e in data["events"] if e["type"] == "start_service"}
    departures = {(e["id"], e["time"]) for e in data["events"] if e["type"] == "departure"}
    for p in data["patients"]:
        for s in p["stages"]:
            if s["service_start"] is not None and s["service_start"] <= data["config"]["duration"]:
                assert (p["id"], s["stage"], s["service_start"]) in starts
        if p["departure"] is not None and p["departure"] <= data["config"]["duration"]:
            assert (p["id"], p["departure"]) in departures
