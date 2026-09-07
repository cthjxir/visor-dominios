import * as THREE from './vendor/three.module.min.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/CSS2DRenderer.js';
import { relaxLayout, fanRadius } from './layout.mjs';

const BACKEND_URL = 'http://127.0.0.1:57843';
window.BACKEND_URL = BACKEND_URL;

// v3: solo se guardan las posiciones que el usuario movio a mano. Guardar tambien
// las calculadas hacia que cada sesion partiera del resultado de la anterior y la
// separacion se acumulara: el mapa se dispersaba un poco mas cada vez que se abria.
// Ahora el layout se recalcula al abrir (es determinista, sale igual) y lo unico
// persistente es lo que el usuario coloco.
const POSITIONS_KEY = 'visor-dominios:positions:v3';
// Nodos que el usuario coloco a mano: la relajacion no los mueve.
const PINNED_KEY = 'visor-dominios:pinned';
// El tamano refuerza la jerarquia junto con la luminosidad, y le da al dominio
// padre (el nombre mas largo) sitio para su etiqueta sin desbordar la esfera.
const NODE_RADIUS = { parent: 52, error: 52, child: 40 };
const MAX_NODE_RADIUS = 52;
const GRID_SPACING = 220;
// El margen deja sitio para el abanico de hijos alrededor de un nodo de la
// primera fila o columna, que si no se recorta contra el borde del lienzo.
const GRID_MARGIN = 200;

// El mapa debe caber en la ventana: las columnas salen del ancho real del lienzo.
function gridColumns(available) {
  return Math.max(2, Math.floor((available - GRID_MARGIN) / GRID_SPACING));
}

let positions = loadPositions();
let pinned = loadPinned();
let nodesById = new Map();
let nodeMeshes = new Map();
let lineElements = [];
let expandedParents = new Set();

let renderer = null;
let labelRenderer = null;
let scene = null;
let camera = null;
let canvasBox = null;
let resizeObserver = null;
const raycaster = new THREE.Raycaster();

// Lienzo infinito: la camara ortografica es una ventana movil sobre un mundo
// sin bordes. camX/camY son la esquina superior-izquierda del mundo que se ve,
// en pixeles reales (mismas unidades que las posiciones guardadas); el zoom
// solo cambia cuanto mundo entra en esa ventana, no la escena en si.
let camX = 0;
let camY = 0;
let viewW = 0;
let viewH = 0;

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.2;
let zoomLevel = 1;

function updateCameraFrustum() {
  if (!camera) return;
  camera.left = camX;
  camera.right = camX + viewW / zoomLevel;
  camera.top = -camY;
  camera.bottom = -(camY + viewH / zoomLevel);
  camera.updateProjectionMatrix();
  draw();
}

function applyZoom(next, anchorX = viewW / 2, anchorY = viewH / 2) {
  const prevZoom = zoomLevel;
  zoomLevel = Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, next)) * 100) / 100;
  // Conserva el punto del mundo bajo (anchorX, anchorY) del viewport: con los
  // botones ese ancla es el centro; con la rueda + Ctrl/Cmd es el cursor.
  const worldX = camX + anchorX / prevZoom;
  const worldY = camY + anchorY / prevZoom;
  camX = worldX - anchorX / zoomLevel;
  camY = worldY - anchorY / zoomLevel;
  if (canvasBox) {
    for (const el of canvasBox.querySelectorAll('.bubble-label')) el.style.transform = `scale(${zoomLevel})`;
  }
  updateCameraFrustum();
}

function zoomIn() {
  applyZoom(zoomLevel + ZOOM_STEP);
}

function zoomOut() {
  applyZoom(zoomLevel - ZOOM_STEP);
}

function loadPositions() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {};
  } catch {
    return {};
  }
  const clean = {};
  for (const [id, pos] of Object.entries(stored)) {
    if (Number.isFinite(pos?.x) && Number.isFinite(pos?.y)) clean[id] = pos;
  }
  return clean;
}

function loadPinned() {
  try {
    return new Set(JSON.parse(localStorage.getItem(PINNED_KEY)) || []);
  } catch {
    return new Set();
  }
}

function savePinned() {
  try {
    localStorage.setItem(PINNED_KEY, JSON.stringify([...pinned]));
  } catch {
    // sin almacenamiento: los nodos fijados solo duran la sesion
  }
}

function savePositions() {
  try {
    const manual = {};
    for (const id of pinned) {
      if (positions[id]) manual[id] = positions[id];
    }
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(manual));
  } catch {
    // sin almacenamiento disponible: solo se pierde la persistencia de posiciones
  }
}

