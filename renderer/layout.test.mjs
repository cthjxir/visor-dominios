// Comprobacion del layout: `npm run test:layout`. Sin framework, solo asserts.
import assert from 'node:assert/strict';
import { relaxLayout, tightestPair, fanRadius, MAX_ITERATIONS, REPULSION_GAP } from './layout.mjs';

const CHILD_R = 40;
const PARENT_R = 52;

// Construye el layout inicial que produce el renderer: rejilla de dominios padre
// y un abanico de subdominios alrededor de cada uno.
function seed(childCounts, { spacing = 220, margin = 200, columns = 2 } = {}) {
  const nodes = [];
  childCounts.forEach((count, p) => {
    const parentId = `p${p}`;
    const x = margin + (p % columns) * spacing;
    const y = margin + Math.floor(p / columns) * spacing;
    const fan = fanRadius(count, CHILD_R);
    nodes.push({
      id: parentId,
      x,
      y,
      r: PARENT_R,
      fan,
      spacing: count > 0 ? fan + CHILD_R : PARENT_R,
    });
    for (let c = 0; c < count; c += 1) {
      const angle = (2 * Math.PI * c) / count - Math.PI / 2;
      nodes.push({
        id: `${parentId}.c${c}`,
        x: x + fan * Math.cos(angle),
        y: y + fan * Math.sin(angle),
        r: CHILD_R,
        parentId,
      });
    }
  });
  return nodes;
}

function check(name, childCounts, options) {
  const nodes = seed(childCounts, options);
  const before = tightestPair(nodes);
  const iterations = relaxLayout(nodes, { minX: 0, minY: 0 });
  const after = tightestPair(nodes);

  if (after) {
    assert.ok(after.slack > -0.5, `${name}: siguen solapados (${after.a} / ${after.b}, holgura ${after.slack.toFixed(1)})`);
  }
  assert.ok(iterations < MAX_ITERATIONS, `${name}: no convergio en ${MAX_ITERATIONS} iteraciones`);
  for (const node of nodes) {
    assert.ok(node.x >= node.r - 0.01 && node.y >= node.r - 0.01, `${name}: ${node.id} se sale del lienzo`);
    assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y), `${name}: ${node.id} sin posicion valida`);
  }
  const holgura = after ? `${before.slack.toFixed(0).padStart(5)} -> ${after.slack.toFixed(0).padStart(4)}` : '  (un solo nodo)';
  console.log(
    `ok   ${name.padEnd(34)} nodos=${String(nodes.length).padStart(3)} iter=${String(iterations).padStart(3)} holgura ${holgura}`,
  );
  return nodes;
}

// El caso que motivo el cambio: un dominio con 15 subdominios junto a otro con 2.
// Antes de relajar, el abanico grande invadia al vecino de la rejilla.
check('15 subdominios junto a 2', [2, 15]);
check('caso comun (2 y 3)', [3, 2]);
check('un solo dominio sin hijos', [0]);
check('todos con muchos hijos', [12, 12, 12, 12]);
check('rejilla densa', [4, 4, 4, 4, 4, 4, 4, 4, 4]);
check('un dominio con 40 subdominios', [40]);

// Un nodo colocado a mano no se mueve; el otro se aparta.
{
  const pinned = { id: 'fijo', x: 300, y: 300, r: PARENT_R, fixed: true };
  const loose = { id: 'suelto', x: 305, y: 300, r: PARENT_R };
  relaxLayout([pinned, loose], { minX: 0, minY: 0 });
  assert.equal(pinned.x, 300, 'el nodo fijado se movio');
  assert.equal(pinned.y, 300, 'el nodo fijado se movio');
  const gap = Math.hypot(loose.x - pinned.x, loose.y - pinned.y) - 2 * PARENT_R;
  assert.ok(gap > REPULSION_GAP - 0.5, `el suelto no se aparto lo suficiente (${gap.toFixed(1)})`);
  console.log('ok   nodo fijado no se mueve         el suelto se aparta a', gap.toFixed(0), 'px');
}

