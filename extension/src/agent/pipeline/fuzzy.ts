// src/agent/pipeline/fuzzy.ts
import type { FormAnalysisResult } from '@/agent/FormAnalyzer'

/** Normalize a string for comparison: lowercase, split on non-alphanumeric. */
function tokenize(s: string): Set<string> {
	return new Set(
		s.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/).filter(Boolean)
	)
}

/** Compute Jaccard token similarity between two strings. Returns 0–1. */
function tokenSimilarity(a: string, b: string): number {
	const ta = tokenize(a)
	const tb = tokenize(b)
	if (ta.size === 0 && tb.size === 0) return 0
	const intersection = new Set([...ta].filter(t => tb.has(t)))
	const union = new Set([...ta, ...tb])
	return intersection.size / union.size
}

/**
 * Check if an LLM key matches a form field.
 * Uses exact normalized match first, then token similarity with > 0.5 threshold.
 */
function matchesField(
	key: string,
	field: FormAnalysisResult['fields'][number],
): boolean {
	// Exact match fast path (normalized string equality)
	const normalizedKey = key.toLowerCase().replace(/[-_\s]/g, '')

	const identifiers = [
		field.canonical_id,
		field.name,
		field.id,
		field.label,
		field.placeholder,
		field.inferred_purpose,
	]

	for (const id of identifiers) {
		if (!id) continue
		const norm = id.toLowerCase().replace(/[-_\s]/g, '')
		if (norm === normalizedKey) return true
	}

	// Token similarity match (threshold > 0.5)
	for (const id of identifiers) {
		if (!id) continue
		if (tokenSimilarity(key, id) > 0.5) return true
	}

	return false
}

/**
 * Try to fuzzy-match an LLM key to a form field.
 * Prefers fields within the same form (formIndex) when provided,
 * falls back to global match if no same-form match found.
 */
export function fuzzyMatchField(
	llmKey: string,
	fields: FormAnalysisResult['fields'],
	usedCanonicalIds: Set<string>,
	formIndex?: number,
): FormAnalysisResult['fields'][number] | null {
	const key = llmKey

	// Phase 1: Try same-form match first
	if (formIndex !== undefined) {
		for (const field of fields) {
			if (usedCanonicalIds.has(field.canonical_id)) continue
			if (field.form_index !== formIndex) continue
			if (matchesField(key, field)) return field
		}
	}

	// Phase 2: Fall back to global match
	for (const field of fields) {
		if (usedCanonicalIds.has(field.canonical_id)) continue
		if (matchesField(key, field)) return field
	}

	return null
}
