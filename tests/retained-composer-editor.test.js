'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { writePostText } = require('../app/facebook/textWriter');
const { verifyComposerText } = require('../app/local-agent/FacebookLiveReadiness');

test('text insertion and verification use only the exact editor retained during composer binding', async () => {
  const calls = [];
  const editor = {
    waitForElementState: async (state) => calls.push(`WAIT:${state}`),
    click: async () => calls.push('CLICK'),
    evaluate: async () => true,
    isVisible: async () => true,
    isEditable: async () => true,
    inputValue: async () => 'immutable snapshot',
  };
  const page = {
    evaluate: async (_fn, value) => { calls.push(`COPY:${value}`); },
    keyboard: { press: async (key) => calls.push(`KEY:${key}`) },
    getByRole: () => { throw new Error('page-wide editor lookup is forbidden'); },
  };
  const composer = {
    handle: { evaluate: async () => true, isVisible: async () => true, locator: () => { throw new Error('composer editor reacquisition is forbidden'); } },
    editor,
  };
  await writePostText(page, 'immutable snapshot', composer);
  await verifyComposerText(composer, 'immutable snapshot');
  assert.deepEqual(calls, ['WAIT:visible', 'CLICK', 'COPY:immutable snapshot', 'KEY:Control+V']);
});
