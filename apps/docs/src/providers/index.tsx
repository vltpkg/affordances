import { ThemeProvider } from '@afford/ui/components/theme-provider'
import { Toaster } from '@afford/ui/components/sonner'
import { TooltipProvider } from '@afford/ui/components/tooltip'

// what every page needs; the docs shell adds its own SidebarProvider (providers/sidebar-provider.tsx)
export const Providers = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <ThemeProvider>
    <TooltipProvider>{children}</TooltipProvider>
    <Toaster />
  </ThemeProvider>
)
