const btnRefresh = document.getElementById('btn-refresh');
const btnPan = document.getElementById('btn-pan');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnViewMap = document.getElementById('btn-view-map');
const btnViewList = document.getElementById('btn-view-list');
const railToolsSection = document.getElementById('rail-tools-section');

// Un spinner que aparece y se va en 50 ms molesta mas que esperar: se retrasa
// su aparicion y, si aparecio, se mantiene un minimo visible.
const LOADING_DELAY_MS = 150;
const LOADING_MIN_MS = 300;

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

function buildCanvasLoading() {
  const wrap = document.createElement('div');
  wrap.className = 'canvas__empty canvas__loading';
  const spinner = document.createElement('span');
  spinner.className = 'canvas__spinner';
  spinner.setAttribute('aria-hidden', 'true');
  const text = document.createElement('p');
  text.className = 'canvas__empty-text';
  text.textContent = 'Consultando los servidores…';
  wrap.append(spinner, text);
  wrap.setAttribute('role', 'status');
  return wrap;
}

// Solo se muestra si el lienzo aun no tiene mapa: borrar uno ya dibujado para
// poner un spinner le quita al usuario la referencia que estaba mirando.
function beginCanvasLoading(root) {
  if (root.querySelector('.bubbles-canvas')) return () => {};
  let shownAt = 0;
  const timer = setTimeout(() => {
    root.textContent = '';
    root.appendChild(buildCanvasLoading());
    shownAt = Date.now();
  }, LOADING_DELAY_MS);

  return async () => {
    clearTimeout(timer);
    if (!shownAt) return;
    const remaining = LOADING_MIN_MS - (Date.now() - shownAt);
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  };
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

// Estado compartido entre refreshAll (carga la lista) y queryServer (curl bajo
// demanda al hacer doble clic): que servidores ya se consultaron y cuales
// estan consultandose ahora mismo.
let knownServers = [];
const domainsById = new Map();
const loadingIds = new Set();

function renderSidebar() {
  renderServerList(document.getElementById('server-list'), knownServers, domainsById, loadingIds, queryServer);
  renderStatus(knownServers, [...domainsById.values()]);
}

// Curl de un solo servidor: se dispara al doble clic en el sidebar, no al
// cargar la app, para no obligar a esperar por servidores que no interesan.
async function queryServer(server) {
  if (loadingIds.has(server.id)) return;
  const root = document.getElementById('bubbles-root');
  if (!root.querySelector('.bubbles-canvas')) resetBubbles(root);
  loadingIds.add(server.id);
  renderSidebar();
  try {
    const entry = await fetchJSON(`/servers/${server.id}/domains`);
    domainsById.set(entry.server_id, entry);
    addServerBubble(root, entry);
  } finally {
    loadingIds.delete(server.id);
    renderSidebar();
  }
}

async function refreshAll() {
  const root = document.getElementById('bubbles-root');
  btnRefresh.dataset.state = 'loading';
  const endLoading = beginCanvasLoading(root);
  try {
    knownServers = await fetchJSON('/servers');
    domainsById.clear();
    renderSidebar();
    await endLoading();

    if (knownServers.length === 0) emptyBubbles(root);
    else welcomeBubbles(root);
    delete btnRefresh.dataset.state;
  } catch (err) {
    await endLoading();
    btnRefresh.dataset.state = 'error';
    document.getElementById('status-counts').textContent = 'Sin conexión con el backend';
    root.textContent = '';
    root.appendChild(buildCanvasError(err.message));
  }
}

// Herramientas (pan/zoom) es especifico del lienzo 3D: no aplica a una tabla.
function selectView(mode) {
  btnViewMap.setAttribute('aria-pressed', String(mode === 'map'));
  btnViewList.setAttribute('aria-pressed', String(mode === 'list'));
  railToolsSection.hidden = mode !== 'map';
  setViewMode(mode);
}

function initDomainSearch() {
  const input = document.getElementById('domain-search');
  const results = document.getElementById('search-results');
  input.addEventListener('input', () => {
    results.textContent = '';
    for (const match of searchNodes(input.value)) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'search-result';
      appendBreakable(btn, match.name);
      btn.addEventListener('click', () => {
        focusNode(match.id);
        input.value = match.name;
        results.textContent = '';
      });
      li.appendChild(btn);
      results.appendChild(li);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initServersUI(refreshAll);
  initDomainSearch();
  btnRefresh.addEventListener('click', refreshAll);
  btnPan.addEventListener('click', () => {
    const active = btnPan.getAttribute('aria-pressed') !== 'true';
    btnPan.setAttribute('aria-pressed', String(active));
    setPanMode(active);
  });
  btnZoomOut.addEventListener('click', zoomOut);
  btnZoomIn.addEventListener('click', zoomIn);
  btnPan.setAttribute('aria-pressed', 'true');
  setPanMode(true);
  btnViewMap.addEventListener('click', () => selectView('map'));
  btnViewList.addEventListener('click', () => selectView('list'));
  refreshAll();
});
