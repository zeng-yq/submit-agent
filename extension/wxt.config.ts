import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { mkdirSync } from 'node:fs'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

function obfuscateKey(key: string): string {
	if (!key) return ''
	const k = 0x5a
	const xored = Array.from(key, (c) => String.fromCharCode(c.charCodeAt(0) ^ k)).join('')
	return Buffer.from(xored, 'binary').toString('base64')
}

export default defineConfig({
	srcDir: 'src',
	outDir: 'dist',
	modules: ['@wxt-dev/module-react'],
	webExt: {
		chromiumProfile: chromeProfile,
		keepProfileChanges: true,
		chromiumArgs: ['--hide-crash-restore-bubble'],
	},
	vite: () => ({
		plugins: [tailwindcss()],
		define: {
			__VERSION__: JSON.stringify('0.1.0'),
			__DEFAULT_LLM_BASE_URL__: JSON.stringify(process.env.DEFAULT_LLM_BASE_URL ?? 'https://openrouter.ai/api/v1'),
			__DEFAULT_LLM_API_KEY_OBF__: JSON.stringify(obfuscateKey(process.env.DEFAULT_LLM_API_KEY ?? '')),
			__DEFAULT_LLM_MODEL__: JSON.stringify(process.env.DEFAULT_LLM_MODEL ?? 'meta-llama/llama-3.3-70b-instruct:free'),
		},
		build: {
			minify: false,
			chunkSizeWarningLimit: 2000,
		},
	}),
	zip: {
		artifactTemplate: 'submit-agent-{{version}}-{{browser}}.zip',
	},
	manifest: {
		name: 'Submit Agent',
		description: 'AI-powered auto-submission for product directories and backlink sites',
		permissions: ['tabs', 'tabGroups', 'sidePanel', 'storage', 'activeTab', 'identity'],
		host_permissions: ['<all_urls>'],
		icons: {
			16: 'assets/icon-16.png',
			48: 'assets/icon-48.png',
			128: 'assets/icon-128.png',
		},
		action: {
			default_title: 'Submit Agent',
		},
		side_panel: {
			default_path: 'sidepanel/index.html',
		},
	},
})
