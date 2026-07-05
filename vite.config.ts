import { defineConfig } from 'vite';

// base MUST match the GitHub Pages subpath (repo name). If the repo is
// renamed, update this or bundled assets will 404 in production.
export default defineConfig({ base: '/meter/' });
