// Content slides in once as it first scrolls into view. Without observer
// support or with reduced motion, everything simply stays visible.
const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (items.length > 0 && 'IntersectionObserver' in window && !reducedMotion) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

  document.documentElement.classList.add('can-reveal');
  items.forEach((item) => observer.observe(item));
}
