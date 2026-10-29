import { SidebarProvider as ShadcnSidebarProvider } from '@/components/ui/sidebar'

export const SidebarProvider = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  // column: the navbar sits on top, sidebar + content share the row below it
  <ShadcnSidebarProvider
    className="flex-col"
    style={{ '--sidebar-width': '18rem' } as React.CSSProperties}
  >
    {children}
  </ShadcnSidebarProvider>
)
