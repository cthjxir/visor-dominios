// Relajacion del mapa de dominios: repulsion de corto alcance entre nodos que se
// solapan, mas un resorte que mantiene a cada subdominio a la distancia de su
// abanico. Puro y determinista (sin DOM, sin azar): la misma entrada da la misma
// salida, asi que las posiciones guardadas son estables entre sesiones y se puede
// probar con `npm run test:layout`.

// Separacion visible que queda entre dos esferas ya separadas.
export const REPULSION_GAP = 18;
// Cuanto tira la correa padre-hijo por iteracion. Mas alto oscila contra la
// repulsion; mas bajo deja el abanico deformado.
export const LINK_STIFFNESS = 0.18;
// Tope de seguridad: la salida normal es haber resuelto todos los solapes.
export const MAX_ITERATIONS = 400;
// El resorte nunca llega a cero exacto; por debajo de esto ya no se nota.
export const TOLERANCE = 0.4;

// Angulo aureo: separa dos nodos exactamente coincidentes en una direccion
// estable y distinta para cada indice, sin recurrir a Math.random().
const GOLDEN_ANGLE = 2.399963229728653;

// Radio minimo del abanico: por debajo, un padre con uno o dos hijos se veria
// apretado aunque quepan.
export const MIN_FAN_RADIUS = 150;

// Holgura sobre el minimo geometrico del abanico. Ajustado al minimo (+4) el
// abanico cabe justo, pero cualquier empujon del exterior lo descoloca antes de
// que el reparto angular se recupere y dos hermanos acaban solapados.
const FAN_SLACK = 12;

/**
 * Radio al que colocar `count` hijos alrededor de un padre para que quepan sin
 * solaparse. Se deriva de REPULSION_GAP a proposito: si el abanico dejara menos
 * hueco del que pide la repulsion, resorte y repulsion pelearian sin converger.
 */
export function fanRadius(count, childRadius) {
  const perNode = 2 * childRadius + REPULSION_GAP + FAN_SLACK;
  return Math.max(MIN_FAN_RADIUS, (count * perNode) / (2 * Math.PI));
}

const influence = (node) => node.spacing ?? node.r;

const shift = (node, dx, dy) => {
  node.x += dx;
  node.y += dy;
};

// Empuja `a` y `b` hasta `minDistance`, repartiendo segun cuales estan fijados.
// `move` permite trasladar algo mas que el propio nodo (ver moveGroup).
// Devuelve el mayor desplazamiento aplicado (0 si no se tocaban).
function separate(a, b, minDistance, seed, move = shift) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let distance = Math.hypot(dx, dy);
  if (distance >= minDistance) return 0;

  if (distance < 0.01) {
    const angle = (seed * GOLDEN_ANGLE) % (2 * Math.PI);
    dx = Math.cos(angle);
    dy = Math.sin(angle);
    distance = 1;
  }

  // Un nodo fijado no cede su parte: el otro absorbe la separacion entera. Si
  // ambos estan fijados ceden a medias, porque dejarlos encimados para siempre es
  // peor que mover un poco algo que el usuario coloco: el solape no tiene salida
  // (los coloco en momentos distintos y no ve que se pisan hasta que se despliegan).
  const bothFixed = a.fixed && b.fixed;
  const overlap = minDistance - distance;
  const shareA = bothFixed ? 0.5 : a.fixed ? 0 : b.fixed ? 1 : 0.5;
  const shareB = bothFixed ? 0.5 : b.fixed ? 0 : a.fixed ? 1 : 0.5;
  const ux = dx / distance;
  const uy = dy / distance;

  move(a, -ux * overlap * shareA, -uy * overlap * shareA);
  move(b, ux * overlap * shareB, uy * overlap * shareB);
  return overlap * Math.max(shareA, shareB);
}

/**
 * Mueve `nodes` in situ hasta que ningun par se solape.
 *
 * Cada nodo: { id, x, y, r, parentId?, fan?, spacing?, fixed? }
 *   r       radio de la esfera
 *   fan     distancia a la que el resorte quiere a los hijos de ESTE nodo
 *   spacing radio de influencia (por defecto r). Un dominio desplegado ocupa el
 *           area de su abanico, no la de su esfera: sin esto dos abanicos se
 *           cruzan y sus hijos no tienen hueco donde caber sobre su circunferencia
 *   fixed   el usuario lo coloco a mano: no se mueve, pero si empuja
 *
 * Devuelve las iteraciones consumidas (< MAX_ITERATIONS = convergio).
 */
