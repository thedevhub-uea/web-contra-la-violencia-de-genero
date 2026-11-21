// T09 — pintarForo(elementos). Texto SIEMPRE con textContent, nunca innerHTML.
//
// T14: el foro muestra reflexiones Y mensajes del mural, mezclados (los manda /api/foro):
//   { tipo: "reflexion", id, titulo, texto }  → tarjeta con título (como antes)
//   { tipo: "mensaje",   id, titulo: null, texto } → tarjeta corta, sin título, texto grande y centrado
// Los ids se repiten entre tablas (mural 5 y foro 5): toda identidad es tipo + ":" + id.
//
// configurarForo({segundosPorPagina}) cambia cada cuánto pasa de página (lo llama pantalla.js
// con el tiempo del panel).
//
// Uso (desde pantalla.js, T04):
//   pintarForo([{ tipo: "reflexion", id: 1, titulo: "...", texto: "..." }, ...]);
// Se puede llamar cada vez que lleguen datos nuevos de /api/foro: actualiza las
// tarjetas sin reiniciar la rotación ni provocar parpadeos si nada ha cambiado.
//
// Pantalla grande: cada página muestra UNA pregunta (el título de las reflexiones, que solo puede ser
// una de las 5 preguntas del foro) entera y en grande, y debajo hasta 4 respuestas en letra grande.
// Los mensajes del mural van en sus propias páginas («Mensajes del mural»). El tamaño de letra de cada
// respuesta depende de su longitud (.foro-tarjeta--corta / --media / --larga).
//
// Los estilos de la vista están en estilos.css (sección «Foro»); este archivo no inyecta ningún <style>.
//
// Prueba sin API: abrir /pantalla?demo-foro (o ?demo-foro=0, =1, =20 elementos mezclados).
// Con &tipo=mensajes o &tipo=reflexiones se muestran solo de ese tipo (p. ej. ?demo-foro=7&tipo=mensajes).

