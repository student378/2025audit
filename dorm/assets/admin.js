/* 생활관 홈페이지 — 관리자
 * 서버 없이 GitHub REST API로 저장소의 data/*.json 파일을 직접 수정(커밋)합니다.
 * 커밋되면 GitHub Pages가 자동으로 다시 배포하므로 1~2분 뒤 홈페이지에 반영됩니다.
 */
(function () {
  'use strict';

  // 이 사이트가 들어 있는 저장소 기본값 (github.io 주소에서 열면 자동 감지)
  var DEFAULTS = { owner: 'student378', repo: '2025audit', branch: 'main', base: 'dorm' };
  var CFG_KEY = 'dorm-admin-cfg';
  var FILES = { site: 'data/site.json', posts: 'data/posts.json', meals: 'data/meals.json' };
  var FILE_LABEL = { site: '사이트 설정', posts: '게시판', meals: '식단표' };
  var MEALS = [['breakfast', '조식'], ['lunch', '중식'], ['dinner', '석식']];
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  var ITEM_TYPES = [['page', '일반 페이지'], ['board', '게시판'], ['meal', '주간식단표'], ['schedule', '생활관 일정'], ['link', '외부 링크']];
  var BOARD_TYPES = [['list', '일반 목록형'], ['gallery', '갤러리형'], ['faq', 'FAQ형(아코디언)']];

  var cfg = {};
  var mode = 'github';
  var data = { site: null, posts: null, meals: null };
  var sha = {};
  var dirty = {};
  var view = 'dashboard';
  var blobMap = {}; // 업로드 직후(배포 전) 미리보기용: 상대경로 → blob URL

  /* ================= 유틸 ================= */
  function $(s, el) { return (el || document).querySelector(s); }
  function h(tag, props) {
    var el = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value' || k === 'checked') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) return c.forEach(function (x) { append(el, x); });
    el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var w = x.getDay(); return addDays(x, w === 0 ? -6 : 1 - w); }
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function sstore(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { return null; }
  }
  function toast(msg, type) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast on' + (type ? ' ' + type : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, type === 'err' ? 6000 : 3200);
  }
  function uid(prefix) { return (prefix || 'p') + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4); }
  function previewUrl(u) { return blobMap[u] || u; }
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }

  /* ================= GitHub API ================= */
  function repoPath(file) { var b = (cfg.base || '').replace(/^\/+|\/+$/g, ''); return (b ? b + '/' : '') + file; }
  function contentsUrl(path) {
    return 'https://api.github.com/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo) +
      '/contents/' + path.split('/').map(encodeURIComponent).join('/');
  }
  function gh(url, opts) {
    opts = opts || {};
    var headers = { 'Authorization': 'Bearer ' + cfg.token, 'Accept': opts.accept || 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body, cache: 'no-store' }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          var e = new Error(ghMessage(r.status, j.message));
          e.status = r.status; throw e;
        });
      }
      return opts.raw ? r.text() : r.json();
    });
  }
  function ghMessage(status, msg) {
    if (status === 401) return '토큰이 올바르지 않거나 만료되었습니다.';
    if (status === 403) return '권한이 없습니다. 토큰에 Contents 쓰기 권한이 있는지 확인하세요. (' + (msg || '') + ')';
    if (status === 404) return '저장소 또는 파일을 찾을 수 없습니다. 소유자·저장소·브랜치·폴더 경로를 확인하세요.';
    if (status === 409 || status === 422) return '다른 곳에서 먼저 수정되어 저장이 충돌했습니다. 새로고침 후 다시 시도하세요. (' + (msg || '') + ')';
    return 'GitHub 오류 ' + status + (msg ? ': ' + msg : '');
  }
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToUtf8(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function ghGetJson(file) {
    var url = contentsUrl(repoPath(file)) + '?ref=' + encodeURIComponent(cfg.branch);
    return gh(url).then(function (j) {
      if (j.content) return { sha: j.sha, json: JSON.parse(b64ToUtf8(j.content)) };
      // 1MB 이상 파일은 content가 비어 있으므로 원본으로 다시 받음
      return gh(url, { accept: 'application/vnd.github.raw+json', raw: true }).then(function (t) { return { sha: j.sha, json: JSON.parse(t) }; });
    });
  }
  function ghPut(path, b64, message, fileSha) {
    var body = { message: message, content: b64, branch: cfg.branch };
    if (fileSha) body.sha = fileSha;
    return gh(contentsUrl(path), { method: 'PUT', body: JSON.stringify(body) });
  }

  /* ================= 데이터 로드/저장 ================= */
  function loadAll() {
    var keys = Object.keys(FILES);
    if (mode === 'github') {
      return Promise.all(keys.map(function (k) { return ghGetJson(FILES[k]); })).then(function (a) {
        keys.forEach(function (k, i) { data[k] = a[i].json; sha[k] = a[i].sha; });
      });
    }
    return Promise.all(keys.map(function (k) {
      return fetch(FILES[k] + '?v=' + Date.now(), { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error(FILES[k] + ' ' + r.status); return r.json();
      });
    })).then(function (a) { keys.forEach(function (k, i) { data[k] = a[i]; }); });
  }

  function normalize() {
    var s = data.site;
    s.settings = s.settings || {};
    ['footerLinks', 'familySites', 'topLinks', 'contacts', 'homeBoards'].forEach(function (k) { s.settings[k] = s.settings[k] || []; });
    ['menu', 'hiddenPages', 'slides', 'quickLinks', 'popups', 'banners', 'schedule'].forEach(function (k) { s[k] = s[k] || []; });
    s.pages = s.pages || {};
    data.posts.boards = data.posts.boards || [];
    data.posts.posts = data.posts.posts || [];
    data.meals.days = data.meals.days || {};
    data.meals.times = data.meals.times || {};
  }

  function markDirty(file) {
    if (!FILES[file]) return; // 글쓰기 창의 임시 입력값 등은 저장 대상 아님
    dirty[file] = true;
    updateSaveBtn();
    try { store('dorm-preview', JSON.stringify(data)); } catch (e) { /* 용량 초과 시 미리보기만 생략 */ }
  }
  function dirtyList() { return Object.keys(dirty).filter(function (k) { return dirty[k]; }); }
  function updateSaveBtn() {
    var n = dirtyList().length, b = $('#saveBtn');
    b.disabled = !n;
    b.textContent = n ? (mode === 'github' ? '저장 · 배포 (' + n + ')' : '파일 내려받기 (' + n + ')') : (mode === 'github' ? '저장 · 배포' : '파일 내려받기');
  }

  function saveAll() {
    var list = dirtyList();
    if (!list.length) return;
    var json = {};
    list.forEach(function (k) { json[k] = JSON.stringify(data[k], null, 1) + '\n'; });

    if (mode === 'local') {
      list.forEach(function (k) { download(FILES[k].split('/').pop(), json[k]); dirty[k] = false; });
      updateSaveBtn();
      toast('내려받은 파일을 저장소의 ' + repoPath('data/') + ' 폴더에 덮어쓰면 반영됩니다.', 'ok');
      return;
    }
    var btn = $('#saveBtn');
    btn.disabled = true; btn.textContent = '저장 중…';
    var msg = '생활관 홈페이지 수정: ' + list.map(function (k) { return FILE_LABEL[k]; }).join(', ');
    var chain = Promise.resolve();
    list.forEach(function (k) {
      chain = chain.then(function () {
        return ghPut(repoPath(FILES[k]), utf8ToB64(json[k]), msg, sha[k]).then(function (r) {
          sha[k] = r.content.sha; dirty[k] = false;
        });
      });
    });
    chain.then(function () {
      updateSaveBtn();
      toast('저장했습니다. 1~2분 후 홈페이지에 반영됩니다.', 'ok');
    }).catch(function (e) {
      updateSaveBtn();
      toast('저장 실패: ' + e.message, 'err');
    });
  }

  function download(name, text) {
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ================= 파일 업로드 ================= */
  function pickFile(accept) {
    return new Promise(function (res) {
      // 문서에 붙어 있어야 일부 브라우저(사파리 등)에서 change 이벤트가 발생함
      var inp = h('input', { type: 'file', accept: accept || '', hidden: true });
      document.body.appendChild(inp);
      inp.addEventListener('change', function () { var f = inp.files[0] || null; inp.remove(); res(f); });
      inp.click();
    });
  }
  function compressImage(file) {
    // 큰 사진은 가로 1920px / JPEG 85%로 줄여 저장소 용량을 아낌
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return Promise.resolve(file);
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1920 / img.width);
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (b) {
          URL.revokeObjectURL(img.src);
          if (!b || b.size >= file.size) return res(file);
          res(new File([b], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { res(file); };
      img.src = URL.createObjectURL(file);
    });
  }
  function readB64(file) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1]); };
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }
  function upload(file) {
    if (mode !== 'github') { toast('로컬 모드에서는 업로드할 수 없습니다. 이미지 주소(URL)를 직접 입력하세요.', 'err'); return Promise.reject(new Error('local')); }
    if (file.size > 20 * 1024 * 1024) { toast('20MB 이하 파일만 업로드할 수 있습니다.', 'err'); return Promise.reject(new Error('size')); }
    toast('업로드 중… ' + file.name);
    return compressImage(file).then(function (f) {
      var d = new Date();
      var safe = f.name.replace(/[^\w.\-가-힣]/g, '_').slice(-60);
      var rel = 'uploads/' + d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + Date.now().toString(36) + '-' + safe;
      return readB64(f).then(function (b64) {
        return ghPut(repoPath(rel), b64, '생활관 홈페이지 파일 업로드: ' + f.name);
      }).then(function () {
        blobMap[rel] = URL.createObjectURL(f);
        toast('업로드 완료: ' + f.name, 'ok');
        return { url: rel, name: f.name };
      });
    }).catch(function (e) {
      if (e.message !== 'local' && e.message !== 'size') toast('업로드 실패: ' + e.message, 'err');
      throw e;
    });
  }

  /* ================= 공통 폼 요소 ================= */
  function allItems() {
    var out = [];
    data.site.menu.forEach(function (t) { (t.children || []).forEach(function (c) { out.push(c); }); });
    data.site.hiddenPages.forEach(function (c) { out.push(c); });
    return out;
  }
  function refreshLinkOptions() {
    var dl = $('#linkOptions');
    dl.innerHTML = '';
    allItems().forEach(function (c) { if (c.type !== 'link') dl.appendChild(h('option', { value: '#/m/' + c.id, label: c.title })); });
    dl.appendChild(h('option', { value: '#/sitemap', label: '사이트맵' }));
    dl.appendChild(h('option', { value: '#/', label: '메인' }));
  }

  /* field 정의: {key, label, type, options, wide, hint, rows, placeholder} */
  function field(obj, f, file, onChange) {
    var wrap = h('label', { class: 'fld' + (f.wide ? ' wide' : '') + (f.type === 'checkbox' ? ' chk' : '') });
    var input, extra = null;
    var val = obj[f.key];
    function set(v) { obj[f.key] = v; markDirty(file); if (onChange) onChange(obj, f.key); }

    if (f.type === 'checkbox') {
      input = h('input', { type: 'checkbox', checked: !!val });
      input.addEventListener('change', function () { set(input.checked); });
      wrap.appendChild(input); wrap.appendChild(h('span', { text: f.label }));
      return wrap;
    }
    wrap.appendChild(h('span', { class: 'fl', text: f.label }));

    if (f.type === 'textarea') {
      input = h('textarea', { rows: f.rows || 3, placeholder: f.placeholder || '' });
      input.value = val || '';
    } else if (f.type === 'select') {
      var opts = typeof f.options === 'function' ? f.options() : f.options;
      input = h('select', {}, opts.map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
      input.value = val == null ? '' : val;
    } else if (f.type === 'icon') {
      var pv = h('span', { class: 'icon-pv', html: dormIcon(val, 22) });
      input = h('select', {}, Object.keys(DORM_ICONS).map(function (k) { return h('option', { value: k, text: k + ' (' + DORM_ICONS[k].label + ')' }); }));
      input.value = val || 'link';
      input.addEventListener('change', function () { pv.innerHTML = dormIcon(input.value, 22); });
      extra = h('div', { class: 'row' }, pv, input);
    } else if (f.type === 'image' || f.type === 'file') {
      input = h('input', { type: 'text', placeholder: f.placeholder || '업로드하거나 주소 입력' });
      input.value = val || '';
      var th = f.type === 'image' ? h('span', { class: 'thumb' }) : null;
      var showThumb = function () { if (th) th.style.backgroundImage = input.value ? 'url("' + previewUrl(input.value).replace(/"/g, '%22') + '")' : ''; };
      showThumb();
      input.addEventListener('input', showThumb);
      var up = h('button', { type: 'button', class: 'btn sm', text: '업로드' });
      up.addEventListener('click', function (e) {
        e.preventDefault();
        pickFile(f.type === 'image' ? 'image/*' : '').then(function (file) {
          if (!file) return;
          upload(file).then(function (r) { input.value = r.url; set(r.url); showThumb(); }).catch(function () {});
        });
      });
      var clr = h('button', { type: 'button', class: 'btn sm', text: '지우기' });
      clr.addEventListener('click', function (e) { e.preventDefault(); input.value = ''; set(''); showThumb(); });
      extra = h('div', { class: 'row' }, th, input, up, clr);
    } else {
      var type = f.type === 'link' ? 'text' : (f.type || 'text');
      input = h('input', { type: type, placeholder: f.placeholder || '' });
      if (f.type === 'link') input.setAttribute('list', 'linkOptions');
      input.value = val == null ? '' : val;
    }
    var ev = (input.tagName === 'SELECT' || f.type === 'color' || f.type === 'date') ? 'change' : 'input';
    input.addEventListener(ev, function () { set(f.type === 'number' ? (input.value === '' ? '' : +input.value) : input.value); });
    wrap.appendChild(extra || input);
    if (f.hint) wrap.appendChild(h('span', { class: 'hint', text: f.hint }));
    return wrap;
  }

  function fields(obj, defs, file, cls, onChange) {
    return h('div', { class: 'fields ' + (cls || '') }, defs.map(function (f) { return field(obj, f, file, onChange); }));
  }

  /* 반복 항목 편집기 */
  function listEditor(arr, defs, file, opt) {
    opt = opt || {};
    var box = h('div');
    function draw() {
      box.innerHTML = '';
      var items = h('div', { class: 'items' });
      if (!arr.length) items.appendChild(h('p', { class: 'muted', text: '등록된 항목이 없습니다.' }));
      arr.forEach(function (it, i) {
        var sum = h('span', { class: 'sum', text: opt.summary ? opt.summary(it) : '' });
        var hd = h('div', { class: 'item-hd' },
          h('span', { class: 'no', text: '#' + (i + 1) }), sum,
          h('button', { type: 'button', class: 'btn xs', text: '▲', title: '위로', onclick: function () { move(arr, i, -1); markDirty(file); draw(); } }),
          h('button', { type: 'button', class: 'btn xs', text: '▼', title: '아래로', onclick: function () { move(arr, i, 1); markDirty(file); draw(); } }),
          h('button', { type: 'button', class: 'btn xs danger', text: '삭제', onclick: function () {
            if (!confirm('이 항목을 삭제할까요?')) return;
            arr.splice(i, 1); markDirty(file); draw();
          } }));
        var bd = h('div', { class: 'item-bd' }, fields(it, defs, file, opt.cls, function () { if (opt.summary) sum.textContent = opt.summary(it); }));
        items.appendChild(h('div', { class: 'item' + (opt.compact ? ' compact' : '') }, hd, bd));
      });
      box.appendChild(items);
      box.appendChild(h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn sm', text: '+ ' + (opt.addLabel || '항목 추가'), onclick: function () {
        arr.push(opt.make ? opt.make() : {}); markDirty(file); draw();
      } })));
    }
    draw();
    return box;
  }

  function card(title, sub) {
    var c = h('section', { class: 'card' }, h('h3', { text: title }));
    if (sub) c.appendChild(h('p', { class: 'sub', html: sub }));
    for (var i = 2; i < arguments.length; i++) append(c, arguments[i]);
    return c;
  }

  /* ================= 리치 에디터 ================= */
  function richEditor(html) {
    var area = h('div', { class: 'rte-area', contenteditable: 'true' });
    area.innerHTML = toPreview(html || '');
    var src = h('textarea', { class: 'rte-src', hidden: true, spellcheck: 'false' });
    var srcMode = false;
    var listeners = [];

    function toPreview(s) { Object.keys(blobMap).forEach(function (k) { s = s.split('"' + k + '"').join('"' + blobMap[k] + '"'); }); return s; }
    function fromPreview(s) { Object.keys(blobMap).forEach(function (k) { s = s.split('"' + blobMap[k] + '"').join('"' + k + '"'); }); return s; }
    function value() { return fromPreview(srcMode ? src.value : area.innerHTML).replace(/<p><br><\/p>$/, ''); }
    function changed() { listeners.forEach(function (fn) { fn(value()); }); }
    function cmd(c, v) { area.focus(); document.execCommand(c, false, v); changed(); }
    function insertHtml(s) { area.focus(); document.execCommand('insertHTML', false, s); changed(); }

    var block = h('select', { title: '문단 형식' },
      h('option', { value: 'p', text: '본문' }), h('option', { value: 'h3', text: '제목 1' }), h('option', { value: 'h4', text: '제목 2' }));
    block.addEventListener('change', function () { cmd('formatBlock', block.value); });

    function b(label, title, fn) { return h('button', { type: 'button', title: title, html: label, onmousedown: function (e) { e.preventDefault(); }, onclick: fn }); }
    var srcBtn = b('&lt;/&gt; HTML', 'HTML 직접 편집', function () {
      srcMode = !srcMode;
      if (srcMode) { src.value = fromPreview(area.innerHTML); } else { area.innerHTML = toPreview(src.value); }
      area.hidden = srcMode; src.hidden = !srcMode;
      srcBtn.classList.toggle('on', srcMode);
    });
    var bar = h('div', { class: 'rte-bar' },
      block,
      h('span', { class: 'sep' }),
      b('<b>B</b>', '굵게', function () { cmd('bold'); }),
      b('<i>I</i>', '기울임', function () { cmd('italic'); }),
      b('<u>U</u>', '밑줄', function () { cmd('underline'); }),
      b('<span style="color:#d93b3b">A</span>', '빨간 글씨', function () { cmd('foreColor', '#d93b3b'); }),
      b('<span style="color:#0b4ea2">A</span>', '파란 글씨', function () { cmd('foreColor', '#0b4ea2'); }),
      h('span', { class: 'sep' }),
      b('• 목록', '글머리 목록', function () { cmd('insertUnorderedList'); }),
      b('1. 목록', '번호 목록', function () { cmd('insertOrderedList'); }),
      b('링크', '링크 넣기', function () {
        var u = prompt('링크 주소 (예: https://… 또는 #/m/notice)');
        if (u) cmd('createLink', u);
      }),
      b('표', '표 넣기', function () {
        var spec = prompt('표 크기 (행x열)', '3x3');
        var m = /(\d+)\s*[x×*]\s*(\d+)/i.exec(spec || '');
        if (!m) return;
        var r = Math.min(+m[1], 30), c = Math.min(+m[2], 10), t = '<table><thead><tr>';
        for (var j = 0; j < c; j++) t += '<th>제목</th>';
        t += '</tr></thead><tbody>';
        for (var i = 1; i < r; i++) { t += '<tr>'; for (j = 0; j < c; j++) t += '<td>&nbsp;</td>'; t += '</tr>'; }
        insertHtml(t + '</tbody></table><p><br></p>');
      }),
      b('이미지', '이미지 업로드', function () {
        var sel = window.getSelection(), range = sel.rangeCount ? sel.getRangeAt(0) : null;
        pickFile('image/*').then(function (f) {
          if (!f) return;
          upload(f).then(function (r) {
            area.focus();
            if (range) { sel.removeAllRanges(); sel.addRange(range); }
            insertHtml('<img src="' + previewUrl(r.url) + '" alt="' + r.name.replace(/"/g, '') + '">');
          }).catch(function () {});
        });
      }),
      b('지도/영상', 'iframe 코드 붙여넣기 (네이버·카카오 지도, 유튜브)', function () {
        var code = prompt('지도 또는 유튜브의 "퍼가기/HTML 태그" 코드를 붙여넣으세요');
        if (code && /^\s*<iframe[\s\S]*<\/iframe>\s*$/i.test(code)) insertHtml(code + '<p><br></p>');
        else if (code) alert('<iframe …></iframe> 형식의 코드만 넣을 수 있습니다.');
      }),
      h('span', { class: 'sep' }),
      b('서식 지우기', '선택 영역 서식 제거 (한글·워드에서 붙여넣은 뒤 사용)', function () { cmd('removeFormat'); }),
      srcBtn);

    area.addEventListener('input', changed);
    src.addEventListener('input', changed);
    var el = h('div', { class: 'rte' }, bar, area, src);
    return { el: el, value: value, onChange: function (fn) { listeners.push(fn); } };
  }

  /* ================= 모달 ================= */
  function openModal(title, body) {
    $('#modalTitle').textContent = title;
    var mb = $('#modalBody'); mb.innerHTML = ''; mb.appendChild(body);
    $('#modal').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() { $('#modal').hidden = true; document.body.style.overflow = ''; }

  /* ================= 화면들 ================= */
  var VIEWS = [
    ['grp', '기본'],
    ['dashboard', '대시보드'],
    ['settings', '기본 정보'],
    ['menu', '메뉴 · 페이지'],
    ['grp', '메인 화면'],
    ['visual', '메인 비주얼'],
    ['quick', '퀵메뉴'],
    ['popup', '팝업 · 알림존'],
    ['grp', '콘텐츠'],
    ['board', '게시판'],
    ['meal', '주간식단표'],
    ['schedule', '생활관 일정'],
    ['grp', '시스템'],
    ['system', '연결 · 백업']
  ];

  function renderNav() {
    var nav = $('#sideNav'); nav.innerHTML = '';
    VIEWS.forEach(function (v) {
      if (v[0] === 'grp') return nav.appendChild(h('div', { class: 'grp', text: v[1] }));
      nav.appendChild(h('button', { type: 'button', class: view === v[0] ? 'on' : '', text: v[1], onclick: function () { go(v[0]); } }));
    });
  }
  function go(v) {
    view = v;
    document.body.classList.remove('nav-open');
    renderNav();
    var title = VIEWS.filter(function (x) { return x[0] === v; })[0];
    $('#viewTitle').textContent = title ? title[1] : '';
    refreshLinkOptions();
    var el = $('#view'); el.innerHTML = '';
    el.appendChild(RENDER[v]());
    window.scrollTo(0, 0);
  }

  var RENDER = {};

  RENDER.dashboard = function () {
    var today = new Date(), mon = mondayOf(today);
    var mealDays = 0;
    for (var i = 0; i < 7; i++) { var d = data.meals.days[ymd(addDays(mon, i))]; if (d && (d.breakfast || d.lunch || d.dinner)) mealDays++; }
    var t = ymd(today);
    var activePop = data.site.popups.filter(function (p) { return p.active && (!p.start || p.start <= t) && (!p.end || p.end >= t); }).length;
    var upcoming = data.site.schedule.filter(function (e) { return (e.end || e.start) >= t; }).length;
    var recent = data.posts.posts.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 6);
    var boardName = {}; data.posts.boards.forEach(function (b) { boardName[b.id] = b.name; });

    var wrap = h('div');
    if (mode === 'local') wrap.appendChild(h('div', { class: 'warn', html: '<b>로컬 모드</b>입니다. 저장하면 JSON 파일이 내려받아지며, 저장소에 직접 반영되지 않습니다. 실제 운영은 <b>연결 · 백업</b>에서 GitHub 토큰으로 연결하세요.' }));
    wrap.appendChild(h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('span', { text: '전체 게시물' }), h('b', { text: data.posts.posts.length })),
      h('div', { class: 'stat' }, h('span', { text: '이번 주 식단 등록' }), h('b', { text: mealDays + ' / 7일' })),
      h('div', { class: 'stat' }, h('span', { text: '노출 중인 팝업' }), h('b', { text: activePop })),
      h('div', { class: 'stat' }, h('span', { text: '예정된 일정' }), h('b', { text: upcoming }))));
    wrap.appendChild(h('div', { class: 'tip', html: '<b>사용 방법</b><ol><li>왼쪽 메뉴에서 내용을 수정합니다. (자동으로 임시 보관됩니다)</li><li><b>미리보기</b>로 홈페이지에 어떻게 보이는지 확인합니다.</li><li>오른쪽 위 <b>저장 · 배포</b>를 누르면 저장소에 커밋되고, 1~2분 뒤 홈페이지에 반영됩니다.</li></ol>' }));
    var tb = h('table', { class: 'grid resp' }, h('thead', {}, h('tr', {}, h('th', { text: '게시판' }), h('th', { text: '제목' }), h('th', { text: '등록일' }), h('th'))),
      h('tbody', {}, recent.map(function (p) {
        return h('tr', {}, h('td', { text: boardName[p.board] || p.board }), h('td', { class: 'ellipsis', text: p.title }), h('td', { text: p.date }),
          h('td', { class: 'act' }, h('button', { type: 'button', class: 'btn xs', text: '수정', onclick: function () { boardState.board = p.board; go('board'); editPost(p); } })));
      })));
    wrap.appendChild(card('최근 게시물', null, tb,
      h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn primary sm', text: '+ 새 공지 작성', onclick: function () { boardState.board = 'notice'; go('board'); editPost(null); } }),
        ' ', h('button', { type: 'button', class: 'btn sm', text: '이번 주 식단 입력', onclick: function () { go('meal'); } }))));
    return wrap;
  };

  RENDER.settings = function () {
    var s = data.site.settings;
    var wrap = h('div');
    wrap.appendChild(card('사이트 기본 정보', '로고·사이트 이름·대표 색상 등 홈페이지 전체에 쓰이는 정보입니다.',
      fields(s, [
        { key: 'univName', label: '대학 이름' },
        { key: 'siteName', label: '사이트 이름', placeholder: '생활관' },
        { key: 'siteNameEn', label: '영문 이름 (서브 상단 표시)' },
        { key: 'univUrl', label: '대학 홈페이지 주소' },
        { key: 'logoImage', label: '로고 이미지 (비우면 기본 로고)', type: 'image', wide: true, hint: '가로형 PNG(투명 배경, 높이 100px 내외) 권장' },
        { key: 'primaryColor', label: '대표 색상', type: 'color' },
        { key: 'accentColor', label: '보조 색상', type: 'color' }
      ], 'site')));
    wrap.appendChild(card('연락처 · 하단 정보', null,
      fields(s, [
        { key: 'address', label: '주소', wide: true },
        { key: 'tel', label: '대표 전화' },
        { key: 'fax', label: '팩스' },
        { key: 'email', label: '이메일' },
        { key: 'officeHours', label: '업무 시간' },
        { key: 'copyright', label: '저작권 문구', wide: true }
      ], 'site')));

    var hb = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:14px' }, data.posts.boards.map(function (b) {
      var cb = h('input', { type: 'checkbox', checked: s.homeBoards.indexOf(b.id) >= 0 });
      cb.addEventListener('change', function () {
        var i = s.homeBoards.indexOf(b.id);
        if (cb.checked && i < 0) s.homeBoards.push(b.id);
        if (!cb.checked && i >= 0) s.homeBoards.splice(i, 1);
        markDirty('site');
      });
      return h('label', { class: 'row' }, cb, b.name);
    }));
    wrap.appendChild(card('메인 게시판 탭', '메인 화면 "공지사항" 영역에 탭으로 보여줄 게시판을 선택하세요. (선택 순서대로 표시)', hb));
    wrap.appendChild(card('문의 안내 전화번호', '메인 화면 "문의 안내" 영역',
      listEditor(s.contacts, [{ key: 'label', label: '부서' }, { key: 'tel', label: '전화번호' }], 'site', { compact: true, addLabel: '전화번호 추가', summary: function (x) { return x.label; } })));
    wrap.appendChild(card('상단 링크', '맨 위 어두운 줄 오른쪽 링크',
      listEditor(s.topLinks, [{ key: 'label', label: '이름' }, { key: 'url', label: '주소', type: 'link' }], 'site', { compact: true, addLabel: '링크 추가', summary: function (x) { return x.label; } })));
    wrap.appendChild(card('하단 링크', '개인정보처리방침 등 (강조 체크 시 색상 표시)',
      listEditor(s.footerLinks, [{ key: 'label', label: '이름' }, { key: 'url', label: '주소', type: 'link' }, { key: 'strong', label: '강조', type: 'checkbox' }], 'site', { compact: true, cls: 'c3', addLabel: '링크 추가', summary: function (x) { return x.label; } })));
    wrap.appendChild(card('관련 사이트', '하단 "관련 사이트" 선택 상자',
      listEditor(s.familySites, [{ key: 'label', label: '이름' }, { key: 'url', label: '주소' }], 'site', { compact: true, addLabel: '사이트 추가', summary: function (x) { return x.label; } })));
    return wrap;
  };

  /* ---- 메뉴 · 페이지 ---- */
  function idTaken(id, except) {
    if (data.site.menu.some(function (t) { return t !== except && t.id === id; })) return true;
    return allItems().some(function (c) { return c !== except && c.id === id; });
  }
  function idInput(obj, onRename) {
    var inp = h('input', { class: 'id', value: obj.id, title: '주소에 쓰이는 영문 ID (#/m/ID)' });
    inp.addEventListener('change', function () {
      var v = inp.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      if (!v || v === obj.id) { inp.value = obj.id; return; }
      if (idTaken(v, obj)) { toast('이미 사용 중인 ID입니다: ' + v, 'err'); inp.value = obj.id; return; }
      var old = obj.id; obj.id = v; inp.value = v;
      if (onRename) onRename(old, v);
      markDirty('site');
    });
    return inp;
  }
  function renamePage(old, v) {
    if (data.site.pages[old]) { data.site.pages[v] = data.site.pages[old]; delete data.site.pages[old]; }
  }
  function editPage(item) {
    var pg = data.site.pages[item.id] || (data.site.pages[item.id] = { html: '' });
    var ed = richEditor(pg.html);
    var body = h('div', {}, ed.el, h('div', { class: 'modal-ft' },
      h('button', { type: 'button', class: 'btn', text: '취소', onclick: closeModal }),
      h('button', { type: 'button', class: 'btn primary', text: '적용', onclick: function () {
        pg.html = ed.value(); markDirty('site'); closeModal(); toast('적용했습니다. 저장 · 배포를 눌러야 홈페이지에 반영됩니다.');
      } })));
    openModal('페이지 내용 편집 — ' + item.title, body);
  }
  function childRows(list, isHidden, redraw) {
    var tb = h('tbody');
    list.forEach(function (c, i) {
      var target = h('td');
      function drawTarget() {
        target.innerHTML = '';
        if (c.type === 'page') target.appendChild(h('button', { type: 'button', class: 'btn sm', text: '내용 편집', onclick: function () { editPage(c); } }));
        else if (c.type === 'board') {
          var sel = h('select', {}, data.posts.boards.map(function (b) { return h('option', { value: b.id, text: b.name }); }));
          sel.value = c.boardId || ''; if (!c.boardId && data.posts.boards[0]) { c.boardId = data.posts.boards[0].id; sel.value = c.boardId; }
          sel.addEventListener('change', function () { c.boardId = sel.value; markDirty('site'); });
          target.appendChild(sel);
        } else if (c.type === 'link') {
          var u = h('input', { value: c.url || '', placeholder: 'https://' });
          u.addEventListener('input', function () { c.url = u.value; markDirty('site'); });
          target.appendChild(u);
        } else target.appendChild(h('span', { class: 'muted', text: c.type === 'meal' ? '주간식단표 메뉴에서 관리' : '생활관 일정 메뉴에서 관리' }));
      }
      drawTarget();
      var title = h('input', { value: c.title });
      title.addEventListener('input', function () { c.title = title.value; markDirty('site'); });
      var type = h('select', {}, (isHidden ? [ITEM_TYPES[0]] : ITEM_TYPES).map(function (t) { return h('option', { value: t[0], text: t[1] }); }));
      type.value = c.type;
      type.addEventListener('change', function () { c.type = type.value; markDirty('site'); drawTarget(); });
      tb.appendChild(h('tr', {},
        h('td', {}, title),
        h('td', {}, idInput(c, renamePage)),
        h('td', {}, type),
        target,
        h('td', { class: 'act' },
          h('a', { class: 'btn xs', href: 'index.html#/m/' + c.id, target: '_blank', rel: 'noopener', text: '보기' }), ' ',
          h('button', { type: 'button', class: 'btn xs', text: '▲', onclick: function () { move(list, i, -1); markDirty('site'); redraw(); } }), ' ',
          h('button', { type: 'button', class: 'btn xs', text: '▼', onclick: function () { move(list, i, 1); markDirty('site'); redraw(); } }), ' ',
          h('button', { type: 'button', class: 'btn xs danger', text: '삭제', onclick: function () {
            if (!confirm('"' + c.title + '" 메뉴를 삭제할까요?' + (c.type === 'page' ? '\n(페이지 내용도 함께 삭제됩니다)' : ''))) return;
            list.splice(i, 1); if (c.type === 'page') delete data.site.pages[c.id]; markDirty('site'); redraw();
          } }))));
    });
    return h('table', { class: 'grid resp' }, h('thead', {}, h('tr', {}, h('th', { text: '메뉴 이름' }), h('th', { text: 'ID (주소)' }), h('th', { text: '종류' }), h('th', { text: '내용 / 연결' }), h('th'))), tb);
  }

  RENDER.menu = function () {
    var wrap = h('div');
    var tree = h('div');
    function draw() {
      tree.innerHTML = '';
      data.site.menu.forEach(function (t, i) {
        var title = h('input', { value: t.title, 'aria-label': '대메뉴 이름' });
        title.addEventListener('input', function () { t.title = title.value; markDirty('site'); });
        t.children = t.children || [];
        tree.appendChild(h('div', { class: 'menu-top' },
          h('div', { class: 'menu-top-hd' }, h('b', { text: (i + 1) + '.' }), title, idInput(t), h('span', { class: 'sp' }),
            h('button', { type: 'button', class: 'btn xs', text: '▲', onclick: function () { move(data.site.menu, i, -1); markDirty('site'); draw(); } }),
            h('button', { type: 'button', class: 'btn xs', text: '▼', onclick: function () { move(data.site.menu, i, 1); markDirty('site'); draw(); } }),
            h('button', { type: 'button', class: 'btn xs danger', text: '대메뉴 삭제', onclick: function () {
              if (!confirm('"' + t.title + '" 대메뉴와 하위 메뉴를 모두 삭제할까요?')) return;
              t.children.forEach(function (c) { if (c.type === 'page') delete data.site.pages[c.id]; });
              data.site.menu.splice(i, 1); markDirty('site'); draw();
            } })),
          childRows(t.children, false, draw),
          h('div', { style: 'padding:10px 14px' }, h('button', { type: 'button', class: 'btn sm', text: '+ 하위 메뉴 추가', onclick: function () {
            var id = uid('page-'); t.children.push({ id: id, title: '새 메뉴', type: 'page' }); data.site.pages[id] = { html: '<p>내용을 입력하세요.</p>' };
            markDirty('site'); draw();
          } }))));
      });
      tree.appendChild(h('button', { type: 'button', class: 'btn', text: '+ 대메뉴 추가', onclick: function () {
        data.site.menu.push({ id: uid('menu-'), title: '새 대메뉴', children: [] }); markDirty('site'); draw();
      } }));
      hidden.innerHTML = '';
      hidden.appendChild(childRows(data.site.hiddenPages, true, draw));
      hidden.appendChild(h('div', { class: 'add-row' }, h('button', { type: 'button', class: 'btn sm', text: '+ 페이지 추가', onclick: function () {
        var id = uid('page-'); data.site.hiddenPages.push({ id: id, title: '새 페이지', type: 'page' }); data.site.pages[id] = { html: '' };
        markDirty('site'); draw();
      } })));
      refreshLinkOptions();
    }
    var hidden = h('div');
    wrap.appendChild(h('div', { class: 'tip', html: '대메뉴 아래 하위 메뉴를 추가하고 <b>종류</b>를 고르세요. 일반 페이지는 <b>내용 편집</b>으로 본문을 작성합니다. ID는 주소(<code>#/m/ID</code>)에 쓰이므로 영문·숫자·하이픈만 사용합니다. 메인 화면은 PC에서 대메뉴 5~6개가 가장 보기 좋습니다.' }));
    wrap.appendChild(card('주 메뉴 (GNB)', null, tree));
    wrap.appendChild(card('메뉴에 없는 페이지', '개인정보처리방침처럼 하단 링크 등으로만 연결하는 페이지입니다.', hidden));
    draw();
    return wrap;
  };

  RENDER.visual = function () {
    return h('div', {},
      h('div', { class: 'tip', html: '메인 화면 상단의 큰 슬라이드입니다. 이미지는 <b>1920×560px</b> 이상 가로형 사진을 권장합니다. 이미지가 없으면 배경색(그라데이션)이 쓰입니다. 제목에서 줄바꿈은 Enter로 입력하세요.' }),
      card('메인 비주얼 슬라이드', null, listEditor(data.site.slides, [
        { key: 'eyebrow', label: '작은 영문 문구' },
        { key: 'button', label: '버튼 글자' },
        { key: 'title', label: '제목', type: 'textarea', rows: 2, wide: true },
        { key: 'subtitle', label: '부제목', wide: true },
        { key: 'link', label: '버튼 링크', type: 'link' },
        { key: 'bg', label: '배경 (이미지 없을 때 CSS 색/그라데이션)' },
        { key: 'image', label: '배경 이미지', type: 'image', wide: true }
      ], 'site', { addLabel: '슬라이드 추가', summary: function (x) { return (x.title || '').replace(/\n/g, ' '); },
        make: function () { return { title: '새 슬라이드', subtitle: '', eyebrow: '', bg: 'linear-gradient(120deg,#0b3d91,#2aa3e6)', image: '', link: '', button: '자세히 보기' }; } })));
  };

  RENDER.quick = function () {
    return h('div', {},
      h('div', { class: 'tip', text: '메인 비주얼 아래 아이콘 메뉴입니다. PC에서 8개, 모바일에서 4개씩 두 줄로 보이므로 4의 배수로 구성하는 것을 권장합니다.' }),
      card('퀵메뉴', null, listEditor(data.site.quickLinks, [
        { key: 'label', label: '이름' },
        { key: 'icon', label: '아이콘', type: 'icon' },
        { key: 'link', label: '링크', type: 'link', wide: true }
      ], 'site', { addLabel: '퀵메뉴 추가', summary: function (x) { return x.label; }, make: function () { return { label: '새 메뉴', icon: 'link', link: '#/' }; } })));
  };

  RENDER.popup = function () {
    return h('div', {},
      card('레이어 팝업', '메인 화면 접속 시 뜨는 팝업입니다. 노출 기간이 지나면 자동으로 사라집니다. 이미지 또는 내용(HTML) 중 하나 이상 입력하세요.',
        listEditor(data.site.popups, [
          { key: 'title', label: '제목 (관리용·대체텍스트)', wide: true },
          { key: 'active', label: '사용', type: 'checkbox' },
          { key: 'link', label: '클릭 시 이동', type: 'link' },
          { key: 'start', label: '시작일', type: 'date' },
          { key: 'end', label: '종료일', type: 'date' },
          { key: 'image', label: '팝업 이미지', type: 'image', wide: true },
          { key: 'html', label: '내용 (HTML 가능)', type: 'textarea', rows: 4, wide: true },
          { key: 'width', label: '가로 크기(px)', type: 'number' },
          { key: 'top', label: '위쪽 위치(px)', type: 'number' },
          { key: 'left', label: '왼쪽 위치(px)', type: 'number' }
        ], 'site', { addLabel: '팝업 추가', summary: function (x) { return (x.active ? '[사용] ' : '[중지] ') + (x.title || '') + (x.end ? '  ~' + x.end : ''); },
          make: function () { var t = ymd(new Date()); return { active: true, title: '새 팝업', image: '', html: '', link: '', start: t, end: ymd(addDays(new Date(), 14)), width: 380, top: 140, left: 80 }; } })),
      card('알림존 배너', '메인 화면 하단 "알림존" 슬라이드 배너입니다. 이미지(4:3 비율 권장)가 없으면 배경색 위에 제목이 표시됩니다.',
        listEditor(data.site.banners, [
          { key: 'title', label: '제목', type: 'textarea', rows: 2 },
          { key: 'link', label: '링크', type: 'link' },
          { key: 'image', label: '배너 이미지', type: 'image' },
          { key: 'bg', label: '배경 (CSS 색/그라데이션)' }
        ], 'site', { addLabel: '배너 추가', summary: function (x) { return (x.title || '').replace(/\n/g, ' '); },
          make: function () { return { title: '새 배너', link: '', image: '', bg: 'linear-gradient(135deg,#0b4ea2,#00a0e9)' }; } })));
  };

  /* ---- 게시판 ---- */
  var boardState = { board: 'notice', q: '' };
  RENDER.board = function () {
    var boards = data.posts.boards;
    if (!boards.some(function (b) { return b.id === boardState.board; }) && boards[0]) boardState.board = boards[0].id;
    var wrap = h('div');
    var tabs = h('div', { class: 'tabs' }, boards.map(function (b) {
      var n = data.posts.posts.filter(function (p) { return p.board === b.id; }).length;
      return h('button', { type: 'button', class: b.id === boardState.board ? 'on' : '', onclick: function () { boardState.board = b.id; go('board'); } }, b.name, h('small', { text: n }));
    }));
    var q = h('input', { placeholder: '제목 검색', value: boardState.q, style: 'max-width:240px' });
    var tbody = h('tbody');
    function drawList() {
      tbody.innerHTML = '';
      var kw = q.value.trim().toLowerCase();
      var list = data.posts.posts.filter(function (p) { return p.board === boardState.board && (!kw || p.title.toLowerCase().indexOf(kw) >= 0); })
        .sort(function (a, b) { if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1; return a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id; });
      if (!list.length) tbody.appendChild(h('tr', {}, h('td', { colspan: 5, class: 'muted', text: '게시물이 없습니다.' })));
      list.forEach(function (p) {
        tbody.appendChild(h('tr', {},
          h('td', { text: p.id }),
          h('td', { class: 'ellipsis' }, p.pinned ? h('span', { class: 'badge', text: '공지' }) : null, p.title, (p.files || []).length ? h('span', { class: 'muted', text: ' 📎' + p.files.length }) : null),
          h('td', { text: p.author || '' }),
          h('td', { text: p.date }),
          h('td', { class: 'act' },
            h('a', { class: 'btn xs', href: 'index.html#/m/' + boardItemId(p.board) + '/' + p.id, target: '_blank', rel: 'noopener', text: '보기' }), ' ',
            h('button', { type: 'button', class: 'btn xs', text: '수정', onclick: function () { editPost(p); } }), ' ',
            h('button', { type: 'button', class: 'btn xs danger', text: '삭제', onclick: function () {
              if (!confirm('"' + p.title + '" 글을 삭제할까요?')) return;
              data.posts.posts.splice(data.posts.posts.indexOf(p), 1); markDirty('posts'); go('board');
            } }))));
      });
    }
    q.addEventListener('input', function () { boardState.q = q.value; drawList(); });
    drawList();
    var cur = boards.filter(function (b) { return b.id === boardState.board; })[0];
    wrap.appendChild(tabs);
    wrap.appendChild(h('section', { class: 'card' },
      h('div', { class: 'card-hd' }, h('h3', { text: (cur ? cur.name : '') + ' 게시물' }), q,
        h('button', { type: 'button', class: 'btn primary', text: '+ 글쓰기', onclick: function () { editPost(null); } })),
      h('table', { class: 'grid resp' }, h('thead', {}, h('tr', {}, h('th', { text: '번호' }), h('th', { text: '제목' }), h('th', { text: '작성자' }), h('th', { text: '등록일' }), h('th'))), tbody)));
    var bset = h('details', {}, h('summary', { style: 'cursor:pointer;font-weight:700', text: '게시판 추가 · 설정' }),
      h('p', { class: 'sub muted', html: '게시판을 추가한 뒤 <b>메뉴 · 페이지</b>에서 종류를 "게시판"으로 한 메뉴를 만들어 연결하세요. ID는 영문으로, 한번 정하면 바꾸지 않는 것이 좋습니다.' }),
      listEditor(boards, [
        { key: 'name', label: '게시판 이름' },
        { key: 'id', label: 'ID (영문)' },
        { key: 'type', label: '형태', type: 'select', options: BOARD_TYPES }
      ], 'posts', { compact: true, cls: 'c3', addLabel: '게시판 추가', summary: function (x) { return x.name; }, make: function () { return { id: uid('bbs'), name: '새 게시판', type: 'list' }; } }));
    wrap.appendChild(h('section', { class: 'card' }, bset));
    return wrap;
  };
  function boardItemId(boardId) {
    var it = allItems().filter(function (c) { return c.type === 'board' && c.boardId === boardId; })[0];
    return it ? it.id : boardId;
  }

  function editPost(p) {
    var isNew = !p;
    var draft = p ? JSON.parse(JSON.stringify(p)) : {
      id: 0, board: boardState.board, pinned: false, date: ymd(new Date()), author: data.site.settings.siteName + ' 행정실', title: '', content: '', files: []
    };
    draft.files = draft.files || [];
    var ed = richEditor(draft.content);
    var filesBox = h('div', { class: 'files-list' });
    function drawFiles() {
      filesBox.innerHTML = '';
      draft.files.forEach(function (f, i) {
        var name = h('input', { value: f.name }); name.addEventListener('input', function () { f.name = name.value; });
        var url = h('input', { value: f.url }); url.addEventListener('input', function () { f.url = url.value; });
        filesBox.appendChild(h('div', { class: 'row' }, name, url, h('button', { type: 'button', class: 'btn sm danger', text: '삭제', onclick: function () { draft.files.splice(i, 1); drawFiles(); } })));
      });
      filesBox.appendChild(h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn sm', text: '+ 파일 업로드', onclick: function () {
          pickFile('').then(function (f) { if (f) upload(f).then(function (r) { draft.files.push({ name: r.name, url: r.url }); drawFiles(); }).catch(function () {}); });
        } }),
        h('button', { type: 'button', class: 'btn sm', text: '+ 링크로 추가', onclick: function () { draft.files.push({ name: '첨부파일', url: 'https://' }); drawFiles(); } })));
    }
    drawFiles();
    var form = h('div', {},
      fields(draft, [
        { key: 'title', label: '제목', wide: true },
        { key: 'board', label: '게시판', type: 'select', options: function () { return data.posts.boards.map(function (b) { return [b.id, b.name]; }); } },
        { key: 'author', label: '작성자' },
        { key: 'date', label: '등록일', type: 'date' },
        { key: 'pinned', label: '상단 고정 (공지)', type: 'checkbox' },
        { key: 'thumb', label: '대표 이미지 (갤러리형, 비우면 본문 첫 이미지)', type: 'image', wide: true }
      ], 'draft', 'c3'),
      h('div', { class: 'fld wide', style: 'margin-top:14px' }, h('span', { class: 'fl', text: '내용' }), ed.el),
      h('div', { class: 'fld wide', style: 'margin-top:14px' }, h('span', { class: 'fl', text: '첨부파일 (이름 / 주소)' }), filesBox),
      h('div', { class: 'modal-ft' },
        h('button', { type: 'button', class: 'btn', text: '취소', onclick: closeModal }),
        h('button', { type: 'button', class: 'btn primary', text: isNew ? '등록' : '수정 완료', onclick: function () {
          if (!draft.title.trim()) { toast('제목을 입력하세요.', 'err'); return; }
          draft.content = ed.value();
          draft.files = draft.files.filter(function (f) { return f.url && f.url !== 'https://'; });
          if (!draft.thumb) delete draft.thumb;
          if (isNew) {
            draft.id = data.posts.posts.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0) + 1;
            data.posts.posts.push(draft);
          } else {
            data.posts.posts[data.posts.posts.indexOf(p)] = draft;
          }
          boardState.board = draft.board;
          markDirty('posts'); closeModal(); go('board');
          toast((isNew ? '등록' : '수정') + '했습니다. 저장 · 배포를 눌러야 홈페이지에 반영됩니다.');
        } })));
    openModal(isNew ? '새 글 작성' : '글 수정', form);
  }

  /* ---- 식단표 ---- */
  var mealWeek = mondayOf(new Date());
  function parseTSV(text) {
    // 엑셀 복사 형식(탭 구분, 셀 안 줄바꿈은 큰따옴표로 감쌈) 해석
    var rows = [[]], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === '\t') { rows[rows.length - 1].push(cell); cell = ''; }
      else if (ch === '\n') { rows[rows.length - 1].push(cell); cell = ''; rows.push([]); }
      else if (ch !== '\r') cell += ch;
    }
    rows[rows.length - 1].push(cell);
    return rows.filter(function (r) { return r.some(function (c) { return c.trim(); }); });
  }
  function setMeal(date, meal, val) {
    var days = data.meals.days;
    var d = days[date] || (days[date] = {});
    d[meal] = val.replace(/\s+$/, '');
    if (!d.breakfast && !d.lunch && !d.dinner) delete days[date];
    markDirty('meals');
  }
  RENDER.meal = function () {
    var wrap = h('div');
    var dates = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return addDays(mealWeek, i); });
    var today = ymd(new Date());
    var weekBar = h('div', { class: 'week-bar' },
      h('button', { type: 'button', class: 'btn sm', text: '◀ 이전 주', onclick: function () { mealWeek = addDays(mealWeek, -7); go('meal'); } }),
      h('strong', { text: ymd(dates[0]).replace(/-/g, '.') + ' ~ ' + ymd(dates[6]).replace(/-/g, '.') }),
      h('button', { type: 'button', class: 'btn sm', text: '다음 주 ▶', onclick: function () { mealWeek = addDays(mealWeek, 7); go('meal'); } }),
      h('button', { type: 'button', class: 'btn sm', text: '이번 주', onclick: function () { mealWeek = mondayOf(new Date()); go('meal'); } }),
      h('span', { style: 'flex:1' }),
      h('button', { type: 'button', class: 'btn sm', text: '지난주 식단 복사', onclick: function () {
        if (!confirm('지난주 식단을 이번 화면의 주로 복사할까요? (입력된 내용은 덮어씁니다)')) return;
        dates.forEach(function (d) {
          var src = data.meals.days[ymd(addDays(d, -7))];
          MEALS.forEach(function (m) { setMeal(ymd(d), m[0], (src && src[m[0]]) || ''); });
        });
        go('meal');
      } }),
      h('button', { type: 'button', class: 'btn sm danger', text: '이번 주 비우기', onclick: function () {
        if (!confirm('이 주의 식단을 모두 지울까요?')) return;
        dates.forEach(function (d) { delete data.meals.days[ymd(d)]; }); markDirty('meals'); go('meal');
      } }));

    var table = h('table', { class: 'meal-grid' },
      h('thead', {}, h('tr', {}, h('th', { text: '구분' }), dates.map(function (d) {
        return h('th', { class: ymd(d) === today ? 'today' : '' }, WEEK[d.getDay()], h('small', { text: (d.getMonth() + 1) + '/' + d.getDate() }));
      }))),
      h('tbody', {}, MEALS.map(function (m) {
        return h('tr', {}, h('th', { text: m[1] }), dates.map(function (d) {
          var k = ymd(d), ta = h('textarea', { 'aria-label': k + ' ' + m[1], placeholder: '한 줄에 한 메뉴' });
          ta.value = (data.meals.days[k] || {})[m[0]] || '';
          ta.addEventListener('input', function () { setMeal(k, m[0], ta.value); });
          return h('td', {}, ta);
        }));
      })));

    var paste = h('textarea', { rows: 4, placeholder: '엑셀에서 [조식·중식·석식] 3행 × [월~일] 열 범위를 복사해 여기에 붙여넣으세요. (머리글 제외)' });
    var pasteBtn = h('button', { type: 'button', class: 'btn sm primary', text: '붙여넣은 내용 적용', onclick: function () {
      var rows = parseTSV(paste.value);
      if (!rows.length) { toast('붙여넣은 내용이 없습니다.', 'err'); return; }
      rows.slice(0, 3).forEach(function (r, ri) {
        r.slice(0, 7).forEach(function (c, ci) { setMeal(ymd(dates[ci]), MEALS[ri][0], c.trim()); });
      });
      toast('적용했습니다. (' + Math.min(rows.length, 3) + '행)', 'ok');
      go('meal');
    } });

    wrap.appendChild(card('주간 식단 입력', '칸마다 한 줄에 메뉴 하나씩 입력하세요. 운영하지 않는 날은 비워 두면 "-"로 표시됩니다.', weekBar, h('div', { class: 'scroll-x' }, table)));
    wrap.appendChild(card('엑셀에서 한번에 붙여넣기', null, paste, h('div', { class: 'add-row' }, pasteBtn)));
    wrap.appendChild(card('운영 시간 · 안내 문구', null, fields(data.meals.times, [
      { key: 'breakfast', label: '조식 시간' }, { key: 'lunch', label: '중식 시간' }, { key: 'dinner', label: '석식 시간' }
    ], 'meals', 'c3'), h('div', { style: 'margin-top:12px' }, fields(data.meals, [{ key: 'note', label: '식단표 하단 안내 문구', wide: true }], 'meals'))));
    return wrap;
  };

  RENDER.schedule = function () {
    var arr = data.site.schedule;
    return h('div', {},
      card('생활관 일정', '메인 화면에는 오늘 이후 일정 4개가 표시되고, "생활관 일정" 메뉴에서 달력으로 볼 수 있습니다.',
        h('div', { style: 'margin-bottom:12px' }, h('button', { type: 'button', class: 'btn sm', text: '날짜순 정렬', onclick: function () {
          arr.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }); markDirty('site'); go('schedule');
        } })),
        listEditor(arr, [
          { key: 'start', label: '시작일', type: 'date' },
          { key: 'end', label: '종료일', type: 'date' },
          { key: 'category', label: '분류 (예: 입사·행사)' },
          { key: 'title', label: '일정 내용' }
        ], 'site', { compact: true, cls: 'c4', addLabel: '일정 추가', summary: function (x) { return (x.start || '') + ' ' + (x.title || ''); },
          make: function () { var t = ymd(new Date()); return { start: t, end: t, title: '', category: '일정' }; } })));
  };

  RENDER.system = function () {
    var wrap = h('div');
    var info = mode === 'github'
      ? '<b>' + cfg.owner + '/' + cfg.repo + '</b> 저장소의 <b>' + cfg.branch + '</b> 브랜치, <code>' + repoPath('data/') + '</code> 폴더에 연결되어 있습니다.'
      : '로컬 모드입니다. 저장 시 파일을 내려받습니다.';
    wrap.appendChild(card('연결 정보', info,
      h('button', { type: 'button', class: 'btn', text: mode === 'github' ? '연결 해제 / 다른 저장소 연결' : 'GitHub로 연결하기', onclick: logout })));
    var imp = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    imp.addEventListener('change', function () {
      var f = imp.files[0]; if (!f) return;
      f.text().then(function (t) {
        var j = JSON.parse(t);
        if (!j.site || !j.posts || !j.meals) throw new Error('백업 파일 형식이 아닙니다.');
        if (!confirm('백업 파일 내용으로 전체를 교체할까요? (저장 · 배포를 눌러야 반영됩니다)')) return;
        data = { site: j.site, posts: j.posts, meals: j.meals }; normalize();
        Object.keys(FILES).forEach(markDirty); go('dashboard'); toast('백업을 불러왔습니다.', 'ok');
      }).catch(function (e) { toast('불러오기 실패: ' + e.message, 'err'); });
    });
    wrap.appendChild(card('백업', '전체 내용을 파일 하나로 내려받거나, 백업 파일로 되돌립니다. GitHub에 모든 수정 이력이 남으므로 저장소의 커밋 기록으로도 복구할 수 있습니다.',
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'btn', text: '전체 백업 내려받기', onclick: function () { download('dorm-backup-' + ymd(new Date()) + '.json', JSON.stringify(data, null, 1)); } }),
        h('button', { type: 'button', class: 'btn', text: '백업 파일 불러오기', onclick: function () { imp.click(); } }), imp)));
    return wrap;
  };

  /* ================= 로그인 ================= */
  function detect() {
    var d = Object.assign({}, DEFAULTS);
    var host = location.hostname, segs = location.pathname.split('/').filter(Boolean);
    if (segs.length && /\.html?$/.test(segs[segs.length - 1])) segs.pop();
    if (/\.github\.io$/.test(host)) {
      d.owner = host.split('.')[0];
      if (segs.length) { d.repo = segs[0]; d.base = segs.slice(1).join('/'); }
      else { d.repo = host; d.base = ''; }
    }
    return d;
  }
  function showLogin(err) {
    $('#app').hidden = true; $('#login').hidden = false;
    var saved = {};
    try { saved = JSON.parse(store(CFG_KEY) || '{}'); } catch (e) { saved = {}; }
    var d = Object.assign(detect(), saved);
    var f = $('#loginForm');
    ['owner', 'repo', 'branch', 'base'].forEach(function (k) { f[k].value = d[k] || ''; });
    f.token.value = '';
    f.remember.checked = !!saved.remember;
    $('#loginErr').textContent = err || '';
  }
  function start() {
    $('#modeChip').textContent = mode === 'github' ? cfg.owner + '/' + cfg.repo + ' · ' + cfg.branch : '로컬 모드';
    $('#modeChip').className = 'mode' + (mode === 'local' ? ' local' : '');
    return loadAll().then(function () {
      normalize();
      dirty = {};
      $('#sideTitle').textContent = (data.site.settings.univName || '') + ' ' + (data.site.settings.siteName || '생활관');
      $('#login').hidden = true; $('#app').hidden = false;
      updateSaveBtn();
      go('dashboard');
    });
  }
  function logout() {
    if (dirtyList().length && !confirm('저장하지 않은 변경사항이 있습니다. 연결을 해제할까요?')) return;
    dirty = {};
    var saved = {};
    try { saved = JSON.parse(store(CFG_KEY) || '{}'); } catch (e) { saved = {}; }
    delete saved.token; saved.remember = false;
    store(CFG_KEY, JSON.stringify(saved));
    sstore('dorm-admin-token', null);
    showLogin();
  }

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    cfg = { owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', base: f.base.value.trim(), token: f.token.value.trim(), remember: f.remember.checked };
    mode = 'github';
    var btn = $('#loginBtn'); btn.disabled = true; btn.textContent = '연결 중…';
    start().then(function () {
      var saved = { owner: cfg.owner, repo: cfg.repo, branch: cfg.branch, base: cfg.base, remember: cfg.remember };
      if (cfg.remember) saved.token = cfg.token;
      store(CFG_KEY, JSON.stringify(saved));
      sstore('dorm-admin-token', cfg.token);
    }).catch(function (err) {
      $('#loginErr').textContent = err.message;
    }).then(function () { btn.disabled = false; btn.textContent = '연결하기'; });
  });
  $('#localBtn').addEventListener('click', function () {
    mode = 'local'; cfg = Object.assign(detect(), { token: '' });
    start().catch(function (err) { $('#loginErr').textContent = '데이터를 불러오지 못했습니다: ' + err.message; });
  });

  /* ================= 상단 버튼 등 ================= */
  $('#saveBtn').addEventListener('click', saveAll);
  $('#previewBtn').addEventListener('click', function () {
    try { store('dorm-preview', JSON.stringify(data)); } catch (e) { /* ignore */ }
    window.open('index.html?preview=1#/', 'dorm-preview');
  });
  $('#logoutBtn').addEventListener('click', logout);
  $('#menuBtn').addEventListener('click', function () { document.body.classList.toggle('nav-open'); });
  $('#modalClose').addEventListener('click', function () { if (confirm('편집 중인 내용을 닫을까요?')) closeModal(); });
  window.addEventListener('beforeunload', function (e) {
    if (dirtyList().length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ================= 시작 ================= */
  (function boot() {
    var saved = {};
    try { saved = JSON.parse(store(CFG_KEY) || '{}'); } catch (e) { saved = {}; }
    var token = saved.token || sstore('dorm-admin-token');
    if (saved.owner && token) {
      cfg = Object.assign({}, saved, { token: token });
      mode = 'github';
      start().catch(function (err) { showLogin('자동 연결 실패: ' + err.message); });
    } else showLogin();
  })();
})();
