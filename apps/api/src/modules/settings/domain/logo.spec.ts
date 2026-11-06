import { detectLogoType } from './logo';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('detectLogoType', () => {
  it('recognises PNG and JPEG by their signatures', () => {
    expect(detectLogoType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe('image/png');
    expect(detectLogoType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
  });

  it.each([
    ['SVG text', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
    ['GIF', Buffer.from('GIF89a')],
    ['truncated PNG header', bytes(0x89, 0x50, 0x4e)],
    ['empty', bytes()],
    ['text renamed to .png', Buffer.from('hello, I am not an image')],
  ])('rejects %s', (_label, data) => {
    expect(detectLogoType(data)).toBeNull();
  });
});
