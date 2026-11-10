// only the route's 404: a known id renders as its page
export const notFoundMarkdown = ({ params }) =>
  `# No item ${params.id}\n\nSee [the items](/static).`
