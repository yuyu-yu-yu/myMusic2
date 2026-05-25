import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addPlaybackItem,
  canMovePlaybackPrevious,
  getCurrentPlaybackItem,
  getNextPlaybackItem,
  getPreviousPlaybackItem,
  movePlaybackCursor
} from '../public/playback-sequence.js';

function item(id) {
  return { track: { id, name: `Track ${id}` } };
}

test('playback sequence moves through A-B-C with a linear cursor', () => {
  let state = {};
  state = addPlaybackItem(state, item('A'));
  state = addPlaybackItem(state, item('B'));
  state = addPlaybackItem(state, item('C'));

  assert.equal(getCurrentPlaybackItem(state).track.id, 'C');
  state = movePlaybackCursor(state, -1);
  assert.equal(getCurrentPlaybackItem(state).track.id, 'B');
  assert.equal(getPreviousPlaybackItem(state).track.id, 'A');
  assert.equal(getNextPlaybackItem(state).track.id, 'C');
  state = movePlaybackCursor(state, -1);
  assert.equal(getCurrentPlaybackItem(state).track.id, 'A');
  state = movePlaybackCursor(state, 1);
  assert.equal(getCurrentPlaybackItem(state).track.id, 'B');
});

test('playback sequence truncates future recommendations after explicit replacement', () => {
  let state = {};
  state = addPlaybackItem(state, item('A'));
  state = addPlaybackItem(state, item('B'));
  state = addPlaybackItem(state, item('C'));
  state = movePlaybackCursor(state, -2);
  state = addPlaybackItem(state, item('D'), { truncateFuture: true });

  assert.deepEqual(state.sequence.map(entry => entry.track.id), ['A', 'D']);
  assert.equal(state.cursor, 1);
  assert.equal(getCurrentPlaybackItem(state).track.id, 'D');
});

test('playback sequence avoids duplicate current or tail tracks', () => {
  let state = {};
  state = addPlaybackItem(state, item('A'));
  state = addPlaybackItem(state, item('B'));
  state = addPlaybackItem(state, { track: { id: 'B', name: 'Track B updated' } });

  assert.deepEqual(state.sequence.map(entry => entry.track.id), ['A', 'B']);
  assert.equal(getCurrentPlaybackItem(state).track.name, 'Track B updated');
  assert.equal(canMovePlaybackPrevious(state), true);
});
