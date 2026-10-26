import { describe, expect, it } from 'vitest';
import { isPrivateAddress, rejectRemoteUrl } from './remoteUrlSafety';

describe('rejectRemoteUrl', () => {
  it('accepts ordinary public https/http', () => {
    expect(rejectRemoteUrl('https://cdn.example.com/a.mp4?x=1')).toBeNull();
    expect(rejectRemoteUrl('http://8.8.8.8/a.mp4')).toBeNull();
  });
  it('rejects bad protocols, credentials and local hosts', () => {
    expect(rejectRemoteUrl('file:///etc/passwd')).not.toBeNull();
    expect(rejectRemoteUrl('ftp://example.com/a')).not.toBeNull();
    expect(rejectRemoteUrl('https://user:pw@example.com/a')).not.toBeNull();
    expect(rejectRemoteUrl('http://localhost:8080/a')).not.toBeNull();
    expect(rejectRemoteUrl('http://127.0.0.1:47100/api')).not.toBeNull();
    expect(rejectRemoteUrl('http://[::1]/a')).not.toBeNull();
    expect(rejectRemoteUrl('http://169.254.169.254/latest/meta-data')).not.toBeNull();
    expect(rejectRemoteUrl('not a url')).not.toBeNull();
  });
});

describe('isPrivateAddress', () => {
  it('flags private and reserved ranges', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });
  it('allows public addresses, fake-IP 198.18/15 and NAT64', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '198.18.0.5', '198.19.255.1', '2606:4700::1111', '64:ff9b::808:808', '::ffff:8.8.8.8']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});
