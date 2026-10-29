// the storefront copy a real shop carries around its catalog: reviews, care, shipping, testimonials.
// static, so none of it reaches the graph; the agent's view of each page stays what state.ts returns.

import { listProducts, type Product } from './store'

export type Review = {
  author: string
  location: string
  date: string
  rating: number
  title: string
  body: string
  // what they bought, as the variant picker names it
  bought?: string
}

// review counts by star, 5 down to 1; the reviews shown are the most recent few
type Reviews = { counts: [number, number, number, number, number]; recent: Review[] }

const reviews: Record<string, Reviews> = {
  'heavyweight-tee': {
    counts: [98, 21, 5, 1, 1],
    recent: [
      {
        author: 'Daniel K.',
        location: 'Chicago, IL',
        date: '2026-10-12',
        rating: 5,
        title: 'Finally a tee that keeps its collar',
        body: 'Twenty washes in and the neck still sits flat. The fabric is properly heavy without being stiff. I bought a second one a week later.',
        bought: 'Size M',
      },
      {
        author: 'Priya S.',
        location: 'Austin, TX',
        date: '2026-09-28',
        rating: 4,
        title: 'Great weight, runs boxy',
        body: 'Lovely cotton and the black has not faded. It is cut wide and short, so size down if you want it closer to the body.',
        bought: 'Size S',
      },
      {
        author: 'Tom H.',
        location: 'Leeds, UK',
        date: '2026-09-03',
        rating: 5,
        title: 'Worth the price',
        body: 'Feels like the tees I used to buy fifteen years ago. Shipping to the UK took eight days.',
        bought: 'Size L',
      },
      {
        author: 'Jess M.',
        location: 'Oakland, CA',
        date: '2026-08-17',
        rating: 3,
        title: 'Shrank a little',
        body: 'I put it in a hot dryer by mistake and lost about a centimetre in length. On a cold wash it has been fine since. The quality is obvious.',
        bought: 'Size XL',
      },
    ],
  },
  'six-panel-cap': {
    counts: [61, 14, 3, 1, 0],
    recent: [
      {
        author: 'Marcus L.',
        location: 'Brooklyn, NY',
        date: '2026-10-05',
        rating: 5,
        title: 'Folds flat, bounces back',
        body: 'Lives in my jacket pocket and comes out looking like a cap every time. The brass slide is a nice touch.',
        bought: 'Color: Black',
      },
      {
        author: 'Ana P.',
        location: 'Lisbon, PT',
        date: '2026-09-21',
        rating: 5,
        title: 'The stone colour is perfect',
        body: 'Warmer than grey, cooler than khaki. Goes with everything I own.',
        bought: 'Color: Stone',
      },
      {
        author: 'Chris W.',
        location: 'Denver, CO',
        date: '2026-08-30',
        rating: 4,
        title: 'Shallow fit',
        body: 'Comfortable and well made, but it sits shallow on a bigger head. Fine for me with the slide let out all the way.',
        bought: 'Color: Black',
      },
      {
        author: 'Hana Y.',
        location: 'Vancouver, BC',
        date: '2026-08-02',
        rating: 5,
        title: 'Softer after a wash',
        body: 'Washed it once by hand and it got even softer. No shrinking.',
        bought: 'Color: Stone',
      },
    ],
  },
  'keycap-set': {
    counts: [44, 9, 2, 1, 1],
    recent: [
      {
        author: 'Leo F.',
        location: 'Seattle, WA',
        date: '2026-10-09',
        rating: 5,
        title: 'Thick, textured, quiet',
        body: 'Noticeably deeper sound than the ABS set I replaced. Legends are crisp and the texture has not shined after two months.',
        bought: 'Color: Graphite',
      },
      {
        author: 'Sam O.',
        location: 'Toronto, ON',
        date: '2026-09-15',
        rating: 4,
        title: 'Check your layout first',
        body: 'Fits my ANSI board perfectly. There are no ISO keys, so it will not suit a UK layout.',
        bought: 'Color: Chalk',
      },
      {
        author: 'Rina T.',
        location: 'San Diego, CA',
        date: '2026-08-26',
        rating: 5,
        title: 'Chalk is lovely in person',
        body: 'An off-white rather than a stark white. Makes the whole desk calmer.',
        bought: 'Color: Chalk',
      },
      {
        author: 'Ben A.',
        location: 'Boston, MA',
        date: '2026-08-11',
        rating: 5,
        title: 'Every key I needed',
        body: 'Spare modifiers in all the sizes my board takes. Packaging was sturdy, nothing bent.',
        bought: 'Color: Graphite',
      },
    ],
  },
  'sticker-sheet': {
    counts: [140, 18, 4, 0, 1],
    recent: [
      {
        author: 'Ellie G.',
        location: 'Minneapolis, MN',
        date: '2026-10-14',
        rating: 5,
        title: 'Survived a winter on my bike',
        body: 'Put one on the frame in November. Still there, still matte, no peeling at the edges.',
      },
      {
        author: 'Omar D.',
        location: 'Atlanta, GA',
        date: '2026-09-30',
        rating: 5,
        title: 'Peels off clean',
        body: 'Moved one from my old laptop to the new one with no residue. Small thing, but most stickers fail it.',
      },
      {
        author: 'Kate N.',
        location: 'Melbourne, AU',
        date: '2026-09-09',
        rating: 4,
        title: 'Lovely, a bit small',
        body: 'The designs are great. The sheet is A6, so they are smaller than I pictured. Read the size before you buy.',
      },
      {
        author: 'Will R.',
        location: 'Portland, OR',
        date: '2026-08-21',
        rating: 5,
        title: 'Good add-on',
        body: 'Threw two sheets into an order with the notebook. They came flat in a card sleeve.',
      },
    ],
  },
  'dot-grid-notebook': {
    counts: [203, 31, 6, 2, 1],
    recent: [
      {
        author: 'Grace L.',
        location: 'Philadelphia, PA',
        date: '2026-10-16',
        rating: 5,
        title: 'No bleed with a broad nib',
        body: 'I write with a 1.1 stub and wet inks. Nothing comes through, and there is only faint ghosting.',
        bought: 'Size A5',
      },
      {
        author: 'Jon B.',
        location: 'Dublin, IE',
        date: '2026-10-01',
        rating: 5,
        title: 'Actually lies flat',
        body: 'Opens flat from the first page, so I can sketch across the spread. The dots are light enough to disappear when you want them to.',
        bought: 'Size A5',
      },
      {
        author: 'Mei C.',
        location: 'San Francisco, CA',
        date: '2026-09-18',
        rating: 4,
        title: 'Wish the A6 had more pages',
        body: 'Great paper in a pocket size. It fills up quickly at 160 pages, so I keep a spare.',
        bought: 'Size A6',
      },
      {
        author: 'Felix M.',
        location: 'Berlin, DE',
        date: '2026-09-02',
        rating: 5,
        title: 'Third one',
        body: 'Consistent from notebook to notebook, which is all I want.',
        bought: 'Size A5',
      },
    ],
  },
  'grid-poster': {
    counts: [37, 6, 1, 0, 0],
    recent: [
      {
        author: 'Nora V.',
        location: 'Copenhagen, DK',
        date: '2026-10-07',
        rating: 5,
        title: 'The ink is so rich',
        body: 'You can see the grain of the risograph up close. It looks far better on the wall than on screen.',
        bought: 'Size A2',
      },
      {
        author: 'Ravi J.',
        location: 'Houston, TX',
        date: '2026-09-24',
        rating: 5,
        title: 'Arrived without a crease',
        body: 'Came in a thick tube with tissue around it. Fits a standard A3 frame exactly.',
        bought: 'Size A3',
      },
      {
        author: 'Lucy F.',
        location: 'Bristol, UK',
        date: '2026-09-06',
        rating: 4,
        title: 'Slight curl at first',
        body: 'Needed a couple of days under books to flatten out after the tube. Beautiful once framed.',
        bought: 'Size A3',
      },
      {
        author: 'Andre S.',
        location: 'Montreal, QC',
        date: '2026-08-15',
        rating: 5,
        title: 'Quiet and graphic',
        body: 'Exactly the restraint I wanted over my desk.',
        bought: 'Size A2',
      },
    ],
  },
  'canvas-tote': {
    counts: [72, 15, 4, 2, 0],
    recent: [
      {
        author: 'Sofia R.',
        location: 'Los Angeles, CA',
        date: '2026-10-11',
        rating: 5,
        title: 'Handles long enough for a coat',
        body: 'Sits on my shoulder over a winter coat, which most totes do not manage. Holds a 14 inch laptop with room left.',
      },
      {
        author: 'Pete W.',
        location: 'Nashville, TN',
        date: '2026-09-27',
        rating: 4,
        title: 'Sturdy, no pocket',
        body: 'Thick canvas and good stitching. An inside pocket for keys would make it perfect.',
      },
      {
        author: 'Ines B.',
        location: 'Madrid, ES',
        date: '2026-09-12',
        rating: 5,
        title: 'Daily bag now',
        body: 'Groceries, gym kit, library books. It has softened nicely after a month.',
      },
      {
        author: 'Kofi A.',
        location: 'Washington, DC',
        date: '2026-08-24',
        rating: 3,
        title: 'Creases easily',
        body: 'Natural canvas shows every crease. That is the material, but worth knowing if you like things crisp.',
      },
    ],
  },
  'enamel-mug': {
    counts: [88, 20, 7, 3, 2],
    recent: [
      {
        author: 'Hugo L.',
        location: 'Asheville, NC',
        date: '2026-09-19',
        rating: 5,
        title: 'Camp and desk',
        body: 'Used it on a stove all summer and now it holds pens on my desk. The rim has not chipped.',
      },
      {
        author: 'Clara M.',
        location: 'Edinburgh, UK',
        date: '2026-09-04',
        rating: 4,
        title: 'Gets hot',
        body: 'It is steel, so the handle warms up with fresh coffee. Lovely to drink from once it settles.',
      },
      {
        author: 'Yuki S.',
        location: 'Kyoto, JP',
        date: '2026-08-19',
        rating: 5,
        title: 'Lighter than it looks',
        body: 'Feels like nothing in a backpack. The black rim is crisp.',
      },
      {
        author: 'Dev P.',
        location: 'Chicago, IL',
        date: '2026-08-05',
        rating: 2,
        title: 'Chipped on a tiled floor',
        body: 'Dropped it once and lost a flake of enamel on the base. Still usable, but it is not unbreakable.',
      },
    ],
  },
}

