// every section opens the same way: a label, the claim, and a short lede
export const SectionHead = ({
  eyebrow,
  title,
  id,
  children,
}: {
  eyebrow: string
  title: string
  id: string
  children?: React.ReactNode
}) => (
  <div className="mb-12 max-[899px]:mb-10">
    <p className="mb-4 font-pixel text-sm text-(--fg3)">{eyebrow}</p>
    <h2
      id={id}
      className="max-w-[820px] text-[44px] leading-[1.06] font-semibold tracking-[-0.04em] text-balance max-[899px]:text-[34px]"
    >
      {title}
    </h2>
    {children && (
      <p className="mt-5 max-w-[620px] text-lg leading-[1.6] text-pretty text-(--fg2)">
        {children}
      </p>
    )}
  </div>
)

export const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded-[5px] bg-(--bg3) px-[5px] py-px font-mono text-[0.86em] text-(--fg)">
    {children}
  </code>
)
