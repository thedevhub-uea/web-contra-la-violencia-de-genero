/* CONECTA · dibujo de una burbuja con estilo personalizado. Lo usan el mural proyectado, la vista
 * previa del móvil (/participa) y el panel de administración: así se ve igual en los tres sitios.
 *
 * Los valores permitidos son los mismos que valida el servidor (bd/estilo.py). Aquí NUNCA se
 * construye HTML ni CSS a partir de texto: el texto va con textContent y los colores solo se
 * usan si cumplen /^#[0-9a-f]{6}$/.
 *
 *   EstiloBurbuja.crear(texto, estilo) -> <div class="eb"> que llena a su contenedor
 *   EstiloBurbuja.sanear(estilo)       -> estilo completo y válido (valores por defecto si falta algo)
 */
(function (global) {
  'use strict';

  var FORMAS = ['circulo', 'cuadrado', 'corazon', 'nube', 'estrella', 'hexagono', 'gota', 'lazo'];
  var FUENTES = {
    sans: '"Montserrat", "Poppins", system-ui, sans-serif',
    serif: '"Playfair Display", Georgia, serif',
    manuscrita: '"Caveat", "Segoe Print", cursive',
    display: '"Bebas Neue", Impact, "Arial Narrow", sans-serif',
    redonda: '"Nunito", system-ui, sans-serif',
    mono: '"Space Mono", ui-monospace, Consolas, monospace',
  };
  var ANIMACIONES = ['ninguna', 'flotar', 'latido', 'pulso', 'brillo'];
  var TAMANOS = { S: 0.8, M: 1, L: 1.25 };
  var ALINEACIONES = { izq: 'left', centro: 'center', der: 'right' };
  var ESTILOS_BORDE = ['ninguno', 'solido', 'discontinuo', 'punteado'];
  var POSICIONES_EMOJI = ['centro', 'sup-izq', 'sup-der', 'inf-izq', 'inf-der'];
  var EMOJIS = ['💜', '✊', '🕊️', '🌹', '✨', '🔥', '🦋', '🌸', '🕯️', '📞', '🫂', '⭐', '🌈', '💪', '🛡️', '🤝'];

  var POR_DEFECTO = {
    forma: 'circulo',
    fondo: { tipo: 'solido', c1: '#9b4dff', c2: '#b0123a', opacidad: 0.9 },
    texto: { color: '#ffffff', fuente: 'sans', tam: 'M', negrita: false, cursiva: false, alinea: 'centro' },
    borde: { color: '#c58bff', grosor: 0, estilo: 'ninguno' },
    glow: { color: '#c58bff', intensidad: 0 },
    sombra: 0,
    emoji: { char: '', pos: 'centro' },
    anim: 'flotar',
    escala: 1,
  };

  // Trazados en una caja de 100 × 100 (se estiran a la caja de la burbuja).
  function estrella() {
    var pts = [];
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var r = i % 2 ? 23 : 48;
      pts.push((50 + r * Math.cos(a)).toFixed(2) + ' ' + (53 + r * Math.sin(a)).toFixed(2));
    }
    return 'M' + pts.join('L') + 'Z';
  }
  var TRAZADOS = {
    circulo: 'M50 2A48 48 0 1 1 49.99 2Z',
    cuadrado: 'M22 2H78Q98 2 98 22V78Q98 98 78 98H22Q2 98 2 78V22Q2 2 22 2Z',
    corazon: 'M50 93C38 84 3 62 3 33C3 16 16 4 31 4C41 4 47 10 50 18C53 10 59 4 69 4C84 4 97 16 97 33C97 62 62 84 50 93Z',
    nube: 'M20 4H80Q96 4 96 20V62Q96 78 80 78H62L48 97L42 78H20Q4 78 4 62V20Q4 4 20 4Z',
    estrella: estrella(),
    hexagono: 'M50 2L92 26V74L50 98L8 74V26Z',
    gota: 'M50 2C50 2 14 42 14 64C14 84 30 98 50 98C70 98 86 84 86 64C86 42 50 2 50 2Z',
    // Lazo morado: dos lóbulos que se cruzan arriba y dos colas.
    lazo: 'M50 44C30 30 18 14 28 6C40 -2 56 20 50 44Z M50 44C70 30 82 14 72 6C60 -2 44 20 50 44Z ' +
      'M50 44L24 97Q38 99 50 82Q62 99 76 97L50 44Z',
  };
  // Margen interior del texto en % de la caja: [arriba, derecha, abajo, izquierda].
  var MARGEN_TEXTO = {
    circulo: [15, 15, 15, 15], cuadrado: [9, 9, 9, 9], corazon: [20, 17, 26, 17], nube: [9, 9, 30, 9],
    estrella: [30, 28, 24, 28], hexagono: [15, 12, 15, 12], gota: [38, 17, 15, 17], lazo: [24, 30, 26, 30],
  };

  var RE_COLOR = /^#[0-9a-fA-F]{6}$/;
  var contador = 0;

  function color(v, defecto) { return typeof v === 'string' && RE_COLOR.test(v) ? v.toLowerCase() : defecto; }
  function numero(v, min, max, defecto) {
    return (typeof v === 'number' && isFinite(v)) ? Math.min(max, Math.max(min, v)) : defecto;
  }
  function opcion(v, lista, defecto) { return lista.indexOf(v) >= 0 ? v : defecto; }
  function obj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

  function sanear(bruto) {
    var e = obj(bruto), f = obj(e.fondo), t = obj(e.texto), b = obj(e.borde), g = obj(e.glow), m = obj(e.emoji);
    var d = POR_DEFECTO;
    return {
      forma: opcion(e.forma, FORMAS, d.forma),
      fondo: { tipo: opcion(f.tipo, ['solido', 'degradado'], 'solido'), c1: color(f.c1, d.fondo.c1),
        c2: color(f.c2, d.fondo.c2), opacidad: numero(f.opacidad, 0.35, 1, d.fondo.opacidad) },
      texto: { color: color(t.color, d.texto.color), fuente: FUENTES[t.fuente] ? t.fuente : 'sans',
        tam: TAMANOS[t.tam] ? t.tam : 'M', negrita: t.negrita === true, cursiva: t.cursiva === true,
        alinea: ALINEACIONES[t.alinea] ? t.alinea : 'centro' },
      borde: { color: color(b.color, d.borde.color), grosor: numero(b.grosor, 0, 8, 0),
        estilo: opcion(b.estilo, ESTILOS_BORDE, 'ninguno') },
      glow: { color: color(g.color, d.glow.color), intensidad: numero(g.intensidad, 0, 10, 0) },
      sombra: numero(e.sombra, 0, 10, 0),
      emoji: { char: EMOJIS.indexOf(m.char) >= 0 ? m.char : '', pos: opcion(m.pos, POSICIONES_EMOJI, 'centro') },
      anim: opcion(e.anim, ANIMACIONES, 'flotar'),
      escala: numero(e.escala, 0.8, 1.3, 1),
    };
  }

  // --- Contraste (WCAG) ---
  function rgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
  function lum(c) {
    var v = c.map(function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function contraste(h1, h2) {
    var a = lum(rgb(h1)), b = lum(rgb(h2));
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  // Fondo de la burbuja ya mezclado con el fondo de la pantalla (#07060d) según su opacidad.
  function fondoEfectivo(f) {
    var cs = [rgb(f.c1)].concat(f.tipo === 'degradado' ? [rgb(f.c2)] : []);
    var base = [7, 6, 13];
    var hex = [0, 1, 2].map(function (i) {
      var medio = cs.reduce(function (s, c) { return s + c[i]; }, 0) / cs.length;
      var n = Math.round(base[i] * (1 - f.opacidad) + medio * f.opacidad);
      return ('0' + n.toString(16)).slice(-2);
    });
    return '#' + hex.join('');
  }
  // Color de texto que mejor se lee sobre el fondo de este estilo.
  function textoLegible(estilo) {
    var fe = fondoEfectivo(estilo.fondo);
    return contraste('#ffffff', fe) >= contraste('#120a22', fe) ? '#ffffff' : '#120a22';
  }
  function contrasteTexto(estilo) { return contraste(estilo.texto.color, fondoEfectivo(estilo.fondo)); }

  // --- Dibujo ---
  var SVGNS = 'http://www.w3.org/2000/svg';
  function nodo(nombre, attrs) {
    var n = document.createElementNS(SVGNS, nombre);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function crear(texto, bruto) {
    var s = sanear(bruto);
    var id = 'eb' + (++contador);
    var el = document.createElement('div');
    el.className = 'eb eb-anim-' + s.anim;
    el.dataset.forma = s.forma;

    // Forma: relleno (sólido o degradado), borde, brillo y sombra.
    var svg = nodo('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', class: 'eb-forma' });
    var defs = nodo('defs', {});
    var grad = nodo('linearGradient', { id: id, x1: '0', y1: '0', x2: '1', y2: '1' });
    grad.appendChild(nodo('stop', { offset: '0', 'stop-color': s.fondo.c1 }));
    grad.appendChild(nodo('stop', { offset: '1', 'stop-color': s.fondo.tipo === 'degradado' ? s.fondo.c2 : s.fondo.c1 }));
    defs.appendChild(grad);
    svg.appendChild(defs);
    var path = nodo('path', {
      d: TRAZADOS[s.forma], fill: 'url(#' + id + ')', 'fill-opacity': String(s.fondo.opacidad),
      'fill-rule': 'nonzero', 'stroke-linejoin': 'round',
    });
    if (s.borde.estilo !== 'ninguno' && s.borde.grosor > 0) {
      var w = s.borde.grosor * 0.55;
      path.setAttribute('stroke', s.borde.color);
      path.setAttribute('stroke-width', String(w));
      if (s.borde.estilo === 'discontinuo') path.setAttribute('stroke-dasharray', (w * 3) + ' ' + (w * 2));
      if (s.borde.estilo === 'punteado') {
        path.setAttribute('stroke-dasharray', '0 ' + (w * 2));
        path.setAttribute('stroke-linecap', 'round');
      }
    }
    svg.appendChild(path);
    var filtros = [];
    if (s.glow.intensidad > 0) filtros.push('drop-shadow(0 0 ' + (s.glow.intensidad * 0.12).toFixed(2) + 'cqmin ' + s.glow.color + ')');
    if (s.sombra > 0) filtros.push('drop-shadow(0 ' + (s.sombra * 0.1).toFixed(2) + 'cqmin ' + (s.sombra * 0.15).toFixed(2) + 'cqmin rgba(0,0,0,.65))');
    if (filtros.length) svg.style.filter = filtros.join(' ');
    el.appendChild(svg);

    // Texto (siempre con textContent). El tamaño depende del largo para que quepa.
    var caja = document.createElement('div');
    caja.className = 'eb-texto';
    var mg = MARGEN_TEXTO[s.forma];
    caja.style.inset = mg[0] + '% ' + mg[1] + '% ' + mg[2] + '% ' + mg[3] + '%';
    var p = document.createElement('p');
    var largo = Math.max(1, String(texto).length);
    var factor = largo <= 18 ? 1 : Math.max(0.42, Math.sqrt(18 / largo));
    p.style.fontSize = (11 * TAMANOS[s.texto.tam] * factor * (s.forma === 'estrella' ? 0.8 : 1)).toFixed(2) + 'cqmin';
    p.style.color = s.texto.color;
    p.style.fontFamily = FUENTES[s.texto.fuente];
    p.style.fontWeight = s.texto.negrita ? '800' : '500';
    p.style.fontStyle = s.texto.cursiva ? 'italic' : 'normal';
    p.style.textAlign = ALINEACIONES[s.texto.alinea];
    p.textContent = texto;
    caja.appendChild(p);
    el.appendChild(caja);

    if (s.emoji.char) {
      var em = document.createElement('span');
      em.className = 'eb-emoji eb-emoji-' + s.emoji.pos;
      em.setAttribute('aria-hidden', 'true');
      em.textContent = s.emoji.char;
      el.appendChild(em);
    }
    el.style.setProperty('--eb-escala', String(s.escala));
    return el;
  }

  global.EstiloBurbuja = {
    FORMAS: FORMAS, FUENTES: FUENTES, ANIMACIONES: ANIMACIONES, EMOJIS: EMOJIS, POSICIONES_EMOJI: POSICIONES_EMOJI,
    ESTILOS_BORDE: ESTILOS_BORDE, POR_DEFECTO: POR_DEFECTO,
    sanear: sanear, crear: crear, contraste: contraste, contrasteTexto: contrasteTexto, textoLegible: textoLegible,
  };
})(window);
