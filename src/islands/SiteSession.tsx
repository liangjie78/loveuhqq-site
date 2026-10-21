import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Moon, Sun } from 'lucide-react';
import { Toggle } from '../components/ui/toggle';
import { buttonVariants } from '../components/ui/button';
import { sessionStore } from '../stores/session';

export default function SiteSession() {
  const authenticated = useStore(sessionStore, state => state.authenticated);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function changeTheme(nextDark: boolean) {
    const root = document.documentElement;
    root.classList.toggle('dark', nextDark);
    root.dataset.theme = nextDark ? 'dark' : 'light';
    setDark(nextDark);
    try { localStorage.setItem('loveuhqq_theme', nextDark ? 'dark' : 'light'); } catch { /* Theme still changes for this page. */ }
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', nextDark ? '#1a1717' : '#f5eee4');
    document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')?.setAttribute('content', nextDark ? 'dark' : 'light');
  }

  return (
    <>
      <Toggle
        className="header-theme-toggle"
        type="button"
        pressed={dark}
        onPressedChange={changeTheme}
        aria-label={dark ? '切换为浅色' : '切换为深色'}
        title={dark ? '切换为浅色' : '切换为深色'}
      >
        {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
      </Toggle>
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
