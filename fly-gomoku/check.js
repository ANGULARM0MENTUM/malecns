var fso = new ActiveXObject("Scripting.FileSystemObject");
var root = fso.GetParentFolderName(WScript.ScriptFullName);

function readFile(name) {
  var file = fso.OpenTextFile(root + "\\" + name, 1);
  var text = file.ReadAll();
  file.Close();
  return text;
}

eval(readFile("circuit.js"));
eval(readFile("brain.js"));
var err = circuitSelfCheck();
WScript.Echo("fixture error " + err);
if (err > 1e-4) {
  WScript.Quit(1);
}