// THREE.Color no parsea oklch(). Se pinta un pixel con el valor CSS y se lee el
// resultado: el navegador hace la conversion y el gamut-clamp a sRGB.
const colorProbe = (() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas.getContext('2d', { willReadFrequently: true });
})();

function cssColor(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  colorProbe.fillStyle = '#888888';
  if (value) colorProbe.fillStyle = value;
  colorProbe.fillRect(0, 0, 1, 1);
  const [r, g, b] = colorProbe.getImageData(0, 0, 1, 1).data;
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

// La jerarquia se lee por luminosidad, no por matiz: el color queda libre
// para el estado (error) y para la seleccion (acento).
function nodeColor(type) {
  if (type === 'error') return cssColor('--color-node-error');
  if (type === 'child') return cssColor('--color-node-child');
  return cssColor('--color-node-parent');
}

function buildNodes(servers) {
  const nodes = new Map();
  for (const server of servers) {
    if (server.error) {
      const id = `err:${server.server_id}`;
      nodes.set(id, {
        id, type: 'error', label: server.alias, sublabel: server.error,
        parentId: null, childIds: [],
      });
      continue;
    }
    for (const group of server.groups) {
      const parentId = `${server.server_id}:${group.parent}`;
      nodes.set(parentId, {
        id: parentId, type: 'parent', label: group.parent, sublabel: group.ip,
        parentId: null, childIds: group.children.map((child) => `${server.server_id}:${child}`),
      });
      for (const child of group.children) {
        const childId = `${server.server_id}:${child}`;
        nodes.set(childId, {
          id: childId, type: 'child', label: shortLabel(child, group.parent), title: child,
          sublabel: group.ip, parentId, childIds: [],
        });
      }
    }
  }
  return nodes;
}

// La esfera muestra lo que distingue al subdominio, no lo que repite del padre:
// bajo "tecnologias.gob.mx", "correo.tecnologias.gob.mx" se lee "correo"; y como
// hermano de "ptecnologias.salamanca.gob.mx", "prafipaco.salamanca.gob.mx" se lee
// "prafipaco". El nombre completo sigue en el title de la etiqueta.
function shortLabel(child, parent) {
  const childParts = child.split('.');
  const parentParts = parent.split('.');
  let common = 0;
  while (
    common < childParts.length - 1 &&
    common < parentParts.length &&
    childParts[childParts.length - 1 - common] === parentParts[parentParts.length - 1 - common]
  ) {
    common += 1;
  }
  return common === 0 ? child : childParts.slice(0, childParts.length - common).join('.');
}

function assignRootPositions(nodes, columns) {
  const roots = [...nodes.values()].filter((node) => node.type !== 'child');
  roots.forEach((node, i) => {
    if (!positions[node.id]) {
      const col = i % columns;
      const row = Math.floor(i / columns);
      positions[node.id] = {
        x: GRID_MARGIN + col * GRID_SPACING,
        y: GRID_MARGIN + row * GRID_SPACING,
      };
    }
  });
  savePositions();
  return roots;
}

const radiusOf = (node) => NODE_RADIUS[node.type] || MAX_NODE_RADIUS;

// El abanico de un padre expandido: la distancia a la que se colocan sus hijos y
// tambien el area que reclama frente a los demas dominios.
function fanOf(node) {
  if (!expandedParents.has(node.id) || node.childIds.length === 0) return 0;
  return fanRadius(node.childIds.length, NODE_RADIUS.child);
}

// Reparte los nodos visibles hasta que ninguno se solape y guarda el resultado.
// Es sincrono y determinista: el mapa aparece ya ordenado, sin animacion (una
// escena que se reacomoda a la vista distrae mas de lo que informa).
function relaxVisible() {
  const graph = [];
  for (const [id, node] of nodesById) {
    if (!nodeMeshes.has(id) || !positions[id]) continue;
    const fan = fanOf(node);
    graph.push({
      id,
      x: positions[id].x,
      y: positions[id].y,
      r: radiusOf(node),
      parentId: node.parentId && nodeMeshes.has(node.parentId) ? node.parentId : null,
      fan,
      spacing: fan ? fan + NODE_RADIUS.child : radiusOf(node),
      fixed: pinned.has(id),
    });
  }
  if (graph.length < 2) return;

  relaxLayout(graph, { minX: -Infinity, minY: -Infinity });
  for (const item of graph) positions[item.id] = { x: item.x, y: item.y };
  savePositions();
}

// Vuelca las posiciones en la escena: esferas, enlaces y tamano del lienzo.
function applyPositions() {
  for (const [id, mesh] of nodeMeshes) {
    const pos = positions[id];
    if (pos) mesh.position.set(pos.x, -pos.y, 0);
  }
  for (const link of lineElements) {
    link.el.geometry.dispose();
    link.el.geometry = linkGeometry(positions[link.from], positions[link.to]);
  }
}

// Escena ortografica en coordenadas de pantalla: x hacia la derecha, y hacia abajo
// (se niega al pasar al mundo 3D), asi las posiciones guardadas siguen siendo pixeles.
function setupScene(root, width, height) {
  viewW = width;
  viewH = height;
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    labelRenderer = new CSS2DRenderer();
    // El CSS2DRenderer no posiciona su contenedor: lo hace styles.css (.labels-layer).
    labelRenderer.domElement.className = 'labels-layer';
    scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(-0.4, 0.8, 1);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(0.6, -0.5, 0.8);
    scene.add(fill);
    camera = new THREE.OrthographicCamera(0, 1, 0, -1, 1, 4000);
    camera.position.z = 1000;
  }

  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);

  canvasBox = document.createElement('div');
  canvasBox.className = 'bubbles-canvas';
  canvasBox.style.width = `${width}px`;
  canvasBox.style.height = `${height}px`;
  canvasBox.append(renderer.domElement, labelRenderer.domElement);
  root.appendChild(canvasBox);
  attachPointerHandlers(renderer.domElement);
  observeResize(root);
  updateCameraFrustum();
}

