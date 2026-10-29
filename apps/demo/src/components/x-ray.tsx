'use client'

import { cn } from 'cn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@affordances/ui/components/dialog'
import { agentsOf, kb, LANE, NAMES, type DemoEvent } from '@/lib/race'

// what each model is handed before the task: the system prompt (the affordances agent's carries the site
// index; the webmcp agent's one sentence about page tools) and its tools. the task prompt is the same for all
export const XRay = ({
  open,
  onOpenChange,
  events,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  events: DemoEvent[]
}) => {
  const run = events.find((e) => e.type === 'run')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88dvh] gap-6 overflow-y-auto p-7 text-[15px] sm:max-w-6xl">
        <div>
          <DialogTitle className="text-2xl font-medium tracking-tight">
            What each model is given before the task
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-[15px]">
            Then both get the same message:{' '}
            <span className="text-foreground">“{run?.task.prompt}”</span>
          </DialogDescription>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {agentsOf(events).map((agent) => {
            const setup = events.find((e) => e.type === 'agent' && e.agent === agent)
            if (setup?.type !== 'agent') return null
            // tools pages registered along the way (WebMCP): never in the prompt, only in the toolbox
            const builtins = new Set(setup.tools.map((tool) => tool.name))
            const page = [
              ...new Set(
                events.flatMap((e) =>
                  e.type === 'turn' && e.agent === agent
                    ? (e.tools ?? []).filter((name) => !builtins.has(name))
                    : [],
                ),
              ),
            ]
            return (
              <section key={agent} className={cn('flex min-w-0 flex-col gap-4', LANE[agent])}>
                <h3 className="flex items-center gap-2.5 text-lg font-medium">
                  <span aria-hidden className="size-2.5 rounded-full bg-(--lane)" />
                  {NAMES[agent]}
                </h3>
                <div>
                  <p className="flex justify-between text-[13px] text-muted-foreground">
                    System prompt <span className="font-mono">{kb(setup.system.length)}</span>
                  </p>
                  <pre className="mt-1.5 max-h-[40dvh] overflow-auto rounded-lg border bg-background p-3 font-mono text-xs/[1.6] whitespace-pre-wrap text-muted-foreground">
                    {setup.system}
                  </pre>
                </div>
                <div>
                  <p className="text-[13px] text-muted-foreground">Tools</p>
                  <ul className="mt-1.5 flex flex-col gap-2">
                    {setup.tools.map((tool) => (
                      <li key={tool.name} className="rounded-lg border p-3">
                        <p className="font-mono text-[14px] font-medium">{tool.name}</p>
                        <p className="mt-0.5 text-[14px] text-pretty text-muted-foreground">
                          {tool.description}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                {page.length > 0 && (
                  <div>
                    <p className="text-[13px] text-muted-foreground">
                      Registered by pages during the run, in the toolbox only while on that page
                    </p>
                    <p className="mt-1.5 flex flex-wrap gap-1.5 font-mono text-[14px]">
                      {page.map((name) => (
                        <span key={name} className="rounded-md bg-afford/15 px-1.5 text-afford">
                          {name}
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
