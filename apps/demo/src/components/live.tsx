'use client'

import { useState } from 'react'
import { RadioIcon } from 'lucide-react'
import { Button } from '@affordances/ui/components/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@affordances/ui/components/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@affordances/ui/components/select'
import { LIVE_MODELS, LIVE_PAIRINGS, LIVE_TASKS } from '@/lib/live'
import { modelName, STORIES, type AgentKind } from '@/lib/race'

export type LiveState = { task: string; model: string; agents: AgentKind[] } & (
  | { status: 'starting' | 'done' }
  | { status: 'running'; startedAt: number }
  | { status: 'error'; error: string }
)

const Field = ({
  label,
  value,
  onChange,
  items,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  items: { value: string; label: string }[]
}) => (
  <label className="flex flex-col gap-1.5 text-[13px] text-muted-foreground">
    {label}
    <Select value={value} onValueChange={(v) => v && onChange(v)} items={items}>
      <SelectTrigger className="h-9 w-full px-3 text-sm text-foreground">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value} className="min-h-8 text-sm">
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </label>
)

// a real race against the api, streamed from apps/bench's recorder as it happens
export const LiveDialog = ({
  busy,
  onStart,
}: {
  busy: boolean
  onStart: (task: string, model: string, agents: string) => void
}) => {
  const [agents, setAgents] = useState<string>(LIVE_PAIRINGS[0].agents)
  const [task, setTask] = useState('add-to-cart')
  const [model, setModel] = useState(LIVE_MODELS[0]!)
  const tasks = LIVE_PAIRINGS.find((p) => p.agents === agents)!.tasks as readonly string[]
  return (
    <Dialog>
      <DialogTrigger
        render={<Button variant="outline" className="h-9 gap-2 px-3 text-sm" disabled={busy} />}
      >
        <RadioIcon className="size-4" />
        Live
      </DialogTrigger>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        <div>
          <DialogTitle className="text-lg font-medium">Run a live race</DialogTitle>
          <DialogDescription className="mt-1 text-[14px] text-pretty">
            Two agents race on a fresh store, calling the API for real. It costs a few cents and
            isn’t saved; record with <code className="font-mono">vlr record</code> to keep one.
          </DialogDescription>
        </div>
        <Field
          label="Race"
          value={agents}
          onChange={(next) => {
            setAgents(next)
            const allowed = LIVE_PAIRINGS.find((p) => p.agents === next)!.tasks as readonly string[]
            if (!allowed.includes(task)) setTask(allowed[0]!)
          }}
          items={LIVE_PAIRINGS.map((p) => ({ value: p.agents, label: STORIES[p.story] }))}
        />
        <Field
          label="Task"
          value={task}
          onChange={setTask}
          items={LIVE_TASKS.filter((t) => tasks.includes(t.id)).map((t) => ({
            value: t.id,
            label: t.prompt,
          }))}
        />
        <Field
          label="Model"
          value={model}
          onChange={setModel}
          items={LIVE_MODELS.map((m) => ({ value: m, label: modelName(m) }))}
        />
        <DialogClose
          render={<Button className="h-9 text-sm" onClick={() => onStart(task, model, agents)} />}
        >
          Start the race
        </DialogClose>
      </DialogContent>
    </Dialog>
  )
}
