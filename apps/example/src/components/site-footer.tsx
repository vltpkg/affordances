import Link from 'next/link'
import { categories, categoryHref } from '@/lib/content'
import { Newsletter } from './newsletter'

// the store's own pages beyond the shop aren't built in the demo; these hrefs are where a shop keeps them
const columns: [string, [string, string][]][] = [
  [
    'Shop',
    [
      ...categories().map(([category]): [string, string] => [category, categoryHref(category)]),
      ['All products', '/#products'],
    ],
  ],
  [
    'Help',
    [
      ['Shipping', '/pages/shipping'],
      ['Returns & exchanges', '/pages/returns'],
      ['FAQ', '/pages/faq'],
      ['Track an order', '/account/orders'],
      ['Contact us', 'mailto:hello@affordsupply.example'],
    ],
  ],
  [
    'Company',
    [
      ['About', '/pages/about'],
      ['Journal', '/blogs/journal'],
      ['Stockists', '/pages/stockists'],
      ['Careers', '/pages/careers'],
    ],
  ],
]

const legal: [string, string][] = [
  ['Privacy policy', '/policies/privacy-policy'],
  ['Terms of service', '/policies/terms-of-service'],
  ['Refund policy', '/policies/refund-policy'],
  ['Accessibility', '/pages/accessibility'],
]

const payments = ['Visa', 'Mastercard', 'American Express', 'Apple Pay', 'Google Pay']

const link =
  'rounded-sm text-muted-foreground transition-colors duration-150 ease-out outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30'

export const SiteFooter = () => (
  <footer className="border-t text-sm">
    <div className="mx-auto grid max-w-5xl grid-cols-2 gap-10 px-4 py-12 sm:grid-cols-3 sm:px-6 md:grid-cols-[1fr_1fr_1fr_minmax(0,1.6fr)]">
      {columns.map(([heading, links]) => (
        <nav key={heading} aria-labelledby={`footer-${heading}`}>
          <h2 id={`footer-${heading}`} className="font-medium">
            {heading}
          </h2>
          <ul className="mt-3 space-y-2">
            {links.map(([label, href]) => (
              <li key={label}>
                <Link href={href} className={link}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ))}
      <section
        aria-labelledby="footer-newsletter"
        className="col-span-2 sm:col-span-3 md:col-span-1"
      >
        <h2 id="footer-newsletter" className="font-medium">
          Get new runs first
        </h2>
        <p className="mt-3 max-w-sm text-pretty text-muted-foreground">
          One email when something new is made, never more than once a month.
        </p>
        <Newsletter />
      </section>
    </div>
    <div className="border-t">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 text-xs text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
          <p>© 2026 Afford Supply. A demo store: nothing ships.</p>
          <ul aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
            {legal.map(([label, href]) => (
              <li key={label}>
                <Link href={href} className={link}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <ul aria-label="Payment methods" className="flex flex-wrap gap-1.5">
          {payments.map((method) => (
            <li key={method} className="rounded-sm border px-1.5 py-0.5 text-[11px] leading-4">
              {method}
            </li>
          ))}
        </ul>
      </div>
    </div>
  </footer>
)
