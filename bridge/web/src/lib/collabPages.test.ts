import { describe, expect, it } from 'vitest';
import { collabPageUrl } from './collabPages';

// #145: the bothouse panel frames the collab wiki galaxy page. Which URL that is depends on how
// the panel itself was mounted, and the two mounts differ in where the DSH pages live.
describe('collabPageUrl', () => {
  it('uses the DSH origin directly when the panel runs inside the DSH sidebar entry', () => {
    // /collab/panel/ is on the DSH origin itself, so /collab/* is same-origin and signed in.
    expect(collabPageUrl('wiki-galaxy', '/collab/panel')).toBe('/collab/wiki-galaxy');
    expect(collabPageUrl('desk', '/collab/panel/')).toBe('/collab/desk');
  });

  it('goes through the management server proxy when the panel is opened directly', () => {
    expect(collabPageUrl('wiki-galaxy', '')).toBe('/dsh/collab/wiki-galaxy');
    expect(collabPageUrl('desk', '/')).toBe('/dsh/collab/desk');
  });

  it('trades the panel token for the /dsh/-only cookie on that hop, and only there', () => {
    expect(collabPageUrl('wiki-galaxy', '', 'secret token')).toBe('/dsh/collab/wiki-galaxy?token=secret%20token');
    // Inside the DSH sidebar entry the frame is same-origin with DSH and needs no token.
    expect(collabPageUrl('wiki-galaxy', '/collab/panel', 'secret')).toBe('/collab/wiki-galaxy');
  });
});
