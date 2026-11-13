"""Verify the installed application can serve its OpenAPI document."""

from fastapi.testclient import TestClient

from symbiosis_x.main import create_app


def test_app_loads(tmp_path):
    database_path = tmp_path / "isolated.sqlite3"
    app = create_app(database_path=database_path)

    with TestClient(app) as client:
        response = client.get("/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"] == {"title": "SYMBIOSIS X", "version": "0.1.0"}
    assert app.state.database_path == database_path
