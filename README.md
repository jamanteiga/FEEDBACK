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

## Informes en .docx, .pdf y .xlsx
En «4. Informe resumen» elige el alcance (seleccionados / resultados de la búsqueda / todos) y descarga: **.docx** (Word), **.pdf**, **.xlsx** (hojas: Resumen, Puntos marcados, Valores detectados, Frases requisito, Comparativo, Método). Se generan en el navegador, sin IA ni servicios externos. El PDF usa fuente estándar: caracteres fuera de Latin-1 pueden sustituirse por «?».

## Índice completo en .json
Botón «💾 Guardar índice completo (.json)» (encima de los resultados y en «Base de datos y copia en disco»). Contiene documentos, texto extraído/corregido, etiquetas, notas y puntos marcados; no los archivos originales. «Importar índice…» lo carga en otro equipo. Además, la carpeta de datos guarda una copia automática por documento.

## Editar, eliminar y reindexar
En el detalle de un documento («ver / editar»): título, etiquetas, nota, datos del correo y **corrección del texto** de cada parte (p. ej. errores de OCR; se conserva el original y puede restaurarse). **Eliminar del índice** quita el documento y sus adjuntos de búsquedas e informes sin borrar ningún archivo del disco; los de carpeta quedan como «excluido» y se pueden **restaurar**. **Reindexar** vuelve a leer el original (se conservan título, etiquetas, nota y marcas; se pierden las correcciones de texto). Tras cada cambio se refrescan la búsqueda y el informe abierto. Nuevo filtro «Título/etiqueta contiene…».

## Novedades v0.11
- **Proyectos/buques**: selector en la cabecera (＋ para crear). Cada documento y carpeta pertenece a un proyecto; búsquedas, panel e informes se limitan al proyecto activo (o «Todos»). Se puede cambiar el proyecto de un documento en «✎ Editar este documento».
- **Requisitos y su estado** (sección 5): desde el detalle («☑ Añadir selección como requisito»), desde un punto marcado («→ requisito») o desde la revisión de valores. Estados pendiente/aceptado/descartado/conflicto, concepto y nota; los fijas tú. Se incluyen en el informe y se descargan en .xlsx. Si se elimina el documento de origen, el requisito queda marcado «origen eliminado» y sale del informe.
- **Revisión de valores y posibles discrepancias** (sección 6): valores literales agrupados por magnitud y unidad, con aviso cuando aparecen cifras distintas en documentos distintos. Filtro por texto y por rango (`8-12 m/s`, `>=250 Pa`, `<45 dB`). No decide cuál prevalece.
- **Búsquedas guardadas** con aviso de documentos nuevos desde la última vez; **sinónimos editables** (caudal = flujo…, m3/h = m³/h); orden por relevancia o fecha; agrupar por documento; contadores por tipo; **hilos de correo**.
- **Visor integrado**: «abrir original» de un PDF lo muestra en la página exacta con los términos buscados resaltados (solo PDF con texto; no en imágenes).
- **Revisión de OCR dudoso**: imagen a la izquierda, texto editable a la derecha, página a página.
- **Informe con plantilla**: empresa, nº de proyecto, revisión (botón «Nueva revisión»), autor y logotipo, por proyecto; salen en HTML, .docx, .pdf y .xlsx.
- **Registro de cambios**: quién/cuándo importó, editó, eliminó, reindexó o exportó (indica tu nombre en la cabecera); descargable en .csv y guardado en la carpeta de datos.
- **Copia cifrada**: «🔒 Guardar índice cifrado (.fbk)» (AES-256-GCM, clave por contraseña). Sin la contraseña no se puede recuperar. Para importarlo, escribe antes la contraseña.
- **Panel de inicio** con totales y aviso de copia en disco ausente o antigua; **modo oscuro**; **atajos**: `/` buscar, `Alt+R` informe de resultados, `Alt+G` guardar índice, `Esc` cerrar.
- **Instalable (PWA)** y utilizable sin conexión tras la primera carga (Edge/Chrome: menú ⋯ → Aplicaciones → Instalar este sitio como aplicación). Las actualizaciones llegan solas al recargar.
- La página ya no se bloquea tanto al indexar lotes grandes (PDF.js y el OCR ya iban en hilos aparte; ahora se cede el control entre páginas). No se han movido a hilos aparte la lectura de Office/correo.

