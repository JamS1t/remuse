' Starts the Remuse Agent with no console window. Logs go to backend\data\agent.log.
' scripts\install-windows.ps1 puts a shortcut to this file in the Startup folder.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
backend = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "backend")
If Not fso.FolderExists(fso.BuildPath(backend, "data")) Then fso.CreateFolder(fso.BuildPath(backend, "data"))
sh.CurrentDirectory = backend
sh.Run "cmd /c node --env-file-if-exists=..\.env src\server.ts >> data\agent.log 2>&1", 0, False