export const getReviews = (slug: string) => {
  const { counts, recent } = reviews[slug]!
  const count = counts.reduce((sum, n) => sum + n)
  const average = counts.reduce((sum, n, i) => sum + n * (5 - i), 0) / count
  return { counts, recent, count, average: Math.round(average * 10) / 10 }
}

// care beyond the one-line detail: what a person asks before they buy
export const care: Record<string, string[]> = {
  'heavyweight-tee': [
    'Machine wash cold, inside out, with similar colours.',
    'Tumble dry low or hang dry. High heat shrinks cotton.',
    'Warm iron on the reverse if needed. Do not bleach.',
  ],
  'six-panel-cap': [
    'Hand wash in cool water with a little mild detergent.',
    'Reshape while damp and air dry. Do not machine dry.',
    'Wipe the brass slide dry to keep its colour even.',
  ],
  'keycap-set': [
    'Pull the caps with the included puller, straight up.',
    'Soak in warm soapy water, rinse, and let them dry fully before refitting.',
    'PBT will not shine with use; no special care needed.',
  ],
  'sticker-sheet': [
    'Apply to a clean, dry, smooth surface and press from the centre out.',
    'Weatherproof once applied. Dishwasher safe on the top rack.',
  ],
  'dot-grid-notebook': [
    'Keep away from damp; the paper is uncoated.',
    'Let wet inks dry for a few seconds before closing the book.',
  ],
  'grid-poster': [
    'Unroll and lay flat under a few books for a day before framing.',
    'Risograph ink can smudge for the first week; handle by the edges.',
    'Frame behind glass, out of direct sunlight.',
  ],
  'canvas-tote': [
    'Spot clean, or machine wash cold on its own.',
    'Air dry. Natural canvas softens and creases with use.',
  ],
  'enamel-mug': [
    'Hand wash. Avoid abrasive pads on the enamel.',
    'Safe on a gas or camp stove; never heat it empty.',
    'Not for the microwave.',
  ],
}