// El div y el renderer siempre miden lo mismo que el panel visible: la camara,
// no el DOM, es lo que se mueve por el mundo infinito.
function observeResize(root) {
  if (resizeObserver) return;
  resizeObserver = new ResizeObserver(() => {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height || !canvasBox) return;
    viewW = width;
    viewH = height;
    canvasBox.style.width = `${width}px`;
    canvasBox.style.height = `${height}px`;
    renderer.setSize(width, height);
    labelRenderer.setSize(width, height);
    updateCameraFrustum();
  });
  resizeObserver.observe(root);
}

function clearScene() {
  for (const mesh of nodeMeshes.values()) removeObject(mesh);
  for (const link of lineElements) removeObject(link.el);
  nodeMeshes = new Map();
  lineElements = [];
}

function removeObject(object) {
  object.removeFromParent();
  object.geometry?.dispose();
  object.material?.dispose();
  for (const child of [...object.children]) {
    if (child instanceof CSS2DObject) child.element.remove();
    child.removeFromParent();
  }
}

function draw() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

// Vacia el lienzo y arranca una escena nueva y vacia, lista para recibir
// servidores uno a uno via addServerBubble.
function resetBubbles(root) {
  nodesById = new Map();
  expandedParents = new Set();
  clearScene();
  root.textContent = '';
  setupScene(root, root.clientWidth || 900, root.clientHeight || 600);
}

function emptyBubbles(root) {
  nodesById = new Map();
  clearScene();
  root.textContent = '';
  root.appendChild(buildEmptyState());
}

// Agrega los dominios de un solo servidor al lienzo ya abierto por
// resetBubbles: las burbujas existentes no se tocan, la relajacion solo
// reacomoda lo necesario para que la burbuja nueva no se encime con ellas.
function addServerBubble(root, server) {
  const newNodes = buildNodes([server]);
  if (newNodes.size === 0) return;
  for (const [id, node] of newNodes) nodesById.set(id, node);
  expandedParents = new Set([...expandedParents].filter((id) => nodesById.has(id)));

  const columns = gridColumns(viewW || root.clientWidth || 900);
  const roots = assignRootPositions(nodesById, columns);

  for (const node of roots) {
    if (!nodeMeshes.has(node.id)) renderNode(node);
  }
  for (const parentId of expandedParents) {
    const node = nodesById.get(parentId);
    if (node && newNodes.has(parentId)) expandChildren(node);
  }
  relaxVisible();
  applyPositions();
  draw();
}

function buildEmptyState() {
  const wrap = document.createElement('div');
  wrap.className = 'canvas__empty';
  const title = document.createElement('p');
  title.className = 'canvas__empty-title';
  title.textContent = 'Todavía no hay nada que mapear';
  const text = document.createElement('p');
  text.className = 'canvas__empty-text';
  text.textContent = 'Registra un servidor de Virtualmin con «Nuevo servidor» y sus dominios aparecerán aquí como un mapa que puedes reordenar.';
  wrap.append(title, text);
  return wrap;
}