## Novedades v0.12
- **Versiones de la copia**: en la carpeta de datos se guardan instantáneas comprimidas del índice (`versions/`, las últimas 7; una automática cada 6 h al guardar y otra manual con «Guardar versión ahora»). «Restaurar esta versión» vuelve atrás (antes guarda una versión de seguridad del estado actual). No incluyen los originales.
- **Requisitos vinculados**: cada requisito puede vincularse a equipos, sistemas, planos o cálculos (✎ en «Vinculado a»), con responsable y fecha límite. Vista «por vinculación» (cuántos abiertos hay en cada sistema), filtros de abiertos/vencidos/próximos 14 días y aviso de vencidos en el panel. Salen en el informe y en el .xlsx de requisitos.
- **Comparar versiones**: marca 2 documentos en la tabla y pulsa «Comparar versiones»: líneas añadidas/eliminadas y valores técnicos que cambian (literal, sin interpretar). Descargable en .xlsx.
- **Comprobar integridad**: detecta documentos de carpeta modificados o desaparecidos y originales importados que no están en este navegador; ofrece reindexar o eliminar.

## Novedades v0.13 (según tu fichero de feedback)
- **OCR automático también en imágenes incrustadas** en Word, Excel y PowerPoint (capturas, fotos de planos…): se extraen y se les pasa OCR solas, como los adjuntos de un correo (las muy pequeñas —logos, firmas— se omiten).
- **Duplicados en bloque**: en «Documentos» → «Quitar todos los duplicados del registro» (solo limpia el registro, no toca archivos) y «Borrar del disco los archivos duplicados…» (borra de verdad los archivos idénticos a otro ya indexado; pide confirmación con la lista y comprueba que la copia que se conserva existe).
- **Scroll vertical** en la tabla de documentos, en el registro de errores/duplicados, resultados, requisitos, etc.
- **Una pantalla de altura**: pestañas (Inicio · Buscar · Requisitos · Informes · Documentos · Datos y copias); cabecera y pestañas fijas, cada pestaña se desplaza por dentro. Los avisos salen como mensajes flotantes aunque estés en otra pestaña.
- **Carpeta de datos mínima**: antes creaba `docs/`, `blobs/` y `pimg/`. Ahora guarda un único archivo `feedback-datos.fbd` (índice comprimido), la carpeta `versions/` (versiones) y `originales/` **solo** si importas archivos a mano. Las imágenes procesadas ya no se guardan en disco (se regeneran al reindexar). Una copia antigua se migra sola al guardar y borra `docs/`, `blobs/`, `pimg/` y los json sueltos.
- **Seguridad del repositorio**: `.gitignore` bloquea además `*.fbd`, `*.fbv`, `*.fbk`, `docs/`, `blobs/`, `pimg/`, `originales/`, `versions/` y los formatos de correo/Office. Si elegiste esta carpeta como carpeta de datos, esos archivos no se suben.

## Novedades v0.14
- **Formatos nuevos (lectura directa, sin conversión)**: Word `.doc` y `.docx`, Excel `.xls` y `.xlsx`, y planos CAD `.dwg` (R14 a 2018), `.dxf` y `.dgn` (V7 fiable; V8 aproximado). De los planos se indexan textos, cajetín/atributos, capas, bloques y espacios modelo/papel. 
- **Procesado en segundo plano** (Web Worker): Word, Excel, planos y correos se analizan sin congelar la pantalla; si el navegador no lo permite, se procesa en la ventana como antes.
- **Búsqueda**: por valores y unidades (`caudal > 5000 m3/h`, `presión 200-300 Pa`, con equivalencias de unidades), tolerancia a erratas de OCR, frase exacta entre comillas y «más como este».
- **Control documental**: matriz de trazabilidad (requisito → documentos y páginas → estado, exportable a .xlsx), lista de comprobación por documento, detección de revisiones sustituidas con comparación, y papelera de 30 días.
- **Informes**: marca de agua (BORRADOR…), clasificación arriba y abajo de cada página y numeración «Página X de Y» en HTML, PDF, Word y Excel (Informes → Plantilla del informe).
- **Contraseña opcional** (Datos y copias → Contraseña de la aplicación): cifra con AES-256 (PBKDF2, 250 000 iteraciones) el índice, textos, marcas y archivos importados del navegador y la copia de la carpeta de datos. Se pide al abrir; bloqueo manual y automático por inactividad. **Sin la contraseña no hay recuperación.** No cifra los originales de tus carpetas ni los nombres de las carpetas añadidas. Al activarla o quitarla se regeneran la copia en disco y se descartan las versiones antiguas.
- **Uso**: arrastrar una carpeta entera con barra de progreso y cancelación, vista previa de `.msg`/`.eml` con adjuntos y conversación, y atajos de teclado (`?` muestra la ayuda).
- **Licencias**: `vendor/libredwg/` (lectura de DWG) es GPL-3.0; ver `vendor/libredwg/PACKAGE.txt`. SheetJS (Apache-2.0). Pesa unos 8 MB (wasm); solo se carga al abrir un `.dwg`.

