
from fastapi.testclient import TestClient

from symbiosis_x.main import create_app


def test_live_probe(tmp_path):
    app = create_app(database_path=tmp_path / "live.sqlite3")

    with TestClient(app) as client:
        response = client.get("/health/live")

        assert response.status_code == 200
        assert response.json() == {"status": "alive"}
