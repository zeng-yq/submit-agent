import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { type Locale, type TranslationKey, translate } from '@/lib/i18n'
import { getLanguage, setLanguage as persistLanguage } from '@/lib/storage'

interface LanguageContextValue {
	locale: Locale
	setLocale: (locale: Locale) => void
}

const LanguageContext = createContext<LanguageContextValue>({
	locale: 'en',
	setLocale: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>('en')
	const [ready, setReady] = useState(false)

	useEffect(() => {
		getLanguage().then((lang) => {
			setLocaleState(lang)
			setReady(true)
		})
	}, [])

	const setLocale = useCallback((lang: Locale) => {
		setLocaleState(lang)
		persistLanguage(lang)
	}, [])

	if (!ready) return null

	return (
		<LanguageContext.Provider value={{ locale, setLocale }}>
			{children}
		</LanguageContext.Provider>
	)
}

export function useLocale() {
	return useContext(LanguageContext)
}

export function useT() {
	const { locale } = useContext(LanguageContext)
	return useCallback(
		(key: TranslationKey, params?: Record<string, string | number>) => translate(locale, key, params),
		[locale],
	)
}
