import {
  forwardRef,
  type ChangeEventHandler,
  type KeyboardEventHandler,
} from 'react';

import { useRotatingPrompt } from '../useRotatingPrompt';

interface RotatingIdeaInputProps {
  value: string;
  placeholder?: string;
  busy: boolean;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  onKeyDown: KeyboardEventHandler<HTMLTextAreaElement>;
}

export const RotatingIdeaInput = forwardRef<HTMLTextAreaElement, RotatingIdeaInputProps>(
  function RotatingIdeaInput({ value, placeholder, busy, onChange, onKeyDown }, ref) {
    const prompt = useRotatingPrompt({ paused: value.length > 0 || busy || Boolean(placeholder) });
    return (
      <textarea
        ref={ref}
        className={prompt.isEasterEgg ? 'is-easter-egg' : undefined}
        value={value}
        rows={4}
        maxLength={12_000}
        aria-label="描述你想制作的游戏"
        placeholder={placeholder ?? prompt.text}
        onChange={onChange}
        onKeyDown={onKeyDown}
      />
    );
  },
);
