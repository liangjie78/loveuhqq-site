import { useStore } from 'zustand';
import { buttonVariants } from '../components/ui/button';
import { sessionStore } from '../stores/session';

export default function SiteSession() {
  const authenticated = useStore(sessionStore, state => state.authenticated);

  return (
    <>
      <button
        type="button"
        className={buttonVariants({ variant: 'ghost' })}
        data-open-login
        data-needs-js
        aria-label="访客，点击解锁共同手账"
        hidden={authenticated}
      >
        访客
      </button>
      <span data-session-label hidden={!authenticated}>我们的手账</span>
      <button
        type="button"
        className={buttonVariants({ variant: 'ghost' })}
        data-session-logout
        hidden={!authenticated}
      >
        退出
      </button>
    </>
  );
}
