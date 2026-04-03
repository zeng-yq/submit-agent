#!/usr/bin/env node
/**
 * Merges targets.yaml + targets1.txt into sites.json, then health-checks every URL.
 *
 * Usage:
 *   node scripts/build-sites.mjs                # merge + check
 *   node scripts/build-sites.mjs --skip-check   # merge only, no HTTP checks
 *   node scripts/build-sites.mjs --check-only   # re-check existing sites.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const YAML_PATH = path.join(ROOT, 'targets.yaml')
const TXT_PATH = path.join(ROOT, 'targets1.txt')
const TXT2_PATH = path.join(ROOT, 'targets2.txt')
const TXT3_PATH = path.join(ROOT, 'targets3.txt')
const OUT_PATH = path.join(ROOT, 'sites.json')

const CONCURRENCY = 15
const TIMEOUT_MS = 15_000

// Known major sites that block automated requests (403) but work fine in browsers
const BROWSER_ACCESSIBLE_DOMAINS = new Set([
  'g2.com',
  'producthunt.com',
  'crunchbase.com',
  'alternativeto.net',
  'sourceforge.net',
  'stackshare.io',
  'webwiki.com',
  'eu-startups.com',
  'softwareworld.co',
  'saasworthy.com',
  'getlatka.com',
  'startupranking.com',
  'startupbuffer.com',
  'saaspo.com',
  'findatool.io',
  'designrush.com',
  'theresanaiforthat.com',
  'aitoolnet.com',
  'topapps.ai',
  'aihub.cn',
  '51aiyz.com',
])

function isBrowserAccessible(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '')
    return BROWSER_ACCESSIBLE_DOMAINS.has(hostname) ||
           [...BROWSER_ACCESSIBLE_DOMAINS].some(d => hostname.endsWith('.' + d))
  } catch { return false }
}

const CATEGORY_MAP = {
  overseas_ai_directories: 'AI Directories',
  overseas_general: 'Startup & Product Directories',
  overseas_directories: 'Web Directories (SEO)',
  chinese_ai_directories: 'Chinese AI Directories',
  chinese_general: 'Chinese General Directories',
  communities_manual: 'Communities & Forums',
  awesome_lists: 'GitHub Awesome Lists',
  reddit: 'Reddit',
}

// ──────────────────────────────────────────────
// Parse targets.yaml
// ──────────────────────────────────────────────
function parseYaml() {
  const raw = fs.readFileSync(YAML_PATH, 'utf-8')
  const doc = yaml.load(raw)
  const sites = []

  for (const [sectionKey, entries] of Object.entries(doc)) {
    if (!Array.isArray(entries)) continue
    const category = CATEGORY_MAP[sectionKey] || sectionKey

    for (const entry of entries) {
      sites.push({
        name: entry.name,
        submit_url: entry.submit_url || null,
        category,
        type: entry.type || 'form',
        auto: entry.auto || 'no',
        lang: entry.lang || 'en',
        status: entry.status || 'active',
        notes: entry.notes || '',
        source: 'yaml',
      })
    }
  }

  return sites
}

// ──────────────────────────────────────────────
// Parse targets1.txt (TSV with quirks)
// ──────────────────────────────────────────────
function parseTxt() {
  const raw = fs.readFileSync(TXT_PATH, 'utf-8')
  if (!raw.trim()) return []

  const sites = []
  const lines = raw.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    const parts = line.split('\t')

    // Expect at least name + URL. Some entries have the URL on the next line.
    if (parts.length >= 2 && parts[1].startsWith('http')) {
      const name = parts[0].trim()
      const submitUrl = parts[1].trim()
      let dr = parseFloat(parts[2]) || 0
      const pricing = (parts[3] || 'Free').trim()
      let traffic = (parts[4] || '').trim()

      // Traffic might be on the next line (e.g. "Your Story" entry)
      if (!traffic && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        if (/^\d/.test(nextLine) && !nextLine.includes('\t')) {
          traffic = nextLine
          i++
        }
      }

      sites.push({
        name,
        submit_url: submitUrl,
        dr,
        pricing,
        monthly_traffic: traffic,
        source: 'txt',
      })
    } else if (parts.length >= 1 && !parts[0].startsWith('http')) {
      // Name on this line, URL on next line (e.g. "Micro Launch\n\thttps://...")
      const name = parts[0].trim()
      if (name && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        const nextParts = nextLine.split('\t')
        if (nextParts[0]?.startsWith('http')) {
          const submitUrl = nextParts[0].trim()
          const dr = parseFloat(nextParts[1]) || 0
          const pricing = (nextParts[2] || 'Free').trim()
          const traffic = (nextParts[3] || '').trim()
          sites.push({
            name,
            submit_url: submitUrl,
            dr,
            pricing,
            monthly_traffic: traffic,
            source: 'txt',
          })
          i++
        }
      }
    }

    i++
  }

  return sites
}

// ──────────────────────────────────────────────
// Parse targets2.txt (domain-based list with DA/DR + notes)
// Format: name \t domain \t DA/DR \t notes
// ──────────────────────────────────────────────
function parseTxt2() {
  if (!fs.existsSync(TXT2_PATH)) return []
  const raw = fs.readFileSync(TXT2_PATH, 'utf-8')
  if (!raw.trim()) return []

  const sites = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    const parts = line.split('\t')
    if (parts.length < 2) continue

    const name = parts[0].trim()
    let domainOrUrl = parts[1].trim()
    const drField = (parts[2] || '').trim()
    const notes = (parts[3] || '').trim()

    if (!name || domainOrUrl === '-') continue

    // Extract DR/DA number
    let dr = 0
    const drMatch = drField.match(/(?:DR|DA)\s*(\d+)/i)
    if (drMatch) dr = parseInt(drMatch[1])

    // Build a usable URL from domain
    if (!domainOrUrl.startsWith('http')) {
      domainOrUrl = 'https://' + domainOrUrl
    }

    sites.push({
      name,
      submit_url: domainOrUrl,
      dr,
      pricing: 'Free',
      monthly_traffic: '',
      notes,
      source: 'txt2',
    })
  }

  return sites
}

// ──────────────────────────────────────────────
// Parse targets3.txt (paid sites list)
// Format: name \t submit_url \t DR \t "Paid" \t pricing \t traffic
// ──────────────────────────────────────────────
function parseTxt3() {
  if (!fs.existsSync(TXT3_PATH)) return []
  const raw = fs.readFileSync(TXT3_PATH, 'utf-8')
  if (!raw.trim()) return []

  const sites = []
  const lines = raw.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    if (!line) { i++; continue }

    const parts = line.split('\t')

    if (parts.length >= 3 && (parts[1].startsWith('http') || parts[1].includes('.'))) {
      const name = parts[0].trim()
      let submitUrl = parts[1].trim()
      if (!submitUrl.startsWith('http')) submitUrl = 'https://' + submitUrl
      const dr = parseFloat(parts[2]) || 0
      const paidLabel = (parts[3] || '').trim()
      let pricing = (parts[4] || '').trim()
      let traffic = (parts[5] || '').trim()

      // If pricing is just "$" or incomplete, check next line
      if ((pricing === '$' || pricing.endsWith('$')) && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        if (/^\d/.test(nextLine) && !nextLine.includes('http')) {
          pricing = pricing + nextLine.split('\t')[0]
          traffic = traffic || nextLine.split('\t')[1] || ''
          i++
        }
      }

      // Traffic might be on the next line
      if (!traffic && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        if (/^[\d<]/.test(nextLine) && !nextLine.includes('http') && !nextLine.includes('\t')) {
          traffic = nextLine
          i++
        }
      }

      // Mark as paid
      if (paidLabel.toLowerCase() === 'paid' && pricing) {
        pricing = `Paid — ${pricing}`
      } else if (paidLabel.toLowerCase() === 'paid') {
        pricing = 'Paid'
      }

      sites.push({
        name,
        submit_url: submitUrl,
        dr,
        pricing,
        monthly_traffic: traffic,
        notes: '',
        source: 'txt3',
      })
    } else if (parts.length >= 1 && !parts[0].startsWith('http')) {
      // Name on this line, URL on next (multi-line entry)
      const name = parts[0].trim()
      if (name && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim()
        const nextParts = nextLine.split('\t')
        if (nextParts[0]?.startsWith('http') || nextParts[0]?.includes('.')) {
          let submitUrl = nextParts[0].trim()
          if (!submitUrl.startsWith('http')) submitUrl = 'https://' + submitUrl
          const dr = parseFloat(nextParts[1]) || 0
          const paidLabel = (nextParts[2] || '').trim()
          let pricing = (nextParts[3] || '').trim()
          const traffic = (nextParts[4] || '').trim()
          if (paidLabel.toLowerCase() === 'paid' && pricing) {
            pricing = `Paid — ${pricing}`
          } else if (paidLabel.toLowerCase() === 'paid') {
            pricing = 'Paid'
          }
          sites.push({
            name,
            submit_url: submitUrl,
            dr,
            pricing,
            monthly_traffic: traffic,
            notes: '',
            source: 'txt3',
          })
          i++
        }
      }
    }

    i++
  }

  return sites
}

// ──────────────────────────────────────────────
// Merge all sources, dedup by submit_url
// ──────────────────────────────────────────────
function merge(yamlSites, ...additionalSources) {
  const byUrl = new Map()

  for (const site of yamlSites) {
    const key = normalizeUrl(site.submit_url)
    byUrl.set(key, { ...site })
  }

  for (const source of additionalSources) {
    for (const site of source) {
      const key = normalizeUrl(site.submit_url)
      if (byUrl.has(key)) {
        const existing = byUrl.get(key)
        if (site.dr && site.dr > (existing.dr || 0)) existing.dr = site.dr
        if (site.monthly_traffic && !existing.monthly_traffic) existing.monthly_traffic = site.monthly_traffic
        if (site.pricing && site.pricing !== 'Free' && existing.pricing === 'Free') existing.pricing = site.pricing
        if (site.notes && !existing.notes) existing.notes = site.notes
        existing.source = 'merged'
      } else {
        byUrl.set(key, {
          name: site.name,
          submit_url: site.submit_url,
          category: guessCategoryFromUrl(site.submit_url),
          type: 'form',
          auto: 'unknown',
          lang: 'en',
          status: 'active',
          notes: site.notes || '',
          dr: site.dr || 0,
          monthly_traffic: site.monthly_traffic || '',
          pricing: site.pricing || 'Free',
          source: site.source || 'other',
        })
      }
    }
  }

  return [...byUrl.values()]
}

function normalizeUrl(url) {
  if (!url) return ''
  try {
    const u = new URL(url)
    return u.origin + u.pathname.replace(/\/+$/, '')
  } catch {
    return url.replace(/\/+$/, '').toLowerCase()
  }
}

function guessCategoryFromUrl(url) {
  if (!url) return 'Uncategorized'
  const lower = url.toLowerCase()
  if (lower.includes('reddit.com')) return 'Reddit'
  if (lower.includes('github.com')) return 'GitHub Awesome Lists'
  if (/ai|gpt|chat/.test(lower)) return 'AI Directories'
  return 'Startup & Product Directories'
}

// ──────────────────────────────────────────────
// HTTP health check
// ──────────────────────────────────────────────
async function checkUrl(url) {
  if (!url) return { ok: false, status: 0, error: 'no_url' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })
    clearTimeout(timer)

    // Some servers reject HEAD, retry with GET
    if (res.status === 405 || res.status === 403) {
      const controller2 = new AbortController()
      const timer2 = setTimeout(() => controller2.abort(), TIMEOUT_MS)
      try {
        const res2 = await fetch(url, {
          method: 'GET',
          signal: controller2.signal,
          redirect: 'follow',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
        })
        clearTimeout(timer2)
        return { ok: res2.ok, status: res2.status, error: null }
      } catch (err) {
        clearTimeout(timer2)
        return { ok: false, status: res.status, error: err.message }
      }
    }

    return { ok: res.ok, status: res.status, error: null }
  } catch (err) {
    clearTimeout(timer)
    if (err.name === 'AbortError') {
      return { ok: false, status: 0, error: 'timeout' }
    }
    return { ok: false, status: 0, error: err.message }
  }
}

async function checkAllUrls(sites) {
  const results = new Array(sites.length)
  let idx = 0
  let checked = 0

  async function worker() {
    while (idx < sites.length) {
      const i = idx++
      const site = sites[i]
      results[i] = await checkUrl(site.submit_url)
      checked++
      const status = results[i]
      const icon = status.ok ? '✓' : '✗'
      const detail = status.error || `HTTP ${status.status}`
      process.stdout.write(`\r  [${checked}/${sites.length}] ${icon} ${site.name} — ${detail}`.padEnd(80))
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, () => worker())
  await Promise.all(workers)
  process.stdout.write('\n')

  return results
}

// ──────────────────────────────────────────────
// Build final sites.json
// ──────────────────────────────────────────────
function buildOutput(sites, checkResults, { removeDead404 = false } = {}) {
  const output = {
    meta: {
      name: 'Submit Agent — Target Sites',
      description: 'Curated list of directories and platforms for AI product submissions.',
      last_updated: new Date().toISOString().slice(0, 10),
      total_sites: 0,
      total_alive: 0,
      total_dead: 0,
      license: 'MIT',
    },
    sites: [],
  }

  for (let i = 0; i < sites.length; i++) {
    const s = sites[i]
    const check = checkResults ? checkResults[i] : null

    let healthStatus = s.status
    if (check) {
      if (check.ok) {
        healthStatus = 'alive'
      } else if (isBrowserAccessible(s.submit_url)) {
        healthStatus = 'alive'
      } else if (check.error === 'timeout') {
        healthStatus = 'timeout'
      } else if (check.status === 404) {
        healthStatus = 'dead_404'
      } else if (check.status >= 400) {
        healthStatus = `dead_${check.status}`
      } else if (check.error) {
        healthStatus = 'unreachable'
      }
    }

    // Skip confirmed 404s if removeDead404 is true
    if (removeDead404 && healthStatus === 'dead_404') continue
    // Also skip YAML entries already marked dead
    if (removeDead404 && s.status === 'dead') continue
    // Skip malformed entries (e.g. broken multi-line parsing)
    if (!s.submit_url || !s.name || s.submit_url.includes('$') || s.name.startsWith('$')) continue

    if (healthStatus === 'alive') output.meta.total_alive++
    else output.meta.total_dead++

    const drValue = (s.dr && s.dr > 0) ? s.dr : null

    output.sites.push({
      name: s.name,
      submit_url: s.submit_url,
      category: s.category,
      type: s.type || 'form',
      auto: s.auto || 'unknown',
      lang: s.lang || 'en',
      dr: drValue,
      monthly_traffic: s.monthly_traffic || '',
      pricing: s.pricing || 'Free',
      status: healthStatus,
      http_status: check?.status || null,
      notes: s.notes || '',
    })
  }

  output.meta.total_sites = output.sites.length

  // Sort: alive first, then by DR descending (nulls last)
  output.sites.sort((a, b) => {
    const aAlive = a.status === 'alive' ? 0 : 1
    const bAlive = b.status === 'alive' ? 0 : 1
    if (aAlive !== bAlive) return aAlive - bAlive
    const aDr = a.dr ?? -1
    const bDr = b.dr ?? -1
    return bDr - aDr
  })

  return output
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const skipCheck = args.includes('--skip-check')
  const checkOnly = args.includes('--check-only')
  const removeDead = args.includes('--remove-dead')

  let sites

  if (checkOnly) {
    console.log('Re-checking existing sites.json...')
    const existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf-8'))
    sites = existing.sites
  } else {
    console.log('Parsing targets.yaml...')
    const yamlSites = parseYaml()
    console.log(`  → ${yamlSites.length} entries from YAML`)

    console.log('Parsing targets1.txt...')
    const txtSites = parseTxt()
    console.log(`  → ${txtSites.length} entries from TXT`)

    console.log('Parsing targets2.txt...')
    const txt2Sites = parseTxt2()
    console.log(`  → ${txt2Sites.length} entries from TXT2`)

    console.log('Parsing targets3.txt (paid)...')
    const txt3Sites = parseTxt3()
    console.log(`  → ${txt3Sites.length} entries from TXT3 (paid)`)

    console.log('Merging (dedup by URL)...')
    sites = merge(yamlSites, txtSites, txt2Sites, txt3Sites)
    console.log(`  → ${sites.length} unique sites`)
  }

  let checkResults = null
  if (!skipCheck) {
    console.log(`\nHealth-checking ${sites.length} URLs (concurrency=${CONCURRENCY}, timeout=${TIMEOUT_MS}ms)...\n`)
    checkResults = await checkAllUrls(sites)

    const alive = checkResults.filter((r) => r.ok || isBrowserAccessible(sites[checkResults.indexOf(r)]?.submit_url)).length
    const dead = sites.length - alive
    console.log(`\n  Alive: ${alive}  |  Dead/Error: ${dead}`)
  }

  const output = buildOutput(sites, checkResults, { removeDead404: removeDead })

  if (removeDead) {
    const originalCount = sites.length
    console.log(`\n  Removed ${originalCount - output.meta.total_sites} dead (404 / yaml-dead) sites`)
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n')
  console.log(`\nWrote ${OUT_PATH}`)
  console.log(`  Total: ${output.meta.total_sites} sites (${output.meta.total_alive} alive, ${output.meta.total_dead} dead/other)`)

  // Print dead/error sites summary
  if (checkResults) {
    const problems = output.sites.filter((s) => s.status !== 'alive')
    if (problems.length > 0) {
      console.log(`\n── Remaining Non-Alive Sites (${problems.length}) ──`)
      for (const s of problems) {
        console.log(`  ${s.status.padEnd(14)} ${(s.http_status || '').toString().padEnd(4)} ${s.name} — ${s.submit_url}`)
      }
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
