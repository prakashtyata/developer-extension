/**
 * View transitions.
 *
 * Every navigation step slides in horizontally: "forward" enters from the
 * right, "back" enters from the left, which matches reading order. Direction is
 * decided by the caller from what the user actually did (next tab, opened a
 * record, went back) rather than guessed from ids.
 *
 * Animation is CSS-class driven. The class is stripped on animationend, and
 * also by a timeout, so a dropped frame or a test environment without
 * animations can never leave a view stuck off-screen.
 */

const REDUCED = '(prefers-reduced-motion: reduce)';

let timer = 0;

export function prefersReducedMotion() {
  try {
    return !!window.matchMedia && window.matchMedia(REDUCED).matches;
  } catch {
    return false;
  }
}

function cleanup(node) {
  node.classList.remove('slide-in-forward', 'slide-in-back', 'slide-push-left', 'slide-push-right');
  if (timer) {
    clearTimeout(timer);
    timer = 0;
  }
}

/**
 * Slide `node` in. `dir` is 'forward' | 'back'.
 * `leaving`, when given, is pushed the opposite way for a parallax feel.
 */
export function slide(node, dir = 'forward', leaving = null) {
  if (!node) return;
  if (prefersReducedMotion()) {
    cleanup(node);
    return;
  }

  const forward = dir !== 'back';
  const enter = forward ? 'slide-in-forward' : 'slide-in-back';

  if (leaving) {
    leaving.classList.remove('slide-push-left', 'slide-push-right');
    // Force a reflow so the browser registers the start position.
    void leaving.offsetWidth;
    leaving.classList.add(forward ? 'slide-push-left' : 'slide-push-right');
  }

  node.classList.remove('slide-in-forward', 'slide-in-back');
  void node.offsetWidth;
  node.classList.add(enter);

  const done = () => {
    cleanup(node);
    if (leaving) leaving.classList.remove('slide-push-left', 'slide-push-right');
  };
  node.addEventListener('animationend', done, { once: true });
  if (timer) clearTimeout(timer);
  timer = setTimeout(done, 420);
}

/** Fade + slight rise. Used where a horizontal slide would be wrong. */
export function rise(node) {
  if (!node || prefersReducedMotion()) return;
  node.classList.add('rise-in');
  const done = () => node.classList.remove('rise-in');
  node.addEventListener('animationend', done, { once: true });
  setTimeout(done, 320);
}

/** Stagger a list's direct children so a fresh render cascades in. */
export function stagger(list, max = 14, step = 14) {
  if (!list || prefersReducedMotion()) return;
  const kids = Array.from(list.children).slice(0, max);
  kids.forEach((kid, i) => {
    kid.style.setProperty('--stagger', `${i * step}ms`);
    kid.classList.add('stagger-in');
  });
  setTimeout(() => {
    for (const kid of kids) {
      kid.classList.remove('stagger-in');
      kid.style.removeProperty('--stagger');
    }
  }, 320 + kids.length * step);
}
