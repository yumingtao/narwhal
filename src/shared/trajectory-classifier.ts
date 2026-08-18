/**
 * Shared trajectory event classification.
 * Used by both host-bridge.ts (Node.js) and main.tsx (React) to ensure
 * consistent event-to-label mapping across the stack.
 *
 * "Trajectory" is the DeepSeek Harness (DSH) native term for the full
 * execution event stream — turns, tool calls, steps, context updates, etc.
 * "Activity" is reserved for usage analytics (heatmap, summaries).
 */

export type TrajectoryKind = 'trajectory' | 'error'
export type TrajectoryType = 'work' | 'complete' | 'context' | 'error' | 'request' | 'info'

export interface TrajectoryDescriptor {
  readonly label: string
  readonly text: string
  readonly kind: TrajectoryKind
  readonly type: TrajectoryType
  readonly hidden: boolean
}

const HIDDEN_PATTERN = /(permission|sandbox|approval|preset|session[/-]title|request[/-](context|header)|agent[/-]inbox|session[/-]end[/-]seed)/u

/**
 * Classify a raw event into a normalized descriptor for display.
 * This is the single source of truth — both host and renderer must agree.
 */
export function classifyTrajectory(
  eventType: string,
  eventLabel: string | undefined,
  eventText: string,
  kind: 'user' | 'assistant' | 'trajectory' | 'error',
): TrajectoryDescriptor {
  const source = `${eventLabel ?? ''} ${eventText}`.toLowerCase()
  const normalized = eventType.toLowerCase()

  // Error events
  if (kind === 'error' || normalized === 'error' || normalized.endsWith('/error')) {
    return { label: 'Agent needs attention', text: eventText || 'The local Agent reported an error.', kind: 'error', type: 'error', hidden: false }
  }

  // Hidden / internal events
  if (HIDDEN_PATTERN.test(normalized) || HIDDEN_PATTERN.test(source)) {
    return { label: '', text: '', kind: 'trajectory', type: 'context', hidden: true }
  }

  // Turn lifecycle
  if (normalized === 'turn/start' || source.includes('turn started')) {
    return { label: 'Turn started', text: 'The Agent started working on your request.', kind: 'trajectory', type: 'work', hidden: false }
  }
  if (normalized === 'turn/end' || source.includes('completed a turn') || source.includes('turn complete') || source.includes('turn completed')) {
    return { label: 'Turn completed', text: 'The Agent finished this response.', kind: 'trajectory', type: 'complete', hidden: false }
  }

  // Step lifecycle
  if (/(step[/-]start|analysis[/-]start|plan[/-]start)/u.test(normalized) || source.includes('step start')) {
    return { label: 'Started analysis', text: 'The Agent began the next work step.', kind: 'trajectory', type: 'work', hidden: false }
  }
  if (/(step[/-]end|analysis[/-]end|plan[/-]end)/u.test(normalized) || source.includes('step end')) {
    return { label: 'Step completed', text: 'The Agent completed a work step.', kind: 'trajectory', type: 'complete', hidden: false }
  }

  // Tool operations
  if (normalized === 'tool/call') {
    return { label: 'Used local tool', text: 'The Agent is working in the local workspace.', kind: 'trajectory', type: 'work', hidden: false }
  }
  if (normalized === 'tool/result' || source.includes('tool completed') || source.includes('result')) {
    return { label: 'Tool completed', text: 'The local workspace operation finished.', kind: 'trajectory', type: 'complete', hidden: false }
  }
  if (source.includes('tool')) {
    return { label: 'Used local tool', text: 'The Agent worked in the local workspace.', kind: 'trajectory', type: 'work', hidden: false }
  }

  // Context updates
  if (/(context|workspace)/u.test(normalized) || source.includes('context') || source.includes('workspace')) {
    return { label: 'Updated context', text: 'Workspace context was refreshed for this turn.', kind: 'trajectory', type: 'context', hidden: false }
  }

  // Default
  return { label: 'Agent progress updated', text: 'The Agent updated its local work state.', kind: 'trajectory', type: 'work', hidden: false }
}
