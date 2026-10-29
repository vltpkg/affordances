import { Suspense } from 'react'
import { AppSidebar } from '@/components/app-sidebar'
import { Navbar } from '@/components/navbar'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { sections } from '@/lib/source'

const DocsLayout = ({ children }: LayoutProps<'/'>) => (
  <SidebarProvider className="flex-col">
    <Navbar sidebar />
    <div className="flex flex-1">
      {/* the sidebar is fixed, so it's pushed below the navbar explicitly. it reads usePathname(), which is
          only known at request time for urls that weren't prerendered, so Suspense lets those stream it in */}
      <Suspense>
        <AppSidebar
          groups={sections()}
          className="top-(--header-height) h-[calc(100svh-var(--header-height))]"
        />
      </Suspense>
      <SidebarInset className="px-4 py-8 md:px-16 md:py-12">{children}</SidebarInset>
    </div>
  </SidebarProvider>
)

export default DocsLayout
