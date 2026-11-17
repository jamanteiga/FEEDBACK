Attribute VB_Name = "FEEDBACK_Correos"
'==========================================================================
' FEEDBACK - Guarda los correos seleccionados en Outlook como archivos .msg
' en una carpeta, para que la app los indexe con "Buscar nuevos o modificados".
'
' INSTALACION (Outlook de escritorio clasico):
'   1. Outlook: Alt+F11 (Editor de VBA).
'   2. Archivo > Importar archivo... > elegir este .bas
'   3. Cambiar la constante CARPETA (mas abajo) por tu carpeta de correos.
'   4. Cerrar el editor.
' USO:
'   Seleccionar uno o varios correos > Alt+F8 > GuardarCorreosSeleccionados > Ejecutar
'   (opcional: Archivo > Opciones > Barra de herramientas de acceso rapido >
'    "Macros" > Agregar, para tener un boton).
' SI NO DEJA EJECUTAR: Archivo > Opciones > Centro de confianza >
'   Configuracion del Centro de confianza > Configuracion de macros.
'   Puede estar bloqueado por IT; entonces usa el arrastre a una carpeta del Explorador.
' No funciona en el "nuevo Outlook" (no admite VBA).
'==========================================================================
Option Explicit

Private Const CARPETA As String = "C:\FEEDBACK\correos\"   ' <-- CAMBIAR (debe existir)

Public Sub GuardarCorreosSeleccionados()
    Dim sel As Selection, it As Object, n As Long, omitidos As Long
    Dim fso As Object

    Set fso = CreateObject("Scripting.FileSystemObject")
    If Not fso.FolderExists(CARPETA) Then
        MsgBox "No existe la carpeta:" & vbCrLf & CARPETA, vbExclamation, "FEEDBACK"
        Exit Sub
    End If

    Set sel = Application.ActiveExplorer.Selection
    If sel.Count = 0 Then
        MsgBox "Selecciona uno o varios correos.", vbInformation, "FEEDBACK"
        Exit Sub
    End If

    For Each it In sel
        If TypeOf it Is MailItem Then
            GuardarUno it, fso
            n = n + 1
        Else
            omitidos = omitidos + 1
        End If
    Next

    MsgBox n & " correo(s) guardado(s) en:" & vbCrLf & CARPETA & _
           IIf(omitidos > 0, vbCrLf & omitidos & " elemento(s) que no son correos omitidos.", ""), _
           vbInformation, "FEEDBACK"
End Sub

Private Sub GuardarUno(ByVal m As MailItem, ByVal fso As Object)
    Dim base As String, ruta As String, k As Long
    base = Format(m.ReceivedTime, "yyyymmdd-hhnnss") & "_" & Limpia(m.Subject)
    ruta = CARPETA & base & ".msg"
    k = 1
    Do While fso.FileExists(ruta)
        k = k + 1
        ruta = CARPETA & base & "_" & k & ".msg"
    Loop
    m.SaveAs ruta, olMSGUnicode
End Sub

Private Function Limpia(ByVal s As String) As String
    Dim c As Variant
    s = Replace(Replace(s, vbCr, " "), vbLf, " ")
    For Each c In Array("\", "/", ":", "*", "?", """", "<", ">", "|")
        s = Replace(s, c, "_")
    Next
    s = Trim(Left(s, 50))
    If Len(s) = 0 Then s = "sin_asunto"
    Limpia = s
End Function
