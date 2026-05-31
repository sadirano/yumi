from __future__ import annotations


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_add_youtube_and_dedupe(client):
    r = client.post("/api/items", json={
        "url": "https://youtu.be/dQw4w9WgXcQ",
        "tags": ["music", "Classic"],
        "status": "to-watch",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["kind"] == "youtube"
    assert body["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert body["title"] == "Stub Title"
    assert body["duration_sec"] == 123
    assert sorted(t["name"] for t in body["tags"]) == ["classic", "music"]

    # Re-add the same canonical url via a different surface form -> 409
    r2 = client.post("/api/items", json={
        "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s",
    })
    assert r2.status_code == 409
    assert r2.json()["detail"]["existing_id"] == body["id"]


def test_patch_tags_and_notes(client):
    item = client.post("/api/items", json={"url": "https://youtu.be/abc123"}).json()
    r = client.patch(f"/api/items/{item['id']}", json={
        "notes_md": "watched on a rickroll bender",
        "tags": ["rickroll", "lol"],
        "status": "watched",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "watched"
    assert "rickroll" in body["notes_md"]
    assert sorted(t["name"] for t in body["tags"]) == ["lol", "rickroll"]


def test_patch_snapshot_flag(client):
    """Inline grid tag edits (snapshot=false) must skip revision history,
    while normal edits still record it."""
    item = client.post("/api/items", json={"url": "https://youtu.be/snap1"}).json()
    iid = item["id"]

    def rev_count():
        return len(client.get(f"/api/items/{iid}/revisions").json())

    # Normal edit -> snapshots prior state.
    client.patch(f"/api/items/{iid}", json={"tags": ["a"]})
    assert rev_count() == 1

    # Lightweight grid edit -> no new revision.
    r = client.patch(f"/api/items/{iid}", params={"snapshot": "false"}, json={"tags": ["a", "b"]})
    assert r.status_code == 200
    assert sorted(t["name"] for t in r.json()["tags"]) == ["a", "b"]
    assert rev_count() == 1

    # Normal edit again -> history still works (snapshots the ["a","b"] state).
    client.patch(f"/api/items/{iid}", json={"tags": ["a", "b", "c"]})
    assert rev_count() == 2


def test_fts_search(client):
    a = client.post("/api/items", json={"url": "https://youtu.be/aaa"}).json()
    b = client.post("/api/items", json={"url": "https://youtu.be/bbb"}).json()
    client.patch(f"/api/items/{a['id']}", json={"notes_md": "uniqueword zebra"})
    client.patch(f"/api/items/{b['id']}", json={"notes_md": "completely different"})

    r = client.get("/api/items", params={"q": "zebra"})
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()]
    assert a["id"] in ids
    assert b["id"] not in ids


def test_tag_and_and_not(client):
    items = []
    for i, url in enumerate(["https://youtu.be/x1", "https://youtu.be/x2", "https://youtu.be/x3"]):
        it = client.post("/api/items", json={"url": url}).json()
        items.append(it)
    # x1: rust + tutorial   x2: rust + beginner   x3: tutorial only
    client.patch(f"/api/items/{items[0]['id']}", json={"tags": ["rust", "tutorial"]})
    client.patch(f"/api/items/{items[1]['id']}", json={"tags": ["rust", "beginner"]})
    client.patch(f"/api/items/{items[2]['id']}", json={"tags": ["tutorial"]})

    r = client.get("/api/items", params={"tags": "rust,tutorial", "tag_op": "AND"})
    ids = [i["id"] for i in r.json()]
    assert ids == [items[0]["id"]]

    r = client.get("/api/items", params={"tags": "rust", "exclude_tags": "beginner"})
    ids = [i["id"] for i in r.json()]
    assert ids == [items[0]["id"]]

    r = client.get("/api/items", params={"tags": "rust,tutorial", "tag_op": "OR"})
    ids = sorted(i["id"] for i in r.json())
    assert ids == sorted(it["id"] for it in items)


def test_soft_delete_restore_purge(client):
    item = client.post("/api/items", json={"url": "https://youtu.be/del1"}).json()
    assert client.delete(f"/api/items/{item['id']}").status_code == 204

    # Not in main list
    r = client.get("/api/items")
    assert all(i["id"] != item["id"] for i in r.json())

    # In trash
    r = client.get("/api/trash")
    assert any(i["id"] == item["id"] for i in r.json())

    # Restore
    r = client.post(f"/api/items/{item['id']}/restore")
    assert r.status_code == 200

    # Purge after re-delete
    assert client.delete(f"/api/items/{item['id']}").status_code == 204
    assert client.delete(f"/api/items/{item['id']}/purge").status_code == 204
    assert client.get(f"/api/items/{item['id']}").status_code == 404


def test_saved_filters_crud(client):
    space = client.post("/api/spaces", json={
        "name": "Music", "namespaces": ["mood"], "tags": [],
    }).json()

    # Empty to start
    assert client.get(f"/api/spaces/{space['id']}/filters").json() == []

    # Create
    params = {"tagExpr": "mood:calm AND mood:soft", "tags": "mood:calm,mood:soft",
              "tag_op": "AND", "sort": "title"}
    f = client.post(f"/api/spaces/{space['id']}/filters",
                    json={"name": "Calm and Soft", "params": params})
    assert f.status_code == 201
    fid = f.json()["id"]
    assert f.json()["params"] == params

    # List round-trips the params verbatim
    listed = client.get(f"/api/spaces/{space['id']}/filters").json()
    assert len(listed) == 1
    assert listed[0]["params"] == params

    # Rename
    assert client.patch(f"/api/saved-filters/{fid}",
                        json={"name": "Calm"}).json()["name"] == "Calm"

    # Deleting the space cascades the filter away
    assert client.delete(f"/api/spaces/{space['id']}").status_code == 204
    assert client.delete(f"/api/saved-filters/{fid}").status_code == 404


def test_freeform_note(client):
    r = client.post("/api/items", json={
        "note_title": "shower thought",
        "note_body": "what if tags were just keys",
        "tags": ["ideas"],
    })
    assert r.status_code == 201
    body = r.json()
    assert body["kind"] == "note"
    assert body["title"] == "shower thought"


def test_tag_autocomplete(client):
    item = client.post("/api/items", json={"url": "https://youtu.be/tag1"}).json()
    client.patch(f"/api/items/{item['id']}", json={"tags": ["rust", "runtime", "react"]})
    r = client.get("/api/tags", params={"prefix": "ru"})
    names = [t["name"] for t in r.json()]
    assert set(names) == {"rust", "runtime"}
