import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const env = (
	globalThis as {
		process?: { env?: Record<string, string | undefined> };
	}
).process?.env;

export default defineConfig(({ command }) => ({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// Gun ships as CommonJS. Leaving it external makes the Vercel
		// function import the CJS file through Node's ESM loader and crash
		// with ERR_INTERNAL_ASSERTION. Only bundle it for the Vercel
		// production build; Vite's dev SSR runner does not provide `module`
		// and would fail with "module is not defined".
		noExternal: command === 'build' && env?.VERCEL ? ['gun'] : []
	}
}));
