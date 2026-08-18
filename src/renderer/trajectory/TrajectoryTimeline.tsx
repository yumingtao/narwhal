/** TrajectoryTimeline — Chrome-Network-style overview with lanes. */

import type { TrajectorySpan } from './types'
import { kindColor } from './builder'

interface TrajectoryTimelineProps {
  readonly spans: readonly TrajectorySpan[]
  readonly selectedIndex?: number | null
  readonly onSelect?: (index: number | null) => void
}

const LANE_LABELS = ['Input', 'Model', 'Tools'] as const

export function TrajectoryTimeline({
  spans,
  selectedIndex = null,
  onSelect,
}: TrajectoryTimelineProps) {
  if (spans.length === 0) {
    return (
      <section className="trajectory-timeline-empty" aria-label="Trajectory timeline">
        <div className="trajectory-timeline-plot">
          <div className="trajectory-timeline-lanes">
            <span>Input</span>
            <span>Model</span>
            <span>Tools</span>
          </div>
          <div className="trajectory-timeline-track">
            <span className="trajectory-timeline-no-data">No timing data</span>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="trajectory-timeline-root" aria-label="Trajectory timeline">
      <div className="trajectory-timeline-plot">
        <div className="trajectory-timeline-lanes" aria-hidden="true">
          {LANE_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div
          className="trajectory-timeline-track"
          role="slider"
          aria-label="Timeline overview; click to focus events"
          tabIndex={0}
          onClick={() => onSelect?.(null)}
        >
          <div className="trajectory-timeline-lanes-track">
            {spans.map((span) => {
              const color = kindColor(span.kind)
              const isSelected = selectedIndex === span.index
              return (
                <span
                  key={span.index}
                  className="trajectory-timeline-span"
                  data-kind={span.kind}
                  data-lane={span.lane}
                  data-selected={isSelected || undefined}
                  data-error={span.isError || undefined}
                  title={`${span.kind} #${span.index}`}
                  style={{
                    left: `${span.startFraction * 100}%`,
                    width: `${span.widthFraction * 100}%`,
                    backgroundColor: color,
                  }}
                  onClick={(e) => { e.stopPropagation(); onSelect?.(span.index) }}
                />
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
