/** TrajectoryTable — turn-aware event ledger with kind badges and token counts. */

import type { TrajectoryRecord, TrajectoryTurn } from './types'
import { kindLabel, kindColor } from './builder'

interface TrajectoryTableProps {
  readonly turns: readonly TrajectoryTurn[]
  readonly selectedIndex?: number | null
  readonly onSelect?: (index: number | null) => void
  readonly searchQuery?: string
}

function KindBadge({ kind }: { kind: TrajectoryRecord['kind'] }) {
  const color = kindColor(kind)
  return (
    <span
      className="trajectory-kind-badge"
      style={{ backgroundColor: color + '22', color, borderColor: color + '55' }}
    >
      {kindLabel(kind)}
    </span>
  )
}

function TokenCount({ tokens }: { tokens?: TrajectoryRecord['tokens'] }) {
  if (!tokens) return null
  const parts: string[] = []
  if (tokens.input) parts.push(`${tokens.input.toLocaleString()} in`)
  if (tokens.cacheRead) parts.push(`${tokens.cacheRead.toLocaleString()} cr`)
  if (tokens.cacheWrite) parts.push(`${tokens.cacheWrite.toLocaleString()} cw`)
  if (tokens.output) parts.push(`${tokens.output.toLocaleString()} out`)
  if (tokens.reasoning) parts.push(`${tokens.reasoning.toLocaleString()} r`)
  if (parts.length === 0) return null
  return <span className="trajectory-token-count" title="Token counts">{parts.join(' · ')}</span>
}

function TrajectoryRow({
  record,
  selected,
  onSelect,
}: {
  record: TrajectoryRecord
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      className={`trajectory-row ${selected ? 'selected' : ''}`}
      data-kind={record.kind}
      aria-selected={selected}
      onClick={onSelect}
    >
      <span className="trajectory-row-index">#{record.index}</span>
      <KindBadge kind={record.kind} />
      <span className="trajectory-row-preview" title={record.text}>
        {record.preview || record.text}
      </span>
      <TokenCount tokens={record.tokens} />
      {record.timeSeconds !== null && (
        <span className="trajectory-row-time">{Math.round(record.timeSeconds * 1000)} ms</span>
      )}
    </button>
  )
}

export function TrajectoryTable({
  turns,
  selectedIndex = null,
  onSelect,
  searchQuery = '',
}: TrajectoryTableProps) {
  if (turns.length === 0) {
    return (
      <div className="trajectory-table-empty">
        <p>No trajectory events yet.</p>
        <small>Send a message to start capturing the Agent's execution trace.</small>
      </div>
    )
  }

  const query = searchQuery.toLowerCase().trim()

  return (
    <div className="trajectory-table" role="table" aria-label="Trajectory event ledger">
      {turns.map((turn) => {
        const filteredRecords = query
          ? turn.records.filter((r) =>
              r.text.toLowerCase().includes(query)
              || r.kind.toLowerCase().includes(query),
            )
          : turn.records

        if (query && filteredRecords.length === 0) return null

        return (
          <div className="trajectory-turn-group" key={`turn-${turn.turn}`}>
            <div className="trajectory-turn-header" role="row">
              <span className="trajectory-turn-label">Turn {turn.turn}</span>
              <span className="trajectory-turn-count">
                {filteredRecords.length} record{filteredRecords.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="trajectory-turn-records">
              {filteredRecords.map((record) => (
                <TrajectoryRow
                  key={record.id}
                  record={record}
                  selected={selectedIndex === record.index}
                  onSelect={() => onSelect?.(record.index)}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
