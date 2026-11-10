---
'@affordances/md': minor
---

`data-affordances-md="show"` keeps a panel people open on the page, such as a tab panel or an accordion's content, even when it's `hidden`. Each tab panel is headed by its tab's label, and its tab list is left out. Put it on Radix's, shadcn's or fumadocs' panel next to `forceMount`: `<TabsContent forceMount data-affordances-md="show">`. Without the marker, a hidden panel is still dropped like anything else people can't see.
