import { describe, it, expect, beforeEach } from 'vitest'
import { JSDOM } from 'jsdom'

// Import after DOM is available
let waitForAnalysisFields: typeof import('@/agent/FormAnalyzer').waitForAnalysisFields
let dom: JSDOM

describe('waitForAnalysisFields', () => {
  beforeEach(async () => {
    dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      runScripts: 'dangerously',
      url: 'https://example.com',
    })
    const mod = await import('@/agent/FormAnalyzer')
    waitForAnalysisFields = mod.waitForAnalysisFields
  })

  function getDoc(): Document {
    return dom.window.document
  }

  it('字段已存在时立即返回非空字段', async () => {
    const doc = getDoc()
    doc.body.innerHTML = '<form><textarea name="comment"></textarea></form>'
    const result = await waitForAnalysisFields(doc, 1000)
    expect(result.fields.length).toBeGreaterThan(0)
  })

  it('字段延迟出现时轮询等待', async () => {
    const doc = getDoc()
    doc.body.innerHTML = '<form></form>'
    setTimeout(() => {
      doc.body.innerHTML = '<form><textarea name="comment"></textarea></form>'
    }, 100)
    const result = await waitForAnalysisFields(doc, 2000)
    expect(result.fields.length).toBeGreaterThan(0)
  })

  it('超时仍无字段时返回空 analysis', async () => {
    const doc = getDoc()
    doc.body.innerHTML = '<form></form>'
    const result = await waitForAnalysisFields(doc, 400)
    expect(result.fields.length).toBe(0)
  })
})
