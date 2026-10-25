# TrimTimer

Cronómetro de speedcubing local-first. Sin cuenta, sin servidor obligatorio,
sin dependencias de build.

El nombre viene de lo que hace un `ao5`: recortar el mejor y el peor.

## Estado: fase 1

Hecho:

- Cronómetro con máquina de estados y `performance.now()`
- Scrambles de **estado aleatorio** vía cubing.js, con prefetch
- IndexedDB con esquema preparado para sincronizar desde el día uno
- Estadísticas WCA correctas (ao5, ao12, mo3, mejor ao5, mejor single)
- Penalizaciones +2 y DNF, y borrado con tombstone
- Sesiones múltiples
- Export / import JSON
- PWA instalable (manifest + service worker)
- Responsive

Siguiente:

- Inspección WCA de 15s con avisos a los 8 y 12, +2 entre 15 y 17, DNF a partir de 17
- Gráfico de evolución
- Backend de sincronización
- Envoltorio Capacitor

## Correr en local

Hace falta servirlo por HTTP: los módulos ES no cargan desde `file://`.

```sh
python3 -m http.server 8080
# http://localhost:8080
```

Para los tests de las medias, que es la parte donde más fácil es meter la pata:

```sh
node test/stats.test.mjs
```

> `package.json` existe **solo** para que node trate los `.js` como módulos ES.
> No hay dependencias. No hace falta `npm install`.

## Desplegar

Copiar los ficheros a cualquier hosting estático con HTTPS. Todas las rutas son
relativas, así que funciona igual en la raíz del dominio que en un subdirectorio
tipo `usuario.github.io/trimtimer/`.

Para que Chrome en Android genere una WebAPK (y no un simple acceso directo) hacen
falta: HTTPS, el service worker con handler de `fetch`, el manifest con `name`,
iconos de 192 y 512, y `start_url` dentro del scope. Todo está puesto.

## Atajos

| Tecla | Qué hace |
|---|---|
| `Espacio` | Mantener hasta verde, soltar para arrancar. Cualquier tecla para parar. |
| `2` | Alterna +2 en el último solve |
| `D` | Alterna DNF en el último solve |
| `Supr` / `Retroceso` | Borra el último solve |

## Decisiones que no son obvias

**El tiempo crudo y la penalización se guardan por separado.** Si guardas 12.34
con el +2 ya aplicado, no puedes quitarlo cuando te des cuenta del error.

**Los scrambles son de estado aleatorio, no de movimientos aleatorios.** Veinte
movimientos al azar están sesgados y a veces dejan el cubo medio resuelto, con lo
que tus tiempos dejan de ser comparables. Hay un generador de respaldo por si
cubing.js no carga, y la interfaz avisa cuando está activo.

**Cada solve lleva UUID generado en cliente.** Así dos dispositivos nunca colisionan
al insertar, y añadir sincronización después es aditivo en lugar de una reescritura.

**El orden lo asignará el servidor, no el reloj del cliente.** Ordenar por timestamps
de dispositivos con relojes desfasados pierde ediciones en silencio.

**La sincronización nunca está en el camino de la UI.** Se graba en IndexedDB, se
pinta, y se lanza el envío sin `await`. Si falla, queda pendiente y no se pierde nada.

## Pendiente antes de producción

- [ ] **Vendorizar cubing.js.** Ahora tira de `cdn.cubing.net`. Una CDN también es
      cadena de suministro, y dentro del WebView de Capacitor no hay red garantizada.
      Descargar el bundle una vez, meterlo en `vendor/` y cambiar el import en
      `js/scramble.js`.
- [ ] Montar el endpoint `/sync` y rellenar el intercambio en `js/sync.js`.

## Copia de seguridad

Los tiempos viven en IndexedDB, en este navegador y en este origen. Eso significa:

- Limpiar los datos del navegador los borra.
- Cambiar de dominio los deja atrás (otro origen, otro almacenamiento).
- El navegador puede desalojarlos bajo presión de disco. La app pide
  `navigator.storage.persist()` al arrancar para evitarlo; en Ajustes puedes ver
  si está concedido.

**Exporta de vez en cuando.** Es lo único que te protege de todo lo anterior.