(function () {
  "use strict";

  var PESO_POR_PAGINA = 4;   // respuestas por página: corta/media pesan 1, larga 2 (máx. 4 cortas o 2 largas)
  var CORTA = 40;            // hasta aquí, respuesta corta (letra muy grande)
  var MEDIA = 140;           // hasta aquí, media; más, larga
  var TITULO_MENSAJES = "Mensajes del mural / Wall messages";
  var SEGUNDOS_POR_PAGINA = 15;   // se cambia desde el panel: configurarForo({segundosPorPagina})
  var MAX_TITULO = 80;   // igual que el CHECK de bd/schema.sql
  var MAX_TEXTO = 280;   // = db.MAX_FORO_TEXTO: lo que cabe entero en una tarjeta (lo antiguo, más largo, se corta con «…»)
  var MAX_MENSAJE = 200; // igual que el límite del mural (bd/schema.sql)
  var MENSAJE_VACIO = "Escanea el QR y comparte un mensaje o una reflexión";
  var MENSAJE_VACIO_EN = "Scan the QR and share a message or a reflection";

  var estado = {
    elementos: [],
    paginas: [],      // [{tipo, titulo, elementos}] agrupadas por pregunta
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
      var es = tipo === "reflexion" && e.pregunta_es ? String(e.pregunta_es).trim() : "";
      var en = tipo === "reflexion" && e.pregunta_en ? String(e.pregunta_en).trim() : "";
      limpias.push({ clave: clave, tipo: tipo, titulo: titulo, texto: texto, es: es, en: en,
        pn: e.pregunta_id == null ? null : Number(e.pregunta_id) });
    }
    return limpias;
  }

  function longitud(e) {
    var n = Math.min(e.texto.length, e.tipo === "mensaje" ? MAX_MENSAJE : MAX_TEXTO);
    return n <= CORTA ? "corta" : n <= MEDIA ? "media" : "larga";
  }

  // Agrupa por pregunta (en el orden en que aparece cada una: lo más reciente primero) y
  // reparte cada grupo en páginas de PESO_POR_PAGINA. Los mensajes del mural, en su propio grupo.
  function construirPaginas(elementos) {
    var grupos = [];
    var porClave = {};
    elementos.forEach(function (e) {
      var clave = e.tipo === "mensaje" ? "\u0000mensajes" : e.titulo;
      if (!porClave[clave]) {
        porClave[clave] = { tipo: e.tipo, titulo: e.tipo === "mensaje" ? TITULO_MENSAJES : e.titulo,
          es: e.es, en: e.en, pn: e.pn, elementos: [] };
        grupos.push(porClave[clave]);
      }
      porClave[clave].elementos.push(e);
    });
    var paginas = [];
    grupos.forEach(function (g) {
      var actual = null;
      var peso = 0;
      g.elementos.forEach(function (e) {
        var p = longitud(e) === "larga" ? 2 : 1;
        if (!actual || peso + p > PESO_POR_PAGINA) {
          actual = { tipo: g.tipo, titulo: g.titulo, es: g.es, en: g.en, pn: g.pn, elementos: [] };
          paginas.push(actual);
          peso = 0;
        }
        actual.elementos.push(e);
        peso += p;
      });
    });
    return paginas;
  }

  function totalPaginas() {
    return Math.max(1, estado.paginas.length);
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
      var cabecera = document.createElement("header");
      cabecera.className = "foro-cabecera";
      var etiqueta = document.createElement("p");
      etiqueta.className = "foro-etiqueta";
      etiqueta.textContent = "Reflexiones / Reflections";
      var pregunta = document.createElement("h2");
      pregunta.className = "foro-pregunta";
      cabecera.appendChild(etiqueta);
      cabecera.appendChild(pregunta);
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

  // Tarjeta de una respuesta (la pregunta va arriba, en la cabecera de la página).
  function crearTarjeta(elemento) {
    var tarjeta = document.createElement("article");
    tarjeta.className = "foro-tarjeta foro-tarjeta--" + elemento.tipo + " foro-tarjeta--" + longitud(elemento);
    if (elemento.clave != null) tarjeta.dataset.id = elemento.clave;
    var texto = document.createElement("p");
    texto.className = "foro-texto";
    texto.textContent = recortar(elemento.texto, elemento.tipo === "mensaje" ? MAX_MENSAJE : MAX_TEXTO);
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

  // La pregunta en las dos lenguas a la vez: español arriba (grande) e inglés debajo (más pequeño).
  // Si el texto es largo (la pregunta 4) se reduce la letra hasta que quepa sin desbordar.
  function pintarPregunta(h2, pagina) {
    h2.textContent = "";
    var es = document.createElement("span");
    es.className = "foro-pregunta-es";
    es.textContent = pagina.tipo === "mensaje" ? recortar(pagina.titulo, MAX_TITULO) : (pagina.es || recortar(pagina.titulo, MAX_TITULO));
    h2.appendChild(es);
    if (pagina.en) {
      var en = document.createElement("span");
      en.className = "foro-pregunta-en";
      en.lang = "en";
      en.textContent = pagina.en;
      h2.appendChild(en);
    }
    h2.style.removeProperty("--foro-pregunta-escala");
    var escala = 1;
    var maxAlto = window.innerHeight * 0.34;   // alto máximo de la pregunta (ES + EN)
    while (h2.scrollHeight > maxAlto && escala > 0.4) {
      escala -= 0.05;
      h2.style.setProperty("--foro-pregunta-escala", escala.toFixed(2));
    }
  }

  // Pinta la página actual (sin animación).
  function pintarPagina() {
    var vista = prepararVista();
    if (!vista) return;
    var zona = vista.querySelector(".foro-tarjetas");
    var pregunta = vista.querySelector(".foro-pregunta");
    zona.textContent = "";

    if (estado.paginas.length === 0) {
      pregunta.textContent = "";
      pregunta.hidden = true;
      pintarVacio(zona);
    } else {
      var pagina = estado.paginas[estado.pagina];
      pregunta.hidden = false;
      pintarPregunta(pregunta, pagina);
      pregunta.classList.toggle("foro-pregunta--mensajes", pagina.tipo === "mensaje");
      var visibles = pagina.elementos;
      // 1-3 respuestas en una fila; 4, en 2 × 2 (así la letra puede ser más grande)
      zona.style.setProperty("--foro-columnas", visibles.length === 4 ? 2 : visibles.length);
      for (var i = 0; i < visibles.length; i++) zona.appendChild(crearTarjeta(visibles[i]));
    }
    pintarPuntos(vista);
  }

  // Pasa a la siguiente página con un fundido.
  function siguientePagina() {
    var vista = contenedor();
    var zona = vista && vista.querySelector(".foro-tarjetas");
    var anterior = estado.paginas[estado.pagina];
    var indiceNuevo = (estado.pagina + 1) % totalPaginas();
    var nueva = estado.paginas[indiceNuevo];
    // Cambio de pregunta: pantalla de transición con el número de la pregunta que viene.
    var tr = window.pantallaTransicion;
    if (tr && tr.activa() && anterior && nueva && nueva.tipo === "reflexion" && anterior.titulo !== nueva.titulo && nueva.pn) {
      if (!tr.enCurso()) {
        tr.ir({ pregunta: nueva.pn }, function () {
          estado.pagina = Math.min(indiceNuevo, totalPaginas() - 1);
          pintarPagina();
        });
      }
      return;
    }
    estado.pagina = indiceNuevo;
    if (!zona) { pintarPagina(); return; }
    vista.classList.add("foro-cambiando");
    setTimeout(function () {
      pintarPagina();
      vista.classList.remove("foro-cambiando");
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

  // Tiempos del panel (los aplica pantalla.js). Si cambia el ritmo, se rehace el temporizador.
  function configurarForo(opciones) {
    var s = opciones && Number(opciones.segundosPorPagina);
    if (!(s > 0) || s === SEGUNDOS_POR_PAGINA) return;
    SEGUNDOS_POR_PAGINA = s;
    if (estado.temporizador) {
      clearInterval(estado.temporizador);
      estado.temporizador = null;
      ajustarRotacion();
    }
  }
  window.configurarForo = configurarForo;

  function pintarForo(elementos) {
    var nuevas = normalizar(elementos);
    var firma = JSON.stringify(nuevas);

    // Mismos datos que la última vez (refresco de T04 cada 10 s): no se toca nada.
    if (firma === estado.firma && contenedor() && contenedor().querySelector(".foro-tarjetas")) {
      return;
    }
    estado.firma = firma;
    estado.elementos = nuevas;
    estado.paginas = construirPaginas(nuevas);

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
      ["¿Qué piensas de la utilidad del feminismo hoy en día?", "Necesario"],
      ["¿Cómo actuarías tú en ese lugar?", "Llamaría a la policía y me quedaría con ella hasta que llegara ayuda."],
      ["¿Qué le dirías a una persona que está pasando algo así?", "No estás sola. Te creo."],
      ["¿Son útiles los teléfonos de ayuda, los puntos morados y medidas similares?", "Sí, aunque mucha gente no sabe que existen. Habría que darlos a conocer más en los institutos y en las fiestas de los pueblos."],
      ["¿Crees que estas situaciones siguen pasando hoy en día?",
        "Este es un texto deliberadamente largo para comprobar que la tarjeta lo recorta con puntos " +
        "suspensivos y que se sigue leyendo bien desde el fondo de la sala. La violencia de género no " +
        "es un problema privado: es un problema social que nos afecta a todas y a todos, y que solo " +
        "se resuelve con educación, con igualdad real y con el compromiso diario de cada persona de " +
        "no mirar hacia otro lado cuando ve algo que no está bien. <b>Esto no debe salir en negrita</b>."],
      ["¿Qué piensas de la utilidad del feminismo hoy en día?", "Útil"],
      ["¿Cómo actuarías tú en ese lugar?", "Policía"]
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
        lista.push({ tipo: "reflexion", id: i + 1, titulo: e[0], texto: e[1] });
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
