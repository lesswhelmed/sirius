import { THEME_STORAGE_KEY } from "./theme-config";

// Runs synchronously in <head> before first paint so the page renders in the
// correct theme immediately — no flash-of-wrong-theme. It reads the stored
// preference (missing → "dark", our default), resolves "system" against the
// OS, and stamps data-theme + color-scheme on <html>. Any error falls back to
// dark. The React ThemeProvider picks the same value up after hydration.
export function ThemeScript() {
	const script = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
		THEME_STORAGE_KEY,
	)})||"dark";var t=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):(p==="light"?"light":"dark");var e=document.documentElement;e.dataset.theme=t;e.style.colorScheme=t;}catch(_){var e=document.documentElement;e.dataset.theme="dark";e.style.colorScheme="dark";}})();`;
	// Static, build-time string — no user input is interpolated.
	return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
