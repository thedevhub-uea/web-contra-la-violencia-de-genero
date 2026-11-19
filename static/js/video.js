// T08 — Vista de vídeo: iniciarVideo() y pararVideo().
//
// La T04 (pantalla.js) llama a iniciarVideo() al mostrar la vista de vídeo y
// pasa a la siguiente vista con el evento `ended` del <video id="video25n">.
//
// Diseño: el vídeo va en un marco de cristal (mismo estilo que el mural), sobre
// un fondo morado con un resplandor que toma los colores del propio vídeo, con
// una cabecera del 25N, el tiempo que falta y una barra de progreso.
// Todo se construye aquí alrededor del <video> de pantalla.html. Los estilos están
// en static/css/video.css (bajo #vista-video) y este script los carga solo.

(function () {
  'use strict';

  // static/css/video.css, junto a este script (vale también si la app va en un subdirectorio).
  const URL_CSS = (function () {
    const src = document.currentScript && document.currentScript.src;
    try {
      return new URL('../css/video.css', src || window.location.href).href;
    } catch (_) {
      return 'static/css/video.css';
    }
  })();

  const video = document.getElementById('video25n');
  const vista = document.getElementById('vista-video');

  let ambiente = null;      // <canvas> del resplandor
  let pincel = null;
  let barra = null;         // relleno de la barra de progreso
  let tiempo = null;        // texto con el tiempo restante
  let marco = null;
  let bucle = 0;
  let ultimoAmbiente = 0;

  // Cada llamada a iniciarVideo() o pararVideo() sube este número. Un reintento
  // pendiente solo reproduce si sigue siendo el último: así pararVideo() lo anula.
  let intento = 0;
  let espera = null;        // reintento pendiente: {alListo, resolver}

  // --- API pública -----------------------------------------------------------

  // Vuelve al segundo 0 y reproduce con sonido (sin sonido solo si el navegador lo bloquea). Devuelve la promesa de play()
  // (nunca lanza): si el navegador no deja reproducir, se reintenta una vez
  // cuando el vídeo esté listo; si tampoco, la T04 salta la vista.
  function iniciarVideo() {
    if (!video) return Promise.resolve(false);
    cancelarEspera();
    const mio = ++intento;
    prepararVideo();
    try {
      video.currentTime = 0;
    } catch (_) {
      // Sin metadatos aún: empezará en 0 de todas formas.
    }
    animarEntrada();
    actualizarProgreso();
    return reproducir().then(function (ok) {
      if (mio !== intento) return false;   // se paró (o se reinició) mientras tanto
      if (ok || video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return ok;
      return new Promise(function (resolver) {
        const alListo = function () {
          espera = null;
          if (mio !== intento) { resolver(false); return; }
          reproducir().then(function (r) { resolver(r && mio === intento); });
        };
        espera = { alListo: alListo, resolver: resolver };
        video.addEventListener('canplay', alListo, { once: true });
      });
    });
  }

  // Para el vídeo, anula cualquier reintento pendiente y lo deja en el principio.
  function pararVideo() {
    if (!video) return;
    intento++;
    cancelarEspera();
    video.pause();
    try {
      video.currentTime = 0;
    } catch (_) {
      // Nada que rebobinar.
    }
    actualizarProgreso();
  }

  window.iniciarVideo = iniciarVideo;
  window.pararVideo = pararVideo;

  // --- Reproducción ----------------------------------------------------------

  function cancelarEspera() {
    if (!espera) return;
    video.removeEventListener('canplay', espera.alListo);
    espera.resolver(false);
    espera = null;
  }

  // Primero con sonido. Si el navegador lo bloquea (autoplay con audio sin que nadie haya
  // tocado la página), se reproduce sin sonido para no dejar la vista en negro y el sonido
  // se activa en cuanto alguien pulse o toque la pantalla (p. ej. el botón de pantalla completa).
  // En el equipo de la proyección conviene arrancar Chrome con
  // --autoplay-policy=no-user-gesture-required para que suene siempre sin tocar nada.
  function reproducir() {
    video.muted = false;
    return intentarPlay().then(function (ok) {
      if (ok) return true;
      if (video.error) return false;
      video.muted = true;
      esperarGesto();
      return intentarPlay();
    });
  }

  function intentarPlay() {
    const promesa = video.play();
    if (!promesa || typeof promesa.then !== 'function') return Promise.resolve(!video.paused);
    return promesa.then(
      function () { return true; },
      function (error) {
        console.warn('No se pudo reproducir el vídeo' + (video.muted ? ' (sin sonido)' : ' con sonido') + ':',
                     error && error.name);
        return false;
      }
    );
  }

  // Tras el primer gesto de usuario el navegador ya deja sonar: se quita el silencio.
  let gestoArmado = false;
  function esperarGesto() {
    if (gestoArmado) return;
    gestoArmado = true;
    const activar = function () {
      ['pointerdown', 'keydown', 'touchstart'].forEach(function (tipo) {
        document.removeEventListener(tipo, activar, true);
      });
      gestoArmado = false;
      video.muted = false;
    };
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (tipo) {
      document.addEventListener(tipo, activar, true);
    });
  }

  function prepararVideo() {
    video.defaultMuted = false;   // el vídeo tiene audio y se tiene que oír
    video.playsInline = true;
    video.controls = false;
    video.loop = false;   // `ended` tiene que llegar para pasar de vista
    video.disablePictureInPicture = true;
  }

  // --- Interfaz --------------------------------------------------------------

  function construir() {
    vista.classList.add('video-vista');

    ambiente = document.createElement('canvas');
    ambiente.className = 'video-ambiente';
    ambiente.width = 48;
    ambiente.height = 27;
    ambiente.setAttribute('aria-hidden', 'true');
    pincel = ambiente.getContext('2d');

    const cabecera = document.createElement('header');
    cabecera.className = 'video-cabecera';
    const insignia = document.createElement('span');
    insignia.className = 'video-insignia';
    insignia.textContent = '25N';
    const titulo = document.createElement('span');
    titulo.className = 'video-titulo';
    let textos = {};  // traducciones de <body data-textos="{…}"> (i18n)
    try { textos = JSON.parse(document.body.dataset.textos || '{}'); } catch (_) { /* español */ }
    titulo.textContent = textos.video_titulo || 'Día Internacional para la Eliminación de la Violencia contra la Mujer';
    // Créditos de la autora original del cortometraje (instagram.com/zoilaelectra): siempre visibles.
    const creditos = document.createElement('span');
    creditos.className = 'video-creditos';
    creditos.textContent = textos.video_creditos || 'Cortometraje de zoila electra · @zoilaelectra';
    const textosCabecera = document.createElement('span');
    textosCabecera.className = 'video-textos';
    textosCabecera.append(titulo, creditos);
    tiempo = document.createElement('span');
    tiempo.className = 'video-tiempo';
    tiempo.setAttribute('aria-hidden', 'true');
    cabecera.append(insignia, textosCabecera, tiempo);

    marco = document.createElement('div');
    marco.className = 'video-marco';
    const progreso = document.createElement('div');
    progreso.className = 'video-progreso';
    progreso.setAttribute('aria-hidden', 'true');
    barra = document.createElement('span');
    progreso.appendChild(barra);

    video.replaceWith(marco);   // el <video> sigue siendo el mismo elemento (id incluido)
    marco.append(video, progreso);
    vista.prepend(ambiente);
    vista.insertBefore(cabecera, marco);

    video.addEventListener('loadedmetadata', ajustarProporcion);
    video.addEventListener('timeupdate', actualizarTiempo);
    video.addEventListener('play', arrancarBucle);
    video.addEventListener('seeked', actualizarProgreso);
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) ajustarProporcion();
  }

  // El marco toma la proporción del vídeo: así no hay franjas y no se deforma.
  function ajustarProporcion() {
    if (video.videoWidth && video.videoHeight) {
      vista.style.setProperty('--proporcion', (video.videoWidth / video.videoHeight).toFixed(4));
    }
    actualizarTiempo();
  }

  function animarEntrada() {
    if (!marco || !marco.animate || reducirMovimiento()) return;
    marco.animate([
      { opacity: 0, transform: 'translateY(2vh) scale(.95)', filter: 'blur(10px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0)' },
    ], { duration: 1100, easing: 'cubic-bezier(.2,.9,.3,1)' });
  }

  // Barra de progreso fluida (en cada fotograma) y resplandor de colores del vídeo.
  function arrancarBucle() {
    if (bucle) return;
    const paso = function (t) {
      if (video.paused || video.ended || vista.hidden) {
        bucle = 0;
        actualizarProgreso();
        return;
      }
      actualizarProgreso();
      if (t - ultimoAmbiente > 200) {   // 5 veces por segundo basta para el resplandor
        ultimoAmbiente = t;
        pintarAmbiente();
      }
      bucle = requestAnimationFrame(paso);
    };
    bucle = requestAnimationFrame(paso);
  }

  function actualizarProgreso() {
    if (!barra) return;
    const d = video.duration;
    const p = d > 0 && isFinite(d) ? Math.min(1, video.currentTime / d) : 0;
    barra.style.transform = 'scaleX(' + p.toFixed(5) + ')';
  }

  function actualizarTiempo() {
    if (!tiempo) return;
    const d = video.duration;
    if (!(d > 0) || !isFinite(d)) { tiempo.textContent = ''; return; }
    const queda = Math.max(0, Math.ceil(d - video.currentTime));
    tiempo.textContent = Math.floor(queda / 60) + ':' + String(queda % 60).padStart(2, '0');
  }

  function pintarAmbiente() {
    if (!pincel || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    try {
      pincel.drawImage(video, 0, 0, ambiente.width, ambiente.height);
    } catch (_) {
      pincel = null;   // vídeo de otro origen: nos quedamos sin resplandor
    }
  }

  function reducirMovimiento() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function cargarEstilos() {
    if (document.getElementById('video-estilos')) return;
    const enlace = document.createElement('link');
    enlace.id = 'video-estilos';
    enlace.rel = 'stylesheet';
    enlace.href = URL_CSS;
    document.head.appendChild(enlace);
  }

  // --- Arranque --------------------------------------------------------------

  if (video && vista) {
    prepararVideo();
    video.preload = 'auto';   // que esté cargado cuando llegue su turno
    cargarEstilos();
    construir();
  }
})();
