const vscode = require('vscode');

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const KEY_NAME = 'javaAutoFixer.groqApiKey';
const aiCollection = vscode.languages.createDiagnosticCollection('java-groq');

function cfg() {
  return vscode.workspace.getConfiguration('javaAutoFixer');
}

// Sends the code to Groq and returns a list of issues found.
async function askGroq(apiKey, code) {
  const numbered = code.split('\n').map((l, i) => `${i + 1}| ${l}`).join('\n');
  const body = {
    model: cfg().get('groqModel') || 'openai/gpt-oss-120b',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a strict Java code reviewer. Find real bugs only: logic mistakes, wrong comparisons, ' +
          'off-by-one errors, null risks, resource leaks, and wrong method usage. Ignore style and formatting. ' +
          'Reply with ONLY a JSON object, no markdown, in this exact form: ' +
          '{"issues":[{"line":<number>,"message":"<short explanation>","fixed_line":"<the corrected full line, or null>"}]}. ' +
          'Use the line numbers shown in the input. If there are no real problems, reply {"issues":[]}.'
      },
      { role: 'user', content: numbered }
    ]
  };

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Groq returned ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const text = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new Error('Groq reply was not in the expected format.');
  const parsed = JSON.parse(text.slice(start, end + 1));
  return Array.isArray(parsed.issues) ? parsed.issues : [];
}



async function getApiKey(context, forceNew) {
  let key = forceNew
    ? undefined
    : await context.secrets.get(KEY_NAME);

  if (!key) {
    key = await vscode.window.showInputBox({
      prompt: 'Enter your Groq API key',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'gsk_...',
      validateInput: value => {
        if (!value.trim()) {
          return 'API key cannot be empty.';
        }
        return undefined;
      }
    });

    if (!key) return null;

    key = key.trim();
    await context.secrets.store(KEY_NAME, key);
  }

  return key;
}


async function review(doc, context) {
  if (doc.languageId !== 'java') return;
  const apiKey = await getApiKey(context, false);
  if (!apiKey) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Groq is reviewing your Java code...' },
    async () => {
      try {
        const issues = await askGroq(apiKey, doc.getText());
        const diags = [];
        for (const issue of issues) {
          const idx = Number(issue.line) - 1;
          if (!Number.isInteger(idx) || idx < 0 || idx >= doc.lineCount) continue;
          const line = doc.lineAt(idx);
          const d = new vscode.Diagnostic(line.range, `AI: ${issue.message}`, vscode.DiagnosticSeverity.Warning);
          d.source = 'Groq';
          if (typeof issue.fixed_line === 'string' && issue.fixed_line !== line.text) {
            d.aiFix = { line: idx, text: issue.fixed_line };
          }
          diags.push(d);
        }
        aiCollection.set(doc.uri, diags);
        vscode.window.showInformationMessage(
          diags.length ? `Groq found ${diags.length} possible issue(s).` : 'Groq found no issues.'
        );
      } catch (e) {
        vscode.window.showErrorMessage(`Groq review failed: ${e.message}`);
      }
    }
  );
}

function activate(context) {
  context.subscriptions.push(
    aiCollection,

    vscode.commands.registerCommand('javaAutoFixer.aiReview', () => {
      const ed = vscode.window.activeTextEditor;
      if (ed) review(ed.document, context);
    }),

    vscode.commands.registerCommand('javaAutoFixer.setGroqKey', async () => {
      const key = await getApiKey(context, true);
      if (key) vscode.window.showInformationMessage('Groq API key saved.');
    }),

    // Lightbulb: "Apply Groq's fix" replaces the flagged line
    vscode.languages.registerCodeActionsProvider('java', {
      provideCodeActions(doc, range, ctx) {
        const actions = [];
        for (const d of ctx.diagnostics) {
          if (!d.aiFix) continue;
          const a = new vscode.CodeAction("Apply Groq's fix", vscode.CodeActionKind.QuickFix);
          a.diagnostics = [d];
          a.isPreferred = true;
          a.edit = new vscode.WorkspaceEdit();
          a.edit.replace(doc.uri, doc.lineAt(d.aiFix.line).range, d.aiFix.text);
          actions.push(a);
        }
        return actions;
      }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),

    // AI suggestions go stale once the code changes, so clear them
    vscode.workspace.onDidChangeTextDocument(e => aiCollection.delete(e.document.uri)),

    // Optional: review on every save
    vscode.workspace.onDidSaveTextDocument(async doc => {
      if (doc.languageId !== 'java' || !cfg().get('aiOnSave')) return;
      const key = await context.secrets.get(KEY_NAME);
      if (key) review(doc, context);
    })
  );
}

module.exports = { activate };