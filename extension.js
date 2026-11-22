const vscode = require('vscode');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const collection = vscode.languages.createDiagnosticCollection('java-auto-fixer');
const timers = new Map();
let statusItem;
let enabled = true;
let warnedNoJavac = false;

function settings() {
  return vscode.workspace.getConfiguration('javaAutoFixer');
}

// Runs the real Java compiler (javac) on the current text of a document.
// Returns a list of problems, or null if javac is not installed.
function compile(doc) {
  return new Promise(resolve => {
    const fileName = doc.uri.scheme === 'file' && doc.fileName.endsWith('.java')
      ? path.basename(doc.fileName)
      : 'Main.java';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'java-auto-fixer-'));
    const srcFile = path.join(tmp, fileName);
    fs.writeFileSync(srcFile, doc.getText());
    const classDir = doc.uri.scheme === 'file' ? path.dirname(doc.fileName) : tmp;
    const javac = settings().get('javacPath') || 'javac';

    cp.execFile(javac, ['-d', tmp, '-cp', classDir, srcFile], { timeout: 20000 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr || '');
      fs.rmSync(tmp, { recursive: true, force: true });

      if (err && err.code === 'ENOENT') {
        if (!warnedNoJavac) {
          warnedNoJavac = true;
          vscode.window.showErrorMessage('Java Auto Fixer: javac not found. Install a JDK, or set javaAutoFixer.javacPath.');
        }
        return resolve(null);
      }
      resolve(parseJavac(output, fileName));
    });
  });
}

// Reads javac output. Each error looks like:
//   Hello.java:5: error: ';' expected
//       int age = 20
//                   ^
const ERROR_LINE = /^(.+\.java):(\d+): (error|warning): (.*)$/;

function parseJavac(output, fileName) {
  const lines = output.split(/\r?\n/);
  const problems = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ERROR_LINE);
    if (!m || path.basename(m[1]) !== fileName) continue;
    const caretLine = lines[i + 2] || '';
    const col = caretLine.indexOf('^');
    problems.push({
      line: parseInt(m[2], 10) - 1,
      col: col < 0 ? 0 : col,
      kind: m[3],
      message: m[4].trim()
    });
  }
  return problems;
}

// Decides whether javac's error has a safe, automatic fix.
function makeFix(doc, p) {
  if (p.kind !== 'error') return null;
  if (p.message === "';' expected") {
    const pos = new vscode.Position(Math.min(p.line, doc.lineCount - 1), p.col);
    return { title: 'Add missing semicolon ;', edits: [vscode.TextEdit.insert(pos, ';')] };
  }
  if (p.message.startsWith('reached end of file while parsing')) {
    const end = doc.positionAt(doc.getText().length);
    return { title: 'Add missing closing brace }', edits: [vscode.TextEdit.insert(end, '\n}')] };
  }
  return null;
}

function toDiagnostics(doc, problems) {
  return problems.map(p => {
    const line = Math.min(Math.max(p.line, 0), doc.lineCount - 1);
    const text = doc.lineAt(line).text;
    const end = text.length;
    let start = Math.min(p.col, end);
    if (start >= end) start = Math.max(0, end - 1);
    const range = new vscode.Range(line, start, line, end);

    const severity = p.kind === 'warning'
      ? vscode.DiagnosticSeverity.Warning
      : vscode.DiagnosticSeverity.Error;
    const d = new vscode.Diagnostic(range, p.message, severity);
    d.source = 'javac';
    d.javaFix = makeFix(doc, p); // remembered for quick fixes and auto-fix
    return d;
  });
}

