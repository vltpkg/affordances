import { Console, Effect, Option } from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/cli'
import { call, open } from './agent.ts'
import * as format from './format.ts'
import { build, init } from './project.ts'

const json = Flag.Boolean('json').pipe(
  Flag.withDescription('Print the result as JSON, for scripts and agents'),
  Flag.withDefault(false),
)
const token = Flag.String('token').pipe(
  Flag.withDescription('Send as Authorization: Bearer, to act as a signed-in user'),
  Flag.optional,
)
const url = Argument.String('url').pipe(
  Argument.withDescription('A page, e.g. localhost:3000/products/tee'),
)

// one result, two readers: a person gets text, --json gets { ok, ...result } or { ok: false, error }, and a
// failure exits 1 either way. expected failures carry a sentence (CliError.userMessage); others, like a file
// that can't be written, their own message
const exitIf = (fail: boolean) => Effect.sync(() => void (fail && (process.exitCode = 1)))

const respond = <A extends object, E extends { _tag: string; message?: string }, R>(
  asJson: boolean,
  program: Effect.Effect<A, E, R>,
  human: (result: A) => string,
  // a result that is itself a failure, like a refused call: still printed, but ok: false and exit 1
  failed: (result: A) => boolean = () => false,
) =>
  asJson
    ? program.pipe(
        Effect.matchEffect({
          onSuccess: (result) =>
            Console.log(JSON.stringify({ ok: !failed(result), ...result }, null, 2)).pipe(
              Effect.andThen(exitIf(failed(result))),
            ),
          onFailure: (error) =>
            Console.log(
              JSON.stringify(
                {
                  ok: false,
                  error: {
                    code: error._tag,
                    message: CliError.getUserMessage(error) ?? error.message,
                  },
                },
                null,
                2,
              ),
            ).pipe(Effect.andThen(exitIf(true))),
        }),
      )
    : program.pipe(
        Effect.flatMap((result) =>
          Console.log(human(result)).pipe(Effect.andThen(exitIf(failed(result)))),
        ),
      )

const cwd = () => process.cwd()

const initCommand = Command.make('init', { json }, (o) =>
  respond(o.json, init(cwd()), format.initDone),
).pipe(
  Command.withDescription(
    'Set up Affordances in this Next.js app: the route handler, withAffordances in next.config, .gitignore, and a first manifest. Skips what is already done.',
  ),
)

const buildCommand = Command.make('build', { json }, (o) =>
  respond(o.json, build(cwd()), format.built),
).pipe(
  Command.withDescription(
    'Regenerate .affordances/manifest.ts. withAffordances does this when Next starts; use it in scripts and CI.',
  ),
)

const openCommand = Command.make('open', { url, token, json }, (o) =>
  respond(o.json, open(o.url, Option.getOrUndefined(o.token)), format.graph),
).pipe(
  Command.withDescription(
    'Show a page exactly as an agent sees it: its graph, and about what it costs to read.',
  ),
)

const callCommand = Command.make(
  'call',
  {
    url,
    action: Argument.String('action').pipe(
      Argument.withDescription('The action name, e.g. addToCart'),
    ),
    input: Flag.String('input').pipe(
      Flag.withDescription('The input as JSON, e.g. \'{"sku":"tee-m"}\''),
      Flag.optional,
    ),
    confirm: Flag.Boolean('confirm').pipe(
      Flag.withDescription('Confirm an action exposed as confirm, after the person approves'),
      Flag.withDefault(false),
    ),
    token,
    json,
  },
  (o) =>
    respond(
      o.json,
      call(o.url, o.action, {
        input: Option.getOrUndefined(o.input),
        confirm: o.confirm,
        token: Option.getOrUndefined(o.token),
      }),
      format.delta,
      (r) => !r.delta.ok,
    ),
).pipe(
  Command.withDescription('Call an action on a page the way an agent does, and print the delta.'),
)

export const affordances = Command.make('affordances').pipe(
  Command.withDescription('Make a Next.js app agent-operable, and see it the way agents do.'),
  Command.withSubcommands([initCommand, buildCommand, openCommand, callCommand]),
)
