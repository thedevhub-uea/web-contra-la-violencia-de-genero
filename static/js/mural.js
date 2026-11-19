// T07 — Mural de burbujas: pintarMural(mensajes).
// Texto SIEMPRE con textContent, nunca innerHTML.
//
// Uso:
//   pintarMural([{id: 1, texto: "..."}, ...])
//
// Cada mensaje puede traer, si se quiere, su propia personalización:
//   color   cualquier color CSS (un nombre como "teal", hexadecimal, rgb()…). Por defecto, --burbuja-color de paleta.css.
//   fuente  una de las claves de FUENTES ("moderna", "manuscrita", "elegante"...).
//   forma   una de las claves de FORMAS ("circulo", "corazon", "estrella"...).
//   emoji   uno o varios emojis que se muestran grandes encima del texto.
// Los valores que no son válidos se ignoran y se usa el predeterminado.
//
// Opcional: configurarMural({color, fuente, forma, maxBurbujas, velocidad}) cambia
// los valores por defecto de todo el mural.
//
// Caducidad (T15): la API manda `caduca_en` (segundos que le quedan al mensaje, calculados en el
// servidor; null = no caduca). Aquí se guarda como un instante de performance.now() (así no depende
// del reloj del navegador) y un único setInterval de 1 s retira la burbuja con su animación de
// salida, sin esperar al siguiente refresco. En los últimos 20 s la burbuja se atenúa (.caducando).
// Sin burbujas se muestra un mensaje bilingüe («Escanea el QR…») que desaparece con la primera.
//
// Datos de prueba: abre la pantalla con ?demo=mural para verlo sin la API.
//
// Colores: nada va fijo en este archivo. El color por defecto, la opacidad, el fondo y los dos
// colores de texto (claro/oscuro) se leen de las variables de static/css/paleta.css (T13). El texto
// de cada burbuja se elige por contraste WCAG (≥ 4,5:1): si ninguno de los dos llega, se
// aclara u oscurece un poco el color de la burbuja hasta conseguirlo.
//
// Los estilos están en static/css/mural.css (todo bajo #vista-mural) y las fuentes
// en static/fonts/, sin depender de la red. Este script carga el CSS solo, así que
// no hace falta tocar pantalla.html.
//
// El QR (#qr, de la T10) es un obstáculo fijo: las burbujas rebotan contra él
// igual que contra los bordes y nunca pasan por debajo.
//
// Rendimiento: en cada fotograma solo cambia `transform` (lo mueve la tarjeta
// gráfica, sin recalcular la página). El tamaño real de cada burbuja solo se
// toca cuando cambia el número de burbujas.

