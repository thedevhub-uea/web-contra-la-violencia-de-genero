# Moderación: léxico del filtro automático (#34)

| Archivo | Qué es |
|---|---|
| `lexico_25n.txt` | **Fuente** del filtro: insultos, amenazas, siglas y variantes en español, francés e inglés, con categoría, significado y riesgo de falso positivo. |
| `guia_moderacion.md` | Criterios para decidir qué se proyecta (ataque frente a cita, testimonio o petición de ayuda), números, símbolos y emojis. |
| `../../bd/filtros_iniciales.txt` | Lista que carga el filtro. **Se genera** desde el léxico: no la edites a mano. |

## Formato del léxico

```
"palabra" # categoría | significado | riesgo      ← retener: el mensaje no sale hasta que se apruebe
"familia*" # ...                                   ← retener, cualquier palabra que empiece así
varias palabras # ...                              ← retener, expresión completa
#~ "palabra" # ...                                 ← cuarentena: se retiene, avisando de posible falso positivo
#? "palabra" # ...                                 ← contextual: NO se carga (demasiado ambigua sola)
#! "palabra" # ...                                 ← excepción: nunca se retiene (y es prueba negativa)
# 🍑 | peach | motivo | a/b/c                      ← tabla de emojis: solo referencia (#36)
```

### Retener, cuarentena y excepción

| Tipo | En el panel | Qué pasa con el mensaje |
|---|---|---|
| Retener | ficha normal | No sale en pantalla. Motivo: «Palabra filtrada: «x»». |
| Cuarentena | ficha con borde ámbar discontinuo | Tampoco sale, pero el motivo dice «Cuarentena (puede ser un falso positivo): «x»» y se ve en gris: casi siempre se podrá aprobar. Para palabras ambiguas: `puto` («el puto machismo»), `perra`, `bollera`, `maric*`… |
| Excepción | ficha con borde verde discontinuo | Esa palabra (o expresión) nunca cuenta, aunque otro término la cubra: `maricarmen`, `maricruz`, `maricultura` frente a `maric*`. |

Un prefijo ambiguo (`maric*`, `negrat*`, `retrasad*`) va en cuarentena y sus colisiones conocidas
como excepciones: ese es el «segundo filtro». La longitud de la palabra no sirve para separarlos
(«maricona» y «Maricela» tienen las dos 8 letras). El generador solo carga las excepciones `#!` de
una palabra que algún término retendría; las de varias palabras (`puta caso`, que solo es inocente en
italiano) se quedan como pruebas.

- Sin tildes ni mayúsculas. No hace falta escribir plurales ni trucos (`z0rra`, `p.u.t.a`,
  `putaaa`, `p u t a`): el filtro ya los cubre. El generador quita los términos que sobran.
- El riesgo (bajo/medio/alto) es la probabilidad de que la palabra aparezca en un mensaje
  legítimo, no su gravedad. Si es **alto**, no la pongas activa: cuarentena (`#~`) si quieres que
  moderación la vea, contextual (`#?`) si saltaría con demasiados mensajes normales.
- Cuidado con los prefijos (`*`): sin excepciones, `maric*` retendría «Maricarmen». Mejor formas
  exactas; si hace falta el prefijo, en cuarentena y con sus excepciones `#!`.
- Números, símbolos y emojis (`1488`, `卐`, `🍆🍑`) todavía no los admite el filtro: se quedan en el
  léxico como referencia hasta el #36.

## Añadir o quitar un término

1. Edita `lexico_25n.txt` en la sección que toque (o cambia el tipo de una línea: activa, `#~`, `#?`).
2. Si es una palabra que **no** debe saltar, añádela como `#! "palabra" # motivo | ... | alto`:
   pasa a ser una prueba negativa.
3. Genera la lista y pasa las pruebas:

   ```bash
   python herramientas/generar_filtros.py     # reescribe bd/filtros_iniciales.txt
   python herramientas/probar_filtro.py       # pruebas positivas y negativas
   ```

4. Sube los tres archivos (`lexico_25n.txt`, `bd/filtros_iniciales.txt` y, si las tocaste, las pruebas).

## Llevar la lista a una base de datos que ya existe (producción)

`bd/filtros_iniciales.txt` solo se carga la **primera vez** que se crea la base de datos. En el servidor:

```bash
python herramientas/generar_filtros.py --bd
```

Añade los términos que falten y cambia el tipo de los que lo tengan distinto (p. ej. `puto` pasa de
retener a cuarentena), **sin borrar nada** (lo añadido a mano desde el panel se conserva), y lista los
que están en la base de datos pero no en la lista, para quitarlos desde `/admin` si se decide. Para un
término suelto basta con el panel (`/admin`, «Filtro automático»: el desplegable elige retener,
cuarentena o excepción).

## Fuentes

Las fuentes de cada bloque están en el propio léxico, junto a su título. Parte de la selección viene
de [LDNOOBW](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(Shutterstock, Inc., CC BY 4.0), adaptada y comentada.
