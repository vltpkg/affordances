// a literalMd route: /notes/a.md is the note whose file is a.md, not /notes/a's twin
export default async function Page({ params }) {
  const { file } = await params
  return <h1>{`Note ${file}`}</h1>
}
