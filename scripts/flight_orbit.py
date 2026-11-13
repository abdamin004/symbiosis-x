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


def navigation_reference(ascent: dict) -> dict:
    insertion = ascent["insertion_profile"]
    ap = insertion["apoapsis_km"]
    return {
        "earth": EARTH_RADIUS_KM,
        "parking": orbit_reference(ap, insertion["target_periapsis_km"]),
        "insertion": orbit_reference(ap, insertion["initial_periapsis_km"]),
        "station": orbit_reference(420, 420),
        "rcsPulses": 12,
    }