export function relaxLayout(nodes, { minX = 0, minY = 0, gap = REPULSION_GAP } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots = nodes.filter((node) => !node.parentId);

  const childrenOf = new Map(roots.map((root) => [root.id, []]));
  for (const node of nodes) {
    if (node.parentId) childrenOf.get(node.parentId)?.push(node);
  }

  // Un dominio desplegado y sus subdominios se mueven juntos: si el padre se
  // aparta solo, el resorte arrastra a los hijos con retraso y el abanico se
  // apina por un lado. Trasladar el grupo entero le conserva la forma.
  const moveGroup = (node, dx, dy) => {
    shift(node, dx, dy);
    for (const child of childrenOf.get(node.id) || []) {
      if (!child.fixed) shift(child, dx, dy);
    }
  };

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    // Se miden por separado: el objetivo es que no quede solape. Parar solo
    // porque los pasos son pequenos deja pares encimados cuando el sistema
    // avanza despacio, que es justo el caso de un abanico apretado.
    let largestOverlap = 0;
    let largestSpring = 0;

    // 1a. Repulsion de area entre dominios padre: cada uno reclama el espacio de
    //     su abanico, asi los grupos no se cruzan y cada hijo encuentra hueco.
    //     Hace falta: sin ella, un mapa denso oscila entre la repulsion (que echa
    //     al hijo fuera del abanico) y la correa (que lo devuelve) sin converger.
    for (let i = 0; i < roots.length; i += 1) {
      for (let j = i + 1; j < roots.length; j += 1) {
        largestOverlap = Math.max(
          largestOverlap,
          separate(roots[i], roots[j], influence(roots[i]) + influence(roots[j]) + gap, i, moveGroup),
        );
      }
    }

    // 1b. Repulsion de esferas entre todos: resuelve el solape que quede dentro de
    //     un grupo. Solo actua sobre pares que ya se tocan, asi que fuera de ese
    //     radio el mapa conserva la forma de la rejilla que el usuario reconoce.
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        largestOverlap = Math.max(
          largestOverlap,
          separate(nodes[i], nodes[j], nodes[i].r + nodes[j].r + gap, i),
        );
      }
    }

    // 2. Correa al padre: limita la distancia maxima, no la fija. Un resorte
    //    rigido devolvia al hijo al radio exacto justo despues de que la repulsion
    //    lo apartara, y al volver al radio el arco entre hermanos se contraia otra
    //    vez: el sistema oscilaba sin converger. Tirando solo hacia dentro, el
    //    anillo puede ensancharse donde hace falta y el abanico deja de pelearse
    //    con la repulsion.
    for (const node of nodes) {
      if (node.fixed || !node.parentId) continue;
      const parent = byId.get(node.parentId);
      if (!parent) continue;

      const target = parent.fan ?? 0;
      if (!target) continue;

      let dx = node.x - parent.x;
      let dy = node.y - parent.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.01) {
        dx = 1;
        dy = 0;
        distance = 1;
      }

      if (distance <= target) continue;
      const correction = (target - distance) * LINK_STIFFNESS;
      node.x += (dx / distance) * correction;
      node.y += (dy / distance) * correction;
      largestSpring = Math.max(largestSpring, Math.abs(correction));
    }

    // 3. Nada puede salir por arriba ni por la izquierda: alli no hay scroll que
    //    lo recupere (el lienzo solo crece a la derecha y hacia abajo). Un dominio
    //    desplegado se separa del borde lo que mide su abanico, no su esfera: si
    //    no, medio abanico queda recortado contra el borde y sus hijos apilados
    //    en la franja que les deja el limite.
    for (const node of nodes) {
      if (node.fixed) continue;
      const isRoot = !node.parentId;
      const keepOut = isRoot ? influence(node) : node.r;
      const dx = Math.max(minX + keepOut, node.x) - node.x;
      const dy = Math.max(minY + keepOut, node.y) - node.y;
      if (dx || dy) (isRoot ? moveGroup : shift)(node, dx, dy);
    }

    if (largestOverlap < 0.01 && largestSpring < TOLERANCE) return iteration;
  }

  return MAX_ITERATIONS;
}

/**
 * El par mas cercano en relacion a su separacion minima. `slack` negativo = se
 * solapan. Sirve para comprobar el resultado y para las pruebas.
 */
export function tightestPair(nodes, gap = REPULSION_GAP) {
  let tightest = null;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const slack = Math.hypot(b.x - a.x, b.y - a.y) - (a.r + b.r + gap);
      if (!tightest || slack < tightest.slack) tightest = { a: a.id, b: b.id, slack };
    }
  }
  return tightest;
}
