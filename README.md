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
- **Arrastrar un correo directamente desde Outlook al navegador no funciona** (el navegador no recibe archivo). Vías que sí funcionan:
  1. En Outlook, selecciona los correos y arrástralos a una carpeta abierta en el **Explorador de Windows**: se crean archivos `.msg`. Esa carpeta se añade con **Añadir carpeta…** (o se arrastran los `.msg` desde el Explorador a la zona de entrada).
  2. Script `guardar_correos_outlook.js`: en Outlook clásico selecciona los correos y haz **doble clic** en el archivo; guarda cada uno como `.msg` en la carpeta indicada (variable `CARPETA`).
  3. **Automático (recomendado):** `exportar_carpeta_outlook.js`. Crea en Outlook una carpeta llamada `FEEDBACK`, edita `DESTINO` en el script y haz doble clic: queda en segundo plano y guarda como `.msg` todo correo que **arrastres a esa carpeta dentro de Outlook**. Para que arranque con Windows: `Win+R` → `shell:startup` → pega un acceso directo al script. Para pararlo: crea un archivo vacío `.parar` en `DESTINO`.
  En la app, activa **Reescanear automáticamente** (sección 1) para que los correos nuevos se indexen solos mientras la pestaña esté abierta (la primera vez de cada sesión hay que pulsar «Buscar nuevos o modificados» para conceder permiso a las carpetas).
  Todos estos scripts requieren Outlook clásico (no el «nuevo Outlook») y que IT no bloquee Windows Script Host.
- Se indexan asunto, remitente, destinatarios, fecha y cuerpo (texto; si solo hay HTML, se convierte a texto). Filtros por **asunto** y **remitente**.
- Los adjuntos PDF/imagen se indexan como documentos propios, enlazados al correo (heredan asunto, remitente y fecha). Las imágenes pequeñas incrustadas (firmas/logos) y los formatos no indexables (Word, Excel, zip…) se omiten y se listan en el detalle del correo.
- "Abrir original" descarga el `.msg/.eml` para abrirlo en Outlook (el navegador no muestra correos).
- Un adjunto idéntico a un documento ya indexado se registra como duplicado y no se vuelve a indexar (el correo enlaza al documento existente).
- Si Outlook (p. ej. el "nuevo Outlook" o la versión web) no entrega ningún archivo al arrastrar, guarda el correo como `.msg`/`.eml` o PDF y arrástralo.

## Base de datos local y copia en disco
- El índice vive en el navegador (IndexedDB) **de cada equipo**; casa y trabajo son independientes. Usa siempre la **misma URL y el mismo navegador/perfil** (cada dirección y cada perfil tiene su propia base de datos; una ventana privada no guarda nada).
- Para que no se pierda de un día a otro, en *Base de datos y copia en disco* pulsa **Elegir carpeta de datos…** y elige una carpeta de ese ordenador (p. ej. `C:\FEEDBACK\datos`). Se guarda sola una copia tras cada cambio (índice, textos extraídos, marcas, registro, originales importados/adjuntos y versiones procesadas de imágenes).
- Si el navegador pierde sus datos, al abrir la app se restaura sola desde esa carpeta si ya tiene permiso, o con **Restaurar desde la carpeta**. Las carpetas de documentos aparecen como «(volver a elegir)»: elígelas de nuevo (se reconocen por su nombre) y no se reindexa nada.
- **Guardar copia completa ahora** fuerza una copia entera. Cada sesión nueva puede pedir un clic para reconceder permiso de escritura.
- Esta copia es privada de cada equipo: no la sincronices entre casa y trabajo ni la subas a GitHub.

## Adjuntos y otros documentos
- De cada correo (y de cada ZIP) se extraen **todos** los adjuntos y se indexa su contenido: PDF e imágenes (con OCR), **Word (.docx), Excel (.xlsx), PowerPoint (.pptx)**, texto/CSV/HTML/RTF, **ZIP** (un nivel) y **correos anidados** (.eml/.msg), hasta 3 niveles.
- El texto de Word/Excel/PowerPoint se extrae **directamente, sin convertir a PDF**: así no hace falta tener Office. La referencia es: hoja (Excel), diapositiva (PowerPoint), página aproximada (Word; solo si el documento guarda saltos de página) o bloque (texto). «Abrir original» descarga el archivo para abrirlo con su programa.
- Formatos antiguos (.doc, .xls, .ppt) y otros (dwg, imágenes de otros tipos…) no se pueden indexar en el navegador: se listan en el detalle del correo. Guárdalos como .docx/.xlsx/.pptx o PDF.
- Las imágenes pequeñas incrustadas (firmas/logos) se omiten.
- Lo mismo vale para archivos sueltos y para carpetas: los .docx/.xlsx/.pptx/.txt/… se indexan igual.

## Informe resumen
- En el detalle de un documento, selecciona un fragmento del texto y pulsa **★ Marcar selección como importante** (admite nota). Los puntos marcados se guardan con su página.
- Sección **4 · Informe resumen**: elige documentos con las casillas de la tabla (o usa los resultados de la búsqueda, o todos) y genera el informe. Se previsualiza en pantalla y se descarga como **.doc (Word)** o se imprime/guarda como **PDF**.
- Contenido por documento: datos de identificación (tipo, origen, fecha, asunto/remitente si es correo, calidad de OCR), **puntos marcados** y, opcionalmente, **valores y referencias detectados automáticamente** (velocidades, caudales, presiones, temperaturas, espesores, acústica, normativa, materiales, aislamiento, seguridad, montaje) con texto literal y página, más frases con carácter de requisito.
- Opcional: **cuadro comparativo** que junta los valores de distintos documentos con su fuente y fecha, **sin decidir cuál prevalece**.
- Es extracción literal, sin IA: los valores automáticos son propuestas a revisar y pueden contener errores de OCR.

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
