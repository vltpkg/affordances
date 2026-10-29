// shipping is always free here, so the subtotal is the total
export const Totals = ({ count, total }: { count: number; total: string }) => (
  <dl className="text-sm">
    <div className="flex justify-between py-2">
      <dt className="text-muted-foreground">
        {count} {count === 1 ? 'item' : 'items'}
      </dt>
      <dd className="font-mono tabular-nums">{total}</dd>
    </div>
    <div className="flex justify-between py-2">
      <dt className="text-muted-foreground">Shipping</dt>
      <dd>Free</dd>
    </div>
    <div className="flex justify-between border-t pt-3 font-medium">
      <dt>Total</dt>
      <dd className="font-mono tabular-nums">{total}</dd>
    </div>
  </dl>
)
