// FEEDBACK - Guarda como .msg los correos seleccionados en Outlook (clasico, abierto).
// USO: en Outlook selecciona uno o varios correos, y haz doble clic en este archivo.
// Cambia CARPETA por tu carpeta de correos (se crea si no existe).
var CARPETA = "C:\\FEEDBACK\\correos\\";

var fso = new ActiveXObject("Scripting.FileSystemObject");
var sh = new ActiveXObject("WScript.Shell");

function pad(n) { return (n < 10 ? "0" : "") + n; }
function limpia(s) {
  s = String(s || "").replace(/[\r\n]+/g, " ").replace(/[\\\/:*?"<>|]/g, "_");
  s = s.replace(/^\s+|\s+$/g, "").substring(0, 50);
  return s || "sin_asunto";
}
function sello(v) {
  try {
    var d = new Date(v);
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  } catch (e) { return "sin_fecha"; }
}
function crearCarpeta(p) {
  p = p.replace(/\\+$/, "");
  if (fso.FolderExists(p)) return;
  var padre = fso.GetParentFolderName(p);
  if (padre && !fso.FolderExists(padre)) crearCarpeta(padre);
  fso.CreateFolder(p);
}
function aviso(t, icono) { sh.Popup(t, 0, "FEEDBACK", icono || 64); }

try {
  var ol = new ActiveXObject("Outlook.Application");
  var sel = ol.ActiveExplorer().Selection;
  if (sel.Count === 0) { aviso("Selecciona uno o varios correos en Outlook y vuelve a ejecutar.", 48); WScript.Quit(); }
  crearCarpeta(CARPETA);
  var n = 0, omitidos = 0;
  for (var i = 1; i <= sel.Count; i++) {
    var it = sel.Item(i);
    if (it.Class !== 43) { omitidos++; continue; }          // 43 = correo
    var base = CARPETA + sello(it.ReceivedTime) + "_" + limpia(it.Subject), ruta = base + ".msg", k = 1;
    while (fso.FileExists(ruta)) { k++; ruta = base + "_" + k + ".msg"; }
    it.SaveAs(ruta, 9);                                       // 9 = .msg Unicode
    n++;
  }
  aviso(n + " correo(s) guardado(s) en:\n" + CARPETA + (omitidos ? "\n" + omitidos + " elemento(s) que no son correos omitidos." : ""));
} catch (e) {
  aviso("No se pudo guardar:\n" + e.message + "\n\nComprueba que Outlook clasico esta abierto (no el 'nuevo Outlook') y que ambos se ejecutan con el mismo usuario, sin 'Ejecutar como administrador'.", 16);
}
