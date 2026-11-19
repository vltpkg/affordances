import { expect, test } from 'vitest'
import { inputIssues } from '../src/index.ts'

const schema = {
  type: 'object',
  properties: {
    a: { type: 'integer', minimum: 1 },
    b: { enum: ['x', 'y'] },
    c: { type: 'array', items: { type: 'string' }, maxItems: 2 },
  },
  required: ['a'],
  additionalProperties: false,
}

test('an input that fits its schema has no issues', () => {
  expect(inputIssues(schema, { a: 1, b: 'x', c: ['p'] })).toEqual([])
})

test.for([
  ['a missing required property', {}, '/a'],
  ['under a minimum', { a: 0 }, '/a'],
  ['not an integer', { a: 1.5 }, '/a'],
  ['outside an enum', { a: 1, b: 'q' }, '/b'],
  ['too many items', { a: 1, c: ['p', 'q', 'r'] }, '/c'],
  ['a wrong item type', { a: 1, c: [1] }, '/c/0'],
  ['a property the schema closes out', { a: 1, z: 1 }, ''],
  ['not an object', null, ''],
] as const)('%s is an issue, and says where', ([, input, at]) => {
  const issues = inputIssues(schema, input)
  expect(issues.length).toBeGreaterThan(0)
  expect(issues.map((i) => i.at)).toContain(at)
})

test('a schema that can’t be read fails closed', () => {
  expect(inputIssues({ type: 'nonsense' }, {})).toEqual([
    { at: '', message: "the input schema can't be checked, so no input passes it" },
  ])
})