## Novedades v0.15
- **Bandeja de revisión y novedades** (Inicio): documentos nuevos desde tu última visita, sin revisar, pendientes de respuesta, requisitos pendientes y errores. «Revisar siguiente» abre el siguiente sin revisar; dentro del detalle, la tecla **R** lo marca como revisado y pasa al siguiente. Aviso al entrar documentos nuevos (escaneo automático) y cuando una búsqueda guardada tiene resultados nuevos.
- **Edición en bloque** (Documentos): etiquetas, proyecto, nota y casillas de control para todos los documentos marcados.
- **Plantillas de informe** (Informes → Plantilla del informe): guarda y aplica empresa, nº, revisión, autor, logotipo, marca de agua y clasificación por cliente o proyecto.
- **Visor de planos DWG/DXF**: «original» abre el dibujo (líneas, polilíneas, arcos, círculos, elipses, textos y bloques) con zoom, desplazamiento y resaltado de los textos buscados. Es una vista de consulta, no sustituye a un CAD; no dibuja sombreados, splines ni sólidos 3D. DGN: solo texto.
- **Conflictos probables** (Requisitos → Revisión de valores): marca «Solo conflictos probables» para ver la misma frase con valores distintos en documentos distintos. Solo avisa; decide el ingeniero.
- **Vínculos entre documentos** (detalle → «Vínculos») y **mapa de relaciones** (Documentos): responde a, sustituye a, complementa, hace referencia, contradice; las sustituciones y adjuntos aparecen solos.
- **Originales movidos**: en «Comprobar integridad», «buscar en la carpeta» localiza el archivo por su contenido (SHA-256) aunque se haya renombrado o movido y actualiza la ruta.
- **Registro de cambios** también en Excel.
- **Proyecto cifrado (.fbp)** (Datos y copias): exporta el proyecto activo (índice, marcas, requisitos y, si quieres, los originales importados) cifrado con contraseña, e impórtalo en otro equipo con «Importar índice…».
- **Índice de búsqueda persistente**: el arranque no vuelve a leer todas las páginas si nada ha cambiado.
- **PowerPoint antiguo (.ppt)**: lectura directa de diapositivas, tablas y notas del orador.
- **Modo solo lectura** (casilla en la cabecera) y **cabecera** y **mensajes de error en castellano**.
- **Límite conocido**: el DGN V8 sigue siendo una extracción aproximada de cadenas (el formato no está publicado); para planos MicroStation V8 se recomienda guardar también como DWG.


## v0.16 — OCR denso
Para planos con texto apelotonado, tamaños mezclados, líneas cruzando el texto y texto vertical (o fotos de pantalla):
normalización de iluminación (quita moiré/brillos), color→blanco, ampliación ×3, binarizado, eliminación de líneas largas
y lectura horizontal + vertical (±90°). Se aplica automáticamente en imágenes cuando la primera lectura es floja y en PDF escaneados
con confianza <70. El paso queda registrado como `ocr_denso`. En la foto de prueba: de ~5/81 a 26/81 etiquetas exactas (+21 casi exactas). Incluye una segunda binarización por canal máximo para texto sobre sombreados de color (rojo, verde-gris).
Límite: foto de monitor con moiré fuerte; para mejores resultados, exportar el plano a PDF/imagen directamente.

## v0.17 — Filtro por tipo de fichero y previsualización a pantalla completa
- Buscador: nueva lista «Tipo de fichero» (todos, .eml, .msg, DWG, DXF, DGN, PDF, .doc, .docx, .xls, .xlsx, .xlsm, foto/imagen de cualquier formato, .ppt, .pptx), independiente de «Todos los tipos» y combinable con el resto de filtros. Se guarda con la búsqueda guardada.
- «Abrir original» abre siempre una ventana que ocupa toda la pantalla (pantalla completa del navegador cuando es posible) con la ✕ roja arriba a la derecha (también Esc). PDF y planos CAD usan su visor; imágenes se muestran junto a su texto OCR; correos, Word, Excel y PowerPoint se muestran como texto extraído por hoja/diapositiva/parte, con el texto buscado resaltado (▲/▼ o F3/Enter para saltar entre coincidencias).
- Límite: Word/Excel/PowerPoint/correo no se dibujan con su maquetación original (el botón «Descargar original» abre el archivo con su programa). En imágenes el resaltado está en el texto OCR, no sobre la foto.

