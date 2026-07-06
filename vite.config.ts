import { defineConfig, type Plugin } from 'vite';

/**
 * Content-Security-Policy for the deployed site. Injected at build time only —
 * Vite's dev server needs an inline client and a websocket that a strict policy
 * would block, so we skip it during `vite dev`.
 *
 * `style-src` keeps 'unsafe-inline' because the dashboard sets element widths
 * via inline `style` attributes; everything else is locked to same-origin.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'meter-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({ base: '/', plugins: [cspPlugin()] });
