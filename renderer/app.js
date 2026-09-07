const btnRefresh = document.getElementById('btn-refresh');

async function fetchJSON(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  return res.json();
}

function renderStatus(servers, domains) {
  const parents = domains.reduce((sum, entry) => sum + (entry.groups?.length || 0), 0);
  const children = domains.reduce(
    (sum, entry) => sum + (entry.groups || []).reduce((n, group) => n + group.children.length, 0),
    0,
  );
  const down = domains.filter((entry) => entry.error).length;

  const parts = [
    plural(servers.length, 'servidor', 'servidores'),
    plural(parents, 'dominio', 'dominios'),
    plural(children, 'subdominio', 'subdominios'),
  ];
  if (down > 0) parts.push(`${down} sin conexión`);

  document.getElementById('status-counts').textContent = parts.join(' · ');
  document.getElementById('status-time').textContent = `Actualizado ${new Date().toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function buildCanvasError(message) {
  const wrap = document.createElement('div');
  wrap.className = 'canvas__empty';
  const title = document.createElement('p');
  title.className = 'canvas__empty-title';
  title.textContent = 'El backend no responde';
  const text = document.createElement('p');
  text.className = 'canvas__empty-text';
  text.textContent = `${message}. Cierra y vuelve a abrir la aplicación; si persiste, revisa que el proceso del backend haya arrancado.`;
  wrap.append(title, text);
  return wrap;
}

async function refreshAll() {
  const root = document.getElementById('bubbles-root');
  btnRefresh.dataset.state = 'loading';
  try {
    const [servers, domains] = await Promise.all([fetchJSON('/servers'), fetchJSON('/domains')]);
    const domainsById = new Map(domains.map((entry) => [entry.server_id, entry]));
    renderServerList(document.getElementById('server-list'), servers, domainsById);
    renderBubbles(root, domains);
    renderStatus(servers, domains);
    delete btnRefresh.dataset.state;
  } catch (err) {
    btnRefresh.dataset.state = 'error';
    document.getElementById('status-counts').textContent = 'Sin conexión con el backend';
    root.textContent = '';
    root.appendChild(buildCanvasError(err.message));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initServersUI(refreshAll);
  btnRefresh.addEventListener('click', refreshAll);
  refreshAll();
});
