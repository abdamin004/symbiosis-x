from typing import Annotated

from fastapi import Depends
from fastapi.testclient import TestClient

from symbiosis_x.api.roles import require_role
from symbiosis_x.main import create_app


def test_ground_cannot_act_as_crew(tmp_path):
    app = create_app(database_path=tmp_path / "pilot.sqlite3", enable_local_demo=True)

    @app.post("/crew-probe", dependencies=[Depends(require_role("crew"))])
    def probe(role: Annotated[str, "ignored"] = ""):
        return {"ok": True}

    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 60000)) as client:
        session = client.post("/api/v1/demo/session")
        assert session.headers["Cache-Control"] == "no-store"
        tokens = session.json()
        assert len(set(tokens.values())) == 3
        ground = {"Authorization": "Bearer " + tokens["ground"]}
        assert client.post("/crew-probe?role=crew", json={"role": "crew"}, headers=ground).status_code == 403
        assert client.post("/api/v1/runs", json={"role": "facilitator"}, headers=ground).status_code == 403
        assert client.post("/crew-probe").status_code == 401
        assert client.post("/crew-probe", headers={"Authorization": "Bearer invalid"}).status_code == 401
        crew = {"Authorization": "Bearer " + tokens["crew"]}
        assert client.post("/crew-probe", headers=crew).status_code == 200
        assert client.post("/api/v1/demo/session", headers={"Origin": "http://foreign.test"}).status_code == 403

    with TestClient(app, base_url="http://127.0.0.1", client=("192.0.2.1", 60000)) as remote:
        assert remote.post("/api/v1/demo/session").status_code == 403
        assert remote.post("/crew-probe", headers=crew).status_code == 403
