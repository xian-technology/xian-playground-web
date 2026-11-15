/**
 * Monaco from the local `monaco-editor` package (no CDN): the core editor,
 * its standard features, Python and JSON. Workers are bundled by webpack.
 */

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/features/register.all";
import "monaco-editor/languages/definitions/python/register";
import "monaco-editor/languages/features/json/register";

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
  }
}

window.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") {
      return new Worker(new URL("monaco-editor/languages/features/json/json.worker.js", import.meta.url), {
        type: "module",
      });
    }
    return new Worker(new URL("monaco-editor/editor/editor.worker.js", import.meta.url), { type: "module" });
  },
};

monaco.editor.defineTheme("playground-light", {
  base: "vs",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#ffffff",
    "editorGutter.background": "#ffffff",
    "editor.lineHighlightBackground": "#f4f4f6",
    "editorLineNumber.foreground": "#9b9ba6",
  },
});

monaco.editor.defineTheme("playground-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#16161a",
    "editorGutter.background": "#16161a",
    "editor.lineHighlightBackground": "#1f1f25",
    "editorLineNumber.foreground": "#6c6c78",
  },
});

loader.config({ monaco });

export { monaco };
