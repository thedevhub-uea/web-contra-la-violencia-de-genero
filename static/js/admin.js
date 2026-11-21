/* T03 — Panel de moderación en vivo (templates/admin.html).
 *
 * Mejora progresiva: sin este archivo cada botón es un formulario normal que recarga el panel.
 * Con él, nada recarga la página:
 *
 *  - Acciones: cada formulario se envía con fetch (cabecera X-Panel: fetch). El servidor guarda,
 *    vuelve a leer la BD para comprobar que el cambio está hecho y responde {ok, texto, resaltar}.
 *    Después se pide otra vez /admin y se cambian solo los bloques data-vivo="…" (ver refrescar()).
 *    Si el servidor no puede comprobar el cambio, sale un aviso de error y se repinta el estado real.
 *  - Novedades: cada pocos segundos se pregunta a /admin/estado por la «versión» del panel. Si ha
 *    cambiado (mensaje o reflexión nueva, avisos, otra persona moderando…), se repinta igual y lo
 *    nuevo entra resaltado. Lo que se esté escribiendo no se toca: ese bloque espera a la siguiente.
 *  - Filtro (Todo / Mural / Foro / Retirado / Caducado) y búsqueda en publicaciones y en el filtro.
 *  - «Ver texto completo» en reflexiones largas y vista de las burbujas con estilo.
 *  - Confirmación antes de borrar; los ajustes con casillas (data-auto) se guardan al cambiarlos.
 *  - Las «i» de más información (<details class="adm-info">) se cierran al pulsar fuera o con Esc.
 *
 * La URL de /admin/estado llega en <body data-api-estado="…"> (nunca rutas escritas a mano).
 * Texto de usuario siempre con textContent. Los textos de la interfaz llegan traducidos en
 * <body data-textos="…"> (i18n).
 */
