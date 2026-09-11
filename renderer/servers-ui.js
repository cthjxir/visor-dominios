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

// Doble click deja lanzar el curl de un servidor puntual; editar se movio al
// clic derecho para no competir con ese gesto (ver openServerContextMenu).
function renderServerList(container, servers, domainsById, loadingIds, onQuery) {
  container.textContent = '';

  if (servers.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'rail__empty';
    empty.textContent = 'Ninguno todavía.';
    container.appendChild(empty);
    return;
  }

  for (const server of servers) {
    const loading = loadingIds.has(server.id);
    const queried = domainsById.has(server.id);
    const entry = domainsById.get(server.id);
    const counts = countDomains(entry);

    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'server';
    if (loading) button.classList.add('server--pending');
    else if (!queried) button.classList.add('server--unqueried');
    else if (!counts) button.classList.add('server--down');
    button.setAttribute('aria-label', `${server.alias} — doble clic para consultar, clic derecho para editar`);

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
    appendBreakable(host, server.host);
    // El 10000 es el puerto por defecto de Virtualmin: solo estorba mostrarlo.
    if (Number(server.port) !== 10000) {
      const port = document.createElement('span');
      port.className = 'server__port';
      port.textContent = `:${server.port}`;
      host.appendChild(port);
    }

    const meta = document.createElement('span');
    meta.className = 'server__meta';
    if (loading) meta.textContent = 'consultando…';
    else if (!queried) meta.textContent = 'doble clic para consultar';
    else if (counts) {
      meta.textContent = `${plural(counts.parents, 'dominio', 'dominios')} · ${plural(counts.children, 'subdominio', 'subdominios')}`;
    } else {
      meta.textContent = 'sin conexión';
      if (entry?.error) meta.title = entry.error;
    }

    body.append(alias, host, meta);
    button.append(state, body);
    button.addEventListener('dblclick', () => onQuery(server));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      openServerContextMenu(event.clientX, event.clientY, server, { queried, onQuery });
    });
    item.appendChild(button);
    container.appendChild(item);
  }
}

const EDIT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.83 2.83 0 0 1 4 4L7 21l-4 1 1-4Z"/></svg>';
const CONNECT_ICON_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a8 8 0 0 1 16 0"/>'
  + '<path d="M1 10a12 12 0 0 1 22 0"/><line x1="12" y1="18" x2="12" y2="22"/></svg>';

function buildMenuItem(iconSvg, label, onClick) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'server-context-menu__item';
  item.innerHTML = iconSvg;
  const span = document.createElement('span');
  span.textContent = label;
  item.appendChild(span);
  item.addEventListener('click', onClick);
  return item;
}

// Menu contextual: Conectar (solo si el servidor aun no se consulto) y
// Editar, en la posicion del clic derecho. Se cierra solo al elegir, perder
// foco o presionar Escape.
let closeServerContextMenu = () => {};
function openServerContextMenu(x, y, server, { queried, onQuery } = {}) {
  closeServerContextMenu();

  const menu = document.createElement('div');
  menu.className = 'server-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (!queried) {
    menu.appendChild(buildMenuItem(CONNECT_ICON_SVG, 'Conectar', () => {
      close();
      onQuery(server);
    }));
  }
  const editItem = buildMenuItem(EDIT_ICON_SVG, 'Editar', () => {
    close();
    openServerDialogForEdit(server);
  });
  menu.appendChild(editItem);
  document.body.appendChild(menu);

  // Se posiciona primero fuera de pantalla si hace falta (el menu no puede
  // salirse del viewport hacia la derecha/abajo del clic), y recien entonces
  // se anima la entrada, ya con su tamano y lugar final definitivos.
  const rect = menu.getBoundingClientRect();
  const maxLeft = window.innerWidth - rect.width - 8;
  const maxTop = window.innerHeight - rect.height - 8;
  if (rect.left > maxLeft) menu.style.left = `${Math.max(8, maxLeft)}px`;
  if (rect.top > maxTop) menu.style.top = `${Math.max(8, maxTop)}px`;
  requestAnimationFrame(() => menu.classList.add('is-open'));
  menu.querySelector('.server-context-menu__item').focus();

  function close() {
    menu.remove();
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    closeServerContextMenu = () => {};
  }
  function onOutside(event) {
    if (!menu.contains(event.target)) close();
  }
  function onKey(event) {
    if (event.key === 'Escape') close();
  }
  document.addEventListener('pointerdown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  closeServerContextMenu = close;
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

  const importFile = document.getElementById('import-file');
  document.getElementById('btn-import-servers').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    try {
      const res = await fetch(`${BACKEND_URL}/servers/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      });
      const data = await res.json();
      const msg = `${data.added} servidor(es) importado(s).`;
      alert(data.errors.length ? `${msg}\n\nErrores:\n${data.errors.join('\n')}` : msg);
      onSaved();
    } catch (err) {
      alert(`No se pudo importar: ${err.message}`);
    } finally {
      importFile.value = '';
    }
  });

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
        const res = await fetch(`${BACKEND_URL}/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          btnSave.dataset.state = 'error';
          setTestResult(data.error || `No se pudo guardar (${res.status}).`, 'error');
          return;
        }
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