// Dos nodos fijados que se solapan ceden a medias: dejarlos encimados no tiene
// salida para el usuario.
{
  const a = { id: 'a', x: 300, y: 300, r: PARENT_R, fixed: true };
  const b = { id: 'b', x: 320, y: 300, r: PARENT_R, fixed: true };
  relaxLayout([a, b], { minX: 0, minY: 0 });
  const gap = Math.hypot(b.x - a.x, b.y - a.y) - 2 * PARENT_R;
  assert.ok(gap > REPULSION_GAP - 0.5, `dos fijados siguen solapados (${gap.toFixed(1)})`);
  assert.ok(Math.abs((300 - a.x) - (b.x - 320)) < 0.01, 'los dos fijados no cedieron a partes iguales');
  console.log('ok   dos fijados ceden a medias      separados a', gap.toFixed(0), 'px');
}

// Dos nodos exactamente coincidentes se separan de forma determinista.
{
  const run = () => {
    const nodes = [
      { id: 'a', x: 200, y: 200, r: CHILD_R },
      { id: 'b', x: 200, y: 200, r: CHILD_R },
    ];
    relaxLayout(nodes, { minX: 0, minY: 0 });
    return nodes.map((n) => `${n.x.toFixed(3)},${n.y.toFixed(3)}`).join(' ');
  };
  const first = run();
  assert.equal(first, run(), 'el desempate de nodos coincidentes no es determinista');
  console.log('ok   coincidentes se separan igual  ', first);
}

// Relajar dos veces no mueve nada: al reabrir la app el mapa no salta.
{
  const nodes = seed([2, 15]);
  relaxLayout(nodes, { minX: 0, minY: 0 });
  const snapshot = nodes.map((n) => ({ ...n }));
  const iterations = relaxLayout(nodes, { minX: 0, minY: 0 });
  const drift = Math.max(...nodes.map((n, i) => Math.hypot(n.x - snapshot[i].x, n.y - snapshot[i].y)));
  assert.ok(drift < 1, `el layout no es estable al recargar (deriva ${drift.toFixed(2)} px)`);
  console.log(`ok   estable al recargar             deriva ${drift.toFixed(2)} px en ${iterations} iter`);
}

// El fallo que se colo la primera vez: al reabrir la app se relajaba partiendo del
// resultado guardado de la sesion anterior, y la separacion se acumulaba hasta
// dispersar el mapa (2500 px de alto tras unas pocas aperturas). El layout se
// recalcula desde la semilla, asi que repetir el ciclo debe dar siempre lo mismo.
{
  const extentOf = (nodes) => ({
    w: Math.max(...nodes.map((n) => n.x)),
    h: Math.max(...nodes.map((n) => n.y)),
  });

  const fromSeed = () => {
    const nodes = seed([2, 15]);
    relaxLayout(nodes, { minX: 8, minY: 8 });
    return extentOf(nodes);
  };
  const first = fromSeed();
  for (let session = 0; session < 5; session += 1) {
    const again = fromSeed();
    assert.deepEqual(again, first, `la apertura ${session + 2} da un mapa distinto`);
  }

  // Y encadenar relajaciones sobre el MISMO estado tampoco lo hace crecer.
  const chained = seed([2, 15]);
  relaxLayout(chained, { minX: 8, minY: 8 });
  const before = extentOf(chained);
  for (let i = 0; i < 5; i += 1) relaxLayout(chained, { minX: 8, minY: 8 });
  const after = extentOf(chained);
  assert.ok(after.w - before.w < 1 && after.h - before.h < 1, `el mapa se dispersa al re-relajar (${JSON.stringify(before)} -> ${JSON.stringify(after)})`);
  console.log(`ok   sin dispersion acumulativa      mapa ${Math.round(first.w)}x${Math.round(first.h)} px estable en 6 aperturas`);
}

console.log('\nlayout: todo correcto');
