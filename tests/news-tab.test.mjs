// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.location ??= { hostname: '', search: '', href: 'http://localhost/' };
const { newsHtml, clearable } = await import('../js/news-tab.js');

const post = (id, extra = {}) => ({ id: `sb-${id}`, src: 'sb', at: new Date('2026-10-07T10:00:00Z'), pinned: false, row: { id, kind: 'post', title: `Post ${id}`, body: `Body of ${id}`, data: {}, ...extra } });
const st = (extra = {}) => ({ items: [post(1), post(2, { data: { image: 'pic.jpg' } })], read: new Set(['sb-2']), reactions: new Map(), phone: '', toast: null, opened: new Set(), loading: false, code: 'CRA', ...extra });
const o = { vars: { team: 'Cranbourne', manager: 'Ryan' } };

test('a card with a row per post: unread ones are marked, read ones are not', () => {
  const html = newsHtml(st(), o);
  assert.match(html, /<h2>News<\/h2>/);
  assert.equal((html.match(/<details class="nw-post/g) || []).length, 2);
  assert.equal((html.match(/<details class="nw-post new"/g) || []).length, 1);   // post 1 is unread
  assert.match(html, /Unread\./);
});

test('Mark all read only shows while something is unread; Clear all while something can be cleared', () => {
  assert.match(newsHtml(st(), o), /data-nw="markall"/);
  assert.doesNotMatch(newsHtml(st({ read: new Set(['sb-1', 'sb-2']) }), o), /data-nw="markall"/);
  assert.match(newsHtml(st(), o), /data-nw="clear"/);
  assert.doesNotMatch(newsHtml(st({ items: [] }), o), /data-nw="clear"/);
});

test('a post opens in place and keeps open across a redraw; a picture is in the body', () => {
  const html = newsHtml(st({ opened: new Set(['sb-2']) }), o);
  assert.match(html, /<details class="nw-post" data-id="sb-2" open>/);
  assert.doesNotMatch(html, /data-id="sb-1" open/);
  assert.match(html, /class="nc-img"/);
});

test('delete buttons, the undo line, reaction buttons', () => {
  const html = newsHtml(st({ toast: { text: 'Post deleted.' } }), o);
  assert.match(html, /data-nw="del" data-del="sb-1"/);
  assert.match(html, /Post deleted\. <button type="button" class="nw-undo" data-nw="undo">Undo<\/button>/);
  assert.equal((html.match(/data-nw="rx"/g) || []).length, 10);   // five reactions on each of the two posts
});

test('the phone-number post: a form, and not clearable until a number is saved', () => {
  const phone = post(9, { data: { form: 'phone' } });
  assert.equal(clearable(phone, { phone: '' }), false); assert.equal(clearable(phone, { phone: '0412 345 678' }), true);
  const html = newsHtml(st({ items: [phone], phone: '0412 345 678' }), o);
  assert.match(html, /class="ph-form"/); assert.match(html, /value="0412 345 678"/); assert.match(html, />Change<\/button>/);
  assert.doesNotMatch(newsHtml(st({ items: [phone] }), o), /data-del="sb-9"/);
});

test('empty, loading and no-club states', () => {
  assert.match(newsHtml(st({ items: [] }), o), /No messages yet/);
  assert.match(newsHtml(st({ items: [], loading: true }), o), /Loading…/);
  assert.match(newsHtml(st({ code: undefined }), o), /isn’t linked to a club yet/);
});

test('posts are escaped', () => {
  const html = newsHtml(st({ items: [post(3, { title: '<img src=x onerror=alert(1)>' })] }), o);
  assert.doesNotMatch(html, /<img src=x/); assert.match(html, /&lt;img src=x/);
});
