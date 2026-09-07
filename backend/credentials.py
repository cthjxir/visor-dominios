"""Wrapper de keyring: passwords de Virtualmin en el keychain del SO, nunca en disco."""

import keyring
import keyring.errors

SERVICE_NAME = "visor-dominios"


def set_password(server_id, password):
    keyring.set_password(SERVICE_NAME, server_id, password)


def get_password(server_id):
    return keyring.get_password(SERVICE_NAME, server_id)


def delete_password(server_id):
    try:
        keyring.delete_password(SERVICE_NAME, server_id)
    except keyring.errors.PasswordDeleteError:
        pass
