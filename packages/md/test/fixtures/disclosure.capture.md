# disclosure-*.html: how they were captured

Each is a component library's own markup, rendered with React 19.3.1's `renderToStaticMarkup`, with `forceMount` and
`data-affordances-md="show"` on every panel, inside `<main><h1>…</h1>…</main>`:

- `disclosure-radix-tabs.html`: @radix-ui/react-tabs 1.2.1, a `Tabs.Root` with three `Tabs.Trigger`s (npm, pnpm,
  yarn) in a `Tabs.List`, and a `Tabs.Content` for each holding a `<pre><code>` command.
- `disclosure-fumadocs-tabs.html`: fumadocs-ui 16.18.4's `Tabs items` with a `Tab` for each, the same commands.
- `disclosure-radix-accordion.html`: @radix-ui/react-accordion 1.3.1, two `Accordion.Item`s, each a `Header` and
  `Trigger` and a `Content` holding a paragraph.
- `disclosure-radix-collapsible.html`: @radix-ui/react-collapsible 1.2.1, a paragraph, a `Trigger` and a `Content`.

With `forceMount` these render no `hidden` (the app hides closed panels with css, such as fumadocs'
`data-[state=inactive]:hidden`), so the marker's other half, keeping a panel that is `hidden`, is tested on its own.
