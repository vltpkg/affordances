#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { Command } from 'effect/cli'
import { affordances } from './commands.ts'
import pkg from '../package.json' with { type: 'json' }

Command.run(affordances, { version: pkg.version }).pipe(
  Effect.provide(NodeServices.layer),
  // Command.run already printed the error's message; don't log it again as a stack
  NodeRuntime.runMain({ disableErrorReporting: true }),
)
