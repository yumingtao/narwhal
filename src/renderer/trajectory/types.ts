/** Trajectory view types — aligned with DSH's TrajectoryCellKind contract. */

export type TrajectoryCellKind =
  | 'system'
  | 'user'
  | 'context'
  | 'compacted'
  | 'message'
  | 'tool'
  | 'subtool'

export interface TrajectoryRecord {
  readonly id: string
  readonly index: number
  readonly kind: TrajectoryCellKind
  readonly text: string
  readonly preview?: string
  readonly turn: number
  readonly step?: number
  readonly timeSeconds: number | null
  readonly startedAt?: number | null
  readonly tokens?: {
    input?: number
    cacheRead?: number
    cacheWrite?: number
    output?: number
    reasoning?: number
  }
  readonly toolName?: string
  readonly callId?: string
  readonly isError?: boolean
  readonly inputDetail?: string
  readonly outputDetail?: string
  readonly thinkingDetail?: string
  readonly promptDetail?: string
}

export interface TrajectoryTurn {
  readonly turn: number
  readonly records: TrajectoryRecord[]
  readonly durationMs: number
}

export interface TrajectorySpan {
  readonly index: number
  readonly kind: TrajectoryCellKind
  readonly startFraction: number
  readonly widthFraction: number
  readonly lane: 0 | 1 | 2 // 0=Input, 1=Model, 2=Tools
  readonly isError?: boolean
}

export interface TrajectoryData {
  readonly turns: TrajectoryTurn[]
  readonly spans: TrajectorySpan[]
  readonly totalDurationMs: number
  readonly kindCounts: Record<TrajectoryCellKind, number>
}
