import { Navbar } from '@/components/navbar'
import { SiteFooter } from '@/components/site-footer'
import '@/styles/marketing.css'

// the marketing page's shell: our header and the site footer, no sidebar
const MarketingLayout = ({ children }: LayoutProps<'/'>) => (
  <>
    <Navbar />
    {children}
    <SiteFooter />
  </>
)

export default MarketingLayout
