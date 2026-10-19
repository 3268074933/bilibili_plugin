/**
 * B站图片提取器 - 官网交互
 *
 * 只做渐进增强：
 * 1. 移动端导航展开 / 收起；
 * 2. 顶栏滚动阴影；
 * 3. 当前区块导航高亮；
 * 4. 下方内容滚动入场；
 * 5. 页脚年份。
 *
 * 所有内容在没有 JavaScript 时仍然完整可见、可阅读。
 */

(() => {
  'use strict';

  const header = document.getElementById('siteHeader');
  const menuToggle = document.getElementById('menuToggle');
  const nav = document.getElementById('siteNav');
  const navLinks = Array.from(document.querySelectorAll('.nav__link'));
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------ */
  /* 移动端导航                                                          */
  /* ------------------------------------------------------------------ */

  function isMenuOpen() {
    return menuToggle ? menuToggle.getAttribute('aria-expanded') === 'true' : false;
  }

  function setMenuOpen(open) {
    if (!menuToggle || !nav) return;

    menuToggle.setAttribute('aria-expanded', String(open));
    menuToggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    nav.classList.toggle('is-open', open);
  }

  if (menuToggle && nav) {
    menuToggle.addEventListener('click', () => {
      setMenuOpen(!isMenuOpen());
    });

    nav.addEventListener('click', (event) => {
      const link = event.target.closest('a');
      if (link) setMenuOpen(false);
    });

    document.addEventListener('click', (event) => {
      if (!isMenuOpen()) return;
      if (event.target.closest('.site-header')) return;
      setMenuOpen(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !isMenuOpen()) return;
      setMenuOpen(false);
      menuToggle.focus();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900) setMenuOpen(false);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 顶栏滚动状态                                                        */
  /* ------------------------------------------------------------------ */

  if (header) {
    let headerTicking = false;

    const updateHeader = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 8);
      headerTicking = false;
    };

    const onScroll = () => {
      if (headerTicking) return;
      headerTicking = true;
      window.requestAnimationFrame(updateHeader);
    };

    updateHeader();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ------------------------------------------------------------------ */
  /* 当前区块导航高亮                                                    */
  /* ------------------------------------------------------------------ */

  if ('IntersectionObserver' in window && sections.length && navLinks.length) {
    const linkById = new Map();

    navLinks.forEach((link) => {
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      linkById.set(href.slice(1), link);
    });

    const clearCurrent = () => {
      navLinks.forEach((link) => link.removeAttribute('aria-current'));
    };

    const navObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible.length === 0) return;

        clearCurrent();
        const link = linkById.get(visible[0].target.id);
        if (link) link.setAttribute('aria-current', 'true');
      },
      { rootMargin: '-42% 0px -52% 0px', threshold: 0 }
    );

    sections.forEach((section) => {
      if (linkById.has(section.id)) navObserver.observe(section);
    });
  }

  /* ------------------------------------------------------------------ */
  /* 滚动入场                                                            */
  /* ------------------------------------------------------------------ */

  const revealItems = Array.from(document.querySelectorAll('.reveal'));

  if (revealItems.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      revealItems.forEach((item) => item.classList.add('is-visible'));
    } else {
      const revealObserver = new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
      );

      revealItems.forEach((item) => {
        const rect = item.getBoundingClientRect();
        // 只让首屏之外的内容先隐藏，避免加载瞬间闪烁
        if (rect.top > window.innerHeight * 0.92) {
          item.classList.add('is-pending');
          revealObserver.observe(item);
        } else {
          item.classList.add('is-visible');
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* 页脚年份                                                            */
  /* ------------------------------------------------------------------ */

  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();