(function () {
  'use strict';

  var SONDEO_MS = 4000;   // cada cuánto se pregunta si hay novedades (solo con la pestaña visible)

  var norm = function (s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  };
  var hora = function (conSegundos) {
    var o = { hour: '2-digit', minute: '2-digit' };
    if (conSegundos) o.second = '2-digit';
    return new Date().toLocaleTimeString(document.documentElement.lang || 'es', o);
  };
  var TEXTOS = (function () {
    try { return JSON.parse(document.body.dataset.textos || '{}'); } catch (e) { return {}; }
  })();
  var t = function (clave, porDefecto, datos) {
    var texto = TEXTOS[clave] || porDefecto;
    return texto.replace(/\{(\w+)\}/g, function (m, k) { return datos && k in datos ? datos[k] : m; });
  };
  var todos = function (sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); };

  document.body.classList.add('adm-js');

  // Quita ?hecho=… de la dirección para que recargar no repita el aviso (modo sin JS)
  if (location.search && history.replaceState) {
    history.replaceState(null, '', location.pathname + location.hash);
  }

  // ---------- Avisos flotantes (toasts) ----------
  var toasts = document.getElementById('adm-toasts');
  function cerrarToast(el) {
    if (!el.parentNode) return;
    el.classList.add('adm-saliendo');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 400);
  }
  function avisar(texto, tipo) {
    if (!texto) return;
    var el = document.createElement('div');
    el.className = 'adm-aviso adm-aviso-' + (tipo || 'ok');
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    var span = document.createElement('span');
    span.textContent = texto;
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'adm-aviso-cerrar';
    x.setAttribute('aria-label', t('cerrar_aviso', 'Cerrar aviso'));
    x.textContent = '×';
    x.addEventListener('click', function () { cerrarToast(el); });
    el.appendChild(span);
    el.appendChild(x);
    toasts.appendChild(el);
    while (toasts.children.length > 3) toasts.removeChild(toasts.firstChild);
    setTimeout(function () { cerrarToast(el); }, tipo === 'error' ? 10000 : 5000);
  }
  // El aviso que pinta el servidor en modo sin JS (si se llegó con ?hecho=…) pasa a ser un toast.
  var avisoServidor = document.getElementById('adm-aviso');
  if (avisoServidor) {
    avisar(avisoServidor.textContent.trim(), avisoServidor.classList.contains('adm-aviso-error') ? 'error' : 'ok');
    avisoServidor.parentNode.removeChild(avisoServidor);
  }

  // ---------- Indicador «En directo» ----------
  var vivo = document.getElementById('adm-vivo');
  var vivoTexto = document.getElementById('adm-vivo-texto');
  function marcarConexion(ok) {
    vivo.hidden = false;
    vivo.classList.toggle('adm-vivo-error', !ok);
    vivoTexto.textContent = ok ? t('en_directo', 'En directo · {hora}', { hora: hora(true) })
                               : t('sin_conexion', 'Sin conexión: reintentando…');
  }

  // ---------- Filtro y búsqueda de publicaciones (el estado sobrevive a los repintados) ----------
  var filtro = 'todo';
  var busqueda = '';
  function aplicarFiltro() {
    var lista = document.getElementById('lista-pub');
    if (!lista) return;
    var n = 0;
    todos('.adm-fila', lista).forEach(function (f) {
      var ok = (filtro === 'todo' || f.dataset.tipo === filtro || f.dataset.estado === filtro) &&
               (!busqueda || norm(f.querySelector('.adm-fila-cuerpo').textContent).indexOf(busqueda) !== -1);
      f.hidden = !ok;
      if (ok) n++;
    });
    var sin = lista.querySelector('.adm-sin-resultados');
    if (sin) sin.hidden = n !== 0;
  }
  var herramientas = document.getElementById('herramientas-pub');
  if (herramientas) herramientas.hidden = false;
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-filtro]');
    if (!b) return;
    filtro = b.dataset.filtro;
    todos('[data-filtro]').forEach(function (o) { o.setAttribute('aria-pressed', o === b ? 'true' : 'false'); });
    aplicarFiltro();
  });
  var buscarPub = document.getElementById('buscar-pub');
  if (buscarPub) {
    buscarPub.addEventListener('input', function () { busqueda = norm(buscarPub.value.trim()); aplicarFiltro(); });
  }

  // ---------- Búsqueda dentro del filtro de palabras ----------
  var buscarFiltro = document.getElementById('buscar-filtro');
  function aplicarBusquedaFiltro() {
    if (!buscarFiltro) return;
    var chips = todos('#lista-filtro .adm-chip');
    buscarFiltro.closest('label').hidden = chips.length <= 12 && !buscarFiltro.value;
    var q = norm(buscarFiltro.value.trim());
    chips.forEach(function (c) { c.hidden = !!q && norm(c.textContent).indexOf(q) === -1; });
  }
  if (buscarFiltro) buscarFiltro.addEventListener('input', aplicarBusquedaFiltro);

  // ---------- Lo que se añade a cada bloque al pintarlo ----------
  function realzar(raiz) {
    // Burbujas con estilo: se dibujan igual que en el mural (estilo-burbuja.js)
    if (window.EstiloBurbuja) {
      todos('[data-eb-style]', raiz).forEach(function (c) {
        if (c.firstChild) return;
        try { c.appendChild(EstiloBurbuja.crear(c.dataset.ebTexto, JSON.parse(c.dataset.ebStyle))); } catch (e) {}
      });
    }
    // «Ver texto completo» en reflexiones largas
    todos('.adm-recortado', raiz).forEach(function (p) {
      if (p.dataset.verMas || p.scrollHeight <= p.clientHeight + 2) return;
      p.dataset.verMas = '1';
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'adm-ver-mas';
      b.textContent = t('ver_completo', 'Ver texto completo');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', function () {
        var abrir = b.getAttribute('aria-expanded') === 'false';
        p.classList.toggle('adm-recortado', !abrir);
        b.setAttribute('aria-expanded', String(abrir));
        b.textContent = abrir ? t('ver_menos', 'Ver menos') : t('ver_completo', 'Ver texto completo');
      });
      p.parentNode.insertBefore(b, p.nextSibling);
    });
  }

  // ---------- Repintar desde el servidor ----------
  var version = document.body.dataset.version || null;
  var pendiente = false;      // algún bloque no se pudo cambiar (se estaba usando): reintentar
  var refrescando = null;

  // Un bloque «ocupado» no se cambia: tiene el foco en un campo, algo a medio escribir o una «i» abierta.
  function ocupado(el) {
    var activo = document.activeElement;
    if (activo && el.contains(activo) && /^(INPUT|TEXTAREA|SELECT)$/.test(activo.tagName) &&
        activo.type !== 'checkbox' && activo.type !== 'hidden') return true;
    if (el.querySelector('details.adm-info[open]')) return true;
    return todos('input, textarea', el).some(function (c) {
      if (c.type === 'hidden' || c.type === 'search') return false;
      if (c.type === 'checkbox' || c.type === 'radio') return c.checked !== c.defaultChecked;
      return c.value !== c.defaultValue;
    });
  }

  function claves() {
    var s = {};
    todos('.adm-fila[data-clave]').forEach(function (f) { s[f.dataset.clave] = true; });
    return s;
  }

  function refrescar(opciones) {
    opciones = opciones || {};
    if (refrescando && !opciones.forzar) return refrescando;
    var antes = claves();
    var hecho = fetch(location.pathname, { headers: { 'X-Panel': 'fetch' }, cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) throw new Error('sesion');
        if (!r.ok) throw new Error('http');
        return r.text();
      })
      .then(function (html) {
        var nuevo = new DOMParser().parseFromString(html, 'text/html');
        var dialogoAbierto = dialogo && dialogo.open;
        var quedan = false;
        todos('[data-vivo]', nuevo).forEach(function (n) {
          var clave = n.getAttribute('data-vivo');
          var actual = document.querySelector('[data-vivo="' + clave + '"]');
          if (!actual) return;
          if (clave !== opciones.forzar && (dialogoAbierto || ocupado(actual))) { quedan = true; return; }
          if (actual.innerHTML === n.innerHTML && actual.className === n.className) return;
          var copia = document.importNode(n, true);
          actual.parentNode.replaceChild(copia, actual);
          realzar(copia);
        });
        pendiente = quedan;
        version = nuevo.body.dataset.version || version;
        document.title = nuevo.title;

        // Lo que no estaba antes entra resaltado; si no lo ha provocado una acción, se avisa.
        var nuevas = 0;
        todos('.adm-fila[data-clave]').forEach(function (f) {
          if (!antes[f.dataset.clave]) { f.classList.add('adm-fila-nueva'); nuevas++; }
        });
        if (opciones.resaltar) {
          todos('.adm-fila[data-clave="' + opciones.resaltar + '"]').forEach(function (f) { f.classList.add('adm-fila-reciente'); });
        }
        var unicas = {};
        todos('.adm-fila-nueva').forEach(function (f) { unicas[f.dataset.clave] = true; });
        nuevas = Object.keys(unicas).length;
        if (nuevas && !opciones.accion) {
          avisar(nuevas === 1 ? t('nuevas_1', '{n} publicación nueva', { n: 1 })
                              : t('nuevas_n', '{n} publicaciones nuevas', { n: nuevas }), 'info');
        }
        setTimeout(function () {
          todos('.adm-fila-nueva').forEach(function (f) { f.classList.remove('adm-fila-nueva'); });
        }, 4000);
        aplicarFiltro();
        aplicarBusquedaFiltro();
        marcarConexion(true);
      })
      .catch(function (err) {
        if (err && err.message === 'sesion') avisar(t('error_sesion', 'La sesión ha caducado. Recarga la página.'), 'error');
        marcarConexion(false);
        pendiente = true;
      })
      .then(function () { if (refrescando === hecho) refrescando = null; });
    refrescando = hecho;
    return hecho;
  }

  // ---------- Enviar acciones con fetch ----------
  function enviar(form) {
    var boton = form.querySelector('button[type=submit]');
    if (boton && boton.getAttribute('aria-busy') === 'true') return;
    var bloque = form.closest('[data-vivo]');
    var fila = form.closest('.adm-fila');
    var interruptor = form.querySelector('[role=switch]');
    if (boton) { boton.setAttribute('aria-busy', 'true'); boton.disabled = true; }
    if (fila) fila.classList.add('adm-ocupada');
    if (interruptor) {   // respuesta inmediata; si falla, el repintado devuelve el estado real
      interruptor.setAttribute('aria-checked', interruptor.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    }
    if (form.hasAttribute('data-auto')) form.classList.add('adm-guardando');

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'X-Panel': 'fetch', 'Accept': 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
      .then(function (r) {
        if (r.status === 401) throw new Error('sesion');
        var json = (r.headers.get('Content-Type') || '').indexOf('application/json') !== -1;
        return json ? r.json() : { ok: false, tipo: 'error', texto: t('error_red', 'No se ha podido guardar.') };
      })
      .then(function (d) {
        avisar(d.texto, d.ok ? 'ok' : 'error');
        if (d.ok && form.hasAttribute('data-limpiar')) form.reset();
        return refrescar({ forzar: bloque && bloque.getAttribute('data-vivo'), resaltar: d.resaltar, accion: true });
      })
      .catch(function (err) {
        avisar(err && err.message === 'sesion' ? t('error_sesion', 'La sesión ha caducado. Recarga la página.')
                                               : t('error_red', 'No se ha podido guardar.'), 'error');
        return refrescar({ forzar: bloque && bloque.getAttribute('data-vivo'), accion: true });
      })
      .then(function () {
        // Si el bloque no se ha repintado (mismo HTML), el botón sigue ahí: se reactiva.
        if (boton && document.contains(boton)) { boton.removeAttribute('aria-busy'); boton.disabled = false; }
        if (fila && document.contains(fila)) fila.classList.remove('adm-ocupada');
        form.classList.remove('adm-guardando');
      });
  }

  // ---------- Confirmación al borrar ----------
  var dialogo = document.getElementById('adm-confirmar');
  var enEspera = null;
  function confirmar(form) {
    var pregunta = form.getAttribute('data-confirmar');
    var fila = form.closest('.adm-fila');
    var cita = fila && (fila.querySelector('.adm-titulo') || fila.querySelector('.adm-texto'));
    if (dialogo && typeof dialogo.showModal === 'function') {
      enEspera = form;
      document.getElementById('adm-confirmar-titulo').textContent = pregunta;
      document.getElementById('adm-confirmar-cita').textContent = cita ? cita.textContent : '';
      dialogo.returnValue = '';
      dialogo.showModal();
    } else if (window.confirm(pregunta + ' ' + t('no_deshacer', 'Esta acción no se puede deshacer.'))) {
      enviar(form);
    }
  }
  if (dialogo) {
    dialogo.addEventListener('close', function () {
      var f = enEspera;
      enEspera = null;
      if (f && dialogo.returnValue === 'si' && document.contains(f)) enviar(f);
    });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form.closest('main') || form.method === 'dialog') return;
    e.preventDefault();
    if (form.hasAttribute('data-confirmar')) confirmar(form); else enviar(form);
  });
  // Ajustes con casillas: se guardan nada más cambiarlos
  document.addEventListener('change', function (e) {
    var form = e.target.form;
    if (!form || !form.hasAttribute('data-auto')) return;
    if (!form.checkValidity()) { form.reportValidity(); return; }
    enviar(form);
  });

  // ---------- Novedades: sondeo de /admin/estado ----------
  var urlEstado = document.body.dataset.apiEstado;
  function sondear() {
    if (document.hidden || !urlEstado) return;
    fetch(urlEstado, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('http'); return r.json(); })
      .then(function (d) {
        marcarConexion(true);
        if (d.version !== version || pendiente) refrescar();
      })
      .catch(function () { marcarConexion(false); });
  }
  setInterval(sondear, SONDEO_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) sondear(); });

  // ---------- «i» de más información: se cierra al pulsar fuera o con Esc ----------
  function cerrarInfos(salvo) {
    todos('details.adm-info[open]').forEach(function (d) { if (d !== salvo) d.open = false; });
  }
  document.addEventListener('click', function (e) {
    cerrarInfos(e.target.closest && e.target.closest('details.adm-info'));
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') cerrarInfos(null);
  });

  realzar(document);
  aplicarFiltro();
  aplicarBusquedaFiltro();
  marcarConexion(true);
})();
