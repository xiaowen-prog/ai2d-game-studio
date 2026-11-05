/** Enter submits; IME confirmation and Shift+Enter remain normal text input. */
export function isSendKey(event: { key: string; shiftKey: boolean; keyCode: number; nativeEvent: { isComposing: boolean } }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229;
}
