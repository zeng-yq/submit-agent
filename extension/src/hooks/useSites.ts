import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SiteData, SubmissionRecord } from '@/lib/types'
import { loadSites } from '@/lib/sites'
import { listSubmissionsByProduct, saveSubmission, updateSubmission } from '@/lib/db'

export interface UseSitesResult {
	sites: SiteData[]
	submissions: Map<string, SubmissionRecord>
	loading: boolean
	refresh: () => Promise<void>
	markSubmitted: (siteName: string, productId: string) => Promise<void>
	markSkipped: (siteName: string, productId: string) => Promise<void>
	markFailed: (siteName: string, productId: string, error?: string) => Promise<void>
	updateStatus: (record: SubmissionRecord) => Promise<void>
}

export function useSites(productId: string | null): UseSitesResult {
	const [sites, setSites] = useState<SiteData[]>([])
	const [submissionList, setSubmissionList] = useState<SubmissionRecord[]>([])
	const [loading, setLoading] = useState(true)

	const refresh = useCallback(async () => {
		const [loadedSites, subs] = await Promise.all([
			loadSites(),
			productId ? listSubmissionsByProduct(productId) : Promise.resolve([]),
		])
		setSites(loadedSites)
		setSubmissionList(subs)
		setLoading(false)
	}, [productId])

	useEffect(() => {
		refresh()
	}, [refresh])

	const submissions = useMemo(() => {
		const map = new Map<string, SubmissionRecord>()
		for (const sub of submissionList) {
			map.set(sub.siteName, sub)
		}
		return map
	}, [submissionList])

	const markSubmitted = useCallback(
		async (siteName: string, productId: string) => {
			const existing = submissions.get(siteName)
			if (existing) {
				await updateSubmission({ ...existing, status: 'submitted', submittedAt: Date.now(), error: undefined, failedAt: undefined })
			} else {
				await saveSubmission({
					siteName,
					productId,
					status: 'submitted',
					submittedAt: Date.now(),
				})
			}
			await refresh()
		},
		[submissions, refresh]
	)

	const markSkipped = useCallback(
		async (siteName: string, productId: string) => {
			const existing = submissions.get(siteName)
			if (existing) {
				await updateSubmission({ ...existing, status: 'skipped' })
			} else {
				await saveSubmission({
					siteName,
					productId,
					status: 'skipped',
				})
			}
			await refresh()
		},
		[submissions, refresh]
	)

	const markFailed = useCallback(
		async (siteName: string, productId: string, error?: string) => {
			const existing = submissions.get(siteName)
			const now = Date.now()
			if (existing) {
				await updateSubmission({
					...existing,
					status: 'failed',
					error: error ?? '',
					failedAt: now,
				})
			} else {
				await saveSubmission({
					siteName,
					productId,
					status: 'failed',
					error: error ?? '',
					failedAt: now,
				})
			}
			await refresh()
		},
		[submissions, refresh]
	)

	const updateStatus = useCallback(
		async (record: SubmissionRecord) => {
			await updateSubmission(record)
			await refresh()
		},
		[refresh]
	)

	return {
		sites,
		submissions,
		loading,
		refresh,
		markSubmitted,
		markSkipped,
		markFailed,
		updateStatus,
	}
}
