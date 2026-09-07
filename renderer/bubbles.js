import * as THREE from './vendor/three.module.min.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/CSS2DRenderer.js';

const BACKEND_URL = 'http://127.0.0.1:57843';
window.BACKEND_URL = BACKEND_URL;

// v2: las posiciones guardadas por la version SVG se calcularon con un abanico de
// radio fijo y sin limites de lienzo, asi que muchas quedaban solapadas o fuera de
// vista. No hay forma de distinguirlas de un ajuste deliberado: se descartan una vez.
const POSITIONS_KEY = 'visor-dominios:positions:v2';
// El tamano refuerza la jerarquia junto con la luminosidad, y le da al dominio
// padre (el nombre mas largo) sitio para su etiqueta sin desbordar la esfera.
const NODE_RADIUS = { parent: 52, error: 52, child: 40 };
const MAX_NODE_RADIUS = 52;
const CHILD_RADIUS = 150;
const GRID_SPACING = 220;
// El margen deja sitio para el abanico de hijos alrededor de un nodo de la
// primera fila o columna, que si no se recorta contra el borde del lienzo.
const GRID_MARGIN = 200;

// El mapa debe caber en la ventana: las columnas salen del ancho real del lienzo.
function gridColumns(available) {
  return Math.max(2, Math.floor((available - GRID_MARGIN) / GRID_SPACING));
}

let positions = loadPositions();
let nodesById = new Map();
let nodeMeshes = new Map();
let lineElements = [];
let expandedParents = new Set();

let renderer = null;
let labelRenderer = null;
let scene = null;
let camera = null;
let canvasBox = null;
const raycaster = new THREE.Raycaster();

// Se sanean al leer: una posicion guardada por una version anterior (o por una
// ventana mas grande) puede caer fuera del lienzo, donde no hay scroll que la
// recupere. Corregir solo al arrastrar dejaria el nodo inalcanzable para siempre.
function loadPositions() {
  let stored;
  try {
    stored = JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {};
  } catch {
    return {};
  }
  const clean = {};
  const taken = new Set();
  for (const [id, pos] of Object.entries(stored)) {
    if (!Number.isFinite(pos?.x) || !Number.isFinite(pos?.y)) continue;
    const fitted = clampPos(pos);
    // Dos nodos en el mismo punto son indistinguibles y no hay forma de separarlos
    // sin arrastrar a ciegas: se descarta el duplicado y el layout lo recoloca.
    const key = `${Math.round(fitted.x)},${Math.round(fitted.y)}`;
    if (taken.has(key)) continue;
    taken.add(key);
    clean[id] = fitted;
  }
  return clean;
}

