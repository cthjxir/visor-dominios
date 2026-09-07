const BACKEND_URL = 'http://127.0.0.1:57843';

const SVG_NS = 'http://www.w3.org/2000/svg';
const POSITIONS_KEY = 'visor-dominios:positions';
const NODE_RADIUS = 44;
const CHILD_RADIUS = 130;
const GRID_SPACING = 220;
const GRID_COLUMNS = 4;

let positions = loadPositions();
let nodesById = new Map();
let nodeElements = new Map();
let lineElements = [];
let expandedParents = new Set();
let linksLayer = null;
let nodesLayer = null;

function loadPositions() {
  try {
    return JSON.parse(localStorage.getItem(POSITIONS_KEY)) || {};
  } catch {
    return {};
  }
}

function savePositions() {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    // sin almacenamiento disponible: solo se pierde la persistencia de posiciones
  }
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
          id: childId, type: 'child', label: child, sublabel: group.ip,
          parentId, childIds: [],
        });
      }
    }
  }
  return nodes;
}

function assignRootPositions(nodes) {
  const roots = [...nodes.values()].filter((node) => node.type !== 'child');
  roots.forEach((node, i) => {
    if (!positions[node.id]) {
      const col = i % GRID_COLUMNS;
      const row = Math.floor(i / GRID_COLUMNS);
      positions[node.id] = { x: 180 + col * GRID_SPACING, y: 170 + row * GRID_SPACING };
    }
  });
  savePositions();
  return roots;
}

function renderBubbles(root, servers) {
  root.textContent = '';
  nodesById = buildNodes(servers);
  nodeElements = new Map();
  lineElements = [];
  expandedParents = new Set([...expandedParents].filter((id) => nodesById.has(id)));

  if (nodesById.size === 0) {
    root.textContent = 'No hay servidores registrados. Usa "+ Servidor" para agregar uno.';
    return;
  }

  const roots = assignRootPositions(nodesById);
  const cols = Math.min(GRID_COLUMNS, roots.length);
  const rows = Math.ceil(roots.length / GRID_COLUMNS);
  const width = Math.max(900, cols * GRID_SPACING + 300);
  const height = Math.max(600, rows * GRID_SPACING + 400);

  const svgEl = document.createElementNS(SVG_NS, 'svg');
  svgEl.setAttribute('width', width);
  svgEl.setAttribute('height', height);
  svgEl.classList.add('bubbles-canvas');

  linksLayer = document.createElementNS(SVG_NS, 'g');
  linksLayer.classList.add('links');
  nodesLayer = document.createElementNS(SVG_NS, 'g');
  nodesLayer.classList.add('nodes');
  svgEl.appendChild(linksLayer);
  svgEl.appendChild(nodesLayer);
  root.appendChild(svgEl);

  for (const node of roots) {
    renderNode(node);
  }
  for (const parentId of expandedParents) {
    const node = nodesById.get(parentId);
    if (node) expandChildren(node);
  }
}

function setNodeTransform(g, x, y) {
  g.setAttribute('transform', `translate(${x},${y})`);
}

