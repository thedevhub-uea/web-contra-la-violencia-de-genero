// T04 — Rotación de vistas y actualización cada 10 s (fetch a /api/mural y /api/foro).
//
// - Alterna mural → vídeo → foro. Solo una vista visible a la vez.
// - La vista de vídeo avanza con el evento 'ended' del vídeo, no por tiempo.
// - Cada 10 s pide la API (URLs en <body data-api-mural / data-api-foro>) y llama a pintarMural (T07) y pintarForo (T09).
// - Si una petición falla, se queda lo último que se pintó: nunca pantalla en blanco.
// - Crea un botón de pantalla completa (o se puede usar F11).
// - T17: durante el mural y el foro, un aro recorre el borde de la pantalla y se completa justo cuando
//   termina la vista (la duración sale de CONFIG.duracion, que ya respeta ?seg=). En el vídeo (tiene su
//   propia barra) y con una vista fijada no hay aro.
// - T16: crea una barra superior (solo informativa) con las vistas de CONFIG.secuencia y marca la activa.
// - Cada 3 s pregunta a /api/pantalla (data-api-control) por las órdenes del panel:
//   «saltar» a una vista (y seguir rotando desde ahí) o «fijar» una vista hasta soltarla.
//   En la misma respuesta llegan los tiempos del panel (duración de mural y foro, páginas del foro y
//   refresco): se aplican al momento; si cambia la duración de la vista en curso, se recalcula lo que
//   le queda (y el aro sigue desde donde iba).
//
// Para pruebas: /pantalla?seg=20  → cada vista con tiempo dura 20 s en vez de 5 min.
(() => {
  'use strict';

  // ---------- Configuración ----------
  const CONFIG = {
    secuencia: ['mural', 'video', 'foro'],
    duracion: { mural: 5 * 60_000, foro: 5 * 60_000 }, // ms por vista (no aplica al vídeo)
    duracionPorDefecto: 5 * 60_000,
    refresco: 10_000,         // cada cuánto se piden los datos
    tiempoMaxPeticion: 8_000, // si la API no responde en este tiempo, se cancela
    videoArranque: 15_000,    // si el vídeo no ha empezado en este tiempo, se salta
    videoMaximo: 15 * 60_000, // tope de seguridad por si nunca llega 'ended'
    control: 3_000,           // cada cuánto se preguntan las órdenes del panel
  };

  // Para pruebas, ?seg= manda sobre los tiempos del panel (ver aplicarTiempos).
  const seg = Number(new URLSearchParams(location.search).get('seg'));
  if (seg > 0) {
    CONFIG.duracionPorDefecto = seg * 1000;
    CONFIG.duracion = { mural: seg * 1000, foro: seg * 1000 };
  }

  // Nombres de la barra de vistas (bilingües fijos, como el lema del QR: lo lee público de ambos
  // idiomas). Si aparece una vista nueva en CONFIG.secuencia y no está aquí, se usa su id.
  const NOMBRES_VISTAS = { mural: 'Mural / Wall', video: 'Vídeo / Video', foro: 'Foro / Forum' };

  // ---------- Rotación de vistas ----------
  const video = document.getElementById('video25n');
  let indice = -1;
  let vistaActual = null;
  let temporizador = null;
  let guardia = null;
  let inicioVista = 0;        // performance.now() al empezar la vista con temporizador
  let fijada = null;          // vista fijada desde el panel (null = rotación automática)
  let ultimoSalto;            // salto_id ya atendido (undefined hasta la primera respuesta)

  function limpiarTemporizadores() {
    clearTimeout(temporizador);
    clearTimeout(guardia);
    temporizador = guardia = null;
    ocultarAro();   // T17: el aro solo vive mientras hay un temporizador de vista
  }

  function videoRoto() {
    return !video || !!video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE;
  }

  function siguiente() {
    // Fijada: se repite la misma vista (el vídeo vuelve a empezar). Si es el vídeo y no
    // se puede reproducir, se rota con normalidad para no dejar la pantalla en negro.
    if (fijada && !(fijada === 'video' && videoRoto())) {
      mostrarVista(fijada);
      return;
    }
    indice = (indice + 1) % CONFIG.secuencia.length;
    mostrarVista(CONFIG.secuencia[indice]);
  }

  function programarFin(nombre) {
    clearTimeout(temporizador);
    temporizador = null;
    ocultarAro(); // T17: sin temporizador (vídeo o vista fijada) no hay aro que llenar
    if (nombre === 'video' || nombre === fijada) return; // el vídeo avanza con 'ended'; lo fijado no avanza
    inicioVista = performance.now();
    const ms = CONFIG.duracion[nombre] ?? CONFIG.duracionPorDefecto;
    temporizador = setTimeout(siguiente, ms);
    arrancarAro(ms); // T17: en mural y foro el aro dura exactamente lo que el temporizador
  }

  // ---------- Transición entre vistas (CONECTA) ----------
  // Pantalla intermedia con la portada (sin logos: los pone el componente fijo) y una etiqueta
  // «Siguiente: X / Next: Y». La vista actual se desvanece (~500 ms) mientras aparece la portada,
  // que se muestra con un zoom muy lento; se cambia de vista por detrás y la portada se desvanece
  // (~500 ms) dejando ver la nueva. No se interrumpe nunca un vídeo en reproducción: solo se
  // transiciona al CAMBIAR de vista. Se activa y se ajusta desde el panel (/api/pantalla).
  const TRANS = { activa: true, seg: 3, etiquetas: {}, enCurso: false, destino: null };
  const FUNDIDO = 500;
  const capaTrans = document.getElementById('transicion-pantalla');

  function mostrarEtiqueta(clave, n) {
    if (!capaTrans) return;
    const et = capaTrans.querySelector('.trans-etiqueta');
    const e = TRANS.etiquetas[clave];
    et.hidden = !e;
    if (e) {
      const poner = t => String(t).replace('{n}', n == null ? '' : n);
      et.querySelector('.es').textContent = 'Siguiente: ' + poner(e.es);
      et.querySelector('.en').textContent = 'Next: ' + poner(e.en);
    }
  }

  // destino: {vista} o {pregunta: n}. aMitad() hace el cambio real mientras la portada lo tapa.
  // Devuelve false si no hay transición (el cambio lo hace quien llama) o si ya hay una en curso.
  function transicionar(destino, aMitad) {
    if (!capaTrans || !TRANS.activa || TRANS.enCurso) return false;
    TRANS.enCurso = true;
    mostrarEtiqueta(destino.pregunta != null ? 'pregunta' : destino.vista, destino.pregunta);
    const total = TRANS.seg * 1000;
    const retencion = Math.max(500, total - 2 * FUNDIDO);
    document.body.classList.add('trans-saliendo');          // la vista actual hace fade-out
    capaTrans.style.setProperty('--trans-dur', (total / 1000) + 's');
    capaTrans.classList.remove('trans-fuera');
    capaTrans.classList.add('trans-visible');
    // Tras el fundido la portada es opaca; se espera y, justo antes de revelar, se cambia de vista
    // (así el vídeo no empieza a reproducirse «a ciegas» debajo de la portada).
    setTimeout(() => {
      aMitad();
      document.body.classList.remove('trans-saliendo');
      document.body.classList.add('trans-entrando');         // la nueva vista hace fade-in
      capaTrans.classList.remove('trans-visible');
      capaTrans.classList.add('trans-fuera');
      setTimeout(() => {
        document.body.classList.remove('trans-entrando');
        capaTrans.classList.remove('trans-fuera');
        TRANS.enCurso = false;
      }, FUNDIDO);
    }, FUNDIDO + retencion);
    return true;
  }

  window.pantallaTransicion = {
    activa: () => TRANS.activa && !!capaTrans,
    enCurso: () => TRANS.enCurso,
    ir: (destino, aMitad) => transicionar(destino, aMitad),
  };

  function aplicarTransicion(t) {
    if (!t || typeof t !== 'object') return;
    TRANS.activa = t.activa !== false;
    if (Number.isFinite(t.seg) && t.seg >= 1 && t.seg <= 10) TRANS.seg = t.seg;
    if (t.etiquetas && typeof t.etiquetas === 'object') TRANS.etiquetas = t.etiquetas;
  }

  // Cambio de vista: con transición si ya había una vista y es distinta. Si llega otra orden
  // mientras dura la transición, solo se actualiza el destino.
  function mostrarVista(nombre) {
    if (TRANS.enCurso) { TRANS.destino = nombre; return; }
    if (vistaActual && vistaActual !== nombre && TRANS.activa) {
      TRANS.destino = nombre;
      limpiarTemporizadores();               // sin aro ni temporizador mientras se tapa la vista
      if (transicionar({ vista: nombre }, () => cambiarVista(TRANS.destino))) return;
    }
    cambiarVista(nombre);
  }

  function cambiarVista(nombre) {
    limpiarTemporizadores();
    if (vistaActual === 'video') detenerVideo();

    for (const n of CONFIG.secuencia) {
      const el = document.getElementById('vista-' + n);
      if (!el) continue;
      const visible = (n === nombre);
      el.hidden = !visible; // estilos.css ya tiene .vista[hidden] { display: none !important }
    }
    vistaActual = nombre;
    indice = CONFIG.secuencia.indexOf(nombre); // la rotación sigue desde aquí
    actualizarBarra(nombre);                   // T16: cubre rotación, saltos y vistas fijadas

    if (nombre === 'video') arrancarVideo();
    else programarFin(nombre);
  }

  // ---------- Vídeo ----------
  function arrancarVideo() {
    // Sin vídeo, o el archivo ya falló al cargar (p. ej. falta video.mp4): saltar ya
    if (videoRoto()) {
      console.warn('Vídeo no disponible; paso a la siguiente vista.');
      setTimeout(siguiente, 0);
      return;
    }

    try {
      if (typeof iniciarVideo === 'function') {
        iniciarVideo(); // T08
      } else {
        video.currentTime = 0;
        video.play().catch(() => { if (vistaActual === 'video') saltarVideo(); });
      }
    } catch (e) {
      console.error('Error al iniciar el vídeo:', e);
      saltarVideo();
      return;
    }

    // Si no arranca (autoplay bloqueado, falta video.mp4…), no nos quedamos atascados
    guardia = setTimeout(() => {
      if (vistaActual !== 'video') return;
      if (video.paused && video.currentTime === 0) {
        console.warn('El vídeo no arrancó; paso a la siguiente vista.');
        siguiente();
      } else {
        guardia = setTimeout(() => { if (vistaActual === 'video') siguiente(); }, CONFIG.videoMaximo);
      }
    }, CONFIG.videoArranque);
  }

  // El vídeo no arranca: se pasa a la siguiente vista. Si está fijado, se reintenta con
  // calma (si no, siguiente() lo volvería a mostrar al instante y se quedaría en bucle).
  function saltarVideo() {
    clearTimeout(guardia);
    guardia = setTimeout(() => { if (vistaActual === 'video') siguiente(); },
                         fijada === 'video' ? CONFIG.videoArranque : 0);
  }

  function detenerVideo() {
    try {
      if (typeof pararVideo === 'function') pararVideo(); // T08
      else if (video) video.pause();
    } catch (e) {
      console.error('Error al parar el vídeo:', e);
    }
  }

  if (video) {
    video.addEventListener('ended', () => { if (vistaActual === 'video') siguiente(); });
    video.addEventListener('error', () => { if (vistaActual === 'video') siguiente(); });
  }

  // ---------- Actualización de datos ----------
  async function actualizar(url, pintar) {
    if (!url) { console.warn('Falta la URL de la API en <body data-api-…>'); return; }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.tiempoMaxPeticion);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const datos = await res.json();
      if (!Array.isArray(datos)) throw new Error('formato inesperado');
      pintar(datos);
    } catch (e) {
      // Sin red, error del servidor o 401: no tocamos nada, se queda lo último pintado
      console.warn(`No se pudo actualizar ${url}:`, e.message);
    } finally {
      clearTimeout(t);
    }
  }

  async function cicloDatos() {
    await Promise.all([
      actualizar(document.body.dataset.apiMural, d => { if (typeof pintarMural === 'function') pintarMural(d); }),
      actualizar(document.body.dataset.apiForo,  d => { if (typeof pintarForo  === 'function') pintarForo(d); }),
    ]);
    // Se programa al terminar: si la red va lenta, las peticiones no se acumulan
    setTimeout(cicloDatos, CONFIG.refresco);
  }

  // ---------- Órdenes del panel (/admin → /api/pantalla) ----------
  function aplicarOrdenes(d) {
    const vistaValida = v => CONFIG.secuencia.includes(v) ? v : null;
    const nuevaFijada = vistaValida(d.fijada);
    const salto = Number(d.salto_id) || 0;

    // La primera respuesta solo marca el punto de partida: recargar /pantalla no repite un salto antiguo
    const saltoNuevo = ultimoSalto !== undefined && salto !== ultimoSalto;
    ultimoSalto = salto;

    if (saltoNuevo && vistaValida(d.salto_vista)) {
      fijada = nuevaFijada;
      mostrarVista(d.salto_vista);
      return;
    }
    if (nuevaFijada === fijada) return;
    fijada = nuevaFijada;
    if (fijada && fijada !== vistaActual) mostrarVista(fijada);
    else if (vistaActual && vistaActual !== 'video') programarFin(vistaActual); // fija o suelta la vista actual
  }

  // Tiempos del panel (segundos). Valores raros se ignoran; ?seg= manda sobre las duraciones.
  function aplicarTiempos(t) {
    if (!t || typeof t !== 'object') return;
    const valido = v => Number.isFinite(v) && v > 0;
    if (valido(t.refresco)) CONFIG.refresco = t.refresco * 1000;
    if (valido(t.foro_pagina) && typeof configurarForo === 'function') configurarForo({ segundosPorPagina: t.foro_pagina });
    if (seg > 0) return;
    let cambia = false;
    for (const vista of ['mural', 'foro']) {
      if (!valido(t[vista])) continue;
      const ms = t[vista] * 1000;
      if (CONFIG.duracion[vista] !== ms) {
        CONFIG.duracion[vista] = ms;
        if (vista === vistaActual) cambia = true;
      }
    }
    // La vista en curso con temporizador: se reprograma con lo que le queda según la nueva duración
    if (cambia && temporizador) {
      const total = CONFIG.duracion[vistaActual];
      const pasado = performance.now() - inicioVista;
      clearTimeout(temporizador);
      temporizador = setTimeout(siguiente, Math.max(0, total - pasado));
      arrancarAro(total, pasado);
    }
  }

  async function cicloControl() {
    const url = document.body.dataset.apiControl;
    if (!url) return; // sin URL no hay control remoto: solo rotación automática
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.tiempoMaxPeticion);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const d = await res.json();
      aplicarTiempos(d.tiempos);
      aplicarTransicion(d.transicion);
      aplicarOrdenes(d);
    } catch (e) {
      // Sin respuesta: se sigue con lo que hubiera (rotación o vista fijada)
      console.warn('No se pudieron leer las órdenes del panel:', e.message);
    } finally {
      clearTimeout(t);
      setTimeout(cicloControl, CONFIG.control);
    }
  }

  // ---------- Barra de vistas (T16) ----------
  // Se crea desde aquí para no tocar el esqueleto común de pantalla.html. Solo informa: no es clicable.
  let barra = null;

  function crearBarra() {
    barra = document.createElement('nav');
    barra.id = 'barra-vistas';
    barra.className = 'barra-vistas'; // estilos: estilos.css
    barra.setAttribute('aria-label', 'Vistas / Views');
    const lista = document.createElement('ol');
    for (const n of CONFIG.secuencia) {
      const item = document.createElement('li');
      item.dataset.vista = n;
      item.textContent = NOMBRES_VISTAS[n] || n;
      lista.append(item);
    }
    barra.append(lista);
    document.body.append(barra);
  }

  function actualizarBarra(nombre) {
    if (!barra) return;
    for (const item of barra.querySelectorAll('li')) {
      const activa = item.dataset.vista === nombre;
      item.classList.toggle('barra-vista--activa', activa);
      if (activa) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    }
  }

  // ---------- Aro de tiempo del mural (T17) ----------
  // <svg> fijo creado desde aquí con dos <rect pathLength="1">: pista y progreso. La animación
  // (stroke-dashoffset de 1 a 0) está en estilos.css; aquí solo se arranca, se para y se mide.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  let aro = null;
  let aroPista = null;
  let aroProgreso = null;

  function crearAro() {
    aro = document.createElementNS(SVG_NS, 'svg');
    aro.id = 'aro-tiempo';
    aro.setAttribute('class', 'aro-tiempo aro-oculto');
    aro.setAttribute('aria-hidden', 'true');
    aro.setAttribute('preserveAspectRatio', 'none');
    aroPista = document.createElementNS(SVG_NS, 'rect');
    aroPista.setAttribute('class', 'aro-pista');
    aroProgreso = document.createElementNS(SVG_NS, 'rect');
    aroProgreso.setAttribute('class', 'aro-progreso');
    for (const r of [aroPista, aroProgreso]) {
      r.setAttribute('pathLength', '1');
      aro.append(r);
    }
    document.body.append(aro);
    medirAro();
    window.addEventListener('resize', medirAro);
    document.addEventListener('fullscreenchange', medirAro);
  }

  // viewBox en píxeles; el rectángulo se mete medio grosor para que el trazo no se recorte en el borde.
  function medirAro() {
    if (!aro) return;
    const ancho = document.documentElement.clientWidth;
    const alto = document.documentElement.clientHeight;
    const grosor = parseFloat(getComputedStyle(aroProgreso).strokeWidth) || 0; // --aro-grosor en px
    aro.setAttribute('viewBox', `0 0 ${ancho} ${alto}`);
    for (const r of [aroPista, aroProgreso]) {
      r.setAttribute('x', grosor / 2);
      r.setAttribute('y', grosor / 2);
      r.setAttribute('width', Math.max(0, ancho - grosor));
      r.setAttribute('height', Math.max(0, alto - grosor));
    }
  }

  function ocultarAro() {
    if (!aro) return;
    aro.classList.remove('aro-activo'); // quita la animación
    aro.classList.add('aro-oculto');
  }

  // ms: duración total; pasado: lo que ya ha transcurrido (el aro empieza ya avanzado).
  function arrancarAro(ms, pasado = 0) {
    if (!aro) return;
    medirAro();
    aro.classList.remove('aro-activo');
    aro.classList.remove('aro-oculto');
    void aro.getBoundingClientRect(); // fuerza el reflow: la animación empieza otra vez desde 0
    aro.style.setProperty('--aro-duracion', ms + 'ms');
    aro.style.setProperty('--aro-retraso', -Math.min(pasado, ms) + 'ms');
    aro.classList.add('aro-activo');
  }

  // ---------- Pantalla completa ----------
  // El botón se crea desde aquí para no tocar el esqueleto común de pantalla.html.
  // Textos traducidos en <body data-textos="{…}"> (i18n); si faltan, español.
  let textos = {};
  try { textos = JSON.parse(document.body.dataset.textos || '{}'); } catch (e) { /* español */ }
  const t = (clave, porDefecto) => textos[clave] || porDefecto;

  function crearBotonPantallaCompleta() {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.id = 'btn-pantalla-completa';
    boton.className = 'boton-pantalla-completa'; // estilo y ocultación en pantalla completa: T10
    boton.textContent = t('pantalla_completa', 'Pantalla completa (o pulsa F11)');

    boton.addEventListener('click', () => {
      const el = document.documentElement;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => { boton.textContent = t('pulsa_f11', 'Pulsa F11 para pantalla completa'); });
      } else {
        boton.textContent = t('pulsa_f11', 'Pulsa F11 para pantalla completa');
      }
      // Si el navegador había bloqueado el vídeo, el clic permite reintentarlo
      if (vistaActual === 'video' && video && video.paused) video.play().catch(() => {});
    });

    document.body.append(boton);
  }

  // ---------- Arranque ----------
  crearBotonPantallaCompleta();
  crearBarra();  // antes de la primera vista: mostrarVista() marca la activa
  crearAro();    // antes de la primera vista: programarFin() lo arranca o lo oculta
  siguiente();   // muestra la primera vista (detrás de la portada de inicio, que se retira sola)
  if (capaTrans) {
    // Pantalla de inicio / reposo: la portada sin etiqueta «Siguiente», visible al cargar.
    capaTrans.classList.add('trans-visible', 'trans-inicio');
    setTimeout(() => {
      capaTrans.classList.remove('trans-visible', 'trans-inicio');
      capaTrans.classList.add('trans-fuera');
      setTimeout(() => capaTrans.classList.remove('trans-fuera'), FUNDIDO);
    }, 2500);
  }
  cicloDatos();  // primera carga de datos inmediata, luego cada 10 s
  cicloControl(); // órdenes del panel: al arrancar y luego cada 3 s
})();
