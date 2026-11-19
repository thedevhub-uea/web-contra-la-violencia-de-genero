// T09 — pintarForo(elementos). Texto SIEMPRE con textContent, nunca innerHTML.
//
// T14: el foro muestra reflexiones Y mensajes del mural, mezclados (los manda /api/foro):
//   { tipo: "reflexion", id, titulo, texto }  → tarjeta con título (como antes)
//   { tipo: "mensaje",   id, titulo: null, texto } → tarjeta corta, sin título, texto grande y centrado
// Los ids se repiten entre tablas (mural 5 y foro 5): toda identidad es tipo + ":" + id.
//
// Uso (desde pantalla.js, T04):
//   pintarForo([{ tipo: "reflexion", id: 1, titulo: "...", texto: "..." }, ...]);
// Se puede llamar cada vez que lleguen datos nuevos de /api/foro: actualiza las
// tarjetas sin reiniciar la rotación ni provocar parpadeos si nada ha cambiado.
//
// Los estilos de la vista están en estilos.css (sección «Foro»); este archivo no inyecta ningún <style>.
//
// Prueba sin API: abrir /pantalla?demo-foro (o ?demo-foro=0, =1, =20 elementos mezclados).
// Con &tipo=mensajes o &tipo=reflexiones se muestran solo de ese tipo (p. ej. ?demo-foro=7&tipo=mensajes).

