import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { mkdirSync } from 'node:fs'

const chromeProfile = '.wxt/chrome-data'
mkdirSync(chromeProfile, { recursive: true })

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
		description: '目录站提交资料生成：产品资料库 + 英文文案生成 + 快捷复制',
		permissions: ['sidePanel', 'storage'],
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
