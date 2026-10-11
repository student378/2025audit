/* 생활관 홈페이지 — 공개 화면
 * 데이터: data/site.json, data/posts.json, data/meals.json (관리자 페이지에서 수정)
 * 라우팅: #/ (메인), #/m/{메뉴ID}, #/m/{메뉴ID}/{글번호}, #/sitemap
 */
(function () {
  'use strict';

  var D = { site: null, posts: null, meals: null };
  var PAGE_SIZE = 10;
  var MEALS = [['breakfast', '조식'], ['lunch', '중식'], ['dinner', '석식']];
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  var sliderTimer = null;

  /* ---------- 유틸 ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var w = x.getDay(); return addDays(x, w === 0 ? -6 : 1 - w); }
  function dotDate(s) { return String(s || '').replace(/-/g, '.'); }
  function stripHtml(h) { var t = document.createElement('div'); t.innerHTML = h || ''; return (t.textContent || '').trim(); }
  function isExternal(url) { return /^https?:\/\//i.test(url || ''); }
  function linkAttr(url) { return 'href="' + esc(url || '#/') + '"' + (isExternal(url) ? ' target="_blank" rel="noopener" title="새 창 열림"' : ''); }
  function store(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; }
  }
  function isNew(date) { return (Date.now() - parseYmd(date).getTime()) < 7 * 864e5; }

  /* ---------- 데이터 ---------- */
  function load() {
    var preview = /[?&]preview=1/.test(location.search);
    if (preview) {
      var draft = null;
      try { draft = JSON.parse(store('dorm-preview') || 'null'); } catch (e) { draft = null; }
      if (draft && draft.site) {
        $('#previewBar').hidden = false;
        return Promise.resolve(draft);
      }
    }
    var v = '?v=' + Date.now();
    return Promise.all(['site', 'posts', 'meals'].map(function (n) {
      return fetch('data/' + n + '.json' + v, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error(n + '.json ' + r.status);
        return r.json();
      });
    })).then(function (a) { return { site: a[0], posts: a[1], meals: a[2] }; });
  }

  function allItems() {
    var out = [];
    D.site.menu.forEach(function (top) {
      (top.children || []).forEach(function (c) { out.push({ top: top, item: c }); });
    });
    (D.site.hiddenPages || []).forEach(function (c) { out.push({ top: null, item: c }); });
    return out;
  }
  function findItem(id) {
    var all = allItems();
    for (var i = 0; i < all.length; i++) if (all[i].item.id === id) return all[i];
    return null;
  }
  function itemForBoard(boardId) {
    var all = allItems();
    for (var i = 0; i < all.length; i++) if (all[i].item.type === 'board' && all[i].item.boardId === boardId) return all[i].item;
    return null;
  }
  function itemHref(item) {
    if (!item) return '#/';
    if (item.type === 'link') return item.url || '#/';
    return '#/m/' + item.id;
  }
  function topHref(top) {
    var first = (top.children || [])[0];
    return first ? itemHref(first) : '#/';
  }
  function board(id) {
    var b = (D.posts.boards || []).filter(function (x) { return x.id === id; })[0];
    return b || { id: id, name: id, type: 'list' };
  }
  function postsOf(boardId) {
    return (D.posts.posts || []).filter(function (p) { return p.board === boardId; }).sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return b.id - a.id;
    });
  }

  /* ---------- 공통 레이아웃 ---------- */
  function renderChrome() {
    var s = D.site.settings;
    var root = document.documentElement.style;
    if (s.primaryColor) root.setProperty('--primary', s.primaryColor);
    if (s.accentColor) root.setProperty('--accent', s.accentColor);

    var logoHtml = s.logoImage
      ? '<img src="' + esc(s.logoImage) + '" alt="' + esc(s.univName + ' ' + s.siteName) + '">'
      : '<span class="logo-mark">' + dormIcon('home', 26) + '</span><span class="logo-txt"><em>' + esc(s.univName) + '</em><strong>' + esc(s.siteName) + '</strong></span>';
    $('#logo').innerHTML = logoHtml;
    $('#ftLogo').innerHTML = '<strong>' + esc(s.univName) + ' ' + esc(s.siteName) + '</strong>';
    $('#topUniv').textContent = s.univName + ' ' + s.siteName + (s.siteNameEn ? ' · ' + s.siteNameEn : '');
    $('#mnavTitle').textContent = s.univName + ' ' + s.siteName;

    $('#topLinks').innerHTML = (s.topLinks || []).map(function (l) {
      return '<li><a ' + linkAttr(l.url) + '>' + esc(l.label) + '</a></li>';
    }).join('');

    $('#gnb').innerHTML = D.site.menu.map(function (top) {
      return '<li data-top="' + esc(top.id) + '"><a href="' + esc(topHref(top)) + '">' + esc(top.title) + '</a>' +
        '<ul class="sub">' + (top.children || []).map(function (c) {
          return '<li><a ' + linkAttr(itemHref(c)) + ' data-item="' + esc(c.id) + '">' + esc(c.title) + '</a></li>';
        }).join('') + '</ul></li>';
    }).join('');

    $('#mnavList').innerHTML = D.site.menu.map(function (top) {
      return '<li><button type="button" class="mnav-top" aria-expanded="false">' + esc(top.title) + '</button>' +
        '<ul>' + (top.children || []).map(function (c) {
          return '<li><a ' + linkAttr(itemHref(c)) + '>' + esc(c.title) + '</a></li>';
        }).join('') + '</ul></li>';
    }).join('');

    $('#ftLinks').innerHTML = (s.footerLinks || []).map(function (l) {
      return '<li' + (l.strong ? ' class="strong"' : '') + '><a ' + linkAttr(l.url) + '>' + esc(l.label) + '</a></li>';
    }).join('');
    $('#familySel').innerHTML = '<option value="">관련 사이트</option>' + (s.familySites || []).map(function (f) {
      return '<option value="' + esc(f.url) + '">' + esc(f.label) + '</option>';
    }).join('');
    $('#ftAddr').innerHTML = '<span>' + esc(s.address) + '</span>' +
      (s.tel ? '<span>TEL. ' + esc(s.tel) + '</span>' : '') +
      (s.fax ? '<span>FAX. ' + esc(s.fax) + '</span>' : '') +
      (s.email ? '<span>E-MAIL. ' + esc(s.email) + '</span>' : '');
    $('#ftCopy').textContent = s.copyright || '';
  }

  function bindChrome() {
    var header = $('#header');
    var gnb = $('#gnb');
    gnb.addEventListener('mouseenter', function () { header.classList.add('open'); });
    header.addEventListener('mouseleave', function () { header.classList.remove('open'); });
    gnb.addEventListener('focusin', function () { header.classList.add('open'); });
    gnb.addEventListener('focusout', function (e) { if (!gnb.contains(e.relatedTarget)) header.classList.remove('open'); });

    var mnav = $('#mnav');
    function setNav(open) {
      mnav.classList.toggle('on', open);
      mnav.setAttribute('aria-hidden', open ? 'false' : 'true');
      $('#btnAllMenu').setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('noscroll', open);
    }
    $('#btnAllMenu').addEventListener('click', function () { setNav(true); });
    $('#mnavClose').addEventListener('click', function () { setNav(false); });
    mnav.addEventListener('click', function (e) {
      if (e.target === mnav) return setNav(false);
      var t = e.target.closest('.mnav-top');
      if (t) {
        var li = t.parentNode, on = !li.classList.contains('on');
        $$('.mnav-list > li').forEach(function (x) { x.classList.remove('on'); $('.mnav-top', x).setAttribute('aria-expanded', 'false'); });
        li.classList.toggle('on', on);
        t.setAttribute('aria-expanded', on ? 'true' : 'false');
      } else if (e.target.closest('a')) setNav(false);
    });

    $('#familyGo').addEventListener('click', function () {
      var u = $('#familySel').value;
      if (u) window.open(u, '_blank', 'noopener');
    });

    var toTop = $('#toTop');
    window.addEventListener('scroll', function () {
      toTop.classList.toggle('on', window.scrollY > 300);
      header.classList.toggle('scrolled', window.scrollY > 36);
    }, { passive: true });
    toTop.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
  }

  /* ---------- 라우터 ---------- */
  function parseHash() {
    var h = location.hash.replace(/^#/, '') || '/';
    var i = h.indexOf('?');
    var path = i < 0 ? h : h.slice(0, i);
    var q = new URLSearchParams(i < 0 ? '' : h.slice(i + 1));
    return { parts: path.split('/').filter(Boolean), q: q };
  }

  function route() {
    if (location.hash === '#content') return;
    clearInterval(sliderTimer);
    var r = parseHash();
    var main = $('#content');
    var s = D.site.settings;
    $('#header').classList.remove('open');
    $$('#gnb > li').forEach(function (li) { li.classList.remove('on'); });

    if (!r.parts.length) {
      document.title = s.univName + ' ' + s.siteName;
      document.body.classList.add('is-main');
      main.innerHTML = homeHtml();
      initHome();
      showPopups();
    } else if (r.parts[0] === 'sitemap') {
      document.body.classList.remove('is-main');
      main.innerHTML = subLayout(null, { id: 'sitemap', title: '사이트맵' }, sitemapHtml());
      document.title = '사이트맵 | ' + s.univName + ' ' + s.siteName;
    } else if (r.parts[0] === 'm') {
      document.body.classList.remove('is-main');
      var found = findItem(r.parts[1]);
      if (!found) {
        main.innerHTML = subLayout(null, { id: '', title: '페이지를 찾을 수 없습니다' }, '<div class="empty">요청하신 페이지를 찾을 수 없습니다. <a href="#/">메인으로</a></div>');
      } else {
        if (found.top) {
          var li = $('#gnb > li[data-top="' + found.top.id + '"]');
          if (li) li.classList.add('on');
        }
        main.innerHTML = subLayout(found.top, found.item, itemBody(found.item, r));
        bindSub(found.item);
        document.title = found.item.title + ' | ' + s.univName + ' ' + s.siteName;
      }
    }
    window.scrollTo(0, 0);
  }

  /* ---------- 메인 ---------- */
  function homeHtml() {
    var site = D.site;
    var slides = site.slides || [];
    var visual = '<section class="mvisual" aria-label="메인 비주얼"><div class="mv-track">' + slides.map(function (sl, i) {
      var bg = sl.image ? 'background-image:url(\'' + esc(sl.image) + '\')' : 'background:' + esc(sl.bg || 'var(--primary)');
      return '<div class="mv-slide' + (i === 0 ? ' on' : '') + '" style="' + bg + '" aria-hidden="' + (i === 0 ? 'false' : 'true') + '">' +
        (sl.image ? '<div class="mv-dim"></div>' : '<div class="mv-pattern"></div>') +
        '<div class="inner mv-text">' +
        (sl.eyebrow ? '<p class="mv-eyebrow">' + esc(sl.eyebrow) + '</p>' : '') +
        '<h2>' + nl2br(sl.title) + '</h2>' +
        (sl.subtitle ? '<p class="mv-sub">' + esc(sl.subtitle) + '</p>' : '') +
        (sl.link ? '<a class="mv-btn" ' + linkAttr(sl.link) + '>' + esc(sl.button || '자세히 보기') + '<i>&rarr;</i></a>' : '') +
        '</div></div>';
    }).join('') + '</div>' +
      (slides.length > 1 ? '<div class="inner mv-ctrl"><span class="mv-count"><b>01</b> / ' + pad(slides.length) + '</span>' +
        '<button type="button" class="mv-prev" aria-label="이전 슬라이드">&lsaquo;</button>' +
        '<button type="button" class="mv-pause" aria-label="자동 넘김 정지">❚❚</button>' +
        '<button type="button" class="mv-next" aria-label="다음 슬라이드">&rsaquo;</button>' +
        '<span class="mv-bar"><i></i></span></div>' : '') +
      '</section>';

    var quick = '<section class="quick"><div class="inner"><ul>' + (site.quickLinks || []).map(function (q) {
      return '<li><a ' + linkAttr(q.link) + '><span class="qi">' + dormIcon(q.icon, 30) + '</span><span class="ql">' + esc(q.label) + '</span></a></li>';
    }).join('') + '</ul></div></section>';

    var boards = (site.settings.homeBoards || ['notice']).map(board);
    var boardBox = '<div class="m-box m-board"><div class="m-tabs" role="tablist">' + boards.map(function (b, i) {
      return '<button type="button" role="tab" class="m-tab' + (i === 0 ? ' on' : '') + '" aria-selected="' + (i === 0) + '" data-i="' + i + '">' + esc(b.name) + '</button>';
    }).join('') + '</div>' + boards.map(function (b, i) {
      var item = itemForBoard(b.id);
      var list = postsOf(b.id).slice(0, 5);
      return '<div class="m-panel' + (i === 0 ? ' on' : '') + '" role="tabpanel">' +
        '<a class="more" href="' + esc(itemHref(item)) + '" aria-label="' + esc(b.name) + ' 더보기">+</a>' +
        (list.length ? '<ul class="m-list">' + list.map(function (p) {
          return '<li><a href="' + esc(itemHref(item)) + '/' + p.id + '">' +
            (p.pinned ? '<span class="badge">공지</span>' : '') +
            '<span class="t">' + esc(p.title) + '</span>' + (isNew(p.date) ? '<span class="new">N</span>' : '') +
            '<span class="d">' + dotDate(p.date) + '</span></a></li>';
        }).join('') + '</ul>' : '<p class="empty sm">등록된 게시물이 없습니다.</p>') + '</div>';
    }).join('') + '</div>';

    var mealBox = '<div class="m-box m-meal"><div class="m-hd"><h3>오늘의 식단</h3>' +
      '<div class="meal-nav"><button type="button" data-d="-1" aria-label="이전 날">&lsaquo;</button><span id="mealDate"></span><button type="button" data-d="1" aria-label="다음 날">&rsaquo;</button></div>' +
      '<a class="more" href="#/m/meal" aria-label="주간식단표 더보기">+</a></div><div class="meal-cols" id="mealCols"></div></div>';

    var today = ymd(new Date());
    var upcoming = (site.schedule || []).filter(function (e) { return (e.end || e.start) >= today; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; }).slice(0, 4);
    var schedBox = '<div class="m-box m-sched"><div class="m-hd"><h3>생활관 일정</h3><a class="more" href="#/m/schedule" aria-label="생활관 일정 더보기">+</a></div>' +
      (upcoming.length ? '<ul>' + upcoming.map(function (e) {
        var d = parseYmd(e.start);
        return '<li><span class="cal"><b>' + pad(d.getDate()) + '</b><em>' + d.getFullYear() + '.' + pad(d.getMonth() + 1) + '</em></span>' +
          '<span class="tx"><i class="cat">' + esc(e.category || '일정') + '</i>' + esc(e.title) +
          '<small>' + dotDate(e.start) + (e.end && e.end !== e.start ? ' ~ ' + dotDate(e.end) : '') + '</small></span></li>';
      }).join('') + '</ul>' : '<p class="empty sm">예정된 일정이 없습니다.</p>') + '</div>';

    var banners = site.banners || [];
    var bannerBox = '<div class="m-box m-banner"><div class="m-hd"><h3>알림존</h3>' +
      (banners.length > 1 ? '<div class="bn-ctrl"><span class="bn-num"><b>1</b>/' + banners.length + '</span><button type="button" data-d="-1" aria-label="이전 배너">&lsaquo;</button><button type="button" data-d="1" aria-label="다음 배너">&rsaquo;</button></div>' : '') +
      '</div><div class="bn-view">' + banners.map(function (b, i) {
        var bg = b.image ? 'background:#eee url(\'' + esc(b.image) + '\') center/cover no-repeat' : 'background:' + esc(b.bg || 'var(--primary)');
        return '<a class="bn' + (i === 0 ? ' on' : '') + '" ' + linkAttr(b.link || '#/') + ' style="' + bg + '">' +
          (b.image ? '<span class="sr">' + esc(b.title) + '</span>' : '<span class="bn-t">' + nl2br(b.title) + '</span>') + '</a>';
      }).join('') + (banners.length ? '' : '<p class="empty sm">등록된 배너가 없습니다.</p>') + '</div></div>';

    var s = site.settings;
    var contactBox = '<div class="m-box m-contact"><div class="m-hd"><h3>문의 안내</h3></div>' +
      '<p class="big">' + dormIcon('phone', 22) + '<a href="tel:' + esc((s.tel || '').replace(/[^0-9]/g, '')) + '">' + esc(s.tel) + '</a></p>' +
      (s.officeHours ? '<p class="hours">' + esc(s.officeHours) + '</p>' : '') +
      '<ul>' + (s.contacts || []).map(function (c) {
        return '<li><span>' + esc(c.label) + '</span><a href="tel:' + esc((c.tel || '').replace(/[^0-9]/g, '')) + '">' + esc(c.tel) + '</a></li>';
      }).join('') + '</ul></div>';

    return visual + quick +
      '<section class="m-sec"><div class="inner grid-2">' + boardBox + mealBox + '</div></section>' +
      '<section class="m-sec alt"><div class="inner grid-3">' + schedBox + bannerBox + contactBox + '</div></section>';
  }

  function initHome() {
    // 메인 비주얼 슬라이더
    var slides = $$('.mv-slide'), cur = 0, playing = true;
    var bar = $('.mv-bar i');
    function go(n) {
      if (!slides.length) return;
      slides[cur].classList.remove('on'); slides[cur].setAttribute('aria-hidden', 'true');
      cur = (n + slides.length) % slides.length;
      slides[cur].classList.add('on'); slides[cur].setAttribute('aria-hidden', 'false');
      var c = $('.mv-count b'); if (c) c.textContent = pad(cur + 1);
      if (bar) { bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = playing ? '' : 'none'; }
    }
    function play() { clearInterval(sliderTimer); if (playing && slides.length > 1) sliderTimer = setInterval(function () { go(cur + 1); }, 6000); }
    if ($('.mv-prev')) {
      $('.mv-prev').onclick = function () { go(cur - 1); play(); };
      $('.mv-next').onclick = function () { go(cur + 1); play(); };
      $('.mv-pause').onclick = function () {
        playing = !playing;
        this.textContent = playing ? '❚❚' : '▶';
        this.setAttribute('aria-label', playing ? '자동 넘김 정지' : '자동 넘김 시작');
        if (bar) bar.style.animationPlayState = playing ? 'running' : 'paused';
        if (playing) go(cur);
        play();
      };
    }
    play();

    // 게시판 탭
    $$('.m-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        var i = +t.dataset.i;
        $$('.m-tab').forEach(function (x, j) { x.classList.toggle('on', j === i); x.setAttribute('aria-selected', j === i); });
        $$('.m-panel').forEach(function (x, j) { x.classList.toggle('on', j === i); });
      });
    });

    // 오늘의 식단
    var mealDay = new Date();
    function drawMeal() {
      var key = ymd(mealDay), day = (D.meals.days || {})[key] || {};
      $('#mealDate').textContent = dotDate(key) + ' (' + WEEK[mealDay.getDay()] + ')';
      $('#mealCols').innerHTML = MEALS.map(function (m) {
        var t = (D.meals.times || {})[m[0]];
        return '<div class="meal-col"><h4>' + m[1] + (t ? '<small>' + esc(t) + '</small>' : '') + '</h4>' +
          (day[m[0]] ? '<p>' + nl2br(day[m[0]]) + '</p>' : '<p class="none">등록된 식단이<br>없습니다.</p>') + '</div>';
      }).join('');
    }
    $$('.meal-nav button').forEach(function (b) {
      b.addEventListener('click', function () { mealDay = addDays(mealDay, +b.dataset.d); drawMeal(); });
    });
    drawMeal();

    // 알림존 배너
    var bns = $$('.bn'), bi = 0;
    function bgo(n) {
      if (!bns.length) return;
      bns[bi].classList.remove('on'); bi = (n + bns.length) % bns.length; bns[bi].classList.add('on');
      var nb = $('.bn-num b'); if (nb) nb.textContent = bi + 1;
    }
    $$('.bn-ctrl button').forEach(function (b) { b.addEventListener('click', function () { bgo(bi + +b.dataset.d); }); });
  }

  /* ---------- 팝업 ---------- */
  function showPopups() {
    var wrap = $('#popups');
    var today = ymd(new Date());
    var list = (D.site.popups || []).map(function (p, i) { p._i = i; return p; }).filter(function (p) {
      if (!p.active) return false;
      if (p.start && today < p.start) return false;
      if (p.end && today > p.end) return false;
      return store('dorm-popup-hide-' + p._i + '-' + (p.title || '')) !== today;
    });
    var mobile = window.innerWidth < 768;
    wrap.innerHTML = list.map(function (p, n) {
      var style = mobile ? '' : 'width:' + (+p.width || 380) + 'px;top:' + ((+p.top || 120) + n * 24) + 'px;left:' + ((+p.left || 60) + n * 24) + 'px';
      var body = (p.image ? '<img src="' + esc(p.image) + '" alt="' + esc(p.title) + '">' : '') + (p.html ? '<div class="pop-html">' + p.html + '</div>' : '');
      return '<div class="pop" role="dialog" aria-label="' + esc(p.title) + '" style="' + style + '" data-key="' + esc('dorm-popup-hide-' + p._i + '-' + (p.title || '')) + '">' +
        '<div class="pop-body">' + (p.link ? '<a ' + linkAttr(p.link) + '>' + body + '</a>' : body) + '</div>' +
        '<div class="pop-ft"><label><input type="checkbox"> 오늘 하루 열지 않기</label><button type="button">닫기</button></div></div>';
    }).join('');
    $$('.pop', wrap).forEach(function (pop) {
      $('.pop-ft button', pop).addEventListener('click', function () {
        if ($('input', pop).checked) store(pop.dataset.key, today);
        pop.remove();
      });
      $('.pop-body a', pop) && $('.pop-body a', pop).addEventListener('click', function () { pop.remove(); });
    });
  }

  /* ---------- 서브 ---------- */
  function subLayout(top, item, body) {
    var lnb = '';
    var crumbs = '<li><a href="#/" aria-label="홈">' + dormIcon('home', 15) + '</a></li>';
    if (top) {
      lnb = '<aside class="lnb"><h2>' + esc(top.title) + '</h2><ul>' + (top.children || []).map(function (c) {
        return '<li' + (c.id === item.id ? ' class="on"' : '') + '><a ' + linkAttr(itemHref(c)) + (c.id === item.id ? ' aria-current="page"' : '') + '>' + esc(c.title) + '</a></li>';
      }).join('') + '</ul></aside>';
      crumbs += '<li>' + esc(top.title) + '</li>';
    }
    crumbs += '<li><strong>' + esc(item.title) + '</strong></li>';
    var s = D.site.settings;
    return '<section class="svisual"><div class="inner"><p class="sv-en">' + esc(s.siteNameEn || '') + '</p><h2>' + esc(top ? top.title : item.title) + '</h2></div></section>' +
      '<div class="inner sub-wrap' + (top ? '' : ' no-lnb') + '">' + lnb +
      '<div class="sub-con"><div class="sub-hd"><h3>' + esc(item.title) + '</h3><ol class="crumb">' + crumbs + '</ol>' +
      '<div class="sub-tools"><button type="button" class="btn-print" aria-label="인쇄">' + dormIcon('doc', 18) + '</button></div></div>' +
      '<div class="sub-body">' + body + '</div></div></div>';
  }

  function bindSub() {
    var p = $('.btn-print'); if (p) p.onclick = function () { window.print(); };
  }

  function itemBody(item, r) {
    switch (item.type) {
      case 'page': {
        var pg = (D.site.pages || {})[item.id];
        return '<div class="content">' + (pg && pg.html ? pg.html : '<p class="empty">준비 중입니다.</p>') + '</div>';
      }
      case 'board': return boardBody(item, r);
      case 'meal': return mealBody(r);
      case 'schedule': return scheduleBody(r);
      case 'link': return '<p class="empty"><a ' + linkAttr(item.url) + '>바로가기</a></p>';
    }
    return '';
  }

  /* 게시판 */
  function boardBody(item, r) {
    var b = board(item.boardId);
    var base = '#/m/' + item.id;
    var list = postsOf(b.id);
    if (r.parts[2]) return postView(item, b, list, +r.parts[2]);

    var q = (r.q.get('q') || '').trim(), field = r.q.get('f') || 'title';
    if (q) {
      var lq = q.toLowerCase();
      list = list.filter(function (p) {
        var hay = field === 'all' ? p.title + ' ' + stripHtml(p.content) : p.title;
        return hay.toLowerCase().indexOf(lq) >= 0;
      });
    }
    var search = '<form class="bbs-search" data-base="' + esc(base) + '"><span class="total">전체 <b>' + list.length + '</b>건</span>' +
      '<select name="f" aria-label="검색 범위"><option value="title"' + (field === 'title' ? ' selected' : '') + '>제목</option><option value="all"' + (field === 'all' ? ' selected' : '') + '>제목+내용</option></select>' +
      '<input name="q" value="' + esc(q) + '" placeholder="검색어를 입력하세요" aria-label="검색어"><button type="submit">검색</button></form>';

    if (b.type === 'faq') {
      return search + (list.length ? '<ul class="faq">' + list.map(function (p) {
        return '<li><button type="button" class="faq-q" aria-expanded="false"><b>Q</b>' + esc(p.title) + '</button><div class="faq-a"><b>A</b><div>' + p.content + '</div></div></li>';
      }).join('') + '</ul>' : '<p class="empty">검색 결과가 없습니다.</p>') + faqScript();
    }

    var page = Math.max(1, +r.q.get('page') || 1);
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (page > pages) page = pages;
    var slice = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    var qs = function (pg) { return base + '?page=' + pg + (q ? '&f=' + encodeURIComponent(field) + '&q=' + encodeURIComponent(q) : ''); };
    var html;
    if (b.type === 'gallery') {
      html = slice.length ? '<ul class="gallery">' + slice.map(function (p) {
        var img = p.thumb || ((p.content || '').match(/<img[^>]+src="([^"]+)"/) || [])[1];
        return '<li><a href="' + esc(base + '/' + p.id) + '"><span class="g-img"' + (img ? ' style="background-image:url(\'' + esc(img) + '\')"' : '') + '>' + (img ? '' : dormIcon('home', 40)) + '</span>' +
          '<span class="g-t">' + esc(p.title) + '</span><span class="g-d">' + dotDate(p.date) + '</span></a></li>';
      }).join('') + '</ul>' : '<p class="empty">등록된 게시물이 없습니다.</p>';
    } else {
      var num = list.filter(function (p) { return !p.pinned; }).length - (page - 1) * PAGE_SIZE;
      var pinnedOnPage = 0;
      html = '<table class="bbs"><caption class="sr">' + esc(b.name) + ' 목록</caption><colgroup><col class="c-no"><col><col class="c-au"><col class="c-dt"><col class="c-fi"></colgroup>' +
        '<thead><tr><th scope="col">번호</th><th scope="col">제목</th><th scope="col">작성자</th><th scope="col">등록일</th><th scope="col">첨부</th></tr></thead><tbody>' +
        (slice.length ? slice.map(function (p) {
          var no;
          if (p.pinned) { no = '<span class="badge">공지</span>'; pinnedOnPage++; } else { no = num--; }
          return '<tr' + (p.pinned ? ' class="pinned"' : '') + '><td class="no">' + no + '</td>' +
            '<td class="tit"><a href="' + esc(base + '/' + p.id) + '">' + esc(p.title) + '</a>' + (isNew(p.date) ? '<span class="new">N</span>' : '') + '</td>' +
            '<td class="au">' + esc(p.author || '') + '</td><td class="dt">' + dotDate(p.date) + '</td>' +
            '<td class="fi">' + ((p.files || []).length ? dormIcon('doc', 16) : '') + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="empty">등록된 게시물이 없습니다.</td></tr>') + '</tbody></table>';
    }
    var pg = '<nav class="paging" aria-label="페이지 이동">';
    var startP = Math.floor((page - 1) / 10) * 10 + 1, endP = Math.min(pages, startP + 9);
    pg += '<a href="' + esc(qs(1)) + '" class="arw" aria-label="처음">&laquo;</a><a href="' + esc(qs(Math.max(1, page - 1))) + '" class="arw" aria-label="이전">&lsaquo;</a>';
    for (var i = startP; i <= endP; i++) pg += '<a href="' + esc(qs(i)) + '"' + (i === page ? ' class="on" aria-current="page"' : '') + '>' + i + '</a>';
    pg += '<a href="' + esc(qs(Math.min(pages, page + 1))) + '" class="arw" aria-label="다음">&rsaquo;</a><a href="' + esc(qs(pages)) + '" class="arw" aria-label="마지막">&raquo;</a></nav>';
    return search + html + pg;
  }

  function faqScript() {
    setTimeout(function () {
      $$('.faq-q').forEach(function (b) {
        b.onclick = function () {
          var li = b.parentNode, on = !li.classList.contains('on');
          li.classList.toggle('on', on); b.setAttribute('aria-expanded', on);
        };
      });
    });
    return '';
  }

  function postView(item, b, list, id) {
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) idx = i;
    var base = '#/m/' + item.id;
    if (idx < 0) return '<p class="empty">게시물을 찾을 수 없습니다.</p><div class="btns"><a class="btn" href="' + esc(base) + '">목록</a></div>';
    var p = list[idx], prev = list[idx + 1], next = list[idx - 1];
    var files = (p.files || []).length ? '<div class="files"><strong>첨부파일</strong><ul>' + p.files.map(function (f) {
      return '<li><a href="' + esc(f.url) + '" download target="_blank" rel="noopener">' + dormIcon('doc', 16) + esc(f.name) + '</a></li>';
    }).join('') + '</ul></div>' : '';
    return '<article class="view"><header class="view-hd"><h4>' + (p.pinned ? '<span class="badge">공지</span>' : '') + esc(p.title) + '</h4>' +
      '<dl><dt>작성자</dt><dd>' + esc(p.author || '') + '</dd><dt>등록일</dt><dd>' + dotDate(p.date) + '</dd></dl></header>' +
      files + '<div class="view-body content">' + (p.content || '') + '</div></article>' +
      '<ul class="view-nav"><li><span>이전글</span>' + (prev ? '<a href="' + esc(base + '/' + prev.id) + '">' + esc(prev.title) + '</a>' : '<em>이전글이 없습니다.</em>') + '</li>' +
      '<li><span>다음글</span>' + (next ? '<a href="' + esc(base + '/' + next.id) + '">' + esc(next.title) + '</a>' : '<em>다음글이 없습니다.</em>') + '</li></ul>' +
      '<div class="btns"><a class="btn" href="' + esc(base) + '">목록</a></div>';
  }

  /* 주간식단표 */
  function mealBody(r) {
    var mon = r.q.get('w') ? mondayOf(parseYmd(r.q.get('w'))) : mondayOf(new Date());
    var days = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(mon, i); });
    var today = ymd(new Date());
    var nav = '<div class="week-nav"><a href="#/m/meal?w=' + ymd(addDays(mon, -7)) + '" aria-label="이전 주">&lsaquo;</a>' +
      '<strong>' + dotDate(ymd(mon)) + ' ~ ' + dotDate(ymd(days[6])) + '</strong>' +
      '<a href="#/m/meal?w=' + ymd(addDays(mon, 7)) + '" aria-label="다음 주">&rsaquo;</a>' +
      '<a class="this" href="#/m/meal">이번 주</a></div>';
    var t = D.meals.times || {};
    var tbl = '<div class="tbl-scroll"><table class="tbl meal-tbl"><caption class="sr">주간식단표</caption><thead><tr><th scope="col">구분</th>' + days.map(function (d) {
      return '<th scope="col" class="' + (ymd(d) === today ? 'today' : '') + (d.getDay() === 0 ? ' sun' : d.getDay() === 6 ? ' sat' : '') + '">' + WEEK[d.getDay()] + '<small>' + pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '</small></th>';
    }).join('') + '</tr></thead><tbody>' + MEALS.map(function (m) {
      return '<tr><th scope="row">' + m[1] + (t[m[0]] ? '<small>' + esc(t[m[0]]) + '</small>' : '') + '</th>' + days.map(function (d) {
        var v = ((D.meals.days || {})[ymd(d)] || {})[m[0]];
        return '<td class="' + (ymd(d) === today ? 'today' : '') + '">' + (v ? nl2br(v) : '<span class="none">-</span>') + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody></table></div>';
    return nav + tbl + (D.meals.note ? '<p class="note">' + esc(D.meals.note) + '</p>' : '');
  }

  /* 생활관 일정 */
  function scheduleBody(r) {
    var base = r.q.get('ym') ? parseYmd(r.q.get('ym') + '-01') : new Date();
    var y = base.getFullYear(), m = base.getMonth();
    var first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
    var prevYm = ymd(new Date(y, m - 1, 1)).slice(0, 7), nextYm = ymd(new Date(y, m + 1, 1)).slice(0, 7);
    var ms = ymd(first), me = ymd(last), today = ymd(new Date());
    var events = (D.site.schedule || []).filter(function (e) { return e.start <= me && (e.end || e.start) >= ms; })
      .sort(function (a, b) { return a.start < b.start ? -1 : 1; });
    var cells = '', d = addDays(first, -first.getDay());
    for (var w = 0; w < 6; w++) {
      cells += '<tr>';
      for (var i = 0; i < 7; i++) {
        var k = ymd(d), inMonth = d.getMonth() === m;
        var evs = events.filter(function (e) { return e.start <= k && (e.end || e.start) >= k; });
        cells += '<td class="' + (inMonth ? '' : 'out') + (k === today ? ' today' : '') + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' +
          '<span class="dn">' + d.getDate() + '</span>' + (inMonth ? evs.map(function (e) { return '<span class="ev" title="' + esc(e.title) + '">' + esc(e.title) + '</span>'; }).join('') : '') + '</td>';
        d = addDays(d, 1);
      }
      cells += '</tr>';
      if (d > last) break;
    }
    return '<div class="week-nav"><a href="#/m/schedule?ym=' + prevYm + '" aria-label="이전 달">&lsaquo;</a><strong>' + y + '. ' + pad(m + 1) + '</strong>' +
      '<a href="#/m/schedule?ym=' + nextYm + '" aria-label="다음 달">&rsaquo;</a><a class="this" href="#/m/schedule">이번 달</a></div>' +
      '<table class="calendar"><caption class="sr">' + y + '년 ' + (m + 1) + '월 일정</caption><thead><tr>' + WEEK.map(function (w, i) {
        return '<th scope="col" class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + w + '</th>';
      }).join('') + '</tr></thead><tbody>' + cells + '</tbody></table>' +
      '<h4 class="h-sub">' + (m + 1) + '월 일정</h4>' +
      (events.length ? '<ul class="sched-list">' + events.map(function (e) {
        return '<li><span class="dt">' + dotDate(e.start) + (e.end && e.end !== e.start ? ' ~ ' + dotDate(e.end) : '') + '</span><i class="cat">' + esc(e.category || '일정') + '</i><span>' + esc(e.title) + '</span></li>';
      }).join('') + '</ul>' : '<p class="empty">등록된 일정이 없습니다.</p>');
  }

  function sitemapHtml() {
    return '<div class="sitemap">' + D.site.menu.map(function (top) {
      return '<div class="sm-col"><h4>' + esc(top.title) + '</h4><ul>' + (top.children || []).map(function (c) {
        return '<li><a ' + linkAttr(itemHref(c)) + '>' + esc(c.title) + '</a></li>';
      }).join('') + '</ul></div>';
    }).join('') + '</div>';
  }

  /* 게시판 검색 폼 (위임) */
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('.bbs-search');
    if (!f) return;
    e.preventDefault();
    var q = f.q.value.trim();
    location.hash = f.dataset.base + (q ? '?f=' + encodeURIComponent(f.f.value) + '&q=' + encodeURIComponent(q) : '');
  });

  /* ---------- 시작 ---------- */
  load().then(function (data) {
    D = data;
    renderChrome();
    bindChrome();
    window.addEventListener('hashchange', route);
    route();
  }).catch(function (err) {
    $('#content').innerHTML = '<div class="inner"><p class="empty">데이터를 불러오지 못했습니다. (' + esc(err.message) + ')<br>로컬에서 확인할 때는 파일을 직접 열지 말고 간단한 웹서버로 실행하세요.</p></div>';
  });
})();
