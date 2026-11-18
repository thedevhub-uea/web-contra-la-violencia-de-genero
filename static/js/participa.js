/* T06 — Contador de caracteres del formulario /participa (opcional).
   Si este archivo no carga, los formularios siguen funcionando. */
document.querySelectorAll('[data-contador]').forEach(function (campo) {
  var contador = document.getElementById(campo.dataset.contador);
  var maximo = campo.maxLength;
  function actualizar() {
    var usados = campo.value.length;
    contador.textContent = usados + ' / ' + maximo;
    contador.classList.toggle('cerca', maximo - usados <= Math.max(10, maximo * 0.1));
  }
  campo.addEventListener('input', actualizar);
  actualizar();
});

// /participa#foro abre directamente la pestaña de reflexión.
function abrirPestanaDelHash() {
  if (location.hash === '#foro') document.getElementById('tab-foro').checked = true;
  if (location.hash === '#mural') document.getElementById('tab-mural').checked = true;
}
abrirPestanaDelHash();
window.addEventListener('hashchange', abrirPestanaDelHash);

// En el título, «Intro» (tecla «Siguiente» del móvil) pasa al texto en vez de enviar
// el formulario a medias.
var titulo = document.getElementById('foro-titulo');
if (titulo) {
  titulo.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      document.getElementById('foro-texto').focus();
    }
  });
}