// Collects every safe fix from a list of diagnostics, without duplicates.
function fixEdits(diags) {
  const edits = [];
  const seen = new Set();
  for (const d of diags) {
    if (!d.javaFix) continue;
    for (const e of d.javaFix.edits) {
      const key = `${e.range.start.line}:${e.range.start.character}:${e.newText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edits.push(e);
    }
  }
  return edits;
}

async function refresh(doc) {
  if (doc.languageId !== 'java') return;
  if (!enabled) {
    collection.delete(doc.uri);
    updateStatus();
    return;
  }
  const version = doc.version;
  const problems = await compile(doc);
  if (problems === null) return;
  if (doc.version !== version) return; // text changed during compile; a newer check will run
  collection.set(doc.uri, toDiagnostics(doc, problems));
  updateStatus();
}

function updateStatus() {
  if (!statusItem) return;
  if (!enabled) {
    statusItem.text = '$(circle-slash) Java Fixer: OFF';
    statusItem.tooltip = 'Click to turn Java Auto Fixer on';
    return;
  }
  const ed = vscode.window.activeTextEditor;
  const count = ed && ed.document.languageId === 'java'
    ? (collection.get(ed.document.uri) || []).length
    : 0;
  statusItem.text = count
    ? `$(error) Java: ${count} problem(s)`
    : '$(pass) Java: OK';
  statusItem.tooltip = 'Click to turn Java Auto Fixer on or off';
}

function activate(context) {
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusItem.command = 'javaAutoFixer.toggle';
  statusItem.show();
  context.subscriptions.push(statusItem, collection);

  // Lightbulb quick fixes
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider('java', {
      provideCodeActions(doc, range, ctx) {
        const actions = [];
        for (const d of ctx.diagnostics) {
          if (!d.javaFix) continue;
          const a = new vscode.CodeAction(d.javaFix.title, vscode.CodeActionKind.QuickFix);
          a.diagnostics = [d];
          a.isPreferred = true;
          a.edit = new vscode.WorkspaceEdit();
          a.edit.set(doc.uri, d.javaFix.edits);
          actions.push(a);
        }
        const all = (collection.get(doc.uri) || []).filter(d => d.javaFix);
        if (all.length > 1) {
          const a = new vscode.CodeAction('Fix all auto-fixable errors in this file', vscode.CodeActionKind.QuickFix);
          a.edit = new vscode.WorkspaceEdit();
          a.edit.set(doc.uri, fixEdits(all));
          actions.push(a);
        }
        return actions;
      }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('javaAutoFixer.toggle', () => {
      enabled = !enabled;
      if (enabled) {
        const ed = vscode.window.activeTextEditor;
        if (ed) refresh(ed.document);
      } else {
        collection.clear();
      }
      vscode.window.showInformationMessage(`Java Auto Fixer is ${enabled ? 'ON' : 'OFF'}`);
      updateStatus();
    }),
    vscode.commands.registerCommand('javaAutoFixer.fixAll', async () => {
      const ed = vscode.window.activeTextEditor;
      if (!ed || ed.document.languageId !== 'java') return;
      const doc = ed.document;
      const problems = await compile(doc);
      if (!problems) return;
      const we = new vscode.WorkspaceEdit();
      we.set(doc.uri, fixEdits(toDiagnostics(doc, problems)));
      await vscode.workspace.applyEdit(we);
      refresh(doc);
    })
  );

  // Automatic checking while typing (waits 0.8 seconds after you stop typing)
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      const doc = e.document;
      if (doc.languageId !== 'java') return;
      const key = doc.uri.toString();
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(() => refresh(doc), 800));
    }),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidSaveTextDocument(refresh),
    vscode.workspace.onDidCloseTextDocument(doc => collection.delete(doc.uri)),
    vscode.window.onDidChangeActiveTextEditor(updateStatus)
  );

  // Automatic fixing on save: edits are applied before the file is written
  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument(event => {
      const doc = event.document;
      if (!enabled || doc.languageId !== 'java' || !settings().get('autoFixOnSave')) return;
      event.waitUntil((async () => {
        const problems = await compile(doc);
        if (!problems) return [];
        return fixEdits(toDiagnostics(doc, problems));
      })());
    })
  );

  require('./groq').activate(context);

  vscode.workspace.textDocuments.forEach(refresh);
  updateStatus();
}

function deactivate() {}

module.exports = { activate, deactivate };