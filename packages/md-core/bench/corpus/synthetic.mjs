// synthetic docs-like page: chrome, prose with links, highlighted code, tables, lists, forms
export const page = (sections = 200) => {
  const out = [
    '<!doctype html><html lang="en"><head><title>Big page · Site</title><meta name="description" content="A big page"><link rel="canonical" href="https://site.test/big"></head><body>',
  ]
  out.push(
    '<header><nav>' +
      Array.from({ length: 80 }, (_, i) => `<a href="/n/${i}">Nav ${i}</a>`).join('') +
      '</nav></header>',
  )
  out.push(
    '<aside><ul>' +
      Array.from({ length: 300 }, (_, i) => `<li><a href="/docs/${i}">Doc ${i}</a></li>`).join('') +
      '</ul></aside><main><h1>Big page</h1>',
  )
  for (let i = 0; i < sections; i++) {
    out.push(`<section><h2 id="s${i}"><a href="#s${i}">Section ${i}</a></h2>`)
    out.push(
      `<p class="text-sm leading-6">Some <strong>bold</strong> and <em>emphasised</em> prose with a <a href="/docs/x${i}">relative link</a>, an <a href="https://example.com/${i}">absolute one</a>, and <code>inline_code(${i})</code>. Characters like * and _ and [brackets] need escaping.</p>`,
    )
    out.push(
      '<div class="flex gap-2"><span>express</span><span>5.3.0</span><span class="block">yarn</span><a href="/a"><img src="/i.png" alt="Icon"></a></div>',
    )
    out.push(
      '<figure><figcaption>file.ts</figcaption><pre class="shiki" data-language="ts"><code>' +
        Array.from(
          { length: 12 },
          (_, l) =>
            `<span class="line"><span style="color:#D73A49">const</span><span style="color:#24292E"> value${l} </span><span style="color:#D73A49">=</span><span style="color:#005CC5"> ${l}</span><span style="color:#24292E">;</span></span>`,
        ).join('\n') +
        '</code></pre></figure>',
    )
    out.push(
      '<ul>' +
        Array.from(
          { length: 6 },
          (_, l) =>
            `<li><span>Item ${l}</span> with <a href="./rel/${l}">a link</a><ul><li>nested ${l}</li></ul></li>`,
        ).join('') +
        '</ul>',
    )
    if (i % 4 === 0)
      out.push(
        '<table><thead><tr><th><button>Name</button></th><th>Version</th><th>Notes</th></tr></thead><tbody>' +
          Array.from(
            { length: 10 },
            (_, r) =>
              `<tr><td><a href="/p/${r}">pkg-${r}</a></td><td><span class="block">1.${r}.0</span></td><td>Note | with pipe ${r}</td></tr>`,
          ).join('') +
          '</tbody></table>',
      )
    if (i % 10 === 0)
      out.push(
        `<form><label for="f${i}">Email</label><input id="f${i}" type="email" value="a@b.c"><label><input type="checkbox" checked> Subscribe</label><select aria-label="Plan"><option>Free</option><option selected>Pro</option></select><button>Send</button></form>`,
      )
    out.push(
      '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg><div aria-hidden="true">decor</div><div style="display:none">hidden</div></section>',
    )
  }
  out.push('</main><footer><p>Footer</p></footer>')
  for (let i = 0; i < sections; i++)
    out.push(
      `<script>self.__next_f.push([1,"${i}:[\\"$\\",\\"p\\",null,{\\"children\\":\\"${'x'.repeat(600)}\\"}]\\n"])</script>`,
    )
  out.push('</body></html>')
  return out.join('')
}
