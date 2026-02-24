import { ensureFramework, setTaggedValue } from '../taggedValues';

test('ensureFramework lowercases and upserts framework tag', () => {
  const obj: any = { taggedValues: [{ key: 'framework', value: 'React' }] };
  ensureFramework(obj, 'React');
  expect(obj.taggedValues).toEqual([{ key: 'framework', value: 'react' }]);
});

test('setTaggedValue upserts by key', () => {
  const obj: any = { taggedValues: [{ key: 'k', value: '1' }] };
  setTaggedValue(obj, 'k', '2');
  expect(obj.taggedValues).toEqual([{ key: 'k', value: '2' }]);
});
