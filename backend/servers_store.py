"""CRUD de servidores Virtualmin sobre servers.json (escritura atomica).

El password nunca se guarda aqui: vive en el keychain via credentials.py,
indexado por server_id.
"""

import json
import os
import uuid
from pathlib import Path

import platformdirs

import credentials


def _store_path():
    data_dir = Path(platformdirs.user_data_dir("visor-dominios", appauthor=False))
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "servers.json"


def _read_all():
    path = _store_path()
    if not path.exists():
        return []
    with open(path) as f:
        return json.load(f)


def _write_all(servers):
    path = _store_path()
    tmp_path = path.with_name(path.name + ".tmp")
    with open(tmp_path, "w") as f:
        json.dump(servers, f, indent=2)
    os.replace(tmp_path, path)


def list_servers():
    return _read_all()


def add_server(alias, host, port, username, password):
    servers = _read_all()
    server_id = str(uuid.uuid4())
    servers.append(
        {"id": server_id, "alias": alias, "host": host, "port": port, "username": username}
    )
    _write_all(servers)
    credentials.set_password(server_id, password)
    return server_id


def update_server(server_id, password=None, **fields):
    servers = _read_all()
    for server in servers:
        if server["id"] == server_id:
            server.update(fields)
            break
    else:
        raise KeyError(server_id)
    _write_all(servers)
    if password is not None:
        credentials.set_password(server_id, password)


def delete_server(server_id):
    servers = [s for s in _read_all() if s["id"] != server_id]
    _write_all(servers)
    credentials.delete_password(server_id)


def get_server_with_password(server_id):
    for server in _read_all():
        if server["id"] == server_id:
            return {**server, "password": credentials.get_password(server_id)}
    return None


if __name__ == "__main__":
    server_id = add_server(
        alias="Test Ponytail", host="example.invalid", port=10000,
        username="testuser", password="testpass123",
    )
    assert any(s["id"] == server_id for s in list_servers())

    full = get_server_with_password(server_id)
    assert full["password"] == "testpass123"
    assert full["alias"] == "Test Ponytail"

    update_server(server_id, alias="Renamed", password="newpass456")
    full = get_server_with_password(server_id)
    assert full["alias"] == "Renamed"
    assert full["password"] == "newpass456"

    delete_server(server_id)
    assert not any(s["id"] == server_id for s in list_servers())
    assert credentials.get_password(server_id) is None

    print("servers_store OK")
