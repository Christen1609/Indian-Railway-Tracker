import { NavLink } from '../../lib/navigation';

export function Brand() {
  return (
    <NavLink search="" className="panel brand">
      <span className="mark" aria-hidden="true">
        क
      </span>
      <span className="word">kahan</span>
      <span className="word-hi" lang="hi">
        कहाँ
      </span>
    </NavLink>
  );
}
