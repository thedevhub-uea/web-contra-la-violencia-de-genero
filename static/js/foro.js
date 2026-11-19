// T09 — pintarForo(reflexiones). Texto SIEMPRE con textContent, nunca innerHTML.
//
// Uso (desde pantalla.js, T04):
//   pintarForo([{ id: 1, titulo: "...", texto: "..." }, ...]);
// Se puede llamar cada vez que lleguen datos nuevos de /api/foro: actualiza las
// tarjetas sin reiniciar la rotación ni provocar parpadeos si nada ha cambiado.
//
// Los estilos de la vista están en estilos.css (sección «Foro»); este archivo no inyecta ningún <style>.
//
// Prueba sin API: abrir /pantalla?demo-foro (o ?demo-foro=0, =1, =20 reflexiones).

(function () {
  "use strict";

  var TARJETAS_POR_PAGINA = 3;
  var SEGUNDOS_POR_PAGINA = 15;
  var MAX_TITULO = 80;   // igual que el CHECK de bd/schema.sql
  var MAX_TEXTO = 280;   // lo que se lee bien a distancia; el resto se corta con «…»
  var MENSAJE_VACIO = "Escanea el QR y comparte tu reflexión";
  var MENSAJE_VACIO_EN = "Scan the QR and share your reflection";

  var estado = {
    reflexiones: [],
    firma: null,      // para saber si los datos han cambiado entre llamadas
    pagina: 0,
    temporizador: null
  };

  function recortar(texto, maximo) {
    var limpio = String(texto).replace(/\s+\n/g, "\n").trim();
    if (limpio.length <= maximo) return limpio;
    var corte = limpio.slice(0, maximo);
    var espacio = corte.lastIndexOf(" ");
    if (espacio > maximo * 0.6) corte = corte.slice(0, espacio);   // no partir palabras
    return corte.replace(/[\s.,;:!?¡¿-]+$/, "") + "…";
  }

  // Acepta solo objetos con título y texto; ignora lo demás sin romper la pantalla.
  function normalizar(reflexiones) {
    if (!Array.isArray(reflexiones)) return [];
    var limpias = [];
    for (var i = 0; i < reflexiones.length; i++) {
      var r = reflexiones[i];
      if (!r || typeof r !== "object") continue;
      var titulo = r.titulo == null ? "" : String(r.titulo).trim();
      var texto = r.texto == null ? "" : String(r.texto).trim();
      if (!titulo && !texto) continue;
      limpias.push({ id: r.id, titulo: titulo, texto: texto });
    }
    return limpias;
  }

  function totalPaginas() {
    return Math.max(1, Math.ceil(estado.reflexiones.length / TARJETAS_POR_PAGINA));
  }

  function contenedor() {
    return document.getElementById("vista-foro");
  }

  // Crea (una sola vez) la estructura fija de la vista.
  function prepararVista() {
    var vista = contenedor();
    if (!vista) return null;
    if (!vista.querySelector(".foro-tarjetas")) {
      vista.textContent = "";
      var cabecera = document.createElement("h2");
      cabecera.className = "foro-cabecera";
      cabecera.textContent = "Reflexiones / Reflections";
      var tarjetas = document.createElement("div");
      tarjetas.className = "foro-tarjetas";
      tarjetas.setAttribute("aria-live", "polite");
      var puntos = document.createElement("div");
      puntos.className = "foro-puntos";
      vista.appendChild(cabecera);
      vista.appendChild(tarjetas);
      vista.appendChild(puntos);
    }
    return vista;
  }

  function crearTarjeta(reflexion) {
    var tarjeta = document.createElement("article");
    tarjeta.className = "foro-tarjeta";
    if (reflexion.id != null) tarjeta.dataset.id = reflexion.id;

    var titulo = document.createElement("h3");
    titulo.className = "foro-titulo";
    titulo.textContent = recortar(reflexion.titulo, MAX_TITULO);
    titulo.title = reflexion.titulo;

    var texto = document.createElement("p");
    texto.className = "foro-texto";
    texto.textContent = recortar(reflexion.texto, MAX_TEXTO);

    tarjeta.appendChild(titulo);
    tarjeta.appendChild(texto);
    return tarjeta;
  }

  function pintarVacio(zona) {
    zona.style.setProperty("--foro-columnas", 1);
    var vacio = document.createElement("div");
    vacio.className = "foro-vacio";
    var es = document.createElement("p");
    es.textContent = MENSAJE_VACIO;
    var en = document.createElement("p");
    en.className = "foro-vacio-en";
    en.textContent = MENSAJE_VACIO_EN;
    vacio.appendChild(es);
    vacio.appendChild(en);
    zona.appendChild(vacio);
  }

  function pintarPuntos(vista) {
    var puntos = vista.querySelector(".foro-puntos");
    puntos.textContent = "";
    var total = totalPaginas();
    if (total < 2) return;
    for (var i = 0; i < total; i++) {
      var punto = document.createElement("span");
      punto.className = "foro-punto" + (i === estado.pagina ? " foro-activo" : "");
      puntos.appendChild(punto);
    }
  }

  // Pinta la página actual (sin animación).
  function pintarPagina() {
    var vista = prepararVista();
    if (!vista) return;
    var zona = vista.querySelector(".foro-tarjetas");
    zona.textContent = "";

    if (estado.reflexiones.length === 0) {
      pintarVacio(zona);
    } else {
      var inicio = estado.pagina * TARJETAS_POR_PAGINA;
      var visibles = estado.reflexiones.slice(inicio, inicio + TARJETAS_POR_PAGINA);
      zona.style.setProperty("--foro-columnas", visibles.length);
      for (var i = 0; i < visibles.length; i++) zona.appendChild(crearTarjeta(visibles[i]));
    }
    pintarPuntos(vista);
  }

  // Pasa a la siguiente página con un fundido.
  function siguientePagina() {
    var vista = contenedor();
    var zona = vista && vista.querySelector(".foro-tarjetas");
    estado.pagina = (estado.pagina + 1) % totalPaginas();
    if (!zona) { pintarPagina(); return; }
    zona.classList.add("foro-oculto");
    setTimeout(function () {
      pintarPagina();
      zona.classList.remove("foro-oculto");
    }, 600);
  }

  // Solo hay temporizador si hay más de una página; nunca se crean dos a la vez.
  function ajustarRotacion() {
    var haceFalta = totalPaginas() > 1;
    if (haceFalta && !estado.temporizador) {
      estado.temporizador = setInterval(siguientePagina, SEGUNDOS_POR_PAGINA * 1000);
    } else if (!haceFalta && estado.temporizador) {
      clearInterval(estado.temporizador);
      estado.temporizador = null;
    }
  }

  function pintarForo(reflexiones) {
    var nuevas = normalizar(reflexiones);
    var firma = JSON.stringify(nuevas);

    // Mismos datos que la última vez (refresco de T04 cada 10 s): no se toca nada.
    if (firma === estado.firma && contenedor() && contenedor().querySelector(".foro-tarjetas")) {
      return;
    }
    estado.firma = firma;
    estado.reflexiones = nuevas;

    // Se mantiene la página actual si sigue existiendo; si no, se vuelve a la primera.
    if (estado.pagina >= totalPaginas()) estado.pagina = 0;

    pintarPagina();
    ajustarRotacion();
  }

  window.pintarForo = pintarForo;

  // ---- Datos de prueba (solo con ?demo-foro en la URL) ----------------------
  function datosDePrueba(cuantas) {
    var ejemplos = [
      ["No estás sola", "Si te pasa a ti, habla. Hay gente dispuesta a escucharte y a ayudarte."],
      ["El silencio no protege", "Callar ante un comentario machista también es tomar partido. Hoy decido no callar."],
      ["Para mi madre", "Gracias por enseñarme que el respeto no se negocia y que el amor nunca duele."],
      ["Ni una menos", "Cada 25 de noviembre recordamos a las que ya no están y luchamos por las que siguen aquí."],
      ["Un texto muy largo para probar el recorte de las tarjetas en la pantalla proyectada",
        "Este es un texto deliberadamente largo para comprobar que la tarjeta lo recorta con puntos " +
        "suspensivos y que se sigue leyendo bien desde el fondo de la sala. La violencia de género no " +
        "es un problema privado: es un problema social que nos afecta a todas y a todos, y que solo " +
        "se resuelve con educación, con igualdad real y con el compromiso diario de cada persona de " +
        "no mirar hacia otro lado cuando ve algo que no está bien. <b>Esto no debe salir en negrita</b>."]
    ];
    var lista = [];
    for (var i = 0; i < cuantas; i++) {
      var e = ejemplos[i % ejemplos.length];
      lista.push({ id: i + 1, titulo: e[0] + (i >= ejemplos.length ? " (" + (i + 1) + ")" : ""), texto: e[1] });
    }
    return lista;
  }

  var parametros = new URLSearchParams(window.location.search);
  if (parametros.has("demo-foro")) {
    document.addEventListener("DOMContentLoaded", function () {
      var vista = contenedor();
      if (!vista) return;
      document.querySelectorAll(".vista").forEach(function (v) { v.hidden = v !== vista; });
      var valor = parametros.get("demo-foro");
      var cuantas = valor === "" ? 20 : Math.max(0, parseInt(valor, 10) || 0);
      pintarForo(datosDePrueba(cuantas));
      // Simula el refresco de T04: mismos datos a los 10 s y una reflexión nueva a los 20 s.
      setTimeout(function () { pintarForo(datosDePrueba(cuantas)); }, 10000);
      setTimeout(function () {
        var nuevas = datosDePrueba(cuantas);
        nuevas.unshift({ id: 999, titulo: "Reflexión nueva", texto: "Ha llegado mientras rotaba." });
        pintarForo(nuevas);
      }, 20000);
    });
  }
})();
