import { reviewGeneration, reviewValueKey } from '../reviewIdentity';

const collisionPairs: [unknown, unknown][] = [
  [1, '1'],
  [{ order: { a: 1, b: 23 } }, { order: { a1b: 23 } }],
  [['ab'], ['a', 'b']],
  ['', undefined],
  [{ value: '' }, {}],
  [{ value: undefined }, {}],
  [null, undefined],
  [1n, { bigint: '1' }],
  [1n, { $bigint: '1' }],
  [1n, '1'],
  [1n, 1],
  [-0, 0],
  [NaN, null],
  [Infinity, null],
  [Array(1), [undefined]],
  [['a:b', 'c'], ['a', 'b:c']],
  [['a\nb', 'c'], ['a', 'b\nc']],
];

it.each(collisionPairs)('separates typed structured values (pair %#)', (left, right) => {
  expect(reviewValueKey(left)).not.toBe(reviewValueKey(right));
  expect(reviewValueKey([left])).not.toBe(reviewValueKey([right]));
});

it('assigns distinct generations to different objects regardless of IDs or equal contents', () => {
  const requests = [{ id: 1 }, { id: '1' }, { id: 1 }, { id: 1 }];
  const generations = requests.map(reviewGeneration);
  expect(new Set(generations).size).toBe(requests.length);
  expect(requests.map(reviewGeneration)).toEqual(generations);
});

it.each([new Date(0), new Map(), new Set(), Symbol('value'), () => 1])(
  'fails closed for unsupported values (case %#)', (value) => {
    expect(() => reviewValueKey(value)).toThrow('Unsupported review');
  },
);