(function () {
  "use strict";

  var TARJETAS_POR_PAGINA = 3;
  var SEGUNDOS_POR_PAGINA = 15;
  var MAX_TITULO = 80;   // igual que el CHECK de bd/schema.sql
  var MAX_TEXTO = 280;   // lo que se lee bien a distancia; el resto se corta con «…»
  var MAX_MENSAJE = 200; // igual que el límite del mural (bd/schema.sql)
  var MENSAJE_VACIO = "Escanea el QR y comparte un mensaje o una reflexión";
  var MENSAJE_VACIO_EN = "Scan the QR and share a message or a reflection";

  var estado = {
    elementos: [],
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

  // Acepta solo objetos con texto (y título, si son reflexiones); ignora lo demás sin romper la
  // pantalla. Sin «tipo» se trata como reflexión (así funcionaba antes de T14).
  function normalizar(elementos) {
    if (!Array.isArray(elementos)) return [];
    var limpias = [];
    var vistas = {};
    for (var i = 0; i < elementos.length; i++) {
      var e = elementos[i];
      if (!e || typeof e !== "object") continue;
      var tipo = e.tipo === "mensaje" ? "mensaje" : "reflexion";
      var titulo = tipo === "mensaje" || e.titulo == null ? "" : String(e.titulo).trim();
      var texto = e.texto == null ? "" : String(e.texto).trim();
      if (tipo === "mensaje" ? !texto : (!titulo && !texto)) continue;
      var clave = e.id == null ? null : tipo + ":" + e.id;
      if (clave !== null) {
        if (vistas[clave]) continue;   // la misma identidad dos veces: se queda la primera
        vistas[clave] = true;
      }
      limpias.push({ clave: clave, tipo: tipo, titulo: titulo, texto: texto });
    }
    return limpias;
  }

  function totalPaginas() {
    return Math.max(1, Math.ceil(estado.elementos.length / TARJETAS_POR_PAGINA));
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

  function crearTarjeta(elemento) {
    var tarjeta = document.createElement("article");
    tarjeta.className = "foro-tarjeta foro-tarjeta--" + elemento.tipo;
    if (elemento.clave != null) tarjeta.dataset.id = elemento.clave;

    var texto = document.createElement("p");
    texto.className = "foro-texto";

    if (elemento.tipo === "mensaje") {
      // Mensaje del mural: corto, sin título.
      texto.textContent = recortar(elemento.texto, MAX_MENSAJE);
      tarjeta.appendChild(texto);
      return tarjeta;
    }

    var titulo = document.createElement("h3");
    titulo.className = "foro-titulo";
    titulo.textContent = recortar(elemento.titulo, MAX_TITULO);
    titulo.title = elemento.titulo;
    titulo.hidden = !elemento.titulo;
    texto.textContent = recortar(elemento.texto, MAX_TEXTO);

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

    if (estado.elementos.length === 0) {
      pintarVacio(zona);
    } else {
      var inicio = estado.pagina * TARJETAS_POR_PAGINA;
      var visibles = estado.elementos.slice(inicio, inicio + TARJETAS_POR_PAGINA);
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

  function pintarForo(elementos) {
    var nuevas = normalizar(elementos);
    var firma = JSON.stringify(nuevas);

    // Mismos datos que la última vez (refresco de T04 cada 10 s): no se toca nada.
    if (firma === estado.firma && contenedor() && contenedor().querySelector(".foro-tarjetas")) {
      return;
    }
    estado.firma = firma;
    estado.elementos = nuevas;

    // Se mantiene la página actual si sigue existiendo; si no, se vuelve a la primera.
    if (estado.pagina >= totalPaginas()) estado.pagina = 0;

    pintarPagina();
    ajustarRotacion();
  }

  var parametros = new URLSearchParams(window.location.search);
  var modoDemo = parametros.has("demo-foro");

  // En modo demo (?demo-foro) los datos reales que manda pantalla.js no pisan los de prueba.
  window.pintarForo = function (elementos) {
    if (!modoDemo) pintarForo(elementos);
  };

  // ---- Datos de prueba (solo con ?demo-foro en la URL) ----------------------
  var pintarForoDemo = pintarForo;   // la función real: window.pintarForo ignora llamadas en modo demo
  function datosDePrueba(cuantas, tipo) {
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
    var mensajes = [
      "Ni una menos", "Vivas, libres y sin miedo", "Te creo", "Si nos tocan a una, nos tocan a todas",
      "Educar en igualdad es prevenir la violencia de género desde la infancia", "Nunca estás sola",
      "Un mensaje muy largo para probar el recorte: la igualdad se construye cada día, en casa, en clase " +
        "y en la calle, y nadie debería callar ante una injusticia. <i>Esto no debe salir en cursiva</i>."
    ];
    var lista = [];
    for (var i = 0; i < cuantas; i++) {
      // Mezcla: una reflexión de cada tres elementos... y el resto, mensajes (o solo un tipo con &tipo=).
      var esMensaje = tipo === "mensajes" || (tipo !== "reflexiones" && i % 3 !== 0);
      if (esMensaje) {
        lista.push({ tipo: "mensaje", id: i + 1, titulo: null, texto: mensajes[i % mensajes.length] });
      } else {
        var e = ejemplos[i % ejemplos.length];
        lista.push({ tipo: "reflexion", id: i + 1, titulo: e[0] + (i >= ejemplos.length ? " (" + (i + 1) + ")" : ""), texto: e[1] });
      }
    }
    return lista;
  }

  if (modoDemo) {
    document.addEventListener("DOMContentLoaded", function () {
      var vista = contenedor();
      if (!vista) return;
      document.querySelectorAll(".vista").forEach(function (v) { v.hidden = v !== vista; });
      var valor = parametros.get("demo-foro");
      var cuantas = valor === "" ? 20 : Math.max(0, parseInt(valor, 10) || 0);
      var tipo = parametros.get("tipo");
      pintarForoDemo(datosDePrueba(cuantas, tipo));
      // Simula el refresco de T04: mismos datos a los 10 s y un elemento nuevo a los 20 s.
      setTimeout(function () { pintarForoDemo(datosDePrueba(cuantas, tipo)); }, 10000);
      setTimeout(function () {
        var nuevas = datosDePrueba(cuantas, tipo);
        nuevas.unshift(tipo === "mensajes"
          ? { tipo: "mensaje", id: 999, titulo: null, texto: "Mensaje nuevo, ha llegado mientras rotaba." }
          : { tipo: "reflexion", id: 999, titulo: "Reflexión nueva", texto: "Ha llegado mientras rotaba." });
        pintarForoDemo(nuevas);
      }, 20000);
    });
  }
})();
