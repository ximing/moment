import { escapeLike } from '../../src/search/like.js';

describe('escapeLike（spec §3.3）', () => {
  it('先反斜杠再 % _', () => {
    expect(escapeLike('a')).toBe('a');
    expect(escapeLike('100%_off')).toBe('100\\%\\_off');
    expect(escapeLike('a\\b%c_d')).toBe('a\\\\b\\%c\\_d');
  });
});
