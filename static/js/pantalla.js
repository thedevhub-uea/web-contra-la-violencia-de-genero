// T04 — Rotación de vistas y actualización cada 10 s (fetch a /api/mural y /api/foro).
//
// - Alterna mural → vídeo → foro. Solo una vista visible a la vez.
// - La vista de vídeo avanza con el evento 'ended' del vídeo, no por tiempo.
// - Cada 10 s pide la API (URLs en <body data-api-mural / data-api-foro>) y llama a pintarMural (T07) y pintarForo (T09).
// - Si una petición falla, se queda lo último que se pintó: nunca pantalla en blanco.
// - Crea un botón de pantalla completa (o se puede usar F11).
// - T17: durante el mural, un aro recorre el borde de la pantalla y se completa justo cuando termina
//   (la duración sale de CONFIG.duracion.mural, que ya respeta ?seg=). Con el mural fijado no hay aro.
// - T16: crea una barra superior (solo informativa) con las vistas de CONFIG.secuencia y marca la activa.
// - Cada 3 s pregunta a /api/pantalla (data-api-control) por las órdenes del panel:
//   «saltar» a una vista (y seguir rotando desde ahí) o «fijar» una vista hasta soltarla.
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
  let fijada = null;          // vista fijada desde el panel (null = rotación automática)
  let ultimoSalto;            // salto_id ya atendido (undefined hasta la primera respuesta)

  function limpiarTemporizadores() {
    clearTimeout(temporizador);
    clearTimeout(guardia);
    temporizador = guardia = null;
    ocultarAro();   // T17: el aro solo vive mientras hay un temporizador de mural
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
    const ms = CONFIG.duracion[nombre] ?? CONFIG.duracionPorDefecto;
    temporizador = setTimeout(siguiente, ms);
    if (nombre === 'mural') arrancarAro(ms); // T17: el aro dura exactamente lo que el temporizador
  }

  function mostrarVista(nombre) {
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

  async function cicloControl() {
    const url = document.body.dataset.apiControl;
    if (!url) return; // sin URL no hay control remoto: solo rotación automática
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), CONFIG.tiempoMaxPeticion);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      aplicarOrdenes(await res.json());
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

  function arrancarAro(ms) {
    if (!aro) return;
    medirAro();
    aro.classList.remove('aro-activo');
    aro.classList.remove('aro-oculto');
    void aro.getBoundingClientRect(); // fuerza el reflow: la animación empieza otra vez desde 0
    aro.style.setProperty('--aro-duracion', ms + 'ms');
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
      // El clic es un gesto: permite el sonido del vídeo (T08)
      if (typeof activarSonidoVideo === 'function') activarSonidoVideo();
      // Si el navegador había bloqueado el vídeo, el clic permite reintentarlo
      if (vistaActual === 'video' && video && video.paused) video.play().catch(() => {});
    });

    document.body.append(boton);
  }

  // ---------- Arranque ----------
  crearBotonPantallaCompleta();
  crearBarra();  // antes de la primera vista: mostrarVista() marca la activa
  crearAro();    // antes de la primera vista: programarFin() lo arranca o lo oculta
  siguiente();   // muestra la primera vista
  cicloDatos();  // primera carga de datos inmediata, luego cada 10 s
  cicloControl(); // órdenes del panel: al arrancar y luego cada 3 s
})();