function renderNode(node) {
  const pos = positions[node.id] || { x: 150, y: 150 };
  const g = document.createElementNS(SVG_NS, 'g');
  g.classList.add('node', `node-${node.type}`);
  setNodeTransform(g, pos.x, pos.y);

  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('r', NODE_RADIUS);
  circle.classList.add('node-circle');
  g.appendChild(circle);

  const title = document.createElementNS(SVG_NS, 'title');
  title.textContent = node.type === 'error'
    ? `${node.label}: ${node.sublabel}`
    : `${node.label} (${node.sublabel})`;
  g.appendChild(title);

  const fo = document.createElementNS(SVG_NS, 'foreignObject');
  fo.classList.add('bubble-fo');
  fo.setAttribute('x', -NODE_RADIUS);
  fo.setAttribute('y', -NODE_RADIUS);
  fo.setAttribute('width', NODE_RADIUS * 2);
  fo.setAttribute('height', NODE_RADIUS * 2);

  const label = document.createElement('div');
  label.className = 'bubble-label';
  const nameEl = document.createElement('div');
  nameEl.className = 'bubble-name';
  nameEl.textContent = node.label;
  const subEl = document.createElement('div');
  subEl.className = 'bubble-sub';
  subEl.textContent = node.type === 'error' ? 'Error (ver detalle)' : node.sublabel;
  label.append(nameEl, subEl);
  fo.appendChild(label);
  g.appendChild(fo);

  if (node.type === 'parent' && node.childIds.length > 0) {
    g.classList.add('expandable');
    g.classList.toggle('expanded', expandedParents.has(node.id));
  }

  nodesLayer.appendChild(g);
  nodeElements.set(node.id, g);
  attachDrag(g, node);
}

function attachDrag(g, node) {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originX = 0;
  let originY = 0;

  g.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    startX = event.clientX;
    startY = event.clientY;
    ({ x: originX, y: originY } = positions[node.id]);
    try {
      g.setPointerCapture(event.pointerId);
    } catch {
      // pointer sintetico (tests) o ya liberado: el arrastre sigue funcionando igual
    }
  });

  g.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
    const x = originX + dx;
    const y = originY + dy;
    positions[node.id] = { x, y };
    setNodeTransform(g, x, y);
    updateLinesFor(node.id);
  });

  g.addEventListener('pointerup', (event) => {
    if (!dragging) return;
    dragging = false;
    try {
      g.releasePointerCapture(event.pointerId);
    } catch {
      // idem: sin efecto si nunca se capturo el puntero
    }
    savePositions();
    if (!moved && node.type === 'parent' && node.childIds.length > 0) {
      toggleExpand(node, g);
    }
  });
}

function updateLinesFor(nodeId) {
  const pos = positions[nodeId];
  for (const link of lineElements) {
    if (link.from === nodeId) {
      link.el.setAttribute('x1', pos.x);
      link.el.setAttribute('y1', pos.y);
    }
    if (link.to === nodeId) {
      link.el.setAttribute('x2', pos.x);
      link.el.setAttribute('y2', pos.y);
    }
  }
}

function toggleExpand(node, g) {
  if (expandedParents.has(node.id)) {
    expandedParents.delete(node.id);
    collapseChildren(node);
  } else {
    expandedParents.add(node.id);
    expandChildren(node);
  }
  g.classList.toggle('expanded', expandedParents.has(node.id));
}

function expandChildren(parentNode) {
  const parentPos = positions[parentNode.id];
  const total = parentNode.childIds.length;
  parentNode.childIds.forEach((childId, i) => {
    const childNode = nodesById.get(childId);
    if (!positions[childId]) {
      const angle = (2 * Math.PI * i) / total - Math.PI / 2;
      positions[childId] = {
        x: parentPos.x + CHILD_RADIUS * Math.cos(angle),
        y: parentPos.y + CHILD_RADIUS * Math.sin(angle),
      };
    }
    renderNode(childNode);

    const line = document.createElementNS(SVG_NS, 'line');
    line.classList.add('link');
    const childPos = positions[childId];
    line.setAttribute('x1', parentPos.x);
    line.setAttribute('y1', parentPos.y);
    line.setAttribute('x2', childPos.x);
    line.setAttribute('y2', childPos.y);
    linksLayer.appendChild(line);
    lineElements.push({ from: parentNode.id, to: childId, el: line });
  });
  savePositions();
}

function collapseChildren(parentNode) {
  for (const childId of parentNode.childIds) {
    const el = nodeElements.get(childId);
    if (el) {
      el.remove();
      nodeElements.delete(childId);
    }
  }
  lineElements = lineElements.filter((link) => {
    if (link.from === parentNode.id) {
      link.el.remove();
      return false;
    }
    return true;
  });
}
