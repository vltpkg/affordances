// who the page's markdown is for, as the gate in proxy.js said, never the client; and never the gate's token
export default ({ request, searchParams }) =>
  `# Who\n\nuser=${request.headers.get('x-user-id')} adopt=${request.headers.get('x-affordances-md-adopt')} via=${searchParams.get('via')}`
