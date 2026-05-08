' Wrapper invisivel para start.bat — para ser invocado pelo Task Scheduler.
' 0 = janela oculta, False = nao esperar pelo termino (fire-and-forget).

Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir  = fso.GetParentFolderName(WScript.ScriptFullName)
startBat   = scriptDir & "\start.bat"

sh.CurrentDirectory = scriptDir
sh.Run """" & startBat & """", 0, False
