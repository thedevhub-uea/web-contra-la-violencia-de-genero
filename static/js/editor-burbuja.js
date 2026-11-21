/* CONECTA · editor de burbuja de /participa: vista previa en vivo + controles de estilo.
 * Rellena el campo oculto «style» (JSON) del formulario. El servidor lo vuelve a validar
 * contra su lista blanca (bd/estilo.py): lo que se mande aquí nunca se usa tal cual.
 * Necesita estilo-burbuja.js. Si no carga, el formulario sigue enviando solo el texto. */
(function () {
  'use strict';
  var EB = window.EstiloBurbuja;
  var raiz = document.getElementById('editor-burbuja');
  if (!EB || !raiz) return;

  var form = raiz.closest('form');
  var texto = form.querySelector('textarea[name="texto"]');
  var campo = form.querySelector('input[name="style"]');
  var T = JSON.parse(raiz.dataset.textos || '{}');   // textos traducidos
  var estilo = EB.sanear(null);
  var guardado = null;

  var COLORES = ['#9b4dff', '#c58bff', '#6a22c4', '#b0123a', '#d96b86', '#f3eefb', '#120a22', '#2b6cb0',
    '#0f766e', '#d4a017', '#e5733a', '#2e8b57'];
  var DEGRADADOS = [['#b0123a', '#9b4dff'], ['#6a22c4', '#d96b86'], ['#120a22', '#9b4dff'],
    ['#0f766e', '#6a22c4'], ['#e5733a', '#b0123a'], ['#2b6cb0', '#c58bff']];
  var ETIQ_FORMAS = { circulo: T.f_circulo, cuadrado: T.f_cuadrado, corazon: T.f_corazon, nube: T.f_nube,
    estrella: T.f_estrella, hexagono: T.f_hexagono, gota: T.f_gota, lazo: T.f_lazo };

  var vista = document.createElement('div');
  vista.className = 'eb-vista';
  vista.setAttribute('role', 'img');
  vista.setAttribute('aria-label', T.vista || 'Vista previa');
  raiz.appendChild(vista);

  var aviso = document.createElement('p');
  aviso.className = 'eb-aviso';
  aviso.setAttribute('role', 'status');
  aviso.hidden = true;
  raiz.appendChild(aviso);

  var refrescos = [];   // funciones que actualizan los controles cuando cambia el estilo

  function el(tag, props, hijos) {
    var n = document.createElement(tag);
    for (var k in props || {}) n[k] = props[k];
    (hijos || []).forEach(function (h) { n.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return n;
  }

  function pintar() {
    estilo = EB.sanear(estilo);
    vista.textContent = '';
    vista.appendChild(EB.crear(texto.value || T.ejemplo || '…', estilo));
    var distinto = JSON.stringify(estilo) !== JSON.stringify(EB.POR_DEFECTO);
    campo.value = distinto ? JSON.stringify(estilo) : '';
    var c = EB.contrasteTexto(estilo);
    aviso.hidden = c >= 4.5;
    if (c < 4.5) {
      aviso.textContent = '';
      var legible = EB.textoLegible(estilo);
      aviso.appendChild(document.createTextNode((T.contraste || 'Poco contraste.') + ' '));
      aviso.appendChild(el('button', {
        type: 'button', className: 'eb-op', textContent: T.usar_legible || 'Usar color legible',
        onclick: function () { estilo.texto.color = legible; pintar(); refrescar(); },
      }));
    }
  }
  function refrescar() { refrescos.forEach(function (f) { f(); }); }
  function cambiar(fn) { fn(estilo); pintar(); refrescar(); }

  // --- Constructores de controles ---
  function grupo(titulo, abierto) {
    var d = el('details', { className: 'eb-grupo', open: !!abierto }, [el('summary', { textContent: titulo })]);
    raiz.appendChild(d);
    return d;
  }
  function fila(g, etiqueta) {
    var f = el('div', { className: 'eb-fila' });
    if (etiqueta) f.appendChild(el('span', { className: 'eb-etiqueta', textContent: etiqueta }));
    g.appendChild(f);
    return f;
  }
  // Botones de opción única: leer() devuelve el valor actual; poner(e, v) lo cambia.
  function opciones(f, lista, leer, poner, rotulo) {
    var botones = lista.map(function (v) {
      var b = el('button', { type: 'button', className: 'eb-op' });
      var r = rotulo(v);
      if (typeof r === 'string') b.textContent = r; else b.appendChild(r);
      b.onclick = function () { cambiar(function (e) { poner(e, v); }); };
      f.appendChild(b);
      return [v, b];
    });
    refrescos.push(function () {
      botones.forEach(function (p) { p[1].setAttribute('aria-pressed', String(leer() === p[0])); });
    });
  }
  function interruptor(f, rotulo, leer, poner) {
    var b = el('button', { type: 'button', className: 'eb-op', textContent: rotulo });
    b.onclick = function () { cambiar(function (e) { poner(e, !leer()); }); };
    f.appendChild(b);
    refrescos.push(function () { b.setAttribute('aria-pressed', String(!!leer())); });
  }
  function colores(f, leer, poner, paleta) {
    var botones = (paleta || COLORES).map(function (c) {
      var b = el('button', { type: 'button', className: 'eb-color', title: c });
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.onclick = function () { cambiar(function (e) { poner(e, c); }); };
      f.appendChild(b);
      return [c, b];
    });
    var libre = el('input', { type: 'color', title: T.libre || 'Color libre' });
    libre.setAttribute('aria-label', T.libre || 'Color libre');
    libre.oninput = function () { cambiar(function (e) { poner(e, libre.value); }); };
    f.appendChild(libre);
    refrescos.push(function () {
      var v = leer();
      botones.forEach(function (p) { p[1].setAttribute('aria-pressed', String(p[0] === v)); });
      libre.value = v;
    });
  }
  function deslizador(f, min, max, paso, leer, poner, etiqueta) {
    var r = el('input', { type: 'range', min: min, max: max, step: paso });
    r.setAttribute('aria-label', etiqueta);
    r.oninput = function () { cambiar(function (e) { poner(e, parseFloat(r.value)); }); };
    f.appendChild(r);
    refrescos.push(function () { r.value = leer(); });
  }
  function miniatura(forma) {
    var s = EB.crear('', { forma: forma, fondo: { c1: '#c58bff', opacidad: 1 }, anim: 'ninguna' });
    var w = el('span', {});
    w.style.cssText = 'display:block;width:30px;height:30px';
    w.appendChild(s);
    w.title = ETIQ_FORMAS[forma] || forma;
    return w;
  }

  // 1 · Forma
  var g = grupo(T.forma || 'Forma', true);
  opciones(fila(g), EB.FORMAS, function () { return estilo.forma; },
    function (e, v) { e.forma = v; }, miniatura);
  Array.prototype.forEach.call(g.querySelectorAll('.eb-op'), function (b, i) {
    b.setAttribute('aria-label', ETIQ_FORMAS[EB.FORMAS[i]] || EB.FORMAS[i]);
  });

  // 2 · Fondo
  g = grupo(T.fondo || 'Fondo');
  opciones(fila(g), ['solido', 'degradado'], function () { return estilo.fondo.tipo; },
    function (e, v) { e.fondo.tipo = v; }, function (v) { return v === 'solido' ? T.solido : T.degradado; });
  colores(fila(g, T.color_1), function () { return estilo.fondo.c1; }, function (e, c) { e.fondo.c1 = c; });
  colores(fila(g, T.color_2), function () { return estilo.fondo.c2; }, function (e, c) {
    e.fondo.c2 = c; e.fondo.tipo = 'degradado';
  });
  var fd = fila(g, T.degradados);
  DEGRADADOS.forEach(function (par) {
    var b = el('button', { type: 'button', className: 'eb-color', title: par.join(' → ') });
    b.style.background = 'linear-gradient(135deg,' + par[0] + ',' + par[1] + ')';
    b.setAttribute('aria-label', par.join(' → '));
    b.onclick = function () { cambiar(function (e) { e.fondo.tipo = 'degradado'; e.fondo.c1 = par[0]; e.fondo.c2 = par[1]; }); };
    fd.appendChild(b);
  });
  deslizador(fila(g, T.opacidad), 0.35, 1, 0.05, function () { return estilo.fondo.opacidad; },
    function (e, v) { e.fondo.opacidad = v; }, T.opacidad);

  // 3 · Texto
  g = grupo(T.texto || 'Texto');
  colores(fila(g, T.color_texto), function () { return estilo.texto.color; }, function (e, c) { e.texto.color = c; },
    ['#ffffff', '#120a22', '#f3eefb', '#c58bff', '#d96b86', '#ffd9e2']);
  var ff = fila(g, T.fuente);
  Object.keys(EB.FUENTES).forEach(function (k) {
    var b = el('button', { type: 'button', className: 'eb-op', textContent: T['fu_' + k] || k });
    b.style.fontFamily = EB.FUENTES[k];
    b.onclick = function () { cambiar(function (e) { e.texto.fuente = k; }); };
    ff.appendChild(b);
    refrescos.push(function () { b.setAttribute('aria-pressed', String(estilo.texto.fuente === k)); });
  });
  opciones(fila(g, T.tamano), ['S', 'M', 'L'], function () { return estilo.texto.tam; },
    function (e, v) { e.texto.tam = v; }, function (v) { return v; });
  var fe = fila(g, T.estilo_texto);
  interruptor(fe, T.negrita, function () { return estilo.texto.negrita; }, function (e, v) { e.texto.negrita = v; });
  interruptor(fe, T.cursiva, function () { return estilo.texto.cursiva; }, function (e, v) { e.texto.cursiva = v; });
  opciones(fila(g, T.alineacion), ['izq', 'centro', 'der'], function () { return estilo.texto.alinea; },
    function (e, v) { e.texto.alinea = v; }, function (v) { return T['al_' + v]; });

  // 4 · Borde, brillo y sombra
  g = grupo(T.borde || 'Borde y brillo');
  colores(fila(g, T.color_borde), function () { return estilo.borde.color; }, function (e, c) {
    e.borde.color = c; if (!e.borde.grosor) { e.borde.grosor = 3; e.borde.estilo = 'solido'; }
  });
  deslizador(fila(g, T.grosor), 0, 8, 1, function () { return estilo.borde.grosor; }, function (e, v) {
    e.borde.grosor = v; if (v > 0 && e.borde.estilo === 'ninguno') e.borde.estilo = 'solido';
    if (v === 0) e.borde.estilo = 'ninguno';
  }, T.grosor);
  opciones(fila(g, T.estilo_borde), ['solido', 'discontinuo', 'punteado'], function () { return estilo.borde.estilo; },
    function (e, v) { e.borde.estilo = v; if (!e.borde.grosor) e.borde.grosor = 3; }, function (v) { return T['b_' + v]; });
  colores(fila(g, T.color_glow), function () { return estilo.glow.color; }, function (e, c) {
    e.glow.color = c; if (!e.glow.intensidad) e.glow.intensidad = 5;
  });
  deslizador(fila(g, T.glow), 0, 10, 1, function () { return estilo.glow.intensidad; },
    function (e, v) { e.glow.intensidad = v; }, T.glow);
  deslizador(fila(g, T.sombra), 0, 10, 1, function () { return estilo.sombra; },
    function (e, v) { e.sombra = v; }, T.sombra);

  // 5 · Emoji, animación y tamaño
  g = grupo(T.extras || 'Pegatina y animación');
  var fem = fila(g, T.emoji);
  var vacio = el('button', { type: 'button', className: 'eb-op', textContent: '∅' });
  vacio.setAttribute('aria-label', T.sin_emoji || 'Sin emoji');
  vacio.onclick = function () { cambiar(function (e) { e.emoji.char = ''; }); };
  fem.appendChild(vacio);
  refrescos.push(function () { vacio.setAttribute('aria-pressed', String(estilo.emoji.char === '')); });
  EB.EMOJIS.forEach(function (c) {
    var b = el('button', { type: 'button', className: 'eb-op', textContent: c });
    b.onclick = function () { cambiar(function (e) { e.emoji.char = c; }); };
    fem.appendChild(b);
    refrescos.push(function () { b.setAttribute('aria-pressed', String(estilo.emoji.char === c)); });
  });
  opciones(fila(g, T.pos_emoji), EB.POSICIONES_EMOJI, function () { return estilo.emoji.pos; },
    function (e, v) { e.emoji.pos = v; }, function (v) { return T['p_' + v]; });
  opciones(fila(g, T.animacion), EB.ANIMACIONES, function () { return estilo.anim; },
    function (e, v) { e.anim = v; }, function (v) { return T['an_' + v]; });
  deslizador(fila(g, T.tam_burbuja), 0.8, 1.3, 0.05, function () { return estilo.escala; },
    function (e, v) { e.escala = v; }, T.tam_burbuja);

  // Acciones
  var acc = el('div', { className: 'eb-acciones' });
  acc.appendChild(el('button', { type: 'button', className: 'eb-op', textContent: '🎲 ' + (T.sorprendeme || 'Sorpréndeme'),
    onclick: sorprender }));
  acc.appendChild(el('button', { type: 'button', className: 'eb-op', textContent: T.restablecer || 'Restablecer',
    onclick: function () { estilo = EB.sanear(null); pintar(); refrescar(); } }));
  raiz.appendChild(acc);

  function elige(l) { return l[Math.floor(Math.random() * l.length)]; }
  function sorprender() {
    var par = elige(DEGRADADOS);
    var e = EB.sanear(null);
    e.forma = elige(EB.FORMAS);
    e.fondo = { tipo: Math.random() < 0.5 ? 'degradado' : 'solido', c1: par[0], c2: par[1], opacidad: 0.9 };
    e.texto.fuente = elige(Object.keys(EB.FUENTES));
    e.texto.negrita = Math.random() < 0.5;
    e.borde = { color: elige(COLORES), grosor: elige([0, 2, 3, 4]), estilo: elige(['solido', 'discontinuo', 'punteado']) };
    if (!e.borde.grosor) e.borde.estilo = 'ninguno';
    e.glow = { color: elige(COLORES), intensidad: elige([0, 3, 6]) };
    e.emoji = { char: Math.random() < 0.6 ? elige(EB.EMOJIS) : '', pos: elige(EB.POSICIONES_EMOJI) };
    e.anim = elige(EB.ANIMACIONES);
    e.texto.color = EB.textoLegible(e);   // siempre legible
    estilo = e; pintar(); refrescar();
  }

  texto.addEventListener('input', pintar);
  pintar();
  refrescar();
  guardado = null;
})();
