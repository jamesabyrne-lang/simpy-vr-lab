"""SimPy model used by the browser-based SimPy VR Lab demo.

A finite-horizon multi-server security checkpoint. Passengers arrive according to
an exponential interarrival process and request one of a configurable number of
screening resources. Service times are Gamma-distributed so the coefficient of
variation can be changed independently of the mean.
"""

import random
import statistics
import simpy


def run_simulation(
    arrival_rate=0.55,
    mean_service=4.2,
    servers=3,
    duration=120.0,
    variability=0.65,
    seed=17,
):
    arrival_rate = max(float(arrival_rate), 0.01)
    mean_service = max(float(mean_service), 0.05)
    servers = max(1, int(servers))
    duration = max(float(duration), 5.0)
    variability = max(float(variability), 0.05)
    seed = int(seed)

    rng = random.Random(seed)
    env = simpy.Environment()
    checkpoint = simpy.Resource(env, capacity=servers)
    free_server_ids = list(range(servers))

    passengers = []
    events = []
    max_queue = 0
    busy_intervals = []

    def log(kind, pid, **extra):
        item = {"time": round(env.now, 6), "type": kind, "id": pid}
        item.update(extra)
        events.append(item)

    def service_sample():
        # Gamma distribution parameterised by mean and coefficient of variation.
        shape = 1.0 / (variability * variability)
        scale = mean_service / shape
        return max(0.05, rng.gammavariate(shape, scale))

    def passenger(pid, arrival_time):
        nonlocal max_queue

        record = {
            "id": pid,
            "arrival": round(arrival_time, 6),
            "queue_enter": round(arrival_time, 6),
            "service_start": None,
            "departure": None,
            "server": None,
            "service_time": None,
        }
        passengers.append(record)
        log("arrival", pid)

        with checkpoint.request() as request:
            # A SimPy Request is enqueued immediately if all resources are busy.
            # Using the Resource queue directly avoids counting zero-wait customers
            # as a one-person queue.
            waiting_now = len(checkpoint.queue)
            max_queue = max(max_queue, waiting_now)
            log("queue_join", pid, queue=waiting_now)

            yield request

            server_id = min(free_server_ids)
            free_server_ids.remove(server_id)
            start = env.now
            service_time = service_sample()
            departure = start + service_time

            record["service_start"] = round(start, 6)
            record["departure"] = round(departure, 6)
            record["server"] = server_id
            record["service_time"] = round(service_time, 6)
            log("service_start", pid, server=server_id, queue=len(checkpoint.queue))

            busy_intervals.append((start, min(departure, duration)))
            try:
                yield env.timeout(service_time)
                log("departure", pid, server=server_id)
            finally:
                free_server_ids.append(server_id)
                free_server_ids.sort()

    def source():
        pid = 1
        while True:
            interarrival = rng.expovariate(arrival_rate)
            yield env.timeout(interarrival)
            if env.now >= duration:
                return
            env.process(passenger(pid, env.now))
            pid += 1

    env.process(source())
    env.run(until=duration)

    arrived = [p for p in passengers if p["arrival"] < duration]
    started = [p for p in arrived if p["service_start"] is not None and p["service_start"] < duration]
    departed = [p for p in arrived if p["departure"] is not None and p["departure"] <= duration]

    waits = [p["service_start"] - p["arrival"] for p in started]
    systems = [p["departure"] - p["arrival"] for p in departed]
    busy_time = sum(max(0.0, end - start) for start, end in busy_intervals if end > start)

    metrics = {
        "arrivals": len(arrived),
        "throughput": len(departed),
        "mean_wait": round(statistics.fmean(waits), 3) if waits else 0.0,
        "p95_wait": round(sorted(waits)[max(0, int(0.95 * len(waits)) - 1)], 3) if waits else 0.0,
        "mean_time_in_system": round(statistics.fmean(systems), 3) if systems else 0.0,
        "utilisation": round(busy_time / (servers * duration), 4),
        "max_queue": max_queue,
        "left_in_system": len(arrived) - len(departed),
    }

    return {
        "params": {
            "arrival_rate": arrival_rate,
            "mean_service": mean_service,
            "servers": servers,
            "duration": duration,
            "variability": variability,
            "seed": seed,
        },
        "metrics": metrics,
        "passengers": passengers,
        "events": events,
    }
