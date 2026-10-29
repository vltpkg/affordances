// in-memory catalog, carts, and orders. No database: state lives as long as the server process.

export type Variant = { sku: string; label: string; price: number; stock: number }

export type Product = {
  slug: string
  name: string
  category: string
  description: string
  // what the variants differ by; null for a single variant
  option: 'Size' | 'Color' | null
  details: Record<string, string>
  variants: Variant[]
}

export type CartItem = { sku: string; quantity: number }

export type Order = {
  id: string
  placedAt: string
  items: { sku: string; name: string; variant: string | null; quantity: number; price: number }[]
  total: number
}

type Db = {
  products: Product[]
  carts: Map<string, CartItem[]>
  orders: Map<string, Order[]>
  nextOrder: number
}

const seed = (): Db => ({
  products: [
    {
      slug: 'heavyweight-tee',
      name: 'Heavyweight Tee',
      category: 'Apparel',
      description:
        'A boxy tee in dense 300 gsm cotton that holds its shape wash after wash. Ink black, with a small mark on the back of the neck.',
      option: 'Size',
      details: {
        Material: '300 gsm combed cotton',
        Fit: 'Boxy, dropped shoulder',
        Care: 'Cold wash',
      },
      variants: [
        { sku: 'TEE-BLK-S', label: 'S', price: 4800, stock: 6 },
        { sku: 'TEE-BLK-M', label: 'M', price: 4800, stock: 8 },
        { sku: 'TEE-BLK-L', label: 'L', price: 4800, stock: 0 },
        { sku: 'TEE-BLK-XL', label: 'XL', price: 4800, stock: 3 },
      ],
    },
    {
      slug: 'six-panel-cap',
      name: 'Six-Panel Cap',
      category: 'Apparel',
      description:
        'An unstructured cap in washed cotton twill with a brass slide at the back. Soft enough to fold into a pocket.',
      option: 'Color',
      details: { Material: 'Washed cotton twill', Closure: 'Brass slide', Fit: 'One size' },
      variants: [
        { sku: 'CAP-BLK', label: 'Black', price: 3600, stock: 12 },
        { sku: 'CAP-STN', label: 'Stone', price: 3600, stock: 2 },
      ],
    },
    {
      slug: 'keycap-set',
      name: 'Keycap Set',
      category: 'Desk',
      description:
        'A full set of thick PBT keycaps with dye-sublimated legends that never wear off. Fits standard ANSI layouts.',
      option: 'Color',
      details: { Material: '1.5 mm PBT', Profile: 'Cherry', Keys: '142' },
      variants: [
        { sku: 'KEY-GRA', label: 'Graphite', price: 6400, stock: 5 },
        { sku: 'KEY-CHK', label: 'Chalk', price: 6400, stock: 4 },
      ],
    },
    {
      slug: 'sticker-sheet',
      name: 'Sticker Sheet',
      category: 'Paper',
      description:
        'Nine die-cut vinyl stickers on one A6 sheet. Matte, weatherproof, and easy to peel off a laptop later.',
      option: null,
      details: { Material: 'Matte vinyl', Size: 'A6 sheet', Count: '9 stickers' },
      variants: [{ sku: 'STK-01', label: 'Sheet', price: 800, stock: 40 }],
    },
    {
      slug: 'dot-grid-notebook',
      name: 'Dot Grid Notebook',
      category: 'Paper',
      description:
        'Lay-flat binding, 5 mm dot grid, and 100 gsm paper that takes a fountain pen without bleeding through.',
      option: 'Size',
      details: { Paper: '100 gsm, 160 pages', Grid: '5 mm dots', Binding: 'Lay-flat, sewn' },
      variants: [
        { sku: 'NBK-A5', label: 'A5', price: 2200, stock: 10 },
        { sku: 'NBK-A6', label: 'A6', price: 1600, stock: 1 },
      ],
    },
    {
      slug: 'grid-poster',
      name: 'Grid Poster',
      category: 'Paper',
      description:
        'A study of a single circle on a twelve-column grid, printed in one ink on heavy uncoated stock. Ships rolled.',
      option: 'Size',
      details: { Print: 'Single-ink risograph', Paper: '250 gsm uncoated', Edition: 'Open' },
      variants: [
        { sku: 'PST-A2', label: 'A2', price: 3200, stock: 4 },
        { sku: 'PST-A3', label: 'A3', price: 2400, stock: 9 },
      ],
    },
    {
      slug: 'canvas-tote',
      name: 'Canvas Tote',
      category: 'Carry',
      description:
        'Natural 12 oz canvas with long handles that sit comfortably on a shoulder. Holds a laptop and the day around it.',
      option: null,
      details: { Material: '12 oz cotton canvas', Size: '38 × 42 cm', Handles: '70 cm' },
      variants: [{ sku: 'TOT-NAT', label: 'Natural', price: 2800, stock: 2 }],
    },
    {
      slug: 'enamel-mug',
      name: 'Enamel Mug',
      category: 'Desk',
      description:
        'Steel mug with a white enamel finish and a rolled black rim. Light, hard to break, and fine on a camp stove.',
      option: null,
      details: { Material: 'Enamelled steel', Volume: '350 ml', Care: 'Hand wash' },
      variants: [{ sku: 'MUG-WHT', label: 'White', price: 2400, stock: 0 }],
    },
  ],
  carts: new Map(),
  orders: new Map(),
  nextOrder: 1001,
})

