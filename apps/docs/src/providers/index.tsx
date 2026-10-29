import { ThemeProvider } from '@afford/ui/components/theme-provider'
import { Toaster } from '@afford/ui/components/sonner'
import { TooltipProvider } from '@afford/ui/components/tooltip'
import { SidebarProvider } from './sidebar-provider'

export const Providers = ({ children }: Readonly<{ children: React.ReactNode }>) => (
  <ThemeProvider>
    <TooltipProvider>
      <SidebarProvider>{children}</SidebarProvider>
    </TooltipProvider>
    <Toaster />
  </ThemeProvider>
)
