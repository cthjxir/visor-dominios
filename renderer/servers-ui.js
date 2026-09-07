const dialog = document.getElementById('server-dialog');
const form = document.getElementById('server-form');
const formTitle = document.getElementById('server-form-title');
const testResult = document.getElementById('test-result');
const btnDelete = document.getElementById('btn-delete');

function renderServerBar(container, servers) {
  container.textContent = '';
  for (const server of servers) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'server-chip';
    chip.textContent = `${server.alias} ✎`;
    chip.addEventListener('click', () => openServerDialogForEdit(server));
    container.appendChild(chip);
  }
}

function openServerDialogForCreate() {
  form.reset();
  form.id.value = '';
  formTitle.textContent = 'Nuevo servidor';
  btnDelete.hidden = true;
  testResult.textContent = '';
  dialog.showModal();
}

function openServerDialogForEdit(server) {
  form.reset();
  form.id.value = server.id;
  form.alias.value = server.alias;
  form.host.value = server.host;
  form.port.value = server.port;
  form.username.value = server.username;
  formTitle.textContent = 'Editar servidor';
  btnDelete.hidden = false;
  testResult.textContent = '';
  dialog.showModal();
}

function initServersUI(onSaved) {
  document.getElementById('btn-add-server').addEventListener('click', openServerDialogForCreate);
  document.getElementById('btn-cancel').addEventListener('click', () => dialog.close());

  document.getElementById('btn-test').addEventListener('click', async () => {
    testResult.textContent = 'Probando...';
    try {
      const usingSavedPassword = form.id.value && !form.password.value;
      const res = usingSavedPassword
        ? await fetch(`${BACKEND_URL}/servers/${form.id.value}/test`, { method: 'POST' })
        : await fetch(`${BACKEND_URL}/connection-test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host: form.host.value,
              port: Number(form.port.value),
              username: form.username.value,
              password: form.password.value,
            }),
          });
      const data = await res.json();
      testResult.textContent = data.ok ? 'Conexion OK' : `Error: ${data.error}`;
    } catch (err) {
      testResult.textContent = `Error: ${err.message}`;
    }
  });

  btnDelete.addEventListener('click', async () => {
    if (!confirm('¿Eliminar este servidor?')) return;
    await fetch(`${BACKEND_URL}/servers/${form.id.value}`, { method: 'DELETE' });
    dialog.close();
    onSaved();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      alias: form.alias.value,
      host: form.host.value,
      port: Number(form.port.value),
      username: form.username.value,
    };
    if (form.password.value) payload.password = form.password.value;

    if (form.id.value) {
      await fetch(`${BACKEND_URL}/servers/${form.id.value}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      payload.password = payload.password || '';
      await fetch(`${BACKEND_URL}/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    dialog.close();
    onSaved();
  });
}
