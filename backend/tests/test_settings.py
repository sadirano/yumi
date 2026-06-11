from __future__ import annotations


def test_settings_roundtrip(client):
    assert client.get("/api/settings").json() == {}

    r = client.put("/api/settings/counter-tags", json={"value": ["source:anime", "type:task"]})
    assert r.status_code == 200
    assert r.json() == {"key": "counter-tags", "value": ["source:anime", "type:task"]}

    assert client.get("/api/settings").json() == {"counter-tags": ["source:anime", "type:task"]}

    # Overwrite wins; arbitrary JSON values are allowed.
    client.put("/api/settings/counter-tags", json={"value": ["source:manga"]})
    client.put("/api/settings/theme", json={"value": {"dark": True}})
    assert client.get("/api/settings").json() == {
        "counter-tags": ["source:manga"],
        "theme": {"dark": True},
    }