function renderNode(node) {
  const pos = positions[node.id] || { x: 150, y: 150 };
  const geometry = new THREE.SphereGeometry(NODE_RADIUS[node.type] || MAX_NODE_RADIUS, 48, 32);
  const material = new THREE.MeshStandardMaterial({
    color: nodeColor(node.type),
    roughness: 0.38,
    metalness: 0.1,
    emissive: cssColor('--color-accent'),
    emissiveIntensity: expandedParents.has(node.id) ? 0.22 : 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(pos.x, -pos.y, 0);
  mesh.userData.node = node;
  scene.add(mesh);

  mesh.add(new CSS2DObject(buildLabel(node)));

  nodeMeshes.set(node.id, mesh);
}

// CSS2DRenderer centra y posiciona el elemento raiz por su cuenta cada frame
// (pisando cualquier transform que le pongamos), por eso el zoom se aplica a
// un hijo aparte: si no, las esferas (que si estan en la escena 3D) crecerian
// con la camara pero el texto se quedaria siempre del mismo tamano.
function buildLabel(node) {
  const anchor = document.createElement('div');
  const label = document.createElement('div');
  label.className = `bubble-label bubble-${node.type}`;
  label.style.transform = `scale(${zoomLevel})`;
  label.title = node.type === 'error'
    ? `${node.label}: ${node.sublabel}`
    : `${node.title || node.label} (${node.sublabel})`;
  const nameEl = document.createElement('div');
  nameEl.className = 'bubble-name';
  appendBreakable(nameEl, node.label);
  const subEl = document.createElement('div');
  subEl.className = 'bubble-sub';
  subEl.textContent = node.type === 'error' ? 'sin conexión' : node.sublabel;
  label.append(nameEl, subEl);
  anchor.appendChild(label);
  return anchor;
}

// Un dominio se parte por sus puntos, no a mitad de palabra: "servicios." / "gob.mx".
function appendBreakable(el, text) {
  const parts = text.split('.');
  parts.forEach((part, i) => {
    el.append(i < parts.length - 1 ? `${part}.` : part);
    if (i < parts.length - 1) el.appendChild(document.createElement('wbr'));
  });
}

function pickNode(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  ), camera);
  const hit = raycaster.intersectObjects([...nodeMeshes.values()], false)[0];
  return hit ? hit.object : null;
}

// Arrastrar una esfera siempre la mueve; el modo "Desplazarse" solo agrega
// que arrastrar el fondo (donde antes no pasaba nada) recorra el lienzo.
let panMode = false;

function attachPointerHandlers(canvas) {
  if (canvas.dataset.handlersReady) return;
  canvas.dataset.handlersReady = '1';

  let drag = null;
  let pan = null;

  canvas.addEventListener('pointerdown', (event) => {
    const mesh = pickNode(canvas, event);
    if (!mesh) {
      if (!panMode) return;
      pan = {
        startX: event.clientX, startY: event.clientY,
        startCamX: camX, startCamY: camY,
      };
      canvas.setPointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grabbing';
      return;
    }
    const node = mesh.userData.node;
    drag = {
      mesh, node, moved: false,
      startX: event.clientX, startY: event.clientY,
      origin: { ...positions[node.id] },
    };
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (pan) {
      camX = pan.startCamX - (event.clientX - pan.startX) / zoomLevel;
      camY = pan.startCamY - (event.clientY - pan.startY) / zoomLevel;
      updateCameraFrustum();
      return;
    }
    if (!drag) {
      canvas.style.cursor = panMode || pickNode(canvas, event) ? 'grab' : 'default';
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const x = drag.origin.x + dx;
    const y = drag.origin.y + dy;
    positions[drag.node.id] = { x, y };
    drag.mesh.position.set(x, -y, 0);
    updateLinesFor(drag.node.id);
    canvas.style.cursor = 'grabbing';
    draw();
  });

  canvas.addEventListener('pointerup', (event) => {
    if (pan) {
      pan = null;
      canvas.releasePointerCapture?.(event.pointerId);
      canvas.style.cursor = 'grab';
      return;
    }
    if (!drag) return;
    const { node, moved } = drag;
    drag = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.style.cursor = 'grab';
    if (moved) {
      pinned.add(node.id);
      savePinned();
      // El nodo movido no cede; los demas se apartan a su alrededor.
      relaxVisible();
      applyPositions();
      draw();
    }
    savePositions();
    if (!moved && node.type === 'parent' && node.childIds.length > 0) {
      toggleExpand(node);
    }
  });

  // El scroll de trackpad ya no lo da el navegador (no hay contenedor con
  // overflow): sin esto, quitar el scroll nativo le quita a quien usa
  // trackpad su unica forma de recorrer el lienzo sin activar "Desplazarse".
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    // Ctrl/Cmd + rueda (y el pinch de trackpad, que llega como wheel+ctrlKey)
    // hace zoom anclado al cursor; sin modificador, recorre el lienzo.
    if (event.ctrlKey || event.metaKey) {
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.01);
      applyZoom(zoomLevel * factor, event.clientX - rect.left, event.clientY - rect.top);
      return;
    }
    camX += event.deltaX / zoomLevel;
    camY += event.deltaY / zoomLevel;
    updateCameraFrustum();
  }, { passive: false });
}

