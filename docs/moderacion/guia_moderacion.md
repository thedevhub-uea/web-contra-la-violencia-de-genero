# Guía de moderación para la pantalla del 25N

El léxico adjunto sirve para decidir qué mensajes no pasan directamente a la pantalla, no para decidir quién está agrediendo a quién. La revisión debe distinguir entre un ataque, un relato que lo cita, un mensaje que lo condena y una petición de ayuda. Esta distinción coincide con las categorías de intención de [EXIST, UNED](https://nlp.uned.es/exist2024/) y con las pruebas de cita, negación y contramensaje de [Multilingual HateCheck](https://ar5iv.labs.arxiv.org/html/2206.09917).

## Importar sin activar las excepciones

| Tipo de línea | Acción en el sistema |
|---|---|
| `"palabra" # categoría \| significado \| riesgo` | Coincidencia de palabra completa. Envía a revisión humana, no a borrado. |
| `"familia*" # ...` | Prefijo al principio de una palabra, no subcadena en medio. Las familias amplias y problemáticas, como `maric*`, están desactivadas: la importación básica usa formas exactas en su lugar. |
| `varias palabras # ...` | Frase literal con límites externos y tratamiento coherente de espacios. No se requieren comillas. |
| `#? término # ...` | Regla contextual desactivada en la importación básica. Puede incorporarse si hay un objetivo, un segundo indicio, un marco lingüístico claro o una regla contextual específica. |
| `#! término # ...` | Control de falso positivo o excepción a una señal concreta. Nunca autoriza automáticamente el mensaje completo. |
| `# emoji \| nombre \| motivo \| a/b/c` | Tabla de referencia. No importarla como una lista textual de bloqueo. Los nombres son los cortos de [Unicode CLDR](https://www.unicode.org/emoji/charts-17.0/full-emoji-list.html); las combinaciones anotan los nombres de sus elementos. |

Para la importación básica, omite líneas vacías y toda línea que empiece por `#`. Divide cada línea restante en el primer ` # `; conserva exactamente el texto de la izquierda y lee a la derecha los tres campos delimitados por ` | `. Quita las comillas tras interpretar si la regla lleva prefijo. El riesgo es una estimación cualitativa de ambigüedad, no una tasa medida ni una medida de gravedad.

La lista prioriza España y América Latina. Los bloques de francés e inglés cubren las entradas más útiles para mensajes mezclados; el muestreo de francés africano se limita principalmente a Costa de Marfil y no representa todas las variedades del continente. Los repertorios de [ASALE](https://www.asale.org/obras-academicas/diccionarios/diccionario-de-americanismos), [Usito](https://usito.usherbrooke.ca/articles/th%C3%A9matiques/vincent_1) y [Ofcom](https://www.ofcom.org.uk/tv-radio-and-on-demand/broadcast-standards/offensive-language) tienen propósitos y poblaciones distintos. La lista es amplia, pero no exhaustiva en sentido estricto: conviene añadir variantes observadas por moderación local, sin copiar sin revisión los vocabularios de captura de [ALRECO](https://www.inclusion.gob.es/oberaxe/alreco/ficheros/PROTOCOLO-ALRECO.pdf) ni los listados de autocompletado de [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words).

## Decidir qué se proyecta

| Cola | Qué la activa | Decisión recomendada |
|---|---|---|
| **Urgente y privada** | Amenaza creíble o inmediata, violencia en curso, coacción sexual, indicios de autolesión inminente o datos privados acompañados de hostigamiento. | No proyectar. Avisar enseguida al equipo responsable y aplicar el protocolo del campus. No esperar al ritmo de la cola ordinaria. |
| **Revisión antes de proyectar** | Insultos dirigidos, degradación de un grupo, mofa de víctimas, sexualización no solicitada, apología de agresión, una coincidencia activa del léxico, una acusación identificable o un relato gráfico. | Distinguir ataque de cita, testimonio o contramensaje. Si procede publicar, hacerlo sin datos identificativos ni detalles gráficos; no reescribir ni atribuir a la persona un mensaje modificado sin su permiso. |
| **Señal contextual** | Sigla ambigua, número corriente, identidad mencionada, emoji aislado o variante débil. | No detener por sí sola. Retener si hay un segundo indicio pertinente, como una orden hostil dirigida a alguien, una combinación gráfica explícita o un símbolo acompañado de una consigna. |

- **Medidas fuera del léxico:** Retén por separado teléfonos, correos privados, direcciones, identificadores, nombres vinculados a acusaciones, llamadas a hostigar a alguien y supuestas imágenes íntimas. Los detectores deben permitir excepciones limitadas para contactos públicos verificados, como el 016; una excepción de contacto no hace seguro el resto del mensaje ([política de acoso de YouTube](https://support.google.com/youtube/answer/2802268?hl=en); [servicio 016](https://violenciagenero.igualdad.gob.es/informacion-3/recursos/telefono016/)).
- **Amenazas y peticiones de ayuda:** «Te voy a matar» y «Mi pareja me dijo “te voy a matar”» llegan a revisión, pero no se tramitan igual. La primera puede ser una amenaza del remitente; la segunda puede ser un testimonio o una petición de ayuda. Si hay peligro inmediato en España, contacta con el **112**; el **016** y su WhatsApp **600 000 016** ofrecen información y atención especializada, no sustituyen a emergencias ([Delegación del Gobierno contra la Violencia de Género](https://violenciagenero.igualdad.gob.es/informacion-3/recursos/telefono016/)).
- **Crítica frente a hostigamiento:** No retengas por sí solas la crítica a una ley, la expresión «denuncias falsas» ni las palabras «violación», «maltrato», «víctima» o «acoso». La Fiscalía usa «denuncia falsa» como expresión jurídica; el estudio de `#STOPfeminazis` también documenta mensajes que citan la etiqueta para responder al ataque ([Memoria de la Fiscalía](https://www.fiscal.es/memorias/memoria2026/FISCALIA_SITE/capitulo_III/cap_III_1_4.html); [Villar-Aguilés y Pecourt Gracia](https://dialnet.unirioja.es/descarga/articulo/7739317.pdf)).
- **Pantalla en directo:** Si una sola publicación dañina tiene un coste alto, aplica premoderación humana a todos los envíos y usa el léxico para ordenarlos por prioridad. Si no hay capacidad para cubrir toda la cola, es preferible demorar la pantalla o mostrar mensajes aprobados previamente; ante fallo del filtro, no publiques automáticamente. Informa en el formulario de qué se muestra en público y ofrece una vía privada para pedir ayuda.

## Números, símbolos y emojis

No hay un número ni un emoji que recomiende descartar definitivamente solo por coincidir. `1488`, `14/88`, `14-88` y `8814` están en la cola de revisión por ser combinaciones documentadas; `14`, `18`, `28`, `88`, `311` y `69` son señales contextuales por sus usos comunes o ajenos al odio. `卐` y `卍` justifican revisar la proyección, no presumir intención nazi: hay usos religiosos, históricos y culturales ([ADL, 1488](https://www.adl.org/resources/hate-symbol/1488); [ADL, 88](https://www.adl.org/resources/hate-symbol/88); [ADL, 18](https://www.adl.org/resources/hate-symbol/18); [ADL, 28](https://www.adl.org/resources/hate-symbol/28); [ADL, 311](https://www.adl.org/resources/hate-symbol/311); [Merriam-Webster, sixty-nine](https://www.merriam-webster.com/dictionary/sixty-nine); [ADL, esvástica](https://dc.adl.org/resources/hate-symbol/swastika)).

En la tabla de emojis, **a** queda vacía: ni siquiera 🖕 acredita un ataque en una cita o en «🖕 al maltrato». Si la universidad quiere excluir la grosería visual aislada, se puede añadir una regla de pantalla para mensajes que solo contienen ese gesto, sin etiquetarlos como odio. **b** significa retener tras comprobar un objetivo o una combinación pertinente; **c** significa solo marcar cuando aparece aislado. Una secuencia de monos dirigida a una persona negra puede ser un ataque aunque no tenga palabras; el tono de piel de una mano o persona nunca es el criterio de gravedad ([Oversight Board, decisión sobre emojis](https://www.oversightboard.com/decision/bun-rahty4f1/)). Del mismo modo, 🍆🍑💦 o 👉👌 pueden tener sentido sexual, sin convertir una berenjena o una fruta aisladas en infracciones ([Women’s Health, usos sexuales de emojis](https://www.womenshealthmag.com/sex-and-love/g28008142/sexting-emoji/)).

## Normalización y pruebas

- **Separa vistas:** Conserva el mensaje original para revisión y otra vista para cotejo léxico. Normaliza mayúsculas, tildes y espacios en la vista de cotejo; conserva una vista sensible a `ñ` y otra para números y signos antes de tu sustitución existente. No conviertas por defecto `cono` en una ofensa ni números ordinarios en letras. Usa límites de palabra Unicode; no busques `puta` como subcadena ni unas todos los espacios del mensaje ([Unicode UAX #29](https://www.unicode.org/reports/tr29/)).
- **Acota la detección de variantes:** Aplica uniones de letras, repeticiones, inversión y equivalencias visuales solo contra candidatos concretos. No recurras a distancia de edición global ni a una única versión plegada de todo el texto. Los caracteres visualmente confundibles son una señal aproximada, no una normalización principal; para emojis, opera por grafemas y no borres el conector de secuencia `ZWJ` del texto original ([Unicode UTS #39](https://www.unicode.org/reports/tr39/); [Unicode UAX #29](https://www.unicode.org/reports/tr29/)).
- **Distingue reglas de contexto:** No uses una palabra de negación, comillas o una identidad legítima como permiso global: «Las mujeres no merecen vivir» contiene una negación y sigue siendo hostil. Añade a la evaluación ejemplos con negación, citas, reapropiación, mensajes de apoyo y escritura mixta, no solo ataques obvios ([Multilingual HateCheck](https://ar5iv.labs.arxiv.org/html/2206.09917)).

| Ejemplo sintético | Resultado esperado |
|---|---|
| «La computadora de Maricarmen» | Sin alerta léxica. No buscar subcadenas ni activar `maric*` por defecto. |
| «No fue tu culpa. Yo también sufrí acoso» | Sin alerta por las palabras de la campaña. |
| «Quiero que hablemos de denuncias falsas con datos» | Señal contextual como máximo; sin retención léxica automática. |
| «Las víctimas se lo inventan» | Revisión por culpabilización; no descartar sin valorar si es una cita. |
| «Estoy con mi compañera. Tengo 18 años» | Sin alerta por `con` ni por `18`. |
| «Puta caso che lui non arrivi» | La regla `puta` salta en la importación básica. Suprime solo esa coincidencia si se reconoce la locución italiana y el contexto lo confirma ([Treccani](https://www.treccani.it/vocabolario/putacaso/)). |
| «p u t a» | Revisión por variante fragmentada. |
| «Te voy a ma tar» | Revisión por amenaza fragmentada; prioridad al valorar destinatario y riesgo. |
| «Mi ex me dijo “si denuncias te mato”» | Revisión privada del contexto; no sancionar a quien relata la amenaza. |
| «El edificio se construyó en 1488» | Coincidencia y revisión en la importación básica; aprobar por contexto histórico. |
| «Berenjenas al horno 🍆» | Marca no decisoria como máximo. |
| «¿Taller de nudos? 🪢» | Marca no decisoria como máximo. |
| «Receta de berenjena y melocotón 🍆🍑» | No inferir acoso del par sin contexto sexual o destinatario. |
| «Llama al 016 si necesitas información» | No retener por el número de ayuda. |

Antes del directo, revisa una muestra de lo que el sistema dejaría pasar, además de lo retenido: así podrás ver tanto las omisiones como el exceso de alarmas. Incluye mensajes de prueba por variedad lingüística y vigila especialmente cuántos testimonios legítimos se retienen y el tiempo que tardan en llegar a moderación.
