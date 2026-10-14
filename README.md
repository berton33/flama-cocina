# FLAMA · Cocina

Web interna para consultar recetas y escalar producciones. HTML, CSS y JavaScript vanilla. Sin frameworks ni build.

## Archivos

- `recetas.json` — única fuente de datos. Gramajes, nombres, procedimientos y notas viven acá. Para cambiar un gramaje se edita este archivo y nada más.
- `index.html`, `styles.css`, `app.js` — la web. No contienen datos de recetas.

## Levantarla

El navegador bloquea la lectura de `recetas.json` si la página se abre con doble clic (protocolo `file://`). Hay que servir la carpeta por HTTP. Con Python instalado, desde la carpeta del proyecto:

```bash
python -m http.server 8123
```

Después abrir http://localhost:8123 en la PC. Para verla en el celular en la misma red Wi-Fi, usar la IP de la PC en lugar de `localhost`, por ejemplo `http://192.168.0.10:8123`.

## Publicar

Subir la carpeta tal cual a cualquier hosting estático (GitHub Pages, Netlify, Vercel, un servidor con nginx). No hay paso de build.

## Escalado

En cada producción se ingresa la cantidad total a producir, en la unidad definida por `batch.unidad_escalado` del JSON (kg para las salsas de 1 kg, g para el bacon jam). Los ingredientes y el rendimiento se recalculan proporcionalmente y se muestran redondeados a 1 decimal. Tiempos y temperaturas del procedimiento no escalan. Las sub-preparaciones mantienen sus cantidades base y muestran cuántas tandas hay que preparar.
