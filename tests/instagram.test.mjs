// Run with:  node --test "tests/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
const { postLink, accountLink, handleOf, count, instagramCard } = await import('../js/instagram.js');

test('post links are cleaned, and anything else is refused', () => {
  assert.equal(postLink('https://www.instagram.com/p/DAbCdEf1234/?igsh=abc&utm_source=x'), 'https://www.instagram.com/p/DAbCdEf1234/');
  assert.equal(postLink('instagram.com/reel/CxYz_12345'), 'https://www.instagram.com/reel/CxYz_12345/');
  assert.equal(postLink('https://www.instagram.com/reels/CxYz_12345/'), 'https://www.instagram.com/reel/CxYz_12345/');
  assert.equal(postLink('https://evil.example/p/DAbCdEf1234/'), null);
  assert.equal(postLink('https://www.instagram.com.evil.example/p/DAbCdEf1234/'), null);
  assert.equal(postLink('https://www.instagram.com/vleague.official/'), null);
  assert.equal(postLink('javascript:alert(1)'), null);
  assert.equal(postLink(''), null);
});

test('account links', () => {
  assert.equal(accountLink('https://www.instagram.com/vleague.official/'), 'https://www.instagram.com/vleague.official/');
  assert.equal(accountLink('instagram.com/vleague.official?hl=en'), 'https://www.instagram.com/vleague.official/');
  assert.equal(accountLink('https://www.instagram.com/p/DAbCdEf1234/'), null);   // a post is not an account
  assert.equal(accountLink('https://example.com/vleague.official/'), null);
  assert.equal(handleOf('https://www.instagram.com/vleague.official/'), '@vleague.official');
  assert.equal(handleOf('nonsense'), '@vleague.official');
});

test('counts read short', () => {
  assert.equal(count(48), '48'); assert.equal(count(1234), '1,234'); assert.equal(count(12500), '12.5K'); assert.equal(count(20000), '20K'); assert.equal(count(2300000), '2.3M');
  assert.equal(count(null), ''); assert.equal(count(''), ''); assert.equal(count('x'), '');
});

test('the card: follow button always, numbers and posts only when set, embeds only from checked links', () => {
  const none = instagramCard(null);
  assert.match(none, /@vleague\.official/); assert.match(none, /class="ig-follow" href="https:\/\/www\.instagram\.com\/vleague\.official\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(none, /No posts yet/); assert.doesNotMatch(none, /<iframe/); assert.doesNotMatch(none, /ig-stats/);
  const full = instagramCard({ instagram_url: 'https://www.instagram.com/vleague.official/', instagram_posts: ['https://www.instagram.com/p/AAAAA11111/', 'https://www.instagram.com/reel/BBBBB22222/', 'https://www.instagram.com/p/CCCCC33333/'], followers: 1250, posts: 48 });
  assert.equal((full.match(/<iframe/g) || []).length, 2);                                   // two at most
  assert.match(full, /src="https:\/\/www\.instagram\.com\/p\/AAAAA11111\/embed\/"/);
  assert.match(full, /<dd>1,250<\/dd><dt>Followers/); assert.match(full, /<dd>48<\/dd><dt>Posts/);
  const bad = instagramCard({ instagram_url: 'https://evil.example/', instagram_posts: ['https://evil.example/p/AAAAA11111/', '"><script>'], followers: null, posts: null });
  assert.doesNotMatch(bad, /<iframe/); assert.doesNotMatch(bad, /evil|<script>/);        // a bad row points nowhere else
  assert.equal((instagramCard({ instagram_posts: ['https://www.instagram.com/p/AAAAA11111/'] }).match(/is-one/g) || []).length, 1);
});
