"""Backend Flask local: expone servidores/dominios de Virtualmin a Electron."""

import logging

from flask import Flask, jsonify, request

import servers_store
import virtualmin_client

app = Flask(__name__)
logging.getLogger("werkzeug").setLevel(logging.WARNING)


@app.after_request
def allow_local_cors(response):
    # La app renderer corre en origen file:// / null; sin este header el
    # navegador bloquea la lectura de la respuesta al backend en 127.0.0.1.
    # Los otros dos headers son para el preflight OPTIONS que el navegador
    # manda antes de todo POST/PUT/DELETE con body JSON (guardar, editar,
    # borrar o probar un servidor): sin ellos el preflight se rechaza y la
    # petición real nunca sale, viéndose como "Failed to fetch".
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/servers")
def get_servers():
    return jsonify(servers_store.list_servers())


@app.post("/servers")
def create_server():
    body = request.get_json()
    server_id = servers_store.add_server(
        alias=body["alias"],
        host=body["host"],
        port=int(body.get("port", 10000)),
        username=body["username"],
        password=body["password"],
    )
    return jsonify({"id": server_id}), 201


@app.put("/servers/<server_id>")
def edit_server(server_id):
    body = request.get_json()
    password = body.pop("password", None)
    if "port" in body:
        body["port"] = int(body["port"])
    try:
        servers_store.update_server(server_id, password=password, **body)
    except KeyError:
        return jsonify({"error": "servidor no encontrado"}), 404
    return jsonify({"ok": True})


@app.delete("/servers/<server_id>")
def remove_server(server_id):
    servers_store.delete_server(server_id)
    return jsonify({"ok": True})


@app.post("/servers/<server_id>/test")
def test_saved_server(server_id):
    server = servers_store.get_server_with_password(server_id)
    if server is None:
        return jsonify({"ok": False, "error": "servidor no encontrado"}), 404
    return _test_connection(server["host"], server["port"], server["username"], server["password"])


@app.post("/connection-test")
def test_draft_connection():
    body = request.get_json()
    return _test_connection(
        body["host"], int(body.get("port", 10000)), body["username"], body["password"]
    )


def _test_connection(host, port, username, password):
    try:
        virtualmin_client.list_domains(host, port, username, password)
        return jsonify({"ok": True})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)})


@app.get("/servers/<server_id>/domains")
def get_server_domains(server_id):
    full = servers_store.get_server_with_password(server_id)
    if full is None:
        return jsonify({"error": "servidor no encontrado"}), 404
    return jsonify(_domain_entry(full))


def _domain_entry(server):
    entry = {
        "server_id": server["id"],
        "alias": server["alias"],
        "host": server["host"],
        "error": None,
        "groups": [],
    }
    try:
        raw = virtualmin_client.list_domains(
            server["host"], server["port"], server["username"], server["password"]
        )
        entry["groups"] = virtualmin_client.group_domains(raw)
    except Exception as exc:
        entry["error"] = str(exc)
    return entry


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=57843)
