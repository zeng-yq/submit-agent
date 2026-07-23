// src/agent/pipeline/fill.ts
import type { FillResponse } from '@/messaging/messages'
import type { FormFillDeps, FillPhaseInput, FillPhaseOutput } from './types'

const FILL_TIMEOUT_MS = 10_000

/**
 * 逐字段高亮+填写：annotate-active → sleep 150ms → fill，累加 filled/failed。
 * 搬运自原 executeFormFill Step 4b（FormFillEngine.ts:386-427）。
 */
export async function fillPhase(deps: FormFillDeps, input: FillPhaseInput): Promise<FillPhaseOutput> {
  const { fieldsToFill } = input

  deps.log('info', 'fill', `正在填写 ${fieldsToFill.length} 个字段...`, {
    fields: fieldsToFill.map(f => ({ id: f.canonical_id, value: f.value.slice(0, 50) })),
  })

  let filledCount = 0
  let failedCount = 0

  for (let i = 0; i < fieldsToFill.length; i++) {
    const field = fieldsToFill[i]

    await deps.sendToTabMessage(
      { type: 'TAB_COMMAND', action: 'annotate-active', payload: { index: i } },
      3000,
    ).catch(() => {})

    // Small delay so user can see the highlight
    await new Promise(r => setTimeout(r, 150))

    const fillResponse = await deps.sendToTabMessage<FillResponse>(
      { type: 'TAB_COMMAND', action: 'fill', payload: { fields: [field] } },
      FILL_TIMEOUT_MS,
    )

    filledCount += fillResponse?.filled ?? 0
    failedCount += fillResponse?.failed ?? 0

    deps.log('info', 'fill', `字段 ${field.canonical_id}: ${fillResponse?.filled ? '成功' : '失败'}`, {
      canonicalId: field.canonical_id,
      value: field.value.slice(0, 50),
    })
  }

  if (failedCount > 0) {
    deps.log('warning', 'fill', `填写完成: ${filledCount} 成功, ${failedCount} 失败`)
  } else {
    deps.log('success', 'fill', `填写完成: ${filledCount} 个字段已成功填写`)
  }

  return { filled: filledCount, failed: failedCount }
}
