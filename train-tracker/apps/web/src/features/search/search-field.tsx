import { useId, useMemo, useState } from 'react';
import type { FormEvent, KeyboardEvent, Ref } from 'react';
import { navigate, trainSearch } from '../../lib/navigation';
import { FlowButton } from './flow-button';
import { matchTrains, noMatchMessage } from './search';
import type { Candidate } from './search';

type Props = {
  candidates: Candidate[];
  inputId: string;
  initial?: string;
  ariaLabel?: string;
  hasIcon?: boolean;
  formClass: string;
  inputRef?: Ref<HTMLInputElement>;
};

const EMPTY_MESSAGE = 'Type a train number or name.';

/** Label for a suggestion */
function optionText(candidate: Candidate): string {
  return candidate.name === '' ? candidate.number : `${candidate.number} ${candidate.name}`;
}

export function SearchField({
  candidates,
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
  const matches = useMemo(() => matchTrains(value, candidates), [value, candidates]); // trains matching the text, from matchTrains
  const isListShown = isOpen && matches.length > 0;
  const hasNoMatch = value.trim() !== '' && matches.length === 0;
  const message = hasNoMatch ? noMatchMessage(value, candidates) : submitMessage;

  /** Open a train's page */
  function open(candidate: Candidate) {
    setIsOpen(false);
    navigate(trainSearch(candidate.number));
  }

  /** Open the highlighted or only match, or say why not */
  function submit(event: FormEvent) {
    event.preventDefault();
    const chosen = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
    if (chosen !== undefined) {
      open(chosen);
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
      setActiveIndex(((activeIndex + step + matches.length + 1) % (matches.length + 1)) - 1);
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
        {hasNoMatch &&
          candidates.map((candidate) => (
            <button
              key={candidate.number}
              type="button"
              className="sf-suggest"
              onClick={() => open(candidate)}
            >
              Track {optionText(candidate)}
            </button>
          ))}
      </div>
    </div>
  );
}