function savePositions() {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
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

// Un abanico de radio fijo apina los hijos en cuanto pasan de media docena: el
// radio crece para que quepan sin solaparse (15 subdominios reales no caben en 150).
// ponytail: el abanico de un dominio con muchos hijos (radio ~230 con 15) puede
// invadir al vecino del grid, separado GRID_SPACING. Separarlos siempre dispersaria
// el mapa tambien en el caso comun; la alternativa es un layout con repulsion.
function fanRadius(count) {
  const perNode = 2 * NODE_RADIUS.child + 16;
  return Math.max(CHILD_RADIUS, (count * perNode) / (2 * Math.PI));
}

// Un nodo arrastrado (o heredado de una ventana mas grande) no debe quedar fuera
// del lienzo: este siempre se dimensiona para contener todas las posiciones vivas.
// Ningun nodo puede salirse por el borde superior o izquierdo: alli no hay scroll
// que lo recupere (por la derecha y abajo el lienzo crece, ver nodeExtent).
function clampPos(pos) {
  return {
    x: Math.max(MAX_NODE_RADIUS + 8, pos.x),
    y: Math.max(MAX_NODE_RADIUS + 8, pos.y),
  };
}

function nodeExtent() {
  let x = 0;
  let y = 0;
  for (const id of nodesById.keys()) {
    const pos = positions[id];
    if (!pos) continue;
    x = Math.max(x, pos.x);
    y = Math.max(y, pos.y);
  }
  return { x, y };
}

// Escena ortografica en coordenadas de pantalla: x hacia la derecha, y hacia abajo
// (se niega al pasar al mundo 3D), asi las posiciones guardadas siguen siendo pixeles.
function setupScene(root, width, height) {
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

  camera.left = 0;
  camera.right = width;
  camera.top = 0;
  camera.bottom = -height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);

  canvasBox = document.createElement('div');
  canvasBox.className = 'bubbles-canvas';
  canvasBox.style.width = `${width}px`;
  canvasBox.style.height = `${height}px`;
  canvasBox.append(renderer.domElement, labelRenderer.domElement);
  root.appendChild(canvasBox);
  attachPointerHandlers(renderer.domElement);
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

function renderBubbles(root, servers) {
  nodesById = buildNodes(servers);
  expandedParents = new Set([...expandedParents].filter((id) => nodesById.has(id)));

  if (nodesById.size === 0) {
    clearScene();
    root.textContent = '';
    root.appendChild(buildEmptyState());
    return;
  }

  const availableWidth = root.clientWidth || 900;
  const availableHeight = root.clientHeight || 600;
  const columns = gridColumns(availableWidth);
  const roots = assignRootPositions(nodesById, columns);
  const extent = nodeExtent();
  const width = Math.max(availableWidth, extent.x + GRID_MARGIN);
  const height = Math.max(availableHeight, extent.y + GRID_MARGIN);

  clearScene();
  root.textContent = '';
  setupScene(root, width, height);

  for (const node of roots) {
    renderNode(node);
  }
  for (const parentId of expandedParents) {
    const node = nodesById.get(parentId);
    if (node) expandChildren(node);
  }
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

function buildLabel(node) {
  const label = document.createElement('div');
  label.className = `bubble-label bubble-${node.type}`;
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
  return label;
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

function attachPointerHandlers(canvas) {
  if (canvas.dataset.handlersReady) return;
  canvas.dataset.handlersReady = '1';

  let drag = null;

  canvas.addEventListener('pointerdown', (event) => {
    const mesh = pickNode(canvas, event);
    if (!mesh) return;
    const node = mesh.userData.node;
    drag = {
      mesh, node, moved: false,
      startX: event.clientX, startY: event.clientY,
      origin: { ...positions[node.id] },
    };
    canvas.setPointerCapture?.(event.pointerId);
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag) {
      canvas.style.cursor = pickNode(canvas, event) ? 'grab' : 'default';
      return;
    }
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    const { x, y } = clampPos({ x: drag.origin.x + dx, y: drag.origin.y + dy });
    positions[drag.node.id] = { x, y };
    drag.mesh.position.set(x, -y, 0);
    updateLinesFor(drag.node.id);
    canvas.style.cursor = 'grabbing';
    draw();
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    const { node, moved } = drag;
    drag = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.style.cursor = 'grab';
    savePositions();
    if (!moved && node.type === 'parent' && node.childIds.length > 0) {
      toggleExpand(node);
    }
  });
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
  draw();
}

function expandChildren(parentNode) {
  const total = parentNode.childIds.length;
  const fan = fanRadius(total);
  const parentPos = ensureFanFits(parentNode, fan);
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

// Si el padre esta pegado a un borde, su abanico caeria fuera del lienzo y los
// hijos acabarian apilados en la misma esquina: se corre el padre lo justo.
function ensureFanFits(parentNode, fan) {
  const pos = positions[parentNode.id];
  const margin = fan + NODE_RADIUS.child + 8;
  const fitted = { x: Math.max(margin, pos.x), y: Math.max(margin, pos.y) };
  if (fitted.x !== pos.x || fitted.y !== pos.y) {
    positions[parentNode.id] = fitted;
    nodeMeshes.get(parentNode.id)?.position.set(fitted.x, -fitted.y, 0);
    updateLinesFor(parentNode.id);
  }
  growCanvasTo(fitted.x + margin, fitted.y + margin);
  return fitted;
}

// El lienzo se agranda si el abanico lo desborda, para que haya scroll hasta el.
function growCanvasTo(x, y) {
  const width = Math.max(parseFloat(canvasBox.style.width), Math.ceil(x));
  const height = Math.max(parseFloat(canvasBox.style.height), Math.ceil(y));
  if (width === parseFloat(canvasBox.style.width) && height === parseFloat(canvasBox.style.height)) return;
  canvasBox.style.width = `${width}px`;
  canvasBox.style.height = `${height}px`;
  camera.right = width;
  camera.bottom = -height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  labelRenderer.setSize(width, height);
}

function collapseChildren(parentNode) {
  for (const childId of parentNode.childIds) {
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

window.renderBubbles = renderBubbles;
window.appendBreakable = appendBreakable;
