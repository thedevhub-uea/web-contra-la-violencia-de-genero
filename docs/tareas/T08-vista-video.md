# T08 · Video view / Vista de vídeo

## English
**Goal:** Show the awareness video on the projected screen.

**To do**
- In the video section of `templates/pantalla.html`, add `<video id="video25n" src="{{ url_for('static', filename='video/video.mp4') }}" playsinline>` (no `muted` attribute: sound is handled from `video.js`).
- Full-screen size, keeping the proportions (`object-fit: contain`), dark background.
- Expose two functions in `static/js/video.js`: `iniciarVideo()` (rewinds to 0 and plays) and `pararVideo()`.
- The `ended` event is used by T04 to move to the next view.
- **Sound (changed after the original brief, which said "no sound"):** browsers block autoplay with sound, so the video always starts muted and a notice "Pulsa para activar el sonido / Click to enable sound" is shown. The first click or key press on the page (or on the full-screen button) turns sound on for the current video and the following ones. If the browser refuses sound, it plays muted again; audio never stops the rotation. `?mudo` forces silence. For an unattended screen see `docs/DESPLIEGUE.md` (kiosk mode).

**Done when**
- The video starts by itself when its view is shown (muted until someone clicks; then with sound).
- It starts from the beginning every time.
- It fills the screen without being distorted.

---

## Español
**Objetivo:** Mostrar el vídeo de concienciación en la pantalla proyectada.

**Qué hay que hacer**
- En la sección de vídeo de `templates/pantalla.html`, añadir `<video id="video25n" src="{{ url_for('static', filename='video/video.mp4') }}" playsinline>` (sin atributo `muted`: el sonido lo gestiona `video.js`).
- Tamaño de pantalla completa manteniendo la proporción (`object-fit: contain`) y fondo oscuro.
- Exponer dos funciones en `static/js/video.js`: `iniciarVideo()` (vuelve al segundo 0 y reproduce) y `pararVideo()`.
- El evento `ended` lo usa la T04 para pasar a la siguiente vista.
- **Sonido (cambiado respecto al enunciado original, que decía «sin sonido»):** los navegadores bloquean el autoplay con sonido, así que el vídeo arranca siempre silenciado y se muestra el aviso «Pulsa para activar el sonido / Click to enable sound». El primer clic o tecla en la página (o en el botón de pantalla completa) activa el sonido en el vídeo en curso y en los siguientes. Si el navegador rechaza el sonido, se reproduce en silencio; el audio nunca para la rotación. `?mudo` fuerza el silencio. Para una pantalla desatendida, ver `docs/DESPLIEGUE.md` (modo kiosco).

**Terminado cuando**
- El vídeo arranca solo al mostrarse su vista (en silencio hasta que alguien haga clic; después, con sonido).
- Empieza siempre desde el principio.
- Ocupa la pantalla sin deformarse.
