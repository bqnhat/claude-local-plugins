export type StepStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type PlanSubstep = { title: string; status: StepStatus; startedAt?: number; endedAt?: number }
export type PlanStep = { title: string; status: StepStatus; substeps: PlanSubstep[]; startedAt?: number; endedAt?: number }
export type PlanStage = { name: string; steps: PlanStep[] }
export type PlanState = 'running' | 'needs_input' | 'error' | 'done'
export type AgentRun = {
  id: string
  title: string
  state: 'running' | 'waiting' | 'done' | 'error'
  tool: string
  startedAt: number
  endedAt: number | null
  depth: number
}
export type Plan = {
  id: string
  title: string
  kind: 'plan' | 'todo'
  stages: PlanStage[]
  state: PlanState
  note: string | null
  startedAt: number
  updatedAt?: number
  agents?: AgentRun[]
  agentsDoneAt?: number | null
  hidden?: boolean
  isFolded?: boolean
}

export type SuggestionKind = 'verify' | 'dig' | 'advance' | 'decide'
export type Suggestion = { kind: SuggestionKind; label: string; why: string; prompt: string }
export type View = { kind: 'hidden' } | { kind: 'loading'; turnId: string } | { kind: 'offer'; items: Suggestion[]; goal: string }
export type OfferRecord = { labels: string[]; picked: number | null }

export type CacheTtl = '5m' | '1h'

export type CacheSample = { turn: number; turnId: string; at: number; read: number; write: number; fresh: number; model: string }
export type CacheView = 'tokens' | 'savings'

export type HubSection = 'progress' | 'next' | 'calls' | 'cache'
export type HubPaneState = 'down' | 'up' | 'unplaced'

export type CallKind = 'skill' | 'agent'
export type CallStatus = 'running' | 'done' | 'failed'
export type CallVia = 'model' | 'slash'
export type OriginScope = 'personal' | 'project' | 'local' | 'managed' | 'plugin' | 'builtin' | 'mcp' | 'synced' | 'memory' | 'unknown'
export type CallOrigin = { scope: OriginScope; plugin?: string }
export type SourceMap = Record<string, CallOrigin>
export type CallEntry = {
  id: string
  kind: CallKind
  name: string
  via: CallVia
  turn: number
  startedAt: number
  endedAt?: number
  status: CallStatus
  origin: CallOrigin
  description?: string
  model?: string
  isBackground?: boolean
  isRemote?: boolean
  loopId?: string
  agentId?: string
}
export type CallTurn = { turn: number; at: number }
export type LoadedFile = { path: string; scope: OriginScope; firstTurn: number }

declare module 'claude-code' {
  interface PluginState {
    'session-hub': {
      plans: Plan[]
      isOpen: boolean
      tick: number
      isRestoreChecked: boolean
      isExpanded: boolean
      backgroundTaskIds: string[]
      expandedIds: string[]
      isHistoryOpen: boolean
      paneState: HubPaneState
      section: HubSection
      view: View
      history: OfferRecord[]
      lastResponseAt: number | null
      ttl: CacheTtl | null
      cacheLabel: string
      cacheSamples: CacheSample[]
      cacheView: CacheView
      calls: CallEntry[]
      callTurns: CallTurn[]
      callTurn: number
      isCallTurnRunning: boolean
      loadedFiles: LoadedFile[]
      skillSources: SourceMap
      agentSources: SourceMap
      callTick: number
      isFilesShown: boolean
      isCallHistoryOpen: boolean
    }
  }
}

export type LiveTime = { from: number; format: 'span' | 'short' | 'elapsed'; tail?: string }
export type ShownTime = string | LiveTime
