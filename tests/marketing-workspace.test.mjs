import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, audienceRule, esc } from '../src/marketing-workspace.mjs';
test('CSV parsing preserves phone strings, quoted commas, newlines and formula text as data', () => {
  assert.deepEqual(parseCsv('\ufeffName,Phone\r\n"A, B",001234\r\n"Two\nlines","=1+1"'), [['Name', 'Phone'], ['A, B', '001234'], ['Two\nlines', '=1+1']]);
  assert.throws(() => parseCsv('a,"broken'), /unclosed/);
});
test('audience controls encode booleans and relative/unknown dates with distinct meanings', () => {
  assert.deepEqual(audienceRule('lastInteraction', '90'), { field: 'lastInteraction', op: 'olderDays', value: 90 });
  assert.deepEqual(audienceRule('lastMarketing', 'unknown'), { field: 'lastMarketing', op: 'unknown' });
  assert.equal(audienceRule('needsReview', 'false').value, false);
  assert.equal(audienceRule('service', 'Visual aid').op, 'contains');
});
test('preview rendering escapes client names and content', () => assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'));