(function () {
  'use strict';

  // --- Configuración ---------------------------------------------------------

  const FUENTES = {
    moderna: '"Poppins", "Segoe UI", system-ui, sans-serif',
    redonda: '"Nunito", "Segoe UI", system-ui, sans-serif',
    elegante: '"Playfair Display", Georgia, "Times New Roman", serif',
    manuscrita: '"Caveat", "Segoe Print", "Bradley Hand", cursive',
    divertida: '"Pacifico", "Segoe Script", cursive',
    titular: '"Bebas Neue", Impact, "Arial Narrow", sans-serif',
    maquina: '"Space Mono", ui-monospace, Consolas, monospace',
  };

  // static/css/mural.css, junto a este script (vale también si la app va en un subdirectorio).
  const URL_CSS = (function () {
    const src = document.currentScript && document.currentScript.src;
    try {
      return new URL('../css/mural.css', src || window.location.href).href;
    } catch (_) {
      return 'static/css/mural.css';
    }
  })();

  // Formas en coordenadas de 0 a 1 (se estiran a la caja de la burbuja).
  // El círculo no necesita trazado: es la burbuja clásica con border-radius.
  const FORMAS = {
    circulo: null,
    corazon: 'M0.5,0.95 C0.38,0.86 0.03,0.64 0.03,0.34 C0.03,0.16 0.16,0.04 0.31,0.04 ' +
      'C0.41,0.04 0.47,0.1 0.5,0.18 C0.53,0.1 0.59,0.04 0.69,0.04 C0.84,0.04 0.97,0.16 ' +
      '0.97,0.34 C0.97,0.64 0.62,0.86 0.5,0.95 Z',
    estrella: poligonoRedondeado(puntosEstrella(5, 0.5, 0.53, 0.49, 0.6), 0.32),
    // Cinco pétalos redondos (|cos| deja una muesca entre pétalo y pétalo).
    flor: trazadoPolar(function (a) { return 0.5 * (0.8 + 0.2 * Math.abs(Math.cos(2.5 * (a + Math.PI / 2)))); }),
    hexagono: poligonoRedondeado(puntosEstrella(3, 0.5, 0.5, 0.5, 1), 0.2),
    cuadrada: trazadoPolar(function (a) {
      // "Squircle": cuadrado de esquinas suaves, como los iconos de Apple.
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      return 0.5 / Math.pow(Math.pow(c, 5) + Math.pow(s, 5), 1 / 5);
    }),
  };

  const CONFIG = {
    maxBurbujas: 30,
    color: null,          // se lee de --burbuja-color (paleta.css) al iniciar
    fuente: 'moderna',
    forma: 'circulo',
    velocidad: 60,        // px por segundo
    ocupacion: 0.38,      // parte de la pantalla que cubren las burbujas
  };

  const MAX_TEXTO = 200;
  const SUBPASOS = 3;     // la física se calcula varias veces por fotograma: choques más suaves
  const AVISO_CADUCIDAD = 20_000;  // ms antes de caducar en que la burbuja empieza a atenuarse
  const GUARDA_CADUCADA = 30_000;  // ms que se ignora una burbuja recién caducada si una respuesta atrasada la trae
  const reducirMovimiento = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Estado ----------------------------------------------------------------

  const burbujas = new Map();   // id -> burbuja activa
  let contenedor = null;
  let capa = null;
  let ancho = 0;
  let alto = 0;
  let ultimoTiempo = 0;
  let iniciado = false;
  let obstaculo = null;   // rectángulo del QR en coordenadas del mural: {x0, y0, x1, y1}
  let reloj = null;       // setInterval de 1 s que retira lo caducado (solo existe si hay burbujas que caducan)
  const caducadas = new Map();   // id -> hasta cuándo se ignora (performance.now()), tras caducar aquí
  let vacio = null;       // mensaje «Escanea el QR…» (sale solo con 0 burbujas)
  let datosRecibidos = false;    // hasta la primera respuesta de la API no se enseña el mensaje vacío
  // Colores leídos de paleta.css (ver leerPaleta): [r, g, b] salvo alfa, que es un número.
  const PALETA = { fondo: null, alfa: 0.9, textoClaro: null, textoOscuro: null };

  // --- API pública -----------------------------------------------------------

  function pintarMural(mensajes) {
    if (!Array.isArray(mensajes)) return;   // datos raros: se deja lo que hay
    if (!iniciar()) return;
    datosRecibidos = true;

    const ahora = performance.now();
    const validos = [];
    const vistos = new Set();
    for (const m of mensajes) {
      const limpio = limpiarMensaje(m);
      if (!limpio || vistos.has(limpio.id)) continue;
      // Acaba de caducar aquí: una respuesta atrasada no lo vuelve a poner.
      if ((caducadas.get(limpio.id) || 0) > ahora) continue;
      vistos.add(limpio.id);
      validos.push(limpio);
      if (validos.length >= CONFIG.maxBurbujas) break;   // la API manda los más recientes primero
    }

    // Fuera las que ya no están (ocultadas por moderación o desplazadas por nuevas).
    for (const [id, b] of burbujas) {
      if (!vistos.has(id)) quitarBurbuja(b);
    }

    let nuevas = 0;
    for (const m of validos) {
      const b = burbujas.get(m.id);
      const burbuja = b || crearBurbuja(m, nuevas++);
      if (b && b.firma !== firmaDe(m)) rellenar(b, m);
      marcarCaducidad(burbuja, m, ahora);
    }

    recalcularTamanos();
    actualizarVacio();
    ajustarReloj();
  }

  function configurarMural(opciones) {
    if (!opciones || typeof opciones !== 'object') return;
    if (colorARgb(opciones.color)) CONFIG.color = opciones.color;
    if (FUENTES[opciones.fuente]) CONFIG.fuente = opciones.fuente;
    if (Object.prototype.hasOwnProperty.call(FORMAS, opciones.forma)) CONFIG.forma = opciones.forma;
    if (opciones.maxBurbujas > 0) CONFIG.maxBurbujas = Math.min(60, Math.floor(opciones.maxBurbujas));
    if (opciones.velocidad >= 0) CONFIG.velocidad = Math.min(400, Number(opciones.velocidad));
    for (const b of burbujas.values()) rellenar(b, b.mensaje);
    recalcularTamanos();
  }

  window.pintarMural = pintarMural;
  window.configurarMural = configurarMural;
  window.MURAL_FUENTES = Object.keys(FUENTES);
  window.MURAL_FORMAS = Object.keys(FORMAS);

  // --- Arranque --------------------------------------------------------------

  function iniciar() {
    if (iniciado) return true;
    contenedor = document.getElementById('vista-mural');
    if (!contenedor) return false;
    iniciado = true;

    cargarEstilos();
    contenedor.classList.add('mural');
    leerPaleta();

    const fondo = document.createElement('div');
    fondo.className = 'mural-fondo';
    fondo.setAttribute('aria-hidden', 'true');
    capa = document.createElement('div');
    capa.className = 'mural-capa';
    vacio = crearMensajeVacio();
    contenedor.append(fondo, crearDefinicionesSvg(), vacio, capa);

    medir();
    window.addEventListener('resize', medir);
    if ('ResizeObserver' in window) {
      const observador = new ResizeObserver(medir);
      observador.observe(contenedor);
      const qr = document.getElementById('qr');
      if (qr) observador.observe(qr);   // p. ej. cuando termina de cargar la imagen del QR
    }
    if (document.fonts) {
      document.fonts.ready.then(reajustarTodas);
      document.fonts.addEventListener('loadingdone', reajustarTodas);
    }

    requestAnimationFrame(paso);
    return true;
  }

  function medir() {
    const nuevoAncho = contenedor.clientWidth;
    const nuevoAlto = contenedor.clientHeight;
    const cambio = nuevoAncho !== ancho || nuevoAlto !== alto;
    ancho = nuevoAncho;
    alto = nuevoAlto;
    if (!ancho || !alto) return;   // vista oculta: se espera a que se muestre
    const cambioQr = medirObstaculo();
    if (cambio || cambioQr) recalcularTamanos();
    for (const b of burbujas.values()) {
      if (b.porAjustar) ajustarTexto(b);
      b.x = limitar(b.x, b.r, ancho - b.r);
      b.y = limitar(b.y, b.r, alto - b.r);
      chocarConObstaculo(b, 0);
    }
  }

  // Rectángulo del QR (con margen) dentro del mural. Si entre el QR y un borde no
  // cabe una burbuja, se alarga hasta ese borde para que no se quede ninguna atrapada.
  function medirObstaculo() {
    const antes = JSON.stringify(obstaculo);
    obstaculo = null;
    const qr = document.getElementById('qr');
    if (qr && !qr.hidden) {
      const q = qr.getBoundingClientRect();
      const c = contenedor.getBoundingClientRect();
      if (q.width > 0 && q.height > 0) {
        const menor = Math.min(ancho, alto);
        const margen = menor * 0.02;
        const hueco = menor * 0.15;
        let x0 = q.left - c.left - margen;
        let y0 = q.top - c.top - margen;
        let x1 = q.right - c.left + margen;
        let y1 = q.bottom - c.top + margen;
        if (x0 < hueco) x0 = -1e4;
        if (y0 < hueco) y0 = -1e4;
        if (ancho - x1 < hueco) x1 = 1e4;
        if (alto - y1 < hueco) y1 = 1e4;
        if (x1 > 0 && y1 > 0 && x0 < ancho && y0 < alto) obstaculo = { x0: x0, y0: y0, x1: x1, y1: y1 };
      }
    }
    return JSON.stringify(obstaculo) !== antes;
  }

  // Distancia con signo de un punto al obstáculo (negativa si está dentro).
  function distanciaObstaculo(x, y) {
    const o = obstaculo;
    if (!o) return Infinity;
    const dx = Math.max(o.x0 - x, 0, x - o.x1);
    const dy = Math.max(o.y0 - y, 0, y - o.y1);
    if (dx || dy) return Math.hypot(dx, dy);
    return -Math.min(x - o.x0, o.x1 - x, y - o.y0, o.y1 - y);
  }

  // Rebote contra el rectángulo del QR, como contra un borde.
  function chocarConObstaculo(b, t) {
    const o = obstaculo;
    if (!o) return;
    const cx = limitar(b.x, o.x0, o.x1);
    const cy = limitar(b.y, o.y0, o.y1);
    let nx = b.x - cx;
    let ny = b.y - cy;
    let d = Math.hypot(nx, ny);
    if (d >= b.r) return;
    if (d > 1e-6) {
      nx /= d;
      ny /= d;
    } else {
      // El centro ha quedado dentro: sale por el lado más cercano.
      const lados = [[b.x - o.x0, -1, 0], [o.x1 - b.x, 1, 0], [b.y - o.y0, 0, -1], [o.y1 - b.y, 0, 1]];
      lados.sort(function (a, c) { return a[0] - c[0]; });
      d = -lados[0][0];
      nx = lados[0][1];
      ny = lados[0][2];
    }
    b.x += nx * (b.r - d);
    b.y += ny * (b.r - d);
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 2 * vn * nx;
      b.vy -= 2 * vn * ny;
      if (t) choque(b, t, nx, ny);
    }
  }

  // --- Caducidad y pantalla vacía (T15) -------------------------------------------

  // Mensaje fijo y bilingüe (como el lema del QR: lo lee público de ambos idiomas).
  function crearMensajeVacio() {
    const el = document.createElement('div');
    el.className = 'mural-vacio';
    el.setAttribute('role', 'status');
    const es = document.createElement('p');
    es.textContent = 'Escanea el QR y comparte tu mensaje';
    const en = document.createElement('p');
    en.className = 'mural-vacio-en';
    en.textContent = 'Scan the QR and share your message';
    el.append(es, en);
    return el;
  }

  function actualizarVacio() {
    if (vacio) vacio.classList.toggle('visible', datosRecibidos && burbujas.size === 0);
  }

  // Guarda cuándo caduca la burbuja (null/ausente = nunca) y la atenúa si le queda poco.
  function marcarCaducidad(b, m, ahora) {
    b.caduca = m.caducaEn === null ? Infinity : ahora + m.caducaEn * 1000;
    b.el.classList.toggle('caducando', b.caduca - ahora <= AVISO_CADUCIDAD);
  }

  // El reloj de 1 s solo corre mientras haya alguna burbuja que caduque.
  function ajustarReloj() {
    let hay = false;
    for (const b of burbujas.values()) if (b.caduca !== Infinity) { hay = true; break; }
    if (hay && !reloj) {
      reloj = setInterval(revisarCaducidad, 1000);
    } else if (!hay && reloj) {
      clearInterval(reloj);
      reloj = null;
    }
  }

  function revisarCaducidad() {
    const ahora = performance.now();
    let quitadas = 0;
    for (const b of Array.from(burbujas.values())) {
      const resta = b.caduca - ahora;
      if (resta <= 0) {
        caducadas.set(b.id, ahora + GUARDA_CADUCADA);
        quitarBurbuja(b);   // anima la salida (burbuja-salir) y la saca del mapa
        quitadas++;
      } else {
        b.el.classList.toggle('caducando', resta <= AVISO_CADUCIDAD);
      }
    }
    for (const [id, hasta] of caducadas) if (hasta <= ahora) caducadas.delete(id);
    if (quitadas) recalcularTamanos();
    ajustarReloj();
  }

  // --- Datos -----------------------------------------------------------------

  function limpiarMensaje(m) {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.id !== 'number' && typeof m.id !== 'string') return null;
    if (typeof m.texto !== 'string') return null;
    const texto = m.texto.trim().slice(0, MAX_TEXTO);
    if (!texto) return null;
    return {
      id: String(m.id),
      texto: texto,
      color: colorARgb(m.color) ? m.color.trim() : null,
      fuente: FUENTES[m.fuente] ? m.fuente : null,
      forma: Object.prototype.hasOwnProperty.call(FORMAS, m.forma) ? m.forma : null,
      emoji: limpiarEmoji(m.emoji),
      // segundos que le quedan (T15); null = no caduca
      caducaEn: (typeof m.caduca_en === 'number' && isFinite(m.caduca_en) && m.caduca_en >= 0) ? m.caduca_en : null,
    };
  }

  // Solo emojis (hasta unos pocos); cualquier letra o número lo invalida.
  function limpiarEmoji(valor) {
    if (typeof valor !== 'string') return '';
    const e = valor.trim();
    if (!e || e.length > 24) return '';
    try {
      if (!/\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]/u.test(e)) return '';
      const resto = e.replace(/[\u{1F1E6}-\u{1F1FF}#*0-9️⃣]/gu, '');
      if (/[\p{L}\p{N}<>&]/u.test(resto)) return '';
    } catch (_) {
      return '';
    }
    return e;
  }

  function firmaDe(m) {
    return [m.texto, m.color, m.fuente, m.forma, m.emoji].join('\u0000');
  }

  const lienzo = document.createElement('canvas').getContext('2d');

  // Devuelve [r, g, b] o null si no es un color CSS válido.
  function colorARgb(valor) {
    if (typeof valor !== 'string' || !lienzo) return null;
    const v = valor.trim();
    if (!v || v.length > 60) return null;
    // CSS.supports descarta lo que no es un color; var() y currentcolor no se pueden resolver aquí.
    if (/var\(|currentcolor/i.test(v) || !(window.CSS && CSS.supports('color', v))) return null;
    lienzo.fillStyle = v;
    const res = lienzo.fillStyle;
    if (res[0] === '#') {
      return [1, 3, 5].map(function (i) { return parseInt(res.slice(i, i + 2), 16); });
    }
    const nums = res.match(/[\d.]+/g);
    return nums ? nums.slice(0, 3).map(function (n) { return Math.round(Number(n)); }) : null;
  }

  function luminancia(rgb) {
    const c = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Razón de contraste WCAG entre dos luminancias.
  function contraste(l1, l2) {
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }

  // Mezcla a con b: k = 0 → a, k = 1 → b.
  function mezclar(a, b, k) {
    return a.map(function (v, i) { return Math.round(v + (b[i] - v) * k); });
  }

  // Lee de paleta.css (variables del :root) lo que necesita el mural.
  function leerPaleta() {
    const estilo = getComputedStyle(document.documentElement);
    const leer = function (nombre) { return colorARgb(estilo.getPropertyValue(nombre)); };
    PALETA.fondo = leer('--fondo') || colorARgb(getComputedStyle(contenedor).backgroundColor) || [255, 255, 255];
    PALETA.textoClaro = leer('--texto-burbuja-claro') || PALETA.fondo;
    PALETA.textoOscuro = leer('--texto-burbuja-oscuro') || PALETA.fondo;
    const alfa = parseFloat(estilo.getPropertyValue('--burbuja-alfa'));
    if (alfa > 0 && alfa <= 1) PALETA.alfa = alfa;
    if (!CONFIG.color) CONFIG.color = estilo.getPropertyValue('--burbuja-color').trim();
  }

  // Color que se pinta de verdad (el de la burbuja sobre el fondo, con su opacidad) y color
  // del texto que mejor se lee encima. Si ni el claro ni el oscuro llegan a 4,5:1 se desplaza
  // el color de la burbuja hacia el lado contrario al texto elegido, hasta que llegue.
  function elegirTexto(rgb) {
    const lumClaro = luminancia(PALETA.textoClaro);
    const lumOscuro = luminancia(PALETA.textoOscuro);
    let color = rgb.slice();
    let claro = false;
    for (let i = 0; i < 14; i++) {
      const efectivo = mezclar(PALETA.fondo, color, PALETA.alfa);
      // El reflejo del cristal aclara un poco la zona del texto: se tiene en cuenta para el
      // texto claro (que es el que empeora con ello).
      const conReflejo = mezclar(efectivo, PALETA.textoClaro, 0.1);
      const cClaro = contraste(luminancia(conReflejo), lumClaro);
      const cOscuro = contraste(luminancia(efectivo), lumOscuro);
      claro = cClaro > cOscuro;
      if (Math.max(cClaro, cOscuro) >= 4.5) break;
      color = claro ? mezclar(color, PALETA.textoOscuro, 0.1) : mezclar(color, PALETA.textoClaro, 0.1);
    }
    return { rgb: color, claro: claro };
  }

  // --- Formas ----------------------------------------------------------------

  function puntosEstrella(puntas, cx, cy, radio, proporcionInterior) {
    const pts = [];
    const n = puntas * 2;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * Math.PI / puntas;
      const r = i % 2 ? radio * proporcionInterior : radio;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return pts;
  }

  // Polígono con las esquinas redondeadas con curvas (t = cuánto se redondea).
  function poligonoRedondeado(pts, t) {
    const n = pts.length;
    const p = function (v) { return v[0].toFixed(4) + ',' + v[1].toFixed(4); };
    const hacia = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; };
    let d = '';
    for (let i = 0; i < n; i++) {
      const ant = pts[(i - 1 + n) % n];
      const act = pts[i];
      const sig = pts[(i + 1) % n];
      const entrada = hacia(act, ant, t);
      const salida = hacia(act, sig, t);
      d += (i ? ' L' : 'M') + p(entrada) + ' Q' + p(act) + ' ' + p(salida);
    }
    return d + ' Z';
  }

  function trazadoPolar(radio) {
    let d = '';
    for (let i = 0; i < 144; i++) {
      const a = i / 144 * Math.PI * 2;
      const r = radio(a);
      d += (i ? ' L' : 'M') + (0.5 + r * Math.cos(a)).toFixed(4) + ',' + (0.5 + r * Math.sin(a)).toFixed(4);
    }
    return d + ' Z';
  }

  const SVG = 'http://www.w3.org/2000/svg';

  function nodoSvg(nombre, atributos, hijos) {
    const n = document.createElementNS(SVG, nombre);
    for (const k in atributos) n.setAttribute(k, atributos[k]);
    (hijos || []).forEach(function (h) { n.appendChild(h); });
    return n;
  }

  // Recortes de cada forma y degradados del cristal, compartidos por todas las burbujas.
  function crearDefinicionesSvg() {
    const defs = nodoSvg('defs', {});
    for (const nombre in FORMAS) {
      if (!FORMAS[nombre]) continue;
      defs.appendChild(nodoSvg('clipPath', { id: 'mural-clip-' + nombre, clipPathUnits: 'objectBoundingBox' },
        [nodoSvg('path', { d: FORMAS[nombre] })]));
    }
    // El color de cada parada lo pone mural.css con la clase mural-parada-*.
    const parada = function (o, c, a) { return nodoSvg('stop', { offset: o, class: 'mural-parada-' + c, 'stop-opacity': a }); };
    defs.appendChild(nodoSvg('radialGradient', { id: 'mural-brillo', cx: '0.32', cy: '0.2', r: '0.55' }, [
      parada('0', 'blanco', '.42'), parada('.55', 'blanco', '.06'), parada('1', 'blanco', '0'),
    ]));
    defs.appendChild(nodoSvg('linearGradient', { id: 'mural-volumen', x1: '0', y1: '0', x2: '1', y2: '1' }, [
      parada('0', 'blanco', '.85'), parada('.4', 'blanco', '0'), parada('.6', 'sombra', '0'), parada('1', 'sombra', '.5'),
    ]));
    defs.appendChild(nodoSvg('linearGradient', { id: 'mural-iris', x1: '0', y1: '0', x2: '1', y2: '1' }, [
      parada('0', 'blanco', '.95'), parada('.3', 'rosa', '.7'), parada('.55', 'blanco', '.15'),
      parada('.8', 'azul', '.75'), parada('1', 'blanco', '.9'),
    ]));
    defs.appendChild(nodoSvg('filter', { id: 'mural-difuminar', x: '-20%', y: '-20%', width: '140%', height: '140%' }, [
      nodoSvg('feGaussianBlur', { stdDeviation: '0.03' }),
    ]));
    const svg = nodoSvg('svg', { class: 'mural-defs', width: '0', height: '0', 'aria-hidden': 'true' }, [defs]);
    return svg;
  }

  // Capas de cristal dibujadas con el contorno de la forma (para las que no son círculo).
  function crearCristalSvg(d) {
    const comun = { d: d, fill: 'none', 'vector-effect': 'non-scaling-stroke' };
    return nodoSvg('svg', { class: 'burbuja-svg', viewBox: '0 0 1 1', preserveAspectRatio: 'none', 'aria-hidden': 'true' }, [
      nodoSvg('path', { d: d, fill: 'url(#mural-brillo)' }),
      nodoSvg('path', Object.assign({ class: 'burbuja-volumen', stroke: 'url(#mural-volumen)', filter: 'url(#mural-difuminar)' }, comun)),
      nodoSvg('path', Object.assign({ stroke: 'url(#mural-iris)', 'stroke-width': '4', opacity: '.7' }, comun)),
      nodoSvg('path', Object.assign({ class: 'burbuja-borde-brillo', 'stroke-width': '1.5' }, comun)),
    ]);
  }

  // --- Burbujas --------------------------------------------------------------

  function crearBurbuja(m, orden) {
    const el = document.createElement('div');
    el.className = 'burbuja';
    const escala = document.createElement('div');
    escala.className = 'burbuja-escala';
    const sombra = document.createElement('div');
    sombra.className = 'burbuja-sombra';
    sombra.setAttribute('aria-hidden', 'true');
    const cuerpo = document.createElement('div');
    cuerpo.className = 'burbuja-cuerpo';
    const contenido = document.createElement('div');
    contenido.className = 'burbuja-contenido';
    const emoji = document.createElement('span');
    emoji.className = 'burbuja-emoji';
    emoji.setAttribute('aria-hidden', 'true');
    const texto = document.createElement('p');
    texto.className = 'burbuja-texto';

    contenido.append(emoji, texto);
    cuerpo.appendChild(contenido);
    escala.append(sombra, cuerpo);
    el.appendChild(escala);

    const angulo = Math.random() * Math.PI * 2;
    const b = {
      id: m.id, mensaje: m, el: el, escala: escala, cuerpo: cuerpo, svg: null,
      contenido: contenido, emojiEl: emoji, textoEl: texto,
      x: 0, y: 0, r: 0, rObjetivo: 0, rDom: 0, peso: 1, forma: null,
      factorVel: 0.75 + Math.random() * 0.5,
      giro: (Math.random() - 0.5) * 0.4,
      vx: Math.cos(angulo), vy: Math.sin(angulo),
      saliendo: false, colocada: false, porAjustar: true,
      nacida: performance.now(), ultimoChoque: 0, firma: '', caduca: Infinity,
    };

    escala.style.setProperty('--dur', (5 + Math.random() * 4).toFixed(2) + 's');
    escala.style.setProperty('--retraso-flotar', (-Math.random() * 9).toFixed(2) + 's');
    escala.style.setProperty('--retraso', Math.min(orden * 70, 1400) + 'ms');

    rellenar(b, m);
    burbujas.set(m.id, b);
    capa.appendChild(el);
    return b;
  }

  function rellenar(b, m) {
    b.mensaje = m;
    b.firma = firmaDe(m);
    b.textoEl.textContent = m.texto;          // nunca innerHTML
    b.emojiEl.textContent = m.emoji;
    b.emojiEl.hidden = !m.emoji;

    // Color propio, o el de la paleta; si no hay ninguno, el del texto del mural.
    const base = colorARgb(m.color) || colorARgb(CONFIG.color) ||
      colorARgb(getComputedStyle(contenedor).color) || PALETA.textoOscuro;
    const elegido = elegirTexto(base);
    const rgb = elegido.rgb;
    const oscuro = rgb.map(function (v) { return Math.round(v * 0.45); });
    const claro = rgb.map(function (v) { return Math.round(v + (255 - v) * 0.55); });
    const s = b.el.style;
    s.setProperty('--rgb', rgb.join(' '));
    s.setProperty('--rgb-osc', oscuro.join(' '));
    s.setProperty('--rgb-claro', claro.join(' '));
    s.setProperty('--fuente', FUENTES[m.fuente || CONFIG.fuente] || FUENTES.moderna);
    b.el.classList.toggle('burbuja-texto-claro', elegido.claro);   // texto blanco o texto oscuro

    const forma = m.forma || CONFIG.forma;
    if (forma !== b.forma) {
      b.forma = forma;
      b.el.dataset.forma = forma;
      if (b.svg) { b.svg.remove(); b.svg = null; }
      if (FORMAS[forma]) {
        b.svg = crearCristalSvg(FORMAS[forma]);
        b.cuerpo.insertBefore(b.svg, b.contenido);
      }
    }

    // Los mensajes largos y con emoji necesitan algo más de sitio; la estrella también.
    const largo = Math.min(m.texto.length, MAX_TEXTO) / MAX_TEXTO;
    b.peso = (0.8 + 0.6 * Math.sqrt(largo) + (m.emoji ? 0.08 : 0)) * (forma === 'estrella' ? 1.12 : 1);
    b.porAjustar = true;
  }

  function quitarBurbuja(b) {
    if (b.saliendo) return;
    b.saliendo = true;
    burbujas.delete(b.id);
    b.el.classList.add('saliendo');
    setTimeout(function () { b.el.remove(); }, 700);
    actualizarVacio();
  }

  // Radio base para que entre todo sin amontonarse, según cuántas burbujas hay.
  function recalcularTamanos() {
    if (!ancho || !alto) return;
    let suma = 0;
    for (const b of burbujas.values()) suma += b.peso * b.peso;
    if (!suma) return;
    const menor = Math.min(ancho, alto);
    let area = ancho * alto;
    if (obstaculo) {
      area -= Math.max(0, Math.min(ancho, obstaculo.x1) - Math.max(0, obstaculo.x0)) *
        Math.max(0, Math.min(alto, obstaculo.y1) - Math.max(0, obstaculo.y0));
    }
    const base = limitar(Math.sqrt(CONFIG.ocupacion * Math.max(area, ancho * alto * 0.4) / (Math.PI * suma)),
      menor * 0.06, menor * 0.21);
    for (const b of burbujas.values()) {
      b.rObjetivo = Math.min(base * b.peso, menor * 0.28);
      if (!b.colocada) colocar(b);
      // El tamaño real del elemento solo cambia aquí; la transición la hace `scale`.
      if (Math.abs(b.rDom - b.rObjetivo) > 0.5) fijarTamano(b, b.rObjetivo);
      if (b.porAjustar) ajustarTexto(b);
    }
  }

  // Busca un hueco libre: de varios puntos al azar, el que más lejos queda del resto.
  function colocar(b) {
    if (!ancho || !alto || !b.rObjetivo) return;
    b.r = b.rObjetivo;
    let mejor = [ancho / 2, alto / 2];
    let mejorHolgura = -Infinity;
    for (let i = 0; i < 60; i++) {
      const x = b.r + Math.random() * Math.max(1, ancho - 2 * b.r);
      const y = b.r + Math.random() * Math.max(1, alto - 2 * b.r);
      let holgura = distanciaObstaculo(x, y) - b.r;   // nunca encima del QR
      for (const o of burbujas.values()) {
        if (o === b || !o.colocada) continue;
        holgura = Math.min(holgura, Math.hypot(o.x - x, o.y - y) - o.r - b.r);
      }
      if (holgura > mejorHolgura) {
        mejorHolgura = holgura;
        mejor = [x, y];
      }
      if (holgura > b.r * 0.5) break;
    }
    b.x = mejor[0];
    b.y = mejor[1];
    b.colocada = true;
    dibujar(b);
  }

  function fijarTamano(b, r) {
    b.rDom = r;
    const d = (r * 2).toFixed(1) + 'px';
    b.el.style.width = d;
    b.el.style.height = d;
    if (b.svg) b.svg.querySelector('.burbuja-volumen').setAttribute('stroke-width', (r * 0.32).toFixed(1));
    b.porAjustar = true;
  }

  // Elige el tamaño de letra más grande con el que el texto cabe en la burbuja.
  function ajustarTexto(b) {
    if (!ancho || !b.rDom) { b.porAjustar = true; return; }
    const r = b.rDom;
    const largo = b.mensaje.texto.length + (b.mensaje.emoji ? 6 : 0);
    let fs = Math.max(10, Math.min(r * 0.32, 1.55 * r / Math.sqrt(largo + 2)));
    const c = b.contenido;
    const poner = function () { b.el.style.setProperty('--fs', fs.toFixed(2) + 'px'); };
    // Al centrar con flex, lo que desborda por arriba no cuenta en scrollHeight:
    // se mide la altura real del emoji y del texto.
    const noCabe = function () {
      const altoEmoji = b.emojiEl.hidden ? 0 : b.emojiEl.offsetHeight * 1.08;
      return b.textoEl.offsetHeight + altoEmoji > c.clientHeight + 1 ||
        b.textoEl.scrollWidth > c.clientWidth + 1;
    };
    poner();
    for (let i = 0; i < 20 && fs > 9 && noCabe(); i++) {
      fs *= 0.93;
      poner();
    }
    b.porAjustar = false;
  }

  function reajustarTodas() {
    for (const b of burbujas.values()) ajustarTexto(b);
  }

  // --- Física: movimiento, rebotes con los bordes y entre burbujas -------------

  function paso(t) {
    requestAnimationFrame(paso);
    const dt = Math.min(0.04, Math.max(0, (t - ultimoTiempo) / 1000));
    ultimoTiempo = t;
    if (document.hidden || !ancho || !alto || !burbujas.size || !dt) return;

    const lista = [];
    for (const b of burbujas.values()) if (b.colocada) lista.push(b);
    const velocidad = CONFIG.velocidad * (reducirMovimiento ? 0.25 : 1);
    const h = dt / SUBPASOS;

    for (const b of lista) {
      // El radio se acerca suavemente al objetivo (cuando entran o salen otras).
      b.r += (b.rObjetivo - b.r) * Math.min(1, dt * 2.5);

      // Deriva: la dirección gira despacio para que la trayectoria sea curva y orgánica.
      b.giro += (Math.random() - 0.5) * dt * 0.6;
      b.giro = limitar(b.giro, -0.35, 0.35);
      const g = b.giro * dt;
      const cos = Math.cos(g);
      const sin = Math.sin(g);
      const vx = b.vx * cos - b.vy * sin;
      b.vy = b.vx * sin + b.vy * cos;
      b.vx = vx;

      // Velocidad de crucero: tras un choque vuelve poco a poco a su ritmo.
      const v = Math.hypot(b.vx, b.vy) || 1;
      const ajuste = (velocidad * b.factorVel - v) * Math.min(1, dt * 0.7);
      b.vx += (b.vx / v) * ajuste;
      b.vy += (b.vy / v) * ajuste;
    }

    for (let s = 0; s < SUBPASOS; s++) {
      for (const b of lista) {
        b.x += b.vx * h;
        b.y += b.vy * h;
        if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); choque(b, t, 1, 0); }
        else if (b.x > ancho - b.r) { b.x = ancho - b.r; b.vx = -Math.abs(b.vx); choque(b, t, 1, 0); }
        if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy); choque(b, t, 0, 1); }
        else if (b.y > alto - b.r) { b.y = alto - b.r; b.vy = -Math.abs(b.vy); choque(b, t, 0, 1); }
        chocarConObstaculo(b, t);
      }
      chocarEntreSi(lista, t);
    }
    // Un choque entre burbujas puede empujar alguna hacia el QR: se corrige antes de pintar.
    for (const b of lista) chocarConObstaculo(b, t);

    for (const b of lista) dibujar(b);
  }

  // Choques elásticos entre burbujas (la masa crece con el área).
  function chocarEntreSi(lista, t) {
    for (let i = 0; i < lista.length; i++) {
      const a = lista[i];
      const ia = 1 / (a.r * a.r);
      for (let j = i + 1; j < lista.length; j++) {
        const c = lista[j];
        let dx = c.x - a.x;
        let dy = c.y - a.y;
        const minimo = a.r + c.r;
        if (Math.abs(dx) >= minimo || Math.abs(dy) >= minimo) continue;
        let dist = Math.hypot(dx, dy);
        if (dist >= minimo) continue;
        const ic = 1 / (c.r * c.r);
        if (dist < 0.001) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dist = Math.hypot(dx, dy);
        }
        const nx = dx / dist;
        const ny = dy / dist;

        // Se separan con suavidad (solo una parte del solape por subpaso: sin tirones).
        const solape = (minimo - dist) * 0.5;
        const pa = solape * ia / (ia + ic);
        const pc = solape * ic / (ia + ic);
        a.x -= nx * pa; a.y -= ny * pa;
        c.x += nx * pc; c.y += ny * pc;

        // Rebote elástico en la dirección del choque.
        const vrel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
        if (vrel < 0) {
          const imp = -2 * vrel / (ia + ic);
          a.vx -= imp * ia * nx; a.vy -= imp * ia * ny;
          c.vx += imp * ic * nx; c.vy += imp * ic * ny;
          if (-vrel > 15) { choque(a, t, nx, ny); choque(c, t, nx, ny); }
        }
      }
    }
  }

  // Efecto gelatina al chocar: se aplasta en la dirección del golpe.
  // Se hace con la Web Animations API, que no obliga a recalcular la página.
  function choque(b, t, nx, ny) {
    if (b.saliendo || reducirMovimiento || t - b.ultimoChoque < 500 || t - b.nacida < 1800) return;
    if (!b.escala.animate) return;
    b.ultimoChoque = t;
    const horizontal = Math.abs(nx) > Math.abs(ny);
    const aplastar = horizontal ? '0.92 1.07' : '1.07 0.92';
    const rebotar = horizontal ? '1.04 0.97' : '0.97 1.04';
    b.escala.animate([
      { scale: '1 1' }, { scale: aplastar, offset: 0.28 }, { scale: rebotar, offset: 0.6 }, { scale: '1 1' },
    ], { duration: 650, easing: 'cubic-bezier(.25,.8,.35,1)' });
  }

  function dibujar(b) {
    const k = b.rDom ? b.r / b.rDom : 1;
    b.el.style.transform = 'translate3d(' + (b.x - b.rDom).toFixed(2) + 'px,' +
      (b.y - b.rDom).toFixed(2) + 'px,0) scale(' + k.toFixed(4) + ')';
  }

  function limitar(v, min, max) {
    return max < min ? (min + max) / 2 : Math.min(max, Math.max(min, v));
  }

  // --- Estilos ---------------------------------------------------------------

  // Carga static/css/mural.css una vez. Hasta que llega, las burbujas no se ven
  // (lo pone el propio CSS); al llegar, se recalculan tamaños y textos.
  function cargarEstilos() {
    const listo = function () {
      contenedor.classList.add('mural-listo');
      medir();
      recalcularTamanos();
      reajustarTodas();
    };
    let enlace = document.getElementById('mural-estilos');
    if (enlace) {
      if (enlace.sheet) listo(); else enlace.addEventListener('load', listo);
      return;
    }
    enlace = document.createElement('link');
    enlace.id = 'mural-estilos';
    enlace.rel = 'stylesheet';
    enlace.href = URL_CSS;
    enlace.addEventListener('load', listo);
    enlace.addEventListener('error', function () {
      console.warn('No se pudo cargar mural.css');
      contenedor.classList.add('mural-listo');
    });
    document.head.appendChild(enlace);
  }

  // --- Datos de prueba (hasta que esté la API) ---------------------------------

  const MENSAJES_PRUEBA = [
    { id: 1, texto: 'Ni una menos', emoji: '💜', forma: 'corazon' },
    { id: 2, texto: 'Vivas, libres y sin miedo', fuente: 'titular' },
    { id: 3, texto: 'Si nos tocan a una, nos tocan a todas', color: '#c13584', emoji: '✊' },
    { id: 4, texto: '<b>hola</b>' },
    { id: 5, texto: 'Te creo', fuente: 'manuscrita', emoji: '🤝', forma: 'flor' },
    { id: 6, texto: 'El silencio no nos protege', color: '#2ec4b6', fuente: 'elegante', forma: 'cuadrada' },
    { id: 7, texto: 'Juntas somos más fuertes', emoji: '🌸', fuente: 'redonda', forma: 'flor' },
    { id: 8, texto: 'Llama al 016', color: '#ffd166', emoji: '📞', fuente: 'titular', forma: 'estrella' },
    { id: 9, texto: 'No es amor si duele', fuente: 'divertida', forma: 'corazon', color: '#e63946' },
    { id: 10, texto: 'Educar en igualdad es prevenir la violencia de género desde la infancia' },
    { id: 11, texto: 'Mi cuerpo, mi decisión', color: '#e63946', emoji: '🔥' },
    { id: 12, texto: 'Hermana, yo sí te creo', emoji: '💜💜', fuente: 'manuscrita', forma: 'corazon' },
    { id: 13, texto: 'Por las que ya no están', color: '#5a189a', emoji: '🕯️' },
    { id: 14, texto: 'Basta ya', fuente: 'titular', color: '#ff4d9d', forma: 'hexagono' },
    { id: 15, texto: 'La igualdad se construye cada día, en casa, en clase y en la calle', fuente: 'redonda', forma: 'cuadrada' },
    { id: 16, texto: 'Ni sumisas ni devotas: libres', fuente: 'divertida', emoji: '🦋' },
    { id: 17, texto: 'Nunca estás sola', color: '#4cc9f0', emoji: '🫂', forma: 'corazon' },
    { id: 18, texto: 'No es no', fuente: 'maquina', emoji: '🚫', forma: 'hexagono' },
    { id: 19, texto: 'Que el miedo cambie de bando', fuente: 'elegante', color: '#9d4edd' },
    { id: 20, texto: 'Libres', emoji: '🕊️', forma: 'estrella' },
    { id: 21, texto: 'Pide ayuda, hay salida', color: '#06d6a0', fuente: 'redonda' },
    { id: 22, texto: 'Rompe el silencio', emoji: '📢', fuente: 'titular' },
    { id: 23, texto: 'Respeto', color: '#f72585', fuente: 'manuscrita', forma: 'corazon' },
    { id: 24, texto: 'Ninguna agresión sin respuesta', emoji: '🛡️', forma: 'hexagono' },
    { id: 25, texto: 'Queremos llegar a casa tranquilas', fuente: 'elegante' },
    { id: 26, texto: 'El machismo mata', color: '#b5179e', fuente: 'titular' },
    { id: 27, texto: 'Sororidad', emoji: '✨', fuente: 'divertida', color: '#c77dff', forma: 'estrella' },
    { id: 28, texto: 'Ni golpes que duelan ni palabras que hieran', forma: 'cuadrada' },
    { id: 29, texto: 'Aquí también se lucha', emoji: '🏫', color: '#7209b7', forma: 'flor' },
    { id: 30, texto: 'Ojalá un mundo donde este mural no haga falta', fuente: 'manuscrita', emoji: '🌍' },
  ];
  window.MURAL_PRUEBA = MENSAJES_PRUEBA;

  if (/[?&]demo=mural\b/.test(window.location.search)) {
    const arrancarDemo = function () { pintarMural(MENSAJES_PRUEBA.slice().reverse()); };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', arrancarDemo);
    } else {
      arrancarDemo();
    }
  }
})();
