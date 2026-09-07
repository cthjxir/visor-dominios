"""Cliente minimo para la API remota de Virtualmin (list-domains)."""

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def list_domains(host, port, username, password, timeout=15):
    """Devuelve la lista cruda de dominios (data[]) de un servidor Virtualmin."""
    url = f"https://{host}:{port}/virtual-server/remote.cgi"
    params = {"program": "list-domains", "multiline": "", "json": "1"}
    resp = requests.get(
        url, params=params, auth=(username, password), verify=False, timeout=timeout
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def group_domains(raw):
    """Agrupa dominios por IP publica, identificando el padre (default_website_for_ip)."""
    by_ip = {}
    for entry in raw:
        name = entry.get("name")
        values = entry.get("values", {})
        ip = (values.get("external_ip_address") or [None])[0]
        is_default = (values.get("default_website_for_ip") or ["No"])[0] == "Yes"

        group = by_ip.setdefault(ip, {"parent": None, "children": []})
        if is_default:
            group["parent"] = name
        else:
            group["children"].append(name)

    groups = []
    for ip, group in by_ip.items():
        parent = group["parent"]
        children = group["children"]
        if parent is None and children:
            # ponytail: ningun dominio marcado como default en esta IP; se
            # promueve el primero como padre. Ajustar si aparece un caso real
            # donde esto no sea lo esperado.
            parent = children.pop(0)
        groups.append({"ip": ip, "parent": parent, "children": children})
    return groups


if __name__ == "__main__":
    sample_raw = [
        {
            "name": "ptecnologias.salamanca.gob.mx",
            "values": {
                "external_ip_address": ["201.132.34.163"],
                "default_website_for_ip": ["Yes"],
            },
        },
        {
            "name": "pruebamapa.salamanca.gob.mx",
            "values": {
                "external_ip_address": ["201.132.34.163"],
                "default_website_for_ip": ["No"],
            },
        },
        {
            "name": "prafipaco.salamanca.gob.mx",
            "values": {
                "external_ip_address": ["201.132.34.163"],
                "default_website_for_ip": ["No"],
            },
        },
    ]

    groups = group_domains(sample_raw)
    assert len(groups) == 1
    assert groups[0]["ip"] == "201.132.34.163"
    assert groups[0]["parent"] == "ptecnologias.salamanca.gob.mx"
    assert set(groups[0]["children"]) == {
        "pruebamapa.salamanca.gob.mx",
        "prafipaco.salamanca.gob.mx",
    }
    print("group_domains OK:", groups)
