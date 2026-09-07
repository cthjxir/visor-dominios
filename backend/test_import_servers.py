"""Self-check del endpoint /servers/import: parseo CSV y reporte de errores."""

import app as app_module

calls = []


def _fake_add(**kw):
    if any(c["host"] == kw["host"] and c["username"] == kw["username"] for c in calls):
        raise ValueError("ya existe")
    calls.append(kw)


app_module.servers_store.add_server = _fake_add
client = app_module.app.test_client()

csv = "alias,host,username,password,port\nA,a.example,admin,pw1,20000\nB,b.example,root,pw2,\n"
res = client.post("/servers/import", data=csv, content_type="text/csv")
assert res.get_json() == {"added": 2, "errors": []}, res.get_json()
assert calls[0] == {"alias": "A", "host": "a.example", "port": 20000,
                    "username": "admin", "password": "pw1"}
assert calls[1]["port"] == 10000  # puerto vacio -> por defecto

calls.clear()
res = client.post("/servers/import", data="alias,host\nX,x.example\n", content_type="text/csv")
body = res.get_json()
assert body["added"] == 0 and len(body["errors"]) == 1, body  # falta 'username'

calls.clear()
dup = "alias,host,username,password\nA,a.example,admin,pw\nA2,a.example,admin,pw\n"
res = client.post("/servers/import", data=dup, content_type="text/csv")
body = res.get_json()
assert body["added"] == 1 and len(body["errors"]) == 1, body  # 2a fila duplicada

print("import_servers OK")
