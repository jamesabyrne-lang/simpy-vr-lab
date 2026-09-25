"""Fixed-seed equivalence checks against treat-sim 3.0.0."""
import math
import sys
from pathlib import Path
import numpy as np
from treat_sim import model as upstream
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from stars_model import run_stars_simulation

SEEDS=[1,42,754]
RC=1140

def same(a,b,atol=1e-9):
    if math.isnan(float(a)) and math.isnan(float(b)):
        return True
    return bool(np.isclose(float(a),float(b),atol=atol,rtol=1e-10))

for seed in SEEDS:
    scenario=upstream.Scenario()
    expected_df=upstream.single_run(scenario,rc_period=RC,random_no_set=seed)
    expected=expected_df.iloc[0].to_dict()
    actual=run_stars_simulation(seed=seed,run_length=RC)
    got=actual["metrics"]["upstream"]
    failures=[]
    for key in upstream.RESULT_FIELDS:
        if not same(expected[key],got[key]):
            failures.append((key,expected[key],got[key]))
    if failures:
        raise AssertionError(f"Seed {seed} KPI mismatch: {failures}")
    scenario2=upstream.Scenario()
    scenario2.set_random_no_set(seed)
    model=upstream.TreatmentCentreModel(scenario2)
    model.run(results_collection_period=RC)
    expected_path={p.identifier:"trauma" for p in model.trauma_patients}
    expected_path.update({p.identifier:"non-trauma" for p in model.non_trauma_patients})
    actual_path={p["id"]:p["pathway"] for p in actual["patients"]}
    if expected_path!=actual_path:
        raise AssertionError(f"Seed {seed} patient pathway classification mismatch")
    print(f"seed={seed}: PASS ({len(actual_path)} arrivals; {got['09_throughput']} completed)")
print("All fixed-seed comparisons match treat-sim 3.0.0.")
