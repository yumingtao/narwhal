/** Build trajectory data from ChatItem[] — aligned with DSH's trajectory snapshot builder. */

import type { ChatItem } from '../../shared/desktop-contract'
import type {
  TrajectoryCellKind,
  TrajectoryData,
  TrajectoryRecord,
  TrajectorySpan,
  TrajectoryTurn,
} from './types'

const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'SYSTEM',
  user: 'USER',
  context: 'CONTEXT',
  compacted: 'COMPACTED',
  message: 'ASSISTANT',
  tool: 'TOOL',
  subtool: 'SUBTOOL',
}

export function kindLabel(kind: TrajectoryCellKind): string {
  return KIND_LABEL[kind]
}

export function kindColor(kind: TrajectoryCellKind): string {
  switch (kind) {
    case 'system': return '#5a8dee'   // blue
    case 'user': return '#4fc3f7'     // light blue
    case 'context': return '#9c27b0'  // purple
    case 'compacted': return '#78909c' // grey-blue
    case 'message': return '#66bb6a'  // green
    case 'tool': return '#ffa726'    // orange
    case 'subtool': return '#ff7043' // deep orange
    default: return '#78909c'
  }
}

export function kindBgClass(kind: TrajectoryCellKind): string {
  return `tk-${kind}`
}

/** Map ChatItem.kind to TrajectoryCellKind. */
function mapKind(item: ChatItem): TrajectoryCellKind {
  if (item.kind === 'user') return 'user'
  if (item.kind === 'error') return 'tool'
  const label = (item.label ?? '').toLowerCase()
  const text = item.text.toLowerCase()
  if (label.includes('system') || text.includes('system prompt')) return 'system'
  if (label.includes('context') || text.includes('context')) return 'context'
  if (label.includes('tool') || text.includes('tool')) return 'tool'
  if (label.includes('turn') && text.includes('start')) return 'system'
  if (label.includes('turn') && text.includes('complet')) return 'system'
  if (label.includes('step')) return 'message'
  if (label.includes('updated context')) return 'context'
  // Default trajectory items are assistant messages
  return 'message'
}

/** ChatItem → TrajectoryRecord. */
function toRecord(item: ChatItem, index: number, turn: number): TrajectoryRecord {
  const kind = mapKind(item)
  const time = item.time
  return {
    id: item.id,
    index,
    kind,
    text: item.text,
    preview: item.text.length > 120 ? item.text.slice(0, 120) + '…' : item.text,
    turn,
    timeSeconds: null,
    startedAt: time,
    tokens: undefined,
    isError: item.kind === 'error',
    inputDetail: kind === 'user' ? item.text : undefined,
    outputDetail: kind === 'message' ? item.text : undefined,
    thinkingDetail: undefined,
    promptDetail: kind === 'system' ? item.text : undefined,
  }
}

/** Build complete trajectory data from raw ChatItem events. */
export function buildTrajectoryData(items: readonly ChatItem[]): TrajectoryData {
  // Filter to trajectory-relevant items (trajectory, user, assistant, error)
  const trajItems = items.filter(
    (item) => item.kind === 'trajectory' || item.kind === 'user' || item.kind === 'assistant' || item.kind === 'error',
  )

  // Group into turns based on "Turn started" markers
  const turns: TrajectoryTurn[] = []
  let currentTurn: TrajectoryRecord[] = []
  let turnIndex = 1
  let kindCounts: Record<TrajectoryCellKind, number> = {
    system: 0, user: 0, context: 0, compacted: 0, message: 0, tool: 0, subtool: 0,
  }

  trajItems.forEach((item, i) => {
    const record = toRecord(item, i + 1, turnIndex)
    kindCounts[record.kind]++

    // Detect turn boundaries: system events or user messages start a new turn
    if (
      record.kind === 'system'
      || record.kind === 'user'
    ) {
      if (currentTurn.length > 0) {
        turns.push({ turn: turnIndex, records: currentTurn, durationMs: 0 })
        turnIndex++
      }
      currentTurn = []
    }
    currentTurn.push(record)
  })

  if (currentTurn.length > 0) {
    turns.push({ turn: turnIndex, records: currentTurn, durationMs: 0 })
  }

  // Build spans for timeline visualization
  const spans: TrajectorySpan[] = []
  let index = 0
  const totalRecords = turns.reduce((sum, t) => sum + t.records.length, 0) || 1

  turns.forEach((turn) => {
    turn.records.forEach((record) => {
      const lane = record.kind === 'user' || record.kind === 'system' || record.kind === 'context'
        ? 0
        : record.kind === 'message' || record.kind === 'compacted'
          ? 1
          : 2

      const width = 1 / totalRecords
      const start = index / totalRecords

      spans.push({
        index: record.index,
        kind: record.kind,
        startFraction: start,
        widthFraction: width * 0.92, // small gap between spans
        lane: lane as 0 | 1 | 2,
        isError: record.isError,
      })
      index++
    })
  })

  // Compute durations
  const totalDurationMs = turns.length
    ? turns.reduce((max, t) => {
        const first = t.records[0]?.startedAt
        const last = t.records[t.records.length - 1]?.startedAt
        if (first && last) return Math.max(max, last - first)
        return max
      }, 0)
    : 0

  return { turns, spans, totalDurationMs, kindCounts }
}
