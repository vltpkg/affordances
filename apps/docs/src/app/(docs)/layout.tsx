import { Suspense } from 'react'
import { SidebarInset } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { Navbar } from '@/components/navbar'
import { SidebarProvider } from '@/providers/sidebar-provider'
import { source } from '@/lib/source'

// the docs shell, for /docs/… and /agents: navbar, sidebar, and the inset the page renders in
const DocsLayout = ({ children }: LayoutProps<'/'>) => (
  <SidebarProvider>
    <Navbar sidebar />
    <div className="flex flex-1">
      {/* the sidebar is `fixed`, so it's pushed below the navbar explicitly.
          it reads usePathname(), which is only known at request time for urls that weren't prerendered
          (a 404, a probe like /.well-known/…); Suspense lets those stream it in instead of blocking the shell */}
      <Suspense>
        <AppSidebar
          tree={source.pageTree}
          className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
        />
      </Suspense>
      <SidebarInset className="px-4 py-8 md:px-16 md:py-12">{children}</SidebarInset>
    </div>
  </SidebarProvider>
)

export default DocsLayout
