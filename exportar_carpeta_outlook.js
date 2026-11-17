// FEEDBACK - Vigila una carpeta de Outlook y guarda cada correo nuevo como .msg.
// USO: 1) En Outlook crea una carpeta llamada FEEDBACK (cualquier sitio del buzon).
//      2) Haz doble clic en este archivo: queda en segundo plano (sin ventana).
//      3) Arrastra correos a esa carpeta FEEDBACK dentro de Outlook: se exportan solos.
// PARAR: crea un archivo vacio llamado .parar en DESTINO (o cierra wscript.exe en el Administrador de tareas).
// ARRANQUE AUTOMATICO: Win+R > shell:startup > pega aqui un acceso directo a este archivo.
// Solo Outlook clasico (no el "nuevo Outlook"). Outlook debe estar abierto.
var NOMBRE_CARPETA = "FEEDBACK";                 // nombre de la carpeta en Outlook
var DESTINO = "C:\\FEEDBACK\\correos\\";          // CAMBIAR: carpeta donde se guardan los .msg
var SEGUNDOS = 20;                                // cada cuanto se revisa

if (DESTINO.slice(-1) !== "\\") DESTINO += "\\";
var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");
var LOCK = DESTINO + ".exportador.lock", LISTA = DESTINO + ".exportados.txt",
    LOG = DESTINO + ".exportador.log", PARAR = DESTINO + ".parar";

function pad(n) { return (n < 10 ? "0" : "") + n; }
function sello(v) {
  try { var d = new Date(v); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()); }
  catch (e) { return "sin_fecha"; }
}
function limpia(s) {
  s = String(s || "").replace(/[\r\n]+/g, " ").replace(/[\\\/:*?"<>|]/g, "_");
  s = s.replace(/^\s+|\s+$/g, "").substring(0, 50);
  return s || "sin_asunto";
}
function crearCarpeta(p) {
  p = p.replace(/\\+$/, "");
  if (fso.FolderExists(p)) return;
  var padre = fso.GetParentFolderName(p);
  if (padre && !fso.FolderExists(padre)) crearCarpeta(padre);
  fso.CreateFolder(p);
}
function escribe(p, t, anadir) { var f = fso.OpenTextFile(p, anadir ? 8 : 2, true); f.Write(t); f.Close(); }
function lee(p) { if (!fso.FileExists(p)) return ""; var f = fso.OpenTextFile(p, 1); var t = f.AtEndOfStream ? "" : f.ReadAll(); f.Close(); return t; }
function log(t) { try { escribe(LOG, sello(new Date()) + " " + t + "\r\n", true); } catch (e) {} }
function aviso(t, icono, seg) { sh.Popup(t, seg || 0, "FEEDBACK", icono || 64); }

function buscar(f, nombre, prof) {
  if (String(f.Name).toUpperCase() === nombre.toUpperCase()) return f;
  if (prof <= 0) return null;
  var subs = f.Folders;
  for (var i = 1; i <= subs.Count; i++) { var r = buscar(subs.Item(i), nombre, prof - 1); if (r) return r; }
  return null;
}
function carpetaOutlook(ol) {
  var raices = ol.GetNamespace("MAPI").Folders;
  for (var i = 1; i <= raices.Count; i++) { var r = buscar(raices.Item(i), NOMBRE_CARPETA, 3); if (r) return r; }
  return null;
}

// Una pasada: exporta los correos de la carpeta que aun no se han guardado. Devuelve "" o un texto de estado.
function ciclo() {
  var ol;
  try { ol = GetObject("", "Outlook.Application"); } catch (e) { return "Outlook no esta abierto"; }
  var c = carpetaOutlook(ol);
  if (!c) return "No se encuentra la carpeta '" + NOMBRE_CARPETA + "' en Outlook";
  var hechos = " " + lee(LISTA).replace(/\r?\n/g, " ") + " ", items = c.Items, n = 0;
  for (var i = 1; i <= items.Count; i++) {
    try {
      var it = items.Item(i);
      if (it.Class !== 43) continue;                       // 43 = correo
      var id = String(it.EntryID);
      if (hechos.indexOf(" " + id + " ") >= 0) continue;   // ya exportado
      var base = DESTINO + sello(it.ReceivedTime) + "_" + limpia(it.Subject), ruta = base + ".msg", k = 1;
      while (fso.FileExists(ruta)) { k++; ruta = base + "_" + k + ".msg"; }
      it.SaveAs(ruta, 9);                                  // 9 = .msg Unicode
      escribe(LISTA, id + "\r\n", true); hechos += id + " "; n++;
    } catch (e) { log("Error en un correo: " + e.message); }
  }
  if (n) log(n + " correo(s) exportado(s)");
  return "";
}

crearCarpeta(DESTINO);
if (fso.FileExists(LOCK)) {
  var edad = new Date() - new Date(fso.GetFile(LOCK).DateLastModified);
  if (edad < SEGUNDOS * 3000 + 30000) { aviso("Ya hay un exportador en marcha.", 48, 6); WScript.Quit(); }
}
if (fso.FileExists(PARAR)) fso.DeleteFile(PARAR);
aviso("Vigilando la carpeta '" + NOMBRE_CARPETA + "' de Outlook.\nLos correos que arrastres a ella se guardaran en:\n" + DESTINO + "\n\nPara parar: crea el archivo .parar en esa carpeta.", 64, 8);
log("Exportador iniciado");

var estado = "";
while (true) {
  if (fso.FileExists(PARAR)) { try { fso.DeleteFile(PARAR); fso.DeleteFile(LOCK); } catch (e) {} log("Exportador detenido"); break; }
  try {
    escribe(LOCK, "1");
    var r = ciclo();
    if (r !== estado) { estado = r; if (r) log(r); }
  } catch (e) { log("Error: " + e.message); }
  WScript.Sleep(SEGUNDOS * 1000);
}
