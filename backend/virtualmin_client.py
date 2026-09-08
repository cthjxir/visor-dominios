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


def group_domains(raw, host=None):
    """Agrupa dominios por IP publica y elige el padre de cada grupo.

    El dominio que coincide con el host registrado del servidor es siempre el
    padre; solo cuando ninguno coincide se usa default_website_for_ip de
    Virtualmin, y como ultimo recurso se promueve el primer dominio del grupo.
    """
    by_ip = {}
    for entry in raw:
        name = entry.get("name")
        values = entry.get("values", {})
        ip = (values.get("external_ip_address") or [None])[0]
        is_default = (values.get("default_website_for_ip") or ["No"])[0] == "Yes"

        group = by_ip.setdefault(ip, {"default": None, "names": [], "details": {}})
        group["names"].append(name)
        group["details"][name] = values
        if is_default:
            group["default"] = name

    groups = []
    for ip, group in by_ip.items():
        names = group["names"]
        parent = next((n for n in names if n == host), None) or group["default"]
        if parent is None and names:
            parent = names[0]
        children = [n for n in names if n != parent]
        groups.append({
            "ip": ip, "parent": parent, "children": children, "details": group["details"],
        })
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

    # Sin host: manda default_website_for_ip.
    groups = group_domains(sample_raw)
    assert len(groups) == 1
    assert groups[0]["parent"] == "ptecnologias.salamanca.gob.mx"
    assert set(groups[0]["children"]) == {
        "pruebamapa.salamanca.gob.mx",
        "prafipaco.salamanca.gob.mx",
    }
    assert groups[0]["details"]["ptecnologias.salamanca.gob.mx"]["external_ip_address"] == [
        "201.132.34.163",
    ]

    # Con host: el host es el padre aunque Virtualmin marque otro como default.
    groups = group_domains(sample_raw, host="prafipaco.salamanca.gob.mx")
    assert groups[0]["parent"] == "prafipaco.salamanca.gob.mx"
    assert set(groups[0]["children"]) == {
        "ptecnologias.salamanca.gob.mx",
        "pruebamapa.salamanca.gob.mx",
    }
    print("group_domains OK:", groups)
