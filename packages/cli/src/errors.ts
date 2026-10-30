import { Schema } from 'effect'
import { CliError } from 'effect/cli'

// every failure the cli expects, each with the sentence a person (or an agent reading --json) acts on

export class NoApp extends Schema.TaggedError<NoApp>()('NoApp', { root: Schema.String }) {
  override get [CliError.userMessage]() {
    return `No app/ or src/app/ in ${this.root}. Run this from a Next.js project's root.`
  }
}

export class Codegen extends Schema.TaggedError<Codegen>()('Codegen', { message: Schema.String }) {
  override get [CliError.userMessage]() {
    return this.message
  }
}

export class Unreachable extends Schema.TaggedError<Unreachable>()('Unreachable', {
  url: Schema.String,
  reason: Schema.String,
}) {
  override get [CliError.userMessage]() {
    return `Couldn't reach ${this.url}: ${this.reason}. Is the app running?`
  }
}

export class NoGraph extends Schema.TaggedError<NoGraph>()('NoGraph', {
  url: Schema.String,
  reason: Schema.String,
}) {
  override get [CliError.userMessage]() {
    return `${this.url} has no Affordances graph: ${this.reason}`
  }
}

export class BadInput extends Schema.TaggedError<BadInput>()('BadInput', {
  reason: Schema.String,
}) {
  override get [CliError.userMessage]() {
    return `--input isn't JSON: ${this.reason}`
  }
}

export type Expected = NoApp | Codegen | Unreachable | NoGraph | BadInput
