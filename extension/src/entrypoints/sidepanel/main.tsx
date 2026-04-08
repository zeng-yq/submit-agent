import React, { Component } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { LanguageProvider } from '@/hooks/useLanguage'
import '@/assets/index.css'

const syncDarkMode = () => {
	document.documentElement.classList.toggle(
		'dark',
		matchMedia('(prefers-color-scheme: dark)').matches
	)
}
syncDarkMode()
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncDarkMode)

class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error?: Error }> {
	state = { hasError: false, error: undefined as Error | undefined }
	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error }
	}
	render() {
		if (this.state.hasError) {
			return (
				<div style={{ padding: 16, color: '#ef4444', fontSize: 14 }}>
					<h3 style={{ margin: '0 0 8px' }}>Something went wrong</h3>
					<p style={{ margin: 0, opacity: 0.8 }}>{this.state.error?.message}</p>
				</div>
			)
		}
		return this.props.children
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<LanguageProvider>
				<App />
			</LanguageProvider>
		</ErrorBoundary>
	</React.StrictMode>
)
