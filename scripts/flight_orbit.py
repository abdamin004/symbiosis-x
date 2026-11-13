"""Build an ideal two-body navigation reference for the fictional Flight demo."""

from math import cos, pi, sin, sqrt

EARTH_RADIUS_KM = 6371.0
EARTH_MU_KM3_S2 = 398600.4418
SAMPLE_COUNT = 360


def orbit_reference(apoapsis_km: float, periapsis_km: float) -> dict:
    """Sample an ellipse at uniform times, starting at apoapsis."""
    if not -EARTH_RADIUS_KM < periapsis_km <= apoapsis_km:
        raise ValueError("Invalid apsides")
    apoapsis = EARTH_RADIUS_KM + apoapsis_km
    periapsis = EARTH_RADIUS_KM + periapsis_km
    axis = (apoapsis + periapsis) / 2
    eccentricity = (apoapsis - periapsis) / (apoapsis + periapsis)
    period = 2 * pi * sqrt(axis**3 / EARTH_MU_KM3_S2)
    points = []
    for sample in range(SAMPLE_COUNT + 1):
        mean = pi + 2 * pi * sample / SAMPLE_COUNT
        anomaly = mean
        for _ in range(8):
            anomaly -= (anomaly - eccentricity * sin(anomaly) - mean) / (1 - eccentricity * cos(anomaly))
        radius = axis * (1 - eccentricity * cos(anomaly))
        points.append([
            round(axis * (cos(anomaly) - eccentricity), 3),
            round(axis * sqrt(1 - eccentricity**2) * sin(anomaly), 3),
            round(sqrt(EARTH_MU_KM3_S2 * (2 / radius - 1 / axis)), 5),
        ])
    return {"ap": apoapsis_km, "pe": periapsis_km, "period": period, "points": points}


def tangential_delta_v(altitude_km: float, before_other_apsis_km: float, after_other_apsis_km: float) -> float:
    """Ideal speed change in m/s at an apsis shared by two coplanar orbits."""
    radius = EARTH_RADIUS_KM + altitude_km

    def speed(other_apsis_km: float) -> float:
        axis = (radius + EARTH_RADIUS_KM + other_apsis_km) / 2
        return sqrt(EARTH_MU_KM3_S2 * (2 / radius - 1 / axis))

    return round(1000 * (speed(after_other_apsis_km) - speed(before_other_apsis_km)), 1)


def navigation_reference(ascent: dict) -> dict:
    insertion = ascent["insertion_profile"]
    ap = insertion["apoapsis_km"]
    parking_pe = insertion["target_periapsis_km"]
    station_altitude = 420
    parking = orbit_reference(ap, parking_pe)
    station = orbit_reference(station_altitude, station_altitude)
    transfer = orbit_reference(station_altitude, ap)
    # Leave at the first return to parking apoapsis. Seed a fictional station
    # ephemeris that is just ahead of the approach corridor on arrival.
    departure_s = round(parking["period"])
    transfer_s = round(transfer["period"] / 2)
    station_epoch_s = station["period"] * 0.501 - departure_s - transfer_s
    return {
        "earth": EARTH_RADIUS_KM,
        "parking": parking,
        "insertion": orbit_reference(ap, insertion["initial_periapsis_km"]),
        "station": station,
        "transfer": transfer,
        "departureS": departure_s,
        "transferS": transfer_s,
        "stationEpochS": station_epoch_s,
        "insertionDeltaV": tangential_delta_v(ap, insertion["initial_periapsis_km"], parking_pe),
        "transferDeltaV": tangential_delta_v(ap, parking_pe, station_altitude),
        "matchDeltaV": tangential_delta_v(station_altitude, ap, station_altitude),
        "rcsPulses": 12,
    }
