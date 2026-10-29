import { Bluesky } from '@/components/icons/bluesky'
import { Discord } from '@/components/icons/discord'
import { Github } from '@/components/icons/github'
import { Linkedin } from '@/components/icons/linkedin'
import { TwitterX } from '@/components/icons/twitterx'
import { ThemeSwitcher } from '@/components/theme-switcher'

// from vlt.io's content/marketing/socials.ts
const socials = [
  { href: 'https://github.com/vltpkg/vltpkg', label: 'vltpkg on GitHub', Icon: Github },
  { href: 'https://www.linkedin.com/company/vltpkg/', label: 'vlt on LinkedIn', Icon: Linkedin },
  { href: 'https://x.com/vltpkg', label: 'vlt on X', Icon: TwitterX },
  { href: 'https://bsky.app/profile/vlt.sh', label: 'vlt on Bluesky', Icon: Bluesky },
  { href: 'https://discord.gg/qdbXTqxZzZ', label: 'vlt on Discord', Icon: Discord },
]

// the socials and the theme switcher in one bordered strip: the docs sidebar's footer and the site footer
export const SocialStrip = ({ className }: { className?: string }) => (
  <div className={`bg-card flex items-center rounded-xl border p-1 ${className ?? ''}`}>
    {socials.map(({ href, label, Icon }) => (
      <a
        key={href}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 grid size-8 place-items-center rounded-md transition-colors outline-none focus-visible:ring-2"
      >
        <Icon aria-hidden className="size-4" />
      </a>
    ))}
    <div aria-hidden className="bg-border mr-1 ml-auto h-5 w-px" />
    <ThemeSwitcher />
  </div>
)
