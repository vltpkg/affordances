import { forcePath } from '../src/convert/path.ts'

// md converts with md-core by default; here any decline but a streamed page's, which md-core leaves to the tree
// pipeline by design, fails the test instead
forcePath('strict', ['streamed'])
