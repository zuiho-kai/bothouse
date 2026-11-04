import { describe, expect, it } from 'vitest';
import { collabPageUrl } from './collabPages';

// #145: the bothouse panel frames the collab wiki galaxy page. The URL depends on where the
// panel itself is mounted, and the two mounts differ in where the DSH pages live.
describe('collabPageUrl', () => {
  it('points at the collab page directly when the panel runs inside the DSH sidebar entry', () => {
    expect(collabPageUrl('wiki-galaxy', '/collab/panel')).toBe('/collab/wiki-galaxy');
    // The panel is also reachable through the management server's DSH proxy: /dsh + the mount.
    expect(collabPageUrl('wiki-galaxy', '/dsh/collab/panel')).toBe('/dsh/collab/wiki-galaxy');
  });

  it('goes through the DSH proxy when the panel is opened directly on the management server', () => {
    expect(collabPageUrl('wiki-galaxy', '')).toBe('/dsh/collab/wiki-galaxy');
    expect(collabPageUrl('desk', '/')).toBe('/dsh/collab/desk');
  });

  it('trades the panel token for the /dsh/-only cookie on the proxy hop, and only there', () => {
    expect(collabPageUrl('wiki-galaxy', '', 'secret token')).toBe('/dsh/collab/wiki-galaxy?token=secret%20token');
    // Inside the DSH sidebar entry the frame is same-origin with DSH and needs no token.
    expect(collabPageUrl('wiki-galaxy', '/collab/panel', 'secret')).toBe('/collab/wiki-galaxy');
  });

  it('tolerates a trailing slash on the mount path', () => {
    expect(collabPageUrl('wiki-galaxy', '/collab/panel/')).toBe('/collab/wiki-galaxy');
  });
});
