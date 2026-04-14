// extension/src/agent/FormAnnotator.content.ts
/**
 * FormAnnotator — displays numbered labels on detected form fields.
 * Uses Shadow DOM for style isolation (same pattern as FloatButton.content.ts).
 * Runs in the content script context.
 */

const ANNOTATOR_ID = 'submit-agent-annotator'

interface FieldAnnotation {
  index: number
  selector: string
  labelEl: HTMLElement
  fieldEl: Element | null
  originalOutline: string
}

let host: HTMLElement | null = null
let shadow: ShadowRoot | null = null
let annotations: FieldAnnotation[] = []
let activeIndex: number | null = null
let rafId: number | null = null
let onScrollBound: (() => void) | null = null
let onResizeBound: (() => void) | null = null

const LABEL_SIZE = 16
const LABEL_OFFSET = -4

const COLORS = {
  default: '#D4990A',
  active: '#22C55E',
  outlineDefault: '2px dashed rgba(212, 153, 10, 0.5)',
  outlineActive: '2px solid #22C55E',
} as const

function createContainer() {
  if (document.getElementById(ANNOTATOR_ID)) return

  host = document.createElement('div')
  host.id = ANNOTATOR_ID
  host.style.cssText = [
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 100%',
    'height: 100%',
    'z-index: 2147483646',
    'pointer-events: none',
    'overflow: visible',
  ].join(';')

  shadow = host.attachShadow({ mode: 'open' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; }

    .field-label {
      position: absolute;
      width: ${LABEL_SIZE}px;
      height: ${LABEL_SIZE}px;
      border-radius: 4px;
      background: ${COLORS.default};
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.9;
      transition: background 0.2s, opacity 0.2s;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1;
    }

    .field-label.active {
      background: ${COLORS.active};
      opacity: 1;
      animation: pulse 1s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.15); }
    }
  `
  shadow.appendChild(style)

  document.body.appendChild(host)
}

function updatePositions() {
  for (const ann of annotations) {
    if (!ann.fieldEl || !ann.labelEl) continue
    // Check if element is still in DOM
    if (!document.contains(ann.fieldEl)) {
      ann.labelEl.remove()
      ann.fieldEl = null
      continue
    }
    const rect = ann.fieldEl.getBoundingClientRect()
    ann.labelEl.style.left = `${rect.left + LABEL_OFFSET}px`
    ann.labelEl.style.top = `${rect.top + LABEL_OFFSET}px`
  }
}

function schedulePositionUpdate() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    rafId = null
    updatePositions()
  })
}

function startListening() {
  onScrollBound = () => schedulePositionUpdate()
  onResizeBound = () => schedulePositionUpdate()
  window.addEventListener('scroll', onScrollBound, { passive: true })
  window.addEventListener('resize', onResizeBound, { passive: true })
}

function stopListening() {
  if (onScrollBound) window.removeEventListener('scroll', onScrollBound)
  if (onResizeBound) window.removeEventListener('resize', onResizeBound)
  onScrollBound = null
  onResizeBound = null
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
}

/**
 * Show numbered labels on detected form fields.
 */
export function annotateFields(fields: Array<{ selector: string }>) {
  clearAnnotations()
  createContainer()

  annotations = fields.map((f, i) => {
    const fieldEl = document.querySelector(f.selector)
    const labelEl = document.createElement('div')
    labelEl.className = 'field-label'
    labelEl.textContent = String(i + 1)
    shadow!.appendChild(labelEl)

    let originalOutline = ''
    if (fieldEl) {
      const el = fieldEl as HTMLElement
      originalOutline = el.style.outline
      el.style.outline = COLORS.outlineDefault
    }

    return { index: i, selector: f.selector, labelEl, fieldEl, originalOutline }
  })

  // Initial position
  updatePositions()
  startListening()
}

/**
 * Highlight the field currently being filled.
 */
export function annotateActive(index: number) {
  // Remove previous active
  if (activeIndex !== null && activeIndex < annotations.length) {
    const prev = annotations[activeIndex]
    if (prev.fieldEl) {
      (prev.fieldEl as HTMLElement).style.outline = COLORS.outlineDefault
    }
    prev.labelEl.classList.remove('active')
  }

  activeIndex = index

  if (index < 0 || index >= annotations.length) return

  const curr = annotations[index]
  if (curr.fieldEl) {
    (curr.fieldEl as HTMLElement).style.outline = COLORS.outlineActive
  }
  curr.labelEl.classList.add('active')

}

/**
 * Remove all annotations and outlines.
 */
export function clearAnnotations() {
  stopListening()

  // Remove outlines from field elements
  for (const ann of annotations) {
    if (ann.fieldEl && document.contains(ann.fieldEl)) {
      (ann.fieldEl as HTMLElement).style.outline = ann.originalOutline
    }
  }

  annotations = []
  activeIndex = null

  // Remove shadow DOM container
  if (host) {
    host.remove()
    host = null
    shadow = null
  }
}
