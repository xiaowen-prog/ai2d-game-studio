import { describe, expect, it } from 'vitest';
import { isSendKey } from './sendKey';
describe('message keyboard behavior', () => {
  const enter = { key: 'Enter', shiftKey: false, keyCode: 13, nativeEvent: { isComposing: false } };
  it('sends on Enter', () => expect(isSendKey(enter)).toBe(true));
  it('keeps Shift+Enter for newlines', () => expect(isSendKey({ ...enter, shiftKey: true })).toBe(false));
  it('does not send while selecting Chinese characters', () => expect(isSendKey({ ...enter, nativeEvent: { isComposing: true } })).toBe(false));
  it('handles IME browsers reporting only key code 229', () => expect(isSendKey({ ...enter, keyCode: 229 })).toBe(false));
  it('does not submit other keys', () => expect(isSendKey({ ...enter, key: 'a' })).toBe(false));
});
