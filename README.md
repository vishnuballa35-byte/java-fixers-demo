# Java Auto Fixer

A browser-based Java code checker that finds common beginner mistakes, fixes them with one click, and can optionally send the code to Groq AI for a deeper review.

**Live demo:**[ https://your-project-name.pages.dev](https://throbbing-art-5a0e.vishnuballa35.workers.dev/)

## Features

- **Live error checking** as you type, with a status dot (green when clean, red when problems are found).
- **Typo detection** for common misspellings such as `Sytem`, `Sting`, `retrun`, `pubilc`, and `pritnln`.
- **Missing semicolon detection** for statements like variable declarations, method calls, `return`, and `import`.
- **Brace matching** that reports missing closing braces and extra closing braces.
- **Apply fix** buttons for each error, and **Apply all fixes** to correct everything at once.
- **Auto-apply fixes** mode that corrects errors as you type.
- **Groq AI review** (optional) that checks for logic bugs such as wrong comparisons, off-by-one errors, null risks, and resource leaks.

## How to Use

1. Open the live demo link.
2. Paste or edit Java code in the editor. A sample program is loaded by default.
3. Click the status dot in the top-right corner to open the settings panel.
4. Review the listed problems and click **Apply fix**, or click **Apply all fixes**.
5. Turn on **Auto-apply fixes** to correct errors automatically.

### Using the AI Review

1. Get a free API key from https://console.groq.com/keys.
2. Paste the key into the **Groq API key** box above the editor. The key is used only in your browser and is not saved.
3. Click **Review with Groq AI** in the settings panel.

The error checker works without a key. Only the AI review needs one.

## Important Notes

- This tool catches common mistakes only. For full compiler errors, use the VS Code extension version.
- Do not add your own API key to the source code. Anyone who can see the page or the file can read it and use your account.
- The AI review sends your code to Groq's servers. Do not paste confidential code.

## Project Structure

```
java-fixers-demo/
├── index.html   # The complete app (HTML, CSS, and JavaScript)
└── README.md    # This file
```

## Run Locally

1. Download or clone the repository.
2. Open `index.html` in any modern browser. No installation is needed.

## Technologies

- HTML, CSS, and vanilla JavaScript
- Groq API (`openai/gpt-oss-120b`) for optional AI review
- Hosted on Cloudflare Pages

## Author

Vishnu Balla, B.E. Computer Science Engineering (AI & ML), NGIT/KMEC.

## License

This project is for educational use.