export const shipping = [
  'Free standard shipping on every order. Orders leave the studio within 2 business days.',
  'US delivery takes 3–5 business days; international orders 6–12.',
  'Returns are free within 30 days of delivery for unused items in their original packaging.',
]

// where each drawing's interesting part sits, for the gallery's closer views
export const focus: Record<string, [number, number]> = {
  'heavyweight-tee': [48, 30],
  'six-panel-cap': [48, 34],
  'keycap-set': [38, 38],
  'sticker-sheet': [58, 62],
  'dot-grid-notebook': [48, 70],
  'grid-poster': [48, 40],
  'canvas-tote': [48, 36],
  'enamel-mug': [62, 50],
}

export const categoryBlurbs: Record<string, string> = {
  Apparel: 'Heavy cotton, cut to wear in',
  Desk: 'Tools for the hours at the desk',
  Paper: 'Notebooks, prints, and stickers',
  Carry: 'For the walk in between',
}

// category → its products, in catalog order
export const categories = () => {
  const groups = new Map<string, Product[]>()
  for (const product of listProducts())
    groups.set(product.category, [...(groups.get(product.category) ?? []), product])
  return [...groups]
}

export const categoryHref = (category: string) => `/search?q=${encodeURIComponent(category)}`

// same category first, then the rest of the catalog in order
export const related = (slug: string, count = 4) => {
  const product = listProducts().find((p) => p.slug === slug)!
  const others = listProducts().filter((p) => p.slug !== slug)
  return [
    ...others.filter((p) => p.category === product.category),
    ...others.filter((p) => p.category !== product.category),
  ].slice(0, count)
}

export const testimonials = [
  {
    quote:
      'The notebook paper is the best I have found under thirty dollars. I have stopped looking.',
    author: 'Grace L.',
    detail: 'Dot Grid Notebook',
  },
  {
    quote: 'Everything arrived wrapped like a gift, with a handwritten note. That never happens.',
    author: 'Marcus L.',
    detail: 'Six-Panel Cap',
  },
  {
    quote: 'A tee that still looks new after a year of weekly washes. I own four now.',
    author: 'Daniel K.',
    detail: 'Heavyweight Tee',
  },
]