## v0.18
Resultados de búsqueda: las acciones «abrir original · ver / editar · más como este · eliminar» pasan a la línea del título, a la derecha de la etiqueta (p. ej. «General»).

## v0.19 — Texto buscado localizado dentro del original
- PDF con texto: sombreado amarillo exacto sobre el texto (ya existía).
- Fotos/imágenes y PDF escaneados (sin capa de texto): al abrir, se localiza el texto con OCR con coordenadas y se rodea con un rectángulo de borde rojo (con un tenue sombreado amarillo). La posición es aproximada; las coordenadas se guardan en la página para no repetir el OCR (la primera vez tarda unos segundos, más en fotos grandes).
- Planos DWG/DXF/DGN: el visor busca y resalta el texto (ya existía). Word/Excel/PowerPoint/correo: sombreado amarillo en el texto extraído (no se puede dibujar sobre la maquetación original).
- OCR denso: ahora se añade a la lectura normal en vez de sustituirla, para no empeorar imágenes limpias.

## v0.20 — OCR también en planos DWG / DXF / DGN
Al indexar un plano se dibuja su geometría a una imagen y se lee con OCR (horizontal y girada ±90°); solo se añaden como página «OCR del dibujo» las palabras que no estaban ya en el texto extraído (texto convertido a líneas/contornos, p. ej.). Aplica a DWG, DXF y DGN V7. DGN V8 no se puede dibujar (se sigue indexando su texto aproximado). El visor de planos ahora también abre DGN V7 (solo geometría; sin resaltado de texto). Conocido: example_2018.dwg (formato AC1032 concreto de prueba) falla al leerse con libredwg («Aborted()»), anterior a este cambio. No lee imágenes incrustadas (OLE/raster) dentro del DWG.

## v0.21
- **Búsqueda «por significado»** (casilla junto a «agrupar por documento»): amplía la consulta con sinónimos HVAC/naval ES-EN y términos relacionados calculados con tus propios documentos (coocurrencia en la misma página). Sin modelos descargados ni envío de datos; no es una IA neuronal. Se guarda con la búsqueda guardada.
- **Pestaña «Equipos»**: etiquetas técnicas (100VENT5501, RHE-ACON5067, 03JY8-00…), normas (ISO/EN/UNE…) y ficha por etiqueta con todas sus apariciones y valores cercanos (caudal, presión, temperatura…). Se calcula del texto ya indexado.
- **Revisión asistida del OCR**: en el detalle de una página con OCR, «Revisar OCR (recorte + texto)» abre una ventana a pantalla completa con la imagen, las palabras dudosas marcadas (<75 %), su recorte y un campo para corregirlas. La corrección se aplica al texto indexado (queda el original y el registro).
- **Comparación gráfica de planos** (dos DWG/DXF seleccionados → «Comparar versiones»): rojo = solo en A, verde = solo en B, gris = común, y listado de textos añadidos/eliminados.
- **Informes rápidos** (lista en Informes): pendientes de revisar, novedades 7 días, OCR de baja confianza, con puntos marcados, con comprobaciones pendientes.
- **Aviso de copia de seguridad** configurable (Datos y copias → «Salud del índice») y **panel de salud del índice** (errores, sin texto, OCR dudoso, duplicados, sin revisar…).
- **Modo línea de comandos** (`cli/indexar-lote.bat` o `node cli/indexar-lote.mjs <carpeta> <salida.fbp> --clave=… [--originales]`): indexa una carpeta con un Chrome oculto y genera un `.fbp` cifrado que se importa en la app. Requiere Node 18+, Chrome/Edge y `npm i playwright-core`.
- **Imágenes incrustadas**: además de las de `media/` en docx/xlsx/pptx, se buscan PNG/JPEG por firma dentro de objetos OLE incrustados y de .doc/.xls/.ppt antiguos (aproximado). DWG: se listan las imágenes enlazadas (archivos externos) y se intentan extraer las incrustadas (sin ficheros de prueba reales con OLE).
- **DWG 2018 (AC1032 de prueba)**: el lector integrado (libredwg) sigue sin poder abrirlo; ahora da un mensaje claro en castellano («guárdalo como DXF o DWG 2013») y un DWG defectuoso ya no impide leer los siguientes.
- Corregido: el visor/comparador DXF fallaba con grupos de coordenadas repetidos en algunas entidades.

