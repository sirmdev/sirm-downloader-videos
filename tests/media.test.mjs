import test from 'node:test';
import assert from 'node:assert/strict';
import { mediaKind, mergeCandidates, preferredSource } from '../extension/media.mjs';
test('recognizes manifests and video types without treating TS fragments as full videos', () => {
  assert.equal(mediaKind('https://cdn.test/v.m3u8?token=a'), 'HLS');
  assert.equal(mediaKind('https://cdn.test/v.mpd'), 'DASH');
  assert.equal(mediaKind('https://cdn.test/api/stream', 'video/mp4'), 'Vídeo');
  assert.equal(mediaKind('https://cdn.test/seg.ts', 'video/mp2t'), null);
  assert.equal(mediaKind('https://cdn.test/seg.m4s', 'video/mp4'), null);
  assert.equal(mediaKind('blob:https://cdn.test/abc'), null);
});
test('merges duplicates, preserving signed query strings and rejecting non-http URLs', () => {
  const a = {url:'https://cdn.test/v.mp4?token=A',kind:'Vídeo'};
  assert.equal(mergeCandidates([a], [a,{...a,url:'https://cdn.test/v.mp4?token=B'},{url:'file:///secret'}]).length,2);
});
test('blocks YouTube pages and media hosts as required by the Chrome Web Store policy', async () => {
  const {blockedSite} = await import('../extension/media.mjs');
  for (const url of ['https://www.youtube.com/watch?v=x','https://youtube.com/shorts/x','https://m.youtube.com/x','https://music.youtube.com/watch?v=x','https://youtu.be/x','https://www.youtube-nocookie.com/embed/x','https://rr1---sn-abc.googlevideo.com/videoplayback?x=1'])
    assert.equal(blockedSite(url), true, url);
  for (const url of ['https://cdn.test/v.m3u8','https://notyoutube.com/x','https://youtube.com.evil.test/x','not a url'])
    assert.equal(blockedSite(url), false, url);
  assert.deepEqual(mergeCandidates([{url:'https://youtu.be/x'},{url:'https://cdn.test/v.mp4'}]).map(s=>s.url),['https://cdn.test/v.mp4']);
});

test('preferredSource prefers manifests with referer and ignores fragments',()=>{
  assert.deepEqual(preferredSource([{url:'https://a.test/v.mp4'},{url:'https://a.test/s.ts'},{url:'https://a.test/m.m3u8',referer:'https://p.test/'}]),{url:'https://a.test/m.m3u8',kind:'HLS',referer:'https://p.test/'});
  assert.equal(preferredSource([]),undefined);
});
