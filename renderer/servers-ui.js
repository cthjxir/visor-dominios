const dialog = document.getElementById('server-dialog');
const form = document.getElementById('server-form');
const formTitle = document.getElementById('server-form-title');
const testResult = document.getElementById('test-result');
const btnDelete = document.getElementById('btn-delete');
const btnTest = document.getElementById('btn-test');
const btnSave = document.getElementById('btn-save');

function plural(count, singular, pluralWord) {
  return `${count} ${count === 1 ? singular : pluralWord}`;
}

function countDomains(entry) {
  if (!entry || entry.error) return null;
  const parents = entry.groups.length;
  const children = entry.groups.reduce((sum, group) => sum + group.children.length, 0);
  return { parents, children };
}

function renderServerList(container, servers, domainsById) {
  container.textContent = '';

  if (servers.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'rail__empty';
    empty.textContent = 'Ninguno todavía.';
    container.appendChild(empty);
    return;
  }

  for (const server of servers) {
    const entry = domainsById.get(server.id);
    const counts = countDomains(entry);

    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = counts ? 'server' : 'server server--down';
    button.setAttribute('aria-label', `Editar ${server.alias}`);

    const state = document.createElement('span');
    state.className = 'server__state';
    state.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = 'server__body';

    const alias = document.createElement('span');
    alias.className = 'server__alias';
    alias.textContent = server.alias;

    const host = document.createElement('span');
    host.className = 'server__host';
    host.textContent = `${server.host}:${server.port}`;

    const meta = document.createElement('span');
    meta.className = 'server__meta';
    meta.textContent = counts
      ? `${plural(counts.parents, 'dominio', 'dominios')} · ${plural(counts.children, 'subdominio', 'subdominios')}`
      : 'sin conexión';
    if (!counts && entry?.error) meta.title = entry.error;

    body.append(alias, host, meta);
    button.append(state, body);
    button.addEventListener('click', () => openServerDialogForEdit(server));
    item.appendChild(button);
    container.appendChild(item);
  }
}

function setTestResult(message, state) {
  testResult.textContent = message;
  if (state) testResult.dataset.state = state;
  else delete testResult.dataset.state;
}

function openServerDialogForCreate() {
  form.reset();
  form.id.value = '';
  formTitle.textContent = 'Nuevo servidor';
  btnDelete.hidden = true;
  setTestResult('');
  dialog.showModal();
  form.alias.focus();
}

function openServerDialogForEdit(server) {
  form.reset();
  form.id.value = server.id;
  form.alias.value = server.alias;
  form.host.value = server.host;
  form.port.value = server.port;
  form.username.value = server.username;
  formTitle.textContent = `Editar ${server.alias}`;
  btnDelete.hidden = false;
  setTestResult('');
  dialog.showModal();
  form.alias.focus();
}

function initServersUI(onSaved) {
  document.getElementById('btn-add-server').addEventListener('click', openServerDialogForCreate);
  document.getElementById('btn-cancel').addEventListener('click', () => dialog.close());

  btnTest.addEventListener('click', async () => {
    btnTest.dataset.state = 'loading';
    setTestResult('Probando…');
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
      btnTest.dataset.state = data.ok ? 'success' : 'error';
      setTestResult(data.ok ? 'Conexión correcta.' : data.error, data.ok ? 'ok' : 'error');
    } catch (err) {
      btnTest.dataset.state = 'error';
      setTestResult(err.message, 'error');
    }
  });

  btnDelete.addEventListener('click', async () => {
    if (!confirm(`¿Eliminar ${form.alias.value || 'este servidor'}? Se borran también sus credenciales guardadas.`)) return;
    await fetch(`${BACKEND_URL}/servers/${form.id.value}`, { method: 'DELETE' });
    dialog.close();
    onSaved();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const payload = {
      alias: form.alias.value,
      host: form.host.value,
      port: Number(form.port.value),
      username: form.username.value,
    };
    if (form.password.value) payload.password = form.password.value;

    btnSave.dataset.state = 'loading';
    try {
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
    } catch (err) {
      btnSave.dataset.state = 'error';
      setTestResult(`No se pudo guardar: ${err.message}`, 'error');
      return;
    }
    delete btnSave.dataset.state;
  });

  // Al cerrar la hoja se limpian los estados transitorios de los botones.
  dialog.addEventListener('close', () => {
    delete btnTest.dataset.state;
    delete btnSave.dataset.state;
  });
}
