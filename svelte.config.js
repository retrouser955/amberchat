import adapterAuto from '@sveltejs/adapter-auto';
import adapterVercel from '@sveltejs/adapter-vercel';

// Use the explicit Vercel adapter on Vercel. Locally, adapter-auto keeps
// `vite build` working on Windows, where adapter-vercel's function symlinks
// require Developer Mode.
const adapter = process.env.VERCEL ? adapterVercel() : adapterAuto();

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter
	}
};

export default config;
