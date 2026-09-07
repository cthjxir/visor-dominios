async function fetchJSON(path, options) {
  const res = await fetch(`${BACKEND_URL}${path}`, options);
  return res.json();
}

async function refreshServerBar() {
  const servers = await fetchJSON('/servers');
  renderServerBar(document.getElementById('server-bar'), servers);
}

async function refreshDomains() {
  const root = document.getElementById('bubbles-root');
  try {
    const servers = await fetchJSON('/domains');
    renderBubbles(root, servers);
  } catch (err) {
    root.textContent = `No se pudo conectar con el backend: ${err.message}`;
  }
}

async function refreshAll() {
  await Promise.all([refreshServerBar(), refreshDomains()]);
}

document.addEventListener('DOMContentLoaded', () => {
  initServersUI(refreshAll);
  document.getElementById('btn-refresh').addEventListener('click', refreshDomains);
  refreshAll();
});
