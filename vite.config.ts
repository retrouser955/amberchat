import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	ssr: {
		// Gun ships as CommonJS. Leaving it external makes Node's ESM loader
		// import the CJS file directly, which can crash serverless functions
		// (ERR_INTERNAL_ASSERTION) before SvelteKit can render a page.
		noExternal: ['gun']
	}
});
