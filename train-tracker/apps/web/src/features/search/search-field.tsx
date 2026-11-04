import { useId, useState } from 'react';
import type { FormEvent, KeyboardEvent, Ref } from 'react';
import { useTrainSearch } from '../../lib/live';
import { navigate, trainSearch } from '../../lib/navigation';
import { FlowButton } from './flow-button';
import { nextActiveIndex, noMatchMessage } from './search';
import type { Candidate } from './search';

type Props = {
  inputId: string;
  initial?: string;
  ariaLabel?: string;
  hasIcon?: boolean;
  formClass: string;
  inputRef?: Ref<HTMLInputElement>;
};

const EMPTY_MESSAGE = 'Type a train number or name.';

export function SearchField({
  inputId,
  initial = '',
  ariaLabel,
  hasIcon = false,
  formClass,
  inputRef,
}: Props) {
  const listId = useId();
  const messageId = useId();
  const [value, setValue] = useState(initial);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [submitMessage, setSubmitMessage] = useState('');
  const { candidates: matches, isSettled } = useTrainSearch(value); // suggestions for the text, from useTrainSearch
  const isListShown = isOpen && matches.length > 0;
  const hasNoMatch = value.trim() !== '' && isSettled && matches.length === 0;
  const message = hasNoMatch ? noMatchMessage(value) : submitMessage;

  /** Open a train's page */
  function open(candidate: Candidate) {
    setIsOpen(false);
    navigate(trainSearch(candidate.number));
  }

  /** Open the highlighted or only match, or say why not */
  function submit(event: FormEvent) {
    event.preventDefault();
    const settled = isSettled ? matches : [];
    const chosen = settled[activeIndex] ?? (settled.length === 1 ? settled[0] : undefined);
    if (chosen !== undefined) {
      open(chosen);
      return;
    }
    if (!isSettled && /^d{4,5}$/.test(value.trim())) {
      open({ number: value.trim(), name: '' });
      return;
    }
    if (value.trim() === '') {
      setSubmitMessage(EMPTY_MESSAGE);
    }
    setIsOpen(matches.length > 1);
  }

  /** Move through suggestions and close them */
  function press(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setIsOpen(true);
      setActiveIndex(nextActiveIndex(activeIndex, step, matches.length)); // the suggestion one step on, from nextActiveIndex
    }
  }

  return (
    <div className="sf">
      <form className={formClass} role="search" onSubmit={submit}>
        {hasIcon && (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M11 11l3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        )}
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          role="combobox"
          aria-expanded={isListShown}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            isListShown && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
          }
          aria-describedby={messageId}
          aria-label={ariaLabel}
          value={value}
          placeholder="Number or name"
          inputMode="search"
          enterKeyHint="go"
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            setSubmitMessage('');
            setActiveIndex(-1);
            setIsOpen(true);
          }}
          onKeyDown={press}
          onBlur={() => setIsOpen(false)}
        />
        <FlowButton label="Track" />
      </form>
      <ul
        className="sf-list"
        id={listId}
        role="listbox"
        aria-label="Matching trains"
        hidden={!isListShown}
      >
        {matches.map((candidate, index) => (
          <li
            key={candidate.number}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => open(candidate)}
          >
            <span className="mono">{candidate.number}</span> {candidate.name}
          </li>
        ))}
      </ul>
      <div className="search-msg" id={messageId} role="status" aria-live="polite">
        {message}
      </div>
    </div>
  );
}