// one store per process, so dev HMR doesn't wipe carts and orders
const g = globalThis as typeof globalThis & { affordSupply?: Db }
const db = (g.affordSupply ??= seed())

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
export const formatPrice = (cents: number) => usd.format(cents / 100)

export const listProducts = () => db.products

export const getProduct = (slug: string) => db.products.find((p) => p.slug === slug)

export const findVariant = (sku: string) => {
  for (const product of db.products) {
    const variant = product.variants.find((v) => v.sku === sku)
    if (variant) return { product, variant }
  }
}

// every word has to appear in the name, category, or description
export const searchProducts = (query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  return db.products.filter((p) => {
    const text = `${p.name} ${p.category} ${p.description}`.toLowerCase()
    return words.every((word) => text.includes(word))
  })
}

// "Heavyweight Tee, size M"; just the name when the product has one variant
export const variantName = (product: Product, variant: Variant) =>
  product.option
    ? `${product.name}, ${product.option.toLowerCase()} ${variant.label}`
    : product.name

// variantName by SKU, for messages
export const skuName = (sku: string) => {
  const found = findVariant(sku)
  return found ? variantName(found.product, found.variant) : sku
}

export const getCart = (sid: string | null) => (sid && db.carts.get(sid)) || []

export const cartCount = (sid: string | null) =>
  getCart(sid).reduce((sum, item) => sum + item.quantity, 0)

export const quantityInCart = (sid: string | null, sku: string) =>
  getCart(sid).find((item) => item.sku === sku)?.quantity ?? 0

// sets an item's quantity outright; 0 removes it. Throws when stock can't cover it.
export const setQuantity = (sid: string, sku: string, quantity: number) => {
  const found = findVariant(sku)
  if (!found) throw new Error(`Unknown SKU ${sku}`)
  if (quantity > found.variant.stock)
    throw new Error(
      `Only ${found.variant.stock} left of ${variantName(found.product, found.variant)}`,
    )
  const items = getCart(sid).filter((item) => item.sku !== sku)
  if (quantity > 0) {
    const index = getCart(sid).findIndex((item) => item.sku === sku)
    items.splice(index === -1 ? items.length : index, 0, { sku, quantity })
  }
  db.carts.set(sid, items)
}

export const addToCart = (sid: string, sku: string, quantity = 1) =>
  setQuantity(sid, sku, quantityInCart(sid, sku) + quantity)

export const removeFromCart = (sid: string, sku: string) => setQuantity(sid, sku, 0)

export const placeOrder = (sid: string) => {
  const lines = getCart(sid).map((item) => ({ item, ...findVariant(item.sku)! }))
  if (!lines.length) throw new Error('Your cart is empty')
  for (const { item, product, variant } of lines)
    if (item.quantity > variant.stock)
      throw new Error(`Only ${variant.stock} left of ${variantName(product, variant)}`)

  const order: Order = {
    id: `AS-${db.nextOrder++}`,
    placedAt: new Date().toISOString(),
    items: lines.map(({ item, product, variant }) => {
      variant.stock -= item.quantity
      return {
        sku: item.sku,
        name: product.name,
        variant: product.option && `${product.option} ${variant.label}`,
        quantity: item.quantity,
        price: variant.price,
      }
    }),
    total: lines.reduce((sum, { item, variant }) => sum + item.quantity * variant.price, 0),
  }
  db.orders.set(sid, [order, ...getOrders(sid)])
  db.carts.delete(sid)
  return order
}

export const getOrders = (sid: string | null) => (sid && db.orders.get(sid)) || []