function setPanMode(on) {
  panMode = on;
}

// Devuelve los dominios/subdominios cuyo nombre completo contiene la consulta.
function searchNodes(query) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out = [];
  for (const node of nodesById.values()) {
    if (node.type === 'error') continue;
    const name = node.title || node.label;
    if (name.toLowerCase().includes(q)) out.push({ id: node.id, name, type: node.type });
    if (out.length >= 25) break;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Lleva la camara al nodo (expandiendo su padre si hace falta) y lo resalta unos
// segundos con el color de acento.
let highlightTimer = null;
function focusNode(id) {
  const node = nodesById.get(id);
  if (!node) return;
  if (node.parentId && !expandedParents.has(node.parentId)) {
    const parent = nodesById.get(node.parentId);
    if (parent) toggleExpand(parent);
  }
  const pos = positions[id];
  if (!pos) return;
  camX = pos.x - viewW / zoomLevel / 2;
  camY = pos.y - viewH / zoomLevel / 2;
  updateCameraFrustum();

  const mesh = nodeMeshes.get(id);
  if (!mesh) return;
  clearTimeout(highlightTimer);
  const restore = expandedParents.has(id) ? 0.35 : 0;
  mesh.material.emissiveIntensity = 0.9;
  draw();
  highlightTimer = setTimeout(() => {
    mesh.material.emissiveIntensity = restore;
    draw();
  }, 2500);
}

function linkGeometry(fromPos, toPos) {
  return new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(fromPos.x, -fromPos.y, -1),
    new THREE.Vector3(toPos.x, -toPos.y, -1),
  ]);
}

function updateLinesFor(nodeId) {
  for (const link of lineElements) {
    if (link.from !== nodeId && link.to !== nodeId) continue;
    link.el.geometry.dispose();
    link.el.geometry = linkGeometry(positions[link.from], positions[link.to]);
  }
}

function toggleExpand(node) {
  const mesh = nodeMeshes.get(node.id);
  if (expandedParents.has(node.id)) {
    expandedParents.delete(node.id);
    collapseChildren(node);
  } else {
    expandedParents.add(node.id);
    expandChildren(node);
  }
  mesh.material.emissiveIntensity = expandedParents.has(node.id) ? 0.35 : 0;
  relaxVisible();
  applyPositions();
  draw();
}

function expandChildren(parentNode) {
  const total = parentNode.childIds.length;
  const fan = fanRadius(total, NODE_RADIUS.child);
  const parentPos = positions[parentNode.id];
  const lineMaterial = new THREE.LineBasicMaterial({ color: cssColor('--color-node-link') });
  parentNode.childIds.forEach((childId, i) => {
    const childNode = nodesById.get(childId);
    if (!positions[childId]) {
      const angle = (2 * Math.PI * i) / total - Math.PI / 2;
      positions[childId] = {
        x: parentPos.x + fan * Math.cos(angle),
        y: parentPos.y + fan * Math.sin(angle),
      };
    }
    renderNode(childNode);

    const line = new THREE.Line(linkGeometry(parentPos, positions[childId]), lineMaterial);
    scene.add(line);
    lineElements.push({ from: parentNode.id, to: childId, el: line });
  });
  savePositions();
}

function collapseChildren(parentNode) {
  for (const childId of parentNode.childIds) {
    if (!pinned.has(childId)) delete positions[childId];
    const mesh = nodeMeshes.get(childId);
    if (mesh) {
      removeObject(mesh);
      nodeMeshes.delete(childId);
    }
  }
  lineElements = lineElements.filter((link) => {
    if (link.from === parentNode.id) {
      removeObject(link.el);
      return false;
    }
    return true;
  });
}

window.resetBubbles = resetBubbles;
window.emptyBubbles = emptyBubbles;
window.addServerBubble = addServerBubble;
window.appendBreakable = appendBreakable;
window.setPanMode = setPanMode;
window.zoomIn = zoomIn;
window.zoomOut = zoomOut;
window.searchNodes = searchNodes;
window.focusNode = focusNode;
