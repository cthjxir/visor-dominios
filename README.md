# Visor Dominios

App de escritorio (Electron) para monitorear los dominios y subdominios alojados
en uno o varios servidores [Virtualmin](https://www.virtualmin.com/). Agrupa los
dominios por IP pública, distingue el dominio padre de sus subdominios, y los
muestra como un mapa de burbujas 3D interactivo o como una tabla, con detalle
por dominio y buscador.

Desarrollada para la Dirección de Tecnologías de la Información del
Ayuntamiento de Salamanca (México).

## Arquitectura

- **`electron/`** — proceso principal de Electron: abre la ventana, sirve el
  renderer por un esquema `app://` propio (los módulos ES de three.js no cargan
  bajo `file://`) y arranca/detiene el backend como subproceso.
- **`renderer/`** — frontend, HTML/CSS/JS sin framework. El mapa de burbujas
  usa [three.js](https://threejs.org/) (WebGL) y las animaciones
  [anime.js](https://animejs.com/).
- **`backend/`** — servidor Flask local (`127.0.0.1:57843`) que consulta la
  API remota de Virtualmin (`remote.cgi`) y expone el resultado al renderer.

No hay base de datos: los servidores registrados se guardan en un JSON local
(vía `platformdirs`) y sus contraseñas en el llavero del sistema operativo
(vía `keyring`), nunca en texto plano.

## Requisitos

- [Node.js](https://nodejs.org/) 18+ y npm
- Python 3.10+

## Desarrollo

```bash
npm install
```

El backend corre desde un entorno virtual de Python que Electron arranca por
su cuenta (`electron/main.js`). Créalo una sola vez:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd ..
```

Y levanta la app:

```bash
npm start
```

### Otros scripts

```bash
npm run test:layout     # pruebas del algoritmo de acomodo de burbujas (layout.mjs)
npm run vendor:three    # re-vendoriza three.js + CSS2DRenderer a renderer/vendor/
npm run vendor:anime    # re-vendoriza anime.js a renderer/vendor/
npm run vendor:fonts    # re-vendoriza las fuentes Geist a renderer/vendor/fonts/
```

`three`, `animejs` y las fuentes se instalan como devDependencies pero se
copian ("vendorizan") a `renderer/vendor/`, que sí va versionado — el build
final no depende de `node_modules` en tiempo de ejecución. Vuelve a correr el
script `vendor:*` correspondiente después de actualizar esa dependencia.

Para probar el backend por separado:

```bash
cd backend
.venv/bin/python virtualmin_client.py   # corre sus asserts embebidos
.venv/bin/python app.py                 # lo levanta solo, en 127.0.0.1:57843
```

## Build / distribución

```bash
npm run build:backend   # empaqueta el backend con PyInstaller (backend/dist/)
npm run dist            # empaqueta la app con electron-builder
```

`npm run dist` requiere que `build:backend` se haya corrido antes: el backend
empacado se incluye como recurso extra de la app (ver `build.extraResources`
en `package.json`). El release multiplataforma (mac/linux/windows) se genera
automáticamente vía GitHub Actions al subir un tag `v*`.

Windows además tiene un instalador aparte con Inno Setup en
`installer/windows.iss`.

## Estructura de datos

Cada servidor Virtualmin registrado aporta un conjunto de dominios que se
agrupan por su IP pública. Dentro de cada grupo:

- el **padre** es el dominio que coincide con el host registrado del
  servidor, o el que Virtualmin marca como `default_website_for_ip`;
- los demás dominios del grupo quedan como **hijos** (subdominios).

El modal de detalle de un dominio muestra, sin transformarlos, los campos que
la API de Virtualmin reportó para ese dominio.
