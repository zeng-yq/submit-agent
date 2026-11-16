import React, { Component } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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
				<div className="p-4 text-sm text-destructive">
					<h3 className="mb-2 text-base font-semibold">Something went wrong</h3>
					<p className="opacity-80">{this.state.error?.message}</p>
				</div>
			)
		}
		return this.props.children
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(
	<React.StrictMode>
		<ErrorBoundary>
			<App />
		</ErrorBoundary>
	</React.StrictMode>
)