## v0.22
- **Matriz de requisitos ↔ evidencias**: en el detalle de una página, «Vincular esta página» como evidencia de un requisito con veredicto (cumple / no cumple / dudoso) y nota. La matriz de trazabilidad (y su Excel) muestra las evidencias y el **cumplimiento** calculado: sin evidencia · cumple · dudoso · no cumple (cualquier «no cumple» manda). Resumen de totales bajo la tabla. Las evidencias viajan en el .fbp.
- **Lista de equipos exportable** (pestaña Equipos → «Exportar lista de equipos (Excel)»): una hoja por etiqueta (documentos, partes, valores cercanos) y otra con todas las apariciones y su contexto.
- **Inconsistencias entre documentos** (Equipos → «Buscar inconsistencias»): misma etiqueta con valores distintos de la misma magnitud (caudal, presión, temperatura, potencia, velocidad, ruido; unidades normalizadas, tolerancia 2 %) en documentos distintos, solo valores a ≤60 caracteres de la etiqueta. Son propuestas para revisar; «añadir como conflicto» las lleva a requisitos.

## v0.23
- **Duplicados, casi duplicados y versiones** (Documentos → «Buscar»): compara el texto indexado por fragmentos de 5 palabras y lista parejas con parecido ≥70/85/95 % (el % es sobre el documento más corto, así que una versión con añadidos puede salir al 100 %). También lista familias de versiones por nombre (REV, V, fecha) con enlaces «comparar» que abren la comparación de versiones ya existente. No elimina nada.
- **Informe de cobertura de requisitos** (Informes → «Calcular» / «Descargar (Excel)»): totales y % de cumple / dudoso / no cumple / sin evidencia, por concepto y por documento de origen, con hoja de detalle. Opción de incluir descartados.

## subir_feedback.bat (v2, sin preguntas)
Doble clic: sincroniza con GitHub, descomprime el `feedback-web-v*.zip` más reciente (carpeta o Descargas) y lo borra, comprueba que no se cuela ningún documento y sube a `main` sin forzar. `/auto` = sin pausas (log en `%TEMP%\feedback_sync.log`). `/instalar` crea la tarea «FEEDBACK sync» (cada 10 min) para que el PC reciba solo lo subido desde la nube; `/quitar` la borra. `/forzar` descarta cambios locales y se queda con GitHub.

## v0.24
- **Clic en el título de un resultado** abre siempre el original (correo .eml/.msg incluido, PDF, plano, Office…) con el texto buscado resaltado. «ver / editar» sigue abriendo el detalle con el texto extraído.
- **.docm, .xlsm y .pptm** (Office con macros) se indexan como sus equivalentes sin macros. Las macros (`vbaProject.bin`) nunca se ejecutan ni se leen. Nuevo filtro «Tipo de fichero» para .docm y .pptm.

## v0.25
- **Menú de pestañas en vertical**: barra lateral izquierda (Inicio, Buscar, Requisitos, Informes, Equipos, Documentos, Datos y copias). En pantallas estrechas (móvil) la barra se hace más delgada. Los atajos Alt+1…6 siguen igual.

## v0.26
- **Cajetín / portada → metadatos** (`js/cajetin.js`): propone nº de documento, título, revisión, fecha y estado leyendo la portada (2 primeras partes) o el cajetín de planos (texto u OCR). Son propuestas por reglas; se corrigen a mano.
- **Índice maestro** (Documentos → «Índice maestro de documentos»): tabla con nº, título, rev., fecha, estado, tipo, requisitos abiertos/total, evidencias, vigencia y fichero. Pulsa una celda para corregirla (queda en amarillo y se conserva al releer). Excel descargable.
- **Tablas de PDF a Excel** (detalle de un PDF → «Extraer tablas de esta página / de todo el documento»): detecta tablas por la posición del texto (PDF.js) y genera una hoja por tabla. Solo PDF con texto; en escaneados no se reconstruyen columnas.
- **Mapa de relaciones** (Equipos → «Mapa de relaciones»): documentos ↔ etiquetas de equipo ↔ requisitos, en SVG clicable. Vacío = visión general; escribe una etiqueta o un documento para centrarlo.
- **Agenda de requisitos y cambios** (Inicio): requisitos vencidos, que vencen en 14 días o en conflicto, y cambios registrados desde la última visita.
