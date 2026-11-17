# FEEDBACK · versión navegador v0.2

Aplicación 100 % estática (HTML + JS). No hay servidor: PDF.js lee los PDF, Tesseract.js hace el OCR y el índice se guarda en el navegador (IndexedDB).
**Los documentos nunca salen del equipo y nunca se suben a GitHub.** La carpeta se abre en solo lectura.

## Publicar con GitHub Pages
1. Crear un repositorio y subir el contenido de esta carpeta (`index.html`, `style.css`, `js/`, `vendor/`, `.nojekyll`). **Solo código: nunca documentos.**
2. Repositorio → *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main, carpeta /(root) → Save*.
3. Abrir la URL que indique Pages (`https://USUARIO.github.io/REPOSITORIO/`) en **Edge o Chrome**, en casa y en el trabajo.
   Cada equipo/navegador guarda su propio índice: son independientes.

Prueba en local (opcional): `python -m http.server 8000` en esta carpeta y abrir http://localhost:8000

## Uso
1. **Añadir carpeta…** → una o varias (p. ej. una de documentos y otra de correos `.msg`/`.eml`; también pueden estar mezclados). Se recorren las subcarpetas; los archivos ya indexados se saltan y los modificados se reindexan. La ✕ quita una carpeta y sus documentos del índice (no toca el disco).
2. **Archivos sueltos:** arrastrar, Ctrl+V o seleccionar. Se guarda una copia del original en el navegador.
3. **Buscar:** texto sin distinguir tildes, "frase exacta", tipo y fecha del archivo. Clic en el nombre → abre el original en la página del resultado (PDF).
4. Al volver otro día: *Buscar archivos nuevos o modificados* pide un clic para reconceder permiso a la carpeta.

## Correos de Outlook (.msg y .eml)
- Se pueden **arrastrar directamente desde Outlook de escritorio** a la zona de entrada (se recibe como `.msg`). También `.eml`, o desde una carpeta.
- Se indexan asunto, remitente, destinatarios, fecha y cuerpo (texto; si solo hay HTML, se convierte a texto). Filtros por **asunto** y **remitente**.
- Los adjuntos PDF/imagen se indexan como documentos propios, enlazados al correo (heredan asunto, remitente y fecha). Las imágenes pequeñas incrustadas (firmas/logos) y los formatos no indexables (Word, Excel, zip…) se omiten y se listan en el detalle del correo.
- "Abrir original" descarga el `.msg/.eml` para abrirlo en Outlook (el navegador no muestra correos).
- Un adjunto idéntico a un documento ya indexado se registra como duplicado y no se vuelve a indexar (el correo enlaza al documento existente).
- Si Outlook (p. ej. el "nuevo Outlook" o la versión web) no entrega ningún archivo al arrastrar, guarda el correo como `.msg`/`.eml` o PDF y arrástralo.

## Qué hace con cada archivo
- PDF: texto nativo por página; si hay <20 caracteres, rasteriza a 300 dpi y aplica OCR (spa+eng).
- Imágenes (JPG, PNG, TIFF multipágina): gris, contraste, reescalado si es pequeña y enderezado; cada paso se registra y se ve en el detalle.
- Duplicados exactos (SHA-256) y errores: registro visible. Confianza de OCR por página; <60 % → aviso.
- Nombre automático asignado (solo informativo en archivos de carpeta: no se renombra nada en tu disco).

## Límites conocidos
- Solo Edge/Chrome (API de carpetas). Si IT la bloquea, queda arrastrar/pegar/seleccionar.
- OCR más lento que Tesseract nativo (varios segundos por página escaneada).
- No corrige giros de 90°/180° ni quita ruido avanzado; el OCR no mide geometría.
- Pegado desde Teams entrega una imagen posiblemente recomprimida: comprobar resolución (pruebas del apartado 4).
- Un TIFF no se visualiza en el navegador: se ofrece la versión procesada.
- Si se borran los datos del sitio, se pierde el índice (no los originales de la carpeta): reindexar.
- Sin clasificación técnica, IA, Outlook, Graph/SharePoint (fases 4-6).
