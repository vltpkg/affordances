// a root catch-all, as a docs site has: every path no other route takes
export default async function Page({ params }) {
  return <h1>{(await params).slug.join('/')}</h1>
}
