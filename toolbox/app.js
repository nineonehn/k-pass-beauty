/* 복어 툴박스 - UI 글루. 모든 처리는 이 브라우저 안에서 끝난다. */
(function () {
  'use strict';

  var BT = window.BT;
  var $ = function (id) { return document.getElementById(id); };
  var pdfjs = window.pdfjsLib || null;
  if (pdfjs && pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
  }

  /* ── 공통 ─────────────────────────────── */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2100);
  }

  function copyText(text, okMsg) {
    var done = function () { toast(okMsg || '복사했습니다'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }
  function fallbackCopy(text, done) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    if (ok) done(); else toast('복사가 막혔어요. 길게 눌러 복사해 주세요');
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }

  function baseName(name) {
    return String(name || 'image').replace(/\.[^.]+$/, '') || 'image';
  }
  function extOf(type) {
    if (type === 'image/jpeg') return 'jpg';
    if (type === 'image/webp') return 'webp';
    if (type === 'image/png') return 'png';
    return 'png';
  }
  function humanSize(bytes) {
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return (bytes / 1024 / 1024).toFixed(1) + 'MB';
  }
  function readNum(el) { return BT.num(el && el.value, 0); }
  function readText(el) { return el ? String(el.value) : ''; }

  /* 세그먼트: data-* 값 읽고 .on 토글 */
  function segValue(seg, attr) {
    var on = seg.querySelector('button.on');
    return on ? on.getAttribute(attr) : null;
  }
  function segInit(seg, attr, onChange) {
    seg.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn || !seg.contains(btn)) return;
      Array.prototype.forEach.call(seg.querySelectorAll('button'), function (b) { b.classList.toggle('on', b === btn); });
      if (onChange) onChange(btn.getAttribute(attr));
    });
  }

  /* ── 라우터 ───────────────────────────── */
  var ROUTES = {
    home: { title: '복어 툴박스' },
    sec: { title: '보안 서류·사진' },
    img: { title: '커머스·SNS 이미지' },
    qr: { title: 'QR·링크 클리너' },
    fund: { title: '임장 자금 계산기' },
    margin: { title: '마진·노출제한' },
    notice: { title: '공지·스레드 변환' }
  };

  function currentRoute() {
    var h = location.hash.replace(/^#\/?/, '').trim();
    return ROUTES[h] ? h : 'home';
  }

  function paintRoute() {
    var v = currentRoute();
    Object.keys(ROUTES).forEach(function (k) {
      var sec = $('view-' + k);
      if (sec) sec.hidden = k !== v;
    });
    $('barTitle').textContent = ROUTES[v].title;
    $('btnBack').hidden = v === 'home';
    $('barBadge').innerHTML = v === 'home' ? '<span class="dot"></span>로컬 처리' : '';
    window.scrollTo(0, 0);
    if (v === 'fund') calcFund();
    if (v === 'margin') calcMargin();
    if (v === 'notice') updateNotice();
  }

  function go(v) {
    if (currentRoute() === v) { paintRoute(); return; }
    location.hash = v === 'home' ? '' : '#/' + v;
  }

  window.addEventListener('hashchange', paintRoute);
  $('btnBack').addEventListener('click', function () {
    if (history.length > 1) history.back();
    else go('home');
  });
  $('toolGrid').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-view]');
    if (btn) go(btn.getAttribute('data-view'));
  });
  window.addEventListener('scroll', function () {
    $('appbar').classList.toggle('scrolled', window.scrollY > 4);
  }, { passive: true });

  /* ── 파일 디코딩·캔버스 공통 ───────────── */
  function decodeImage(file) {
    return new Promise(function (resolve, reject) {
      if (window.createImageBitmap) {
        createImageBitmap(file).then(resolve).catch(function () { viaImg(); });
      } else { viaImg(); }
      function viaImg() {
        var img = new Image();
        var url = URL.createObjectURL(file);
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없어요: ' + file.name)); };
        img.src = url;
      }
    });
  }
  function srcSize(src) {
    return { w: src.width || src.naturalWidth, h: src.height || src.naturalHeight };
  }
  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function toBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) { resolve(b); }, type, quality);
      } else {
        var d = canvas.toDataURL(type, quality);
        resolve(dataUrlToBlob(d));
      }
    });
  }
  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /* ── 1. 보안 서류·사진 ────────────────── */
  segInit($('secSeg'), 'data-sec', function (v) {
    $('secPanePdf').hidden = v !== 'pdf';
    $('secPaneMosaic').hidden = v !== 'mosaic';
    $('secPaneExif').hidden = v !== 'exif';
  });

  // 파일 목록 렌더(이미지 썸네일 + 순서 변경 + 삭제)
  function renderFileList(ul, files, opts) {
    ul.innerHTML = '';
    files.forEach(function (f, i) {
      var li = document.createElement('li');
      var thumb = document.createElement('img');
      thumb.alt = '';
      if (f.__thumb) thumb.src = f.__thumb;
      else if (/^image\//.test(f.type)) {
        f.__thumb = URL.createObjectURL(f);
        thumb.src = f.__thumb;
      } else {
        thumb.style.display = 'none';
      }
      var name = document.createElement('span');
      name.className = 'fname';
      name.textContent = f.name;
      var meta = document.createElement('span');
      meta.className = 'fmeta';
      meta.textContent = humanSize(f.size);
      li.appendChild(thumb);
      li.appendChild(name);
      li.appendChild(meta);
      if (opts && opts.reorder) {
        var up = document.createElement('button');
        up.type = 'button'; up.className = 'mini'; up.textContent = '↑';
        up.setAttribute('aria-label', '위로');
        up.addEventListener('click', function () { if (i > 0) { var t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; opts.onChange(); } });
        var down = document.createElement('button');
        down.type = 'button'; down.className = 'mini'; down.textContent = '↓';
        down.setAttribute('aria-label', '아래로');
        down.addEventListener('click', function () { if (i < files.length - 1) { var t = files[i + 1]; files[i + 1] = files[i]; files[i] = t; opts.onChange(); } });
        li.appendChild(up);
        li.appendChild(down);
      }
      var del = document.createElement('button');
      del.type = 'button'; del.className = 'mini'; del.textContent = '✕';
      del.setAttribute('aria-label', '빼기');
      del.addEventListener('click', function () {
        files.splice(i, 1);
        if (opts && opts.onChange) opts.onChange();
      });
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  var pdfImages = [];
  $('pdfImgInput').addEventListener('change', function (e) {
    pdfImages = pdfImages.concat(Array.prototype.slice.call(e.target.files || []))
      .filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name); });
    e.target.value = '';
    renderPdfImgList();
  });
  function renderPdfImgList() {
    renderFileList($('pdfImgList'), pdfImages, { reorder: true, onChange: renderPdfImgList });
  }

  $('btnMakePdf').addEventListener('click', async function () {
    if (!pdfImages.length) { toast('사진을 먼저 선택해 주세요'); return; }
    if (!window.PDFLib) { toast('PDF 라이브러리를 불러오지 못했어요'); return; }
    var btn = $('btnMakePdf');
    btn.disabled = true;
    btn.textContent = '만드는 중...';
    try {
      var doc = await PDFLib.PDFDocument.create();
      var size = $('pdfPageSize').value;
      var m = BT.num($('pdfMargin').value, 24);
      for (var i = 0; i < pdfImages.length; i++) {
        var src = await decodeImage(pdfImages[i]);
        var s = srcSize(src);
        var c = makeCanvas(s.w, s.h);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, s.w, s.h);
        var jpg = await toBlob(c, 'image/jpeg', 0.92);
        var bytes = new Uint8Array(await jpg.arrayBuffer());
        var img = await doc.embedJpg(bytes);
        var pageW, pageH, drawW, drawH, x, y;
        if (size === 'a4') {
          pageW = 595.28; pageH = 841.89;
          var availW = pageW - m * 2, availH = pageH - m * 2;
          var k = Math.min(availW / img.width, availH / img.height);
          drawW = img.width * k; drawH = img.height * k;
          x = (pageW - drawW) / 2; y = (pageH - drawH) / 2;
        } else {
          pageW = 595.28;
          pageH = Math.max(120, pageW * (img.height / img.width)) + m * 2;
          drawW = pageW - m * 2; drawH = drawW * (img.height / img.width);
          x = m; y = m;
        }
        var page = doc.addPage([pageW, pageH]);
        page.drawImage(img, { x: x, y: pageH - y - drawH, width: drawW, height: drawH });
      }
      var out = await doc.save();
      var blob = new Blob([out], { type: 'application/pdf' });
      var name = '복어툴박스_' + pdfImages.length + '장.pdf';
      showDownload($('pdfImgOut'), blob, name, pdfImages.length + '장 → 1개 PDF · ' + humanSize(blob.size));
      toast('PDF를 만들었습니다');
    } catch (err) {
      console.error(err);
      toast('PDF 생성 실패: ' + (err && err.message ? err.message : '알 수 없는 오류'));
    } finally {
      btn.disabled = false;
      btn.textContent = 'PDF 만들기';
    }
  });

  var pdfMergeFiles = [];
  $('pdfMergeInput').addEventListener('change', function (e) {
    pdfMergeFiles = pdfMergeFiles.concat(Array.prototype.slice.call(e.target.files || []))
      .filter(function (f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name); });
    e.target.value = '';
    renderPdfMergeList();
  });
  function renderPdfMergeList() {
    renderFileList($('pdfMergeList'), pdfMergeFiles, { reorder: true, onChange: renderPdfMergeList });
  }

  $('btnMergePdf').addEventListener('click', async function () {
    if (pdfMergeFiles.length < 1) { toast('PDF를 먼저 선택해 주세요'); return; }
    var btn = $('btnMergePdf');
    btn.disabled = true; btn.textContent = '합치는 중...';
    try {
      var out = await PDFLib.PDFDocument.create();
      var total = 0;
      for (var i = 0; i < pdfMergeFiles.length; i++) {
        var buf = await pdfMergeFiles[i].arrayBuffer();
        var doc = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
        var pages = await out.copyPages(doc, doc.getPageIndices());
        pages.forEach(function (p) { out.addPage(p); });
        total += pages.length;
      }
      var bytes = await out.save();
      var blob = new Blob([bytes], { type: 'application/pdf' });
      showDownload($('pdfMergeOut'), blob, '복어툴박스_합본.pdf', pdfMergeFiles.length + '개 파일 · ' + total + '페이지 · ' + humanSize(blob.size));
      toast('합쳤습니다');
    } catch (err) {
      console.error(err);
      toast('합치기 실패: ' + (err && err.message ? err.message : '암호가 걸린 PDF일 수 있어요'));
    } finally {
      btn.disabled = false; btn.textContent = '합치기';
    }
  });

  function showDownload(container, blob, name, meta) {
    container.hidden = false;
    container.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'out-title';
    d.textContent = name;
    var p = document.createElement('div');
    p.className = 'note';
    p.style.margin = '0 0 9px';
    p.textContent = meta || humanSize(blob.size);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn primary'; b.textContent = '저장';
    b.addEventListener('click', function () { download(blob, name); });
    container.appendChild(d); container.appendChild(p); container.appendChild(b);
  }

  var splitPdfFile = null;
  $('pdfSplitInput').addEventListener('change', function (e) {
    splitPdfFile = (e.target.files || [])[0] || null;
    var box = $('pdfSplitOut');
    if (splitPdfFile) {
      box.hidden = true;
      toast(splitPdfFile.name + ' 준비됨');
    }
  });

  $('btnSplitPdf').addEventListener('click', async function () {
    if (!splitPdfFile) { toast('PDF를 먼저 선택해 주세요'); return; }
    if (!pdfjs) { toast('PDF 뷰어 라이브러리를 불러오지 못했어요'); return; }
    var btn = $('btnSplitPdf');
    btn.disabled = true; btn.textContent = '푸는 중...';
    try {
      var buf = await splitPdfFile.arrayBuffer();
      var doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
      var scale = BT.num($('pdfScale').value, 2);
      var out = $('pdfSplitOut');
      out.hidden = false;
      out.innerHTML = '';
      var ul = document.createElement('ul');
      ul.className = 'results';
      out.appendChild(ul);
      var blobs = [];
      for (var p = 1; p <= doc.numPages; p++) {
        var page = await doc.getPage(p);
        var vp = page.getViewport({ scale: scale });
        var canvas = makeCanvas(vp.width, vp.height);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        var blob = await toBlob(canvas, 'image/png');
        var name = baseName(splitPdfFile.name) + '_p' + (p < 10 ? '0' + p : p) + '.png';
        blobs.push({ blob: blob, name: name });
        ul.appendChild(resultRow(blob, name, canvas.width + 'x' + canvas.height + ' · ' + humanSize(blob.size)));
      }
      if (doc.numPages > 1) {
        var all = document.createElement('button');
        all.type = 'button'; all.className = 'btn primary'; all.textContent = '전체 저장 (' + doc.numPages + '장)';
        all.addEventListener('click', function () {
          blobs.forEach(function (item, i) {
            setTimeout(function () { download(item.blob, item.name); }, i * 400);
          });
          toast('순서대로 저장합니다');
        });
        out.appendChild(all);
      }
      toast(doc.numPages + '페이지를 풀었습니다');
    } catch (err) {
      console.error(err);
      toast('PDF 열기 실패: ' + (err && err.message ? err.message : '암호가 걸린 PDF일 수 있어요'));
    } finally {
      btn.disabled = false; btn.textContent = '페이지 풀기';
    }
  });

  function resultRow(blob, name, meta, thumbUrl) {
    var li = document.createElement('li');
    if (thumbUrl) {
      var img = document.createElement('img');
      img.className = 'thumb';
      img.src = thumbUrl;
      img.alt = '';
      li.appendChild(img);
    }
    var metaBox = document.createElement('div');
    metaBox.className = 'rmeta';
    var nm = document.createElement('div');
    nm.className = 'rname'; nm.textContent = name;
    var sz = document.createElement('div');
    sz.className = 'rsize'; sz.textContent = meta || humanSize(blob.size);
    metaBox.appendChild(nm); metaBox.appendChild(sz);
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn'; b.textContent = '저장';
    b.addEventListener('click', function () { download(blob, name); });
    li.appendChild(metaBox); li.appendChild(b);
    return li;
  }

  /* 모자이크 */
  var mos = { canvas: null, ctx: null, img: null, history: [], drawing: false, last: null, mode: 'mosaic', size: 48, dirty: false };
  $('mosInput').addEventListener('change', async function (e) {
    var file = (e.target.files || [])[0];
    if (!file) return;
    try {
      var src = await decodeImage(file);
      var s = srcSize(src);
      var maxSide = 2200;
      var k = Math.min(1, maxSide / Math.max(s.w, s.h));
      var c = makeCanvas(s.w * k, s.h * k);
      var ctx = c.getContext('2d');
      mos.img = src;
      ctx.drawImage(src, 0, 0, c.width, c.height);
      mos.canvas = c; mos.ctx = ctx; mos.history = []; mos.dirty = false;
      mos.original = ctx.getImageData(0, 0, c.width, c.height);
      var shown = $('mosCanvas');
      shown.width = c.width; shown.height = c.height;
      shown.getContext('2d').drawImage(c, 0, 0);
      $('mosWrap').hidden = false;
      $('mosTools').hidden = false;
      $('mosDrop').querySelector('.drop-main').textContent = '다른 사진 선택';
      toast('손가락으로 문질러 가리세요');
    } catch (err) {
      console.error(err);
      toast('이미지를 열 수 없어요');
    }
  });

  segInit($('mosModeSeg'), 'data-mode', function (v) { mos.mode = v; });
  $('mosSize').addEventListener('input', function (e) {
    mos.size = BT.num(e.target.value, 48);
    $('mosSizeVal').textContent = mos.size;
  });

  function pushHistory() {
    if (!mos.canvas) return;
    mos.history.push(mos.ctx.getImageData(0, 0, mos.canvas.width, mos.canvas.height));
    if (mos.history.length > 6) mos.history.shift();
  }
  function paintMos() {
    var shown = $('mosCanvas');
    shown.getContext('2d').clearRect(0, 0, shown.width, shown.height);
    shown.getContext('2d').drawImage(mos.canvas, 0, 0);
  }
  function dab(x, y, radius) {
    var ctx = mos.ctx, c = mos.canvas;
    var r = radius || mos.size / 2;
    var sx = Math.max(0, Math.round(x - r)), sy = Math.max(0, Math.round(y - r));
    var ex = Math.min(c.width, Math.round(x + r)), ey = Math.min(c.height, Math.round(y + r));
    var w = ex - sx, h = ey - sy;
    if (w <= 1 || h <= 1) return;
    if (mos.mode === 'mosaic') {
      var block = Math.max(6, Math.round(r / 3.2));
      var data = ctx.getImageData(sx, sy, w, h);
      var d = data.data;
      for (var by = 0; by < h; by += block) {
        for (var bx = 0; bx < w; bx += block) {
          var rs = 0, gs = 0, bs = 0, n = 0;
          var maxY = Math.min(by + block, h), maxX = Math.min(bx + block, w);
          for (var yy = by; yy < maxY; yy++) {
            for (var xx = bx; xx < maxX; xx++) {
              var i = (yy * w + xx) * 4;
              rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; n++;
            }
          }
          if (!n) continue;
          var ar = rs / n, ag = gs / n, ab = bs / n;
          for (var yy2 = by; yy2 < maxY; yy2++) {
            for (var xx2 = bx; xx2 < maxX; xx2++) {
              var j = (yy2 * w + xx2) * 4;
              d[j] = ar; d[j + 1] = ag; d[j + 2] = ab;
            }
          }
        }
      }
      ctx.putImageData(data, sx, sy);
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, w, h);
      ctx.clip();
      ctx.filter = 'blur(' + Math.max(3, Math.round(r / 2.5)) + 'px)';
      ctx.drawImage(c, sx, sy, w, h, sx, sy, w, h);
      ctx.filter = 'none';
      ctx.restore();
    }
    mos.dirty = true;
    paintMos();
  }
  function canvasPoint(ev) {
    var shown = $('mosCanvas');
    var rect = shown.getBoundingClientRect();
    var x = (ev.clientX - rect.left) * (shown.width / rect.width);
    var y = (ev.clientY - rect.top) * (shown.height / rect.height);
    // 브러시 크기는 화면에서 보이는 지름(px) 기준으로 잡고, 캔버스 해상도에 맞춰 환산한다
    var radius = (mos.size / 2) * (shown.width / rect.width);
    return { x: x, y: y, r: radius };
  }
  (function bindMos() {
    var shown = $('mosCanvas');
    shown.addEventListener('pointerdown', function (ev) {
      if (!mos.canvas) return;
      ev.preventDefault();
      pushHistory();
      mos.drawing = true;
      mos.last = canvasPoint(ev);
      shown.setPointerCapture && shown.setPointerCapture(ev.pointerId);
      dab(mos.last.x, mos.last.y, mos.last.r);
    });
    shown.addEventListener('pointermove', function (ev) {
      if (!mos.drawing) return;
      ev.preventDefault();
      var p = canvasPoint(ev);
      var dx = p.x - mos.last.x, dy = p.y - mos.last.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var step = Math.max(4, p.r / 2);
      var n = Math.max(1, Math.ceil(dist / step));
      for (var i = 1; i <= n; i++) {
        dab(mos.last.x + dx * i / n, mos.last.y + dy * i / n, p.r);
      }
      mos.last = p;
    });
    function end() { mos.drawing = false; }
    shown.addEventListener('pointerup', end);
    shown.addEventListener('pointercancel', end);
    shown.addEventListener('pointerleave', end);
  })();

  $('btnMosUndo').addEventListener('click', function () {
    if (!mos.history.length) { toast('되돌릴 작업이 없어요'); return; }
    var snap = mos.history.pop();
    mos.ctx.putImageData(snap, 0, 0);
    paintMos();
    toast('한 단계 되돌렸습니다');
  });
  $('btnMosReset').addEventListener('click', function () {
    if (!mos.canvas || !mos.original) return;
    mos.history = [];
    mos.ctx.putImageData(mos.original, 0, 0);
    paintMos();
    toast('원본으로 되돌렸습니다');
  });
  $('btnMosSave').addEventListener('click', async function () {
    if (!mos.canvas) { toast('사진을 먼저 선택해 주세요'); return; }
    var blob = await toBlob(mos.canvas, 'image/png');
    download(blob, '모자이크_' + Date.now() + '.png');
    toast('저장했습니다 (EXIF 제거됨)');
  });

  /* EXIF 제거 */
  $('exifQuality').addEventListener('input', function (e) {
    $('exifQualityVal').textContent = Number(e.target.value).toFixed(2);
  });
  $('btnExif').addEventListener('click', async function () {
    var files = Array.prototype.slice.call($('exifInput').files || []);
    if (!files.length) { toast('사진을 먼저 선택해 주세요'); return; }
    var btn = $('btnExif');
    btn.disabled = true; btn.textContent = '처리 중...';
    var type = $('exifFormat').value;
    var q = BT.num($('exifQuality').value, 0.92);
    var out = $('exifOut');
    out.hidden = false; out.innerHTML = '';
    var ul = document.createElement('ul');
    ul.className = 'results';
    out.appendChild(ul);
    try {
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var src = await decodeImage(f);
        var s = srcSize(src);
        var c = makeCanvas(s.w, s.h);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(src, 0, 0, s.w, s.h);
        var blob = await toBlob(c, type, q);
        var realType = blob.type || type;
        var name = baseName(f.name) + '_clean.' + extOf(realType);
        var url = URL.createObjectURL(blob);
        ul.appendChild(resultRow(blob, name, humanSize(f.size) + ' → ' + humanSize(blob.size) + ' · GPS·기기정보 제거', url));
      }
      toast(files.length + '장 처리 완료 (EXIF 제거)');
    } catch (err) {
      console.error(err);
      toast('처리 실패: ' + (err && err.message ? err.message : ''));
    } finally {
      btn.disabled = false; btn.textContent = '정보 지우고 저장';
    }
  });

  /* ── 2. 커머스·SNS 이미지 ─────────────── */
  var imgFiles = [];
  $('imgInput').addEventListener('change', function (e) {
    imgFiles = imgFiles.concat(Array.prototype.slice.call(e.target.files || []))
      .filter(function (f) { return /^image\//.test(f.type); });
    e.target.value = '';
    renderImgList();
  });
  function renderImgList() {
    renderFileList($('imgList'), imgFiles, { onChange: renderImgList });
  }
  $('imgQuality').addEventListener('input', function (e) {
    $('imgQualityVal').textContent = Number(e.target.value).toFixed(2);
  });
  var imgRatio = 'none', imgFill = 'crop', wmPos = 'br', wmLogoImg = null;
  segInit($('imgRatioSeg'), 'data-ratio', function (v) {
    imgRatio = v;
    $('imgFillSeg').hidden = v === 'none';
  });
  segInit($('imgFillSeg'), 'data-fill', function (v) { imgFill = v; });
  segInit($('wmPosSeg'), 'data-pos', function (v) { wmPos = v; });
  $('wmOn').addEventListener('change', function (e) { $('wmBox').hidden = !e.target.checked; });
  $('wmOpacity').addEventListener('input', function (e) { $('wmOpacityVal').textContent = e.target.value; });
  $('wmSize').addEventListener('input', function (e) { $('wmSizeVal').textContent = e.target.value; });
  $('wmLogo').addEventListener('change', async function (e) {
    var f = (e.target.files || [])[0];
    wmLogoImg = f ? await decodeImage(f) : null;
    if (wmLogoImg) toast('로고를 올렸습니다');
  });

  function ratioValue(r) {
    var p = r.split(':');
    return BT.num(p[0], 1) / BT.num(p[1], 1);
  }

  function lumaOf(ctx, x, y, w, h) {
    var cx = Math.max(0, Math.round(x)), cy = Math.max(0, Math.round(y));
    var cw = Math.max(1, Math.min(ctx.canvas.width - cx, Math.round(w)));
    var ch = Math.max(1, Math.min(ctx.canvas.height - cy, Math.round(h)));
    var d;
    try { d = ctx.getImageData(cx, cy, cw, ch).data; } catch (e) { return 128; }
    var sum = 0, n = 0, stride = 4 * 13;
    for (var i = 0; i < d.length; i += stride) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      n++;
    }
    return n ? sum / n : 128;
  }

  function drawWatermark(ctx, W, H) {
    var text = readText($('wmText')).trim() || '@bok_o_hrga';
    var opacity = BT.num($('wmOpacity').value, 55) / 100;
    var sizePct = BT.num($('wmSize').value, 4.5) / 100;
    if (!wmLogoImg && !text) return;
    ctx.save();
    if (wmLogoImg) {
      var lw = W * sizePct * 4;
      var lh = lw * (srcSize(wmLogoImg).h / srcSize(wmLogoImg).w);
      ctx.globalAlpha = opacity;
      var lx, ly;
      if (wmPos === 'center') { lx = (W - lw) / 2; ly = (H - lh) / 2; }
      else { lx = W - lw - W * 0.04; ly = H - lh - H * 0.04; }
      if (wmPos === 'tile') {
        var stepX = lw * 1.9, stepY = lh * 2.6;
        for (var y2 = -lh; y2 < H + lh; y2 += stepY) {
          for (var x2 = -lw; x2 < W + lw; x2 += stepX) {
            ctx.drawImage(wmLogoImg, x2 + ((y2 / stepY) % 2 ? stepX / 2 : 0), y2, lw, lh);
          }
        }
      } else {
        ctx.drawImage(wmLogoImg, lx, ly, lw, lh);
      }
      ctx.restore();
      return;
    }
    var fs = Math.max(11, Math.round(W * sizePct));
    ctx.font = '600 ' + fs + 'px "Pretendard Variable", Pretendard, -apple-system, sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.globalAlpha = opacity;
    var tw = ctx.measureText(text).width;
    var margin = W * 0.035;
    // 바탕이 밝으면 검은 글자, 어두우면 흰 글자 (흰 배경 상세컷에서도 보이게)
    var lum = (wmPos === 'tile')
      ? lumaOf(ctx, 0, 0, W, H)
      : lumaOf(ctx, wmPos === 'center' ? (W - tw) / 2 : W - margin - tw, H - margin - fs * 1.3, tw, fs * 1.6);
    var lightBg = lum > 165;
    ctx.fillStyle = lightBg ? 'rgba(14,16,20,1)' : 'rgba(255,255,255,1)';
    ctx.shadowColor = lightBg ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
    ctx.shadowBlur = Math.max(2, fs * 0.18);
    ctx.shadowOffsetY = 1;
    if (wmPos === 'center') {
      ctx.textAlign = 'center';
      ctx.fillText(text, W / 2, H / 2 + fs * 0.35);
    } else if (wmPos === 'tile') {
      ctx.textAlign = 'left';
      var gapX = tw * 2.1, gapY = fs * 4.2;
      ctx.translate(W / 2, H / 2);
      ctx.rotate(-Math.PI / 7);
      ctx.translate(-W / 2, -H / 2);
      for (var y = -H * 0.3; y < H * 1.3; y += gapY) {
        for (var x = -W * 0.3; x < W * 1.3; x += gapX) {
          ctx.fillText(text, x, y);
        }
      }
    } else {
      ctx.textAlign = 'right';
      ctx.fillText(text, W - margin, H - margin);
    }
    ctx.restore();
  }

  function processImage(file, opt) {
    return decodeImage(file).then(function (src) {
      var s = srcSize(src);
      var type = opt.format === 'keep' ? (file.type === 'image/png' ? 'image/png' : 'image/jpeg') : opt.format;
      var maxW = opt.maxW > 0 ? opt.maxW : s.w;
      var canvas, ctx;

      if (opt.ratio === 'none') {
        var tw = Math.min(maxW, s.w);
        var th = Math.round(s.h * (tw / s.w));
        canvas = makeCanvas(tw, th);
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, tw, th);
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(src, 0, 0, tw, th);
      } else {
        var ar = ratioValue(opt.ratio);
        var outW = Math.min(maxW, s.w);
        var outH = Math.round(outW / ar);
        if (outH > 4200) { outH = 4200; outW = Math.round(outH * ar); }
        canvas = makeCanvas(outW, outH);
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        var kCover = Math.max(outW / s.w, outH / s.h);

        if (opt.fill === 'crop') {
          var cw = outW / kCover, ch = outH / kCover;
          var cx = (s.w - cw) / 2, cy = (s.h - ch) / 2;
          ctx.drawImage(src, cx, cy, cw, ch, 0, 0, outW, outH);
        } else if (opt.fill === 'white') {
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outW, outH);
          var kFit = Math.min(outW / s.w, outH / s.h);
          var dw = s.w * kFit, dh = s.h * kFit;
          ctx.drawImage(src, (outW - dw) / 2, (outH - dh) / 2, dw, dh);
        } else {
          // 블러 여백
          ctx.save();
          var kBg = Math.max(outW / s.w, outH / s.h);
          ctx.filter = 'blur(' + Math.max(8, Math.round(outW * 0.02)) + 'px)';
          ctx.drawImage(src, (outW - s.w * kBg) / 2, (outH - s.h * kBg) / 2, s.w * kBg, s.h * kBg);
          ctx.filter = 'none';
          ctx.fillStyle = 'rgba(0,0,0,.12)';
          ctx.fillRect(0, 0, outW, outH);
          ctx.restore();
          var kFit2 = Math.min(outW / s.w, outH / s.h);
          ctx.drawImage(src, (outW - s.w * kFit2) / 2, (outH - s.h * kFit2) / 2, s.w * kFit2, s.h * kFit2);
        }
      }

      if (opt.watermark) drawWatermark(ctx, canvas.width, canvas.height);
      return toBlob(canvas, type, opt.quality).then(function (blob) {
        var realType = blob.type || type;
        var name = baseName(file.name) + '_web.' + extOf(realType);
        return { blob: blob, name: name, w: canvas.width, h: canvas.height, before: file.size, after: blob.size, type: realType };
      });
    });
  }

  $('btnImgRun').addEventListener('click', async function () {
    if (!imgFiles.length) { toast('사진을 먼저 선택해 주세요'); return; }
    var btn = $('btnImgRun');
    btn.disabled = true; btn.textContent = '처리 중...';
    var opt = {
      maxW: BT.num($('imgMaxW').value, 1440),
      format: $('imgFormat').value,
      quality: BT.num($('imgQuality').value, 0.82),
      ratio: imgRatio,
      fill: imgFill,
      watermark: $('wmOn').checked
    };
    var out = $('imgResults');
    out.innerHTML = '';
    var all = [];
    try {
      for (var i = 0; i < imgFiles.length; i++) {
        var r = await processImage(imgFiles[i], opt);
        all.push(r);
        var url = URL.createObjectURL(r.blob);
        var thumb = document.createElement('img');
        thumb.className = 'thumb'; thumb.src = url; thumb.alt = '';
        var li = document.createElement('li');
        li.appendChild(thumb);
        var meta = document.createElement('div');
        meta.className = 'rmeta';
        var nm = document.createElement('div');
        nm.className = 'rname'; nm.textContent = r.name;
        var sz = document.createElement('div');
        sz.className = 'rsize';
        sz.innerHTML = humanSize(r.before) + ' → <b>' + humanSize(r.after) + '</b> · ' + r.w + 'x' + r.h;
        meta.appendChild(nm); meta.appendChild(sz);
        li.appendChild(meta);
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'btn'; b.textContent = '저장';
        (function (item) { b.addEventListener('click', function () { download(item.blob, item.name); }); })(r);
        li.appendChild(b);
        out.appendChild(li);
      }
      $('imgResultCard').hidden = false;
      var saved = all.reduce(function (a, b) { return a + (b.before - b.after); }, 0);
      var savedText = saved > 0 ? humanSize(saved) + ' 줄임' : (saved < 0 ? humanSize(-saved) + ' 늘어남' : '용량 변화 없음');
      $('imgResultHint').textContent = all.length + '장 · ' + savedText;
      window._imgAll = all;
      toast(all.length + '장 완료');
    } catch (err) {
      console.error(err);
      toast('처리 실패: ' + (err && err.message ? err.message : ''));
    } finally {
      btn.disabled = false; btn.textContent = '일괄 적용';
    }
  });

  $('btnImgAll').addEventListener('click', function () {
    var all = window._imgAll || [];
    if (!all.length) { toast('먼저 일괄 적용을 눌러 주세요'); return; }
    all.forEach(function (item, i) {
      setTimeout(function () { download(item.blob, item.name); }, i * 420);
    });
    toast(all.length + '장 저장을 시작합니다');
  });

  /* ── 3. QR·링크 ───────────────────────── */
  segInit($('qrSeg'), 'data-qr', function (v) {
    $('qrPaneMake').hidden = v !== 'make';
    $('qrPaneClean').hidden = v !== 'clean';
  });
  var qrType = 'url';
  segInit($('qrTypeSeg'), 'data-type', function (v) {
    qrType = v;
    $('qrUrlBox').hidden = v !== 'url';
    $('qrTextBox').hidden = v !== 'text';
    $('qrWifiBox').hidden = v !== 'wifi';
    renderQr();
  });

  var qrCurrent = null;

  function qrInput() {
    if (qrType === 'wifi') {
      return BT.qrPayload('wifi', {
        ssid: readText($('qrSsid')),
        password: readText($('qrPass')),
        auth: readText($('qrPass')) ? 'WPA' : 'nopass',
        hidden: $('qrHidden').checked
      });
    }
    var t = readText($('qrUrl')) || readText($('qrText'));
    return BT.qrPayload(qrType, { text: t });
  }

  function renderQr() {
    var box = $('qrBox');
    var text = qrInput();
    var empty = !text || (qrType === 'wifi' && !readText($('qrSsid')));
    if (empty) {
      box.classList.add('empty');
      box.innerHTML = '<span class="qr-empty">입력하면 바로 생성됩니다</span>';
      qrCurrent = null;
      return;
    }
    if (typeof qrcode !== 'function') {
      box.innerHTML = '<span class="qr-empty">QR 모듈을 불러오지 못했어요</span>';
      return;
    }
    try {
      var qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      var n = qr.getModuleCount();
      var cell = Math.max(3, Math.floor(560 / (n + 8)));
      var px = (n + 8) * cell;
      var canvas = makeCanvas(px, px);
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = '#0b0c0f';
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + 4) * cell, (r + 4) * cell, cell, cell);
        }
      }
      box.classList.remove('empty');
      box.innerHTML = '';
      box.appendChild(canvas);
      qrCurrent = { qr: qr, text: text, canvas: canvas };
    } catch (err) {
      console.error(err);
      box.innerHTML = '<span class="qr-empty">내용이 너무 길어요. 조금 줄여 주세요</span>';
      qrCurrent = null;
    }
  }
  ['qrUrl', 'qrText', 'qrSsid', 'qrPass'].forEach(function (id) {
    $(id).addEventListener('input', renderQr);
  });
  $('qrHidden').addEventListener('change', renderQr);

  $('btnQrPng').addEventListener('click', async function () {
    if (!qrCurrent) { toast('내용을 먼저 입력해 주세요'); return; }
    var blob = await toBlob(qrCurrent.canvas, 'image/png');
    download(blob, 'qrcode_' + Date.now() + '.png');
    toast('PNG로 저장했습니다');
  });
  $('btnQrSvg').addEventListener('click', function () {
    if (!qrCurrent) { toast('내용을 먼저 입력해 주세요'); return; }
    try {
      var svg = qrCurrent.qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
      var blob = new Blob([svg], { type: 'image/svg+xml' });
      download(blob, 'qrcode_' + Date.now() + '.svg');
      toast('SVG로 저장했습니다');
    } catch (err) {
      toast('SVG 저장에 실패했어요');
    }
  });
  $('btnQrCopy').addEventListener('click', function () {
    if (!qrCurrent) { toast('내용을 먼저 입력해 주세요'); return; }
    copyText(qrCurrent.text, 'QR 내용을 복사했습니다');
  });

  function runClean() {
    var res = BT.cleanUrl(readText($('cleanInput')));
    var out = $('cleanOut');
    var errBox = $('cleanError');
    if (!res.ok) {
      out.hidden = true;
      errBox.hidden = false;
      errBox.textContent = res.error;
      return;
    }
    errBox.hidden = true;
    out.hidden = false;
    $('cleanUrl').textContent = res.clean;
    var chips = $('cleanRemoved');
    chips.innerHTML = '';
    if (res.removed.length) {
      res.removed.forEach(function (r) {
        var s = document.createElement('span');
        s.className = 'chip';
        s.textContent = '− ' + r;
        chips.appendChild(s);
      });
    } else {
      var s2 = document.createElement('span');
      s2.className = 'chip';
      s2.style.color = 'var(--green)';
      s2.style.background = 'var(--green-soft)';
      s2.textContent = '지울 추적 파라미터가 없습니다';
      chips.appendChild(s2);
    }
    window._cleanUrl = res.clean;
  }
  $('btnClean').addEventListener('click', runClean);
  $('cleanInput').addEventListener('input', function () {
    if (readText($('cleanInput')).trim()) runClean();
    else { $('cleanOut').hidden = true; $('cleanError').hidden = true; }
  });
  $('btnCleanPaste').addEventListener('click', async function () {
    try {
      var t = await navigator.clipboard.readText();
      $('cleanInput').value = t;
      runClean();
    } catch (e) {
      toast('붙여넣기가 막혔어요. 길게 눌러 붙여넣어 주세요');
    }
  });
  $('btnCleanCopy').addEventListener('click', function () {
    if (!window._cleanUrl) return;
    copyText(window._cleanUrl, '깔끔한 링크를 복사했습니다');
  });

  /* ── 4. 자금 계산기 ───────────────────── */
  var fundMode = 'buy', fundLtv = 70;
  segInit($('fundModeSeg'), 'data-mode', function (v) {
    fundMode = v;
    $('fundDepositBox').hidden = v !== 'gap';
    calcFund();
  });
  segInit($('fundLtvSeg'), 'data-ltv', function (v) {
    if (v === 'custom') {
      $('fundLtvCustomBox').hidden = false;
      fundLtv = BT.num($('fundLtvCustom').value, 60);
    } else {
      $('fundLtvCustomBox').hidden = true;
      fundLtv = BT.num(v, 70);
    }
    calcFund();
  });
  $('fundQuick').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-v]');
    if (!b) return;
    $('fundPrice').value = BT.num(b.getAttribute('data-v')).toLocaleString('en-US');
    calcFund();
  });
  $('fundBang').addEventListener('change', function (e) {
    $('fundBangBox').hidden = !e.target.checked;
    calcFund();
  });
  $('fundAcqAuto').addEventListener('change', function (e) {
    $('fundAcqRateBox').hidden = e.target.checked;
    calcFund();
  });
  ['fundPrice', 'fundDeposit', 'fundLtvCustom', 'fundBangAmount', 'fundRate', 'fundYears',
    'fundLoanOverride', 'fundAcqRate', 'fundBrokerVat', 'fundExtra'].forEach(function (id) {
    $(id).addEventListener('input', calcFund);
    $(id).addEventListener('change', calcFund);
  });
  ['fundPrice', 'fundDeposit', 'fundBangAmount', 'fundExtra', 'fundLoanOverride'].forEach(function (id) {
    $(id).addEventListener('blur', function () {
      var v = BT.num($(id).value, 0);
      if ($(id).value.trim()) $(id).value = v ? v.toLocaleString('en-US') : '';
      calcFund();
    });
  });

  function calcFund() {
    var price = readNum($('fundPrice'));
    var r = BT.fundingCalc({
      price: price,
      deposit: readNum($('fundDeposit')),
      mode: fundMode,
      ltvPct: fundLtv,
      bangOn: $('fundBang').checked,
      bangAmount: readNum($('fundBangAmount')),
      acqRateManual: $('fundAcqAuto').checked ? null : readNum($('fundAcqRate')),
      brokerVat: $('fundBrokerVat').checked,
      rate: readNum($('fundRate')),
      years: readNum($('fundYears')),
      loanOverride: readNum($('fundLoanOverride')),
      extraCost: readNum($('fundExtra'))
    });
    $('fundCash').textContent = price > 0 ? BT.eok(r.cash) : '-';
    $('fundCashHint').textContent = price > 0
      ? '정확히 ' + BT.won(r.cash) + ' · 매매가 + 취득세·중개보수 − 전세보증금 − 대출'
      : '매매가를 넣으면 바로 계산됩니다';
    $('fundLoan').textContent = BT.eok(r.loan);
    $('fundMonthly').textContent = BT.won(r.monthly) + ' /월';
    $('fundAcqAutoRate').textContent = BT.pct(r.acqRate, 2);
    $('fundBrokerRate').textContent = '중개보수 상한 ' + BT.pct(r.brokerRate, 1);

    var ledger = $('fundLedger');
    ledger.innerHTML = '';
    r.items.forEach(function (it) {
      if (!it.value) return;
      var li = document.createElement('li');
      var s = document.createElement('span');
      s.textContent = it.label;
      var b = document.createElement('b');
      b.textContent = (it.value < 0 ? '−' : '') + BT.won(Math.abs(it.value)).replace('원', '') + '원';
      if (it.value < 0) b.className = 'minus';
      li.appendChild(s); li.appendChild(b);
      ledger.appendChild(li);
    });
    var tf = document.createElement('li');
    tf.className = 'total';
    var ts = document.createElement('span');
    ts.textContent = '필요 현금';
    var tb = document.createElement('b');
    tb.textContent = BT.eok(r.cash);
    tf.appendChild(ts); tf.appendChild(tb);
    ledger.appendChild(tf);

    var notes = $('fundNotes');
    notes.innerHTML = '';
    r.notes.forEach(function (n) {
      var p = document.createElement('p');
      p.textContent = n;
      notes.appendChild(p);
    });
  }

  /* ── 5. 마진·노출제한 ─────────────────── */
  var mgFee = 10.8;
  segInit($('mgFeeSeg'), 'data-fee', function (v) {
    if (v === 'custom') {
      $('mgFeeCustomBox').hidden = false;
      mgFee = BT.num($('mgFeeCustom').value, 10.8);
    } else {
      $('mgFeeCustomBox').hidden = true;
      BT.FEE_PRESETS.forEach(function (p) { if (p.key === v) mgFee = p.pct; });
    }
    calcMargin();
  });
  $('mgDutyAuto').addEventListener('change', function (e) {
    $('mgDutyAutoBox').hidden = !e.target.checked;
    calcMargin();
  });
  ['mgUsd', 'mgFx', 'mgShip', 'mgDomShip', 'mgDuty', 'mgDutyRate', 'mgThreshold',
    'mgOther', 'mgSale', 'mgFeeCustom', 'mgRecommend'].forEach(function (id) {
    $(id).addEventListener('input', calcMargin);
    $(id).addEventListener('change', calcMargin);
  });

  function calcMargin() {
    var usd = readNum($('mgUsd'));
    var fx = readNum($('mgFx'));
    var ship = readNum($('mgShip'));
    var duty = readNum($('mgDuty'));
    if ($('mgDutyAuto').checked) {
      var est = BT.dutyEstimate({
        usd: usd, fx: fx, intlShipping: ship,
        dutyRate: readNum($('mgDutyRate')),
        thresholdUsd: readNum($('mgThreshold'))
      });
      duty = est.total;
      $('mgDuty').value = duty ? duty.toLocaleString('en-US') : '0';
      $('mgDutyHint').textContent = est.taxable
        ? '과세가격 ' + BT.won(est.customsValue) + ' · 관세 ' + BT.won(est.duty) + ' + 부가세 ' + BT.won(est.vat)
        : '목록통관 면세 한도 이하: 0원 (단, 목록통관 불가 품목은 과세)';
    }
    var r = BT.marginCalc({
      costUsd: usd, fx: fx, intlShipping: ship, duty: duty,
      domesticShip: readNum($('mgDomShip')), otherCost: readNum($('mgOther')),
      salePrice: readNum($('mgSale')), feePct: mgFee,
      recommendPrice: readNum($('mgRecommend'))
    });
    $('mgNet').textContent = BT.won(r.net);
    $('mgNet').style.color = r.net < 0 ? 'var(--red)' : 'var(--ink)';
    $('mgMargin').textContent = '마진율 ' + BT.pct(r.marginPct, 1) + ' · 원가 ' + BT.won(r.cost);
    $('mgCost').textContent = BT.won(r.cost);
    $('mgFee').textContent = BT.won(r.fee) + ' (' + BT.pct(r.feePct, 1) + ')';
    $('mgBreakEven').textContent = BT.won(Math.ceil(r.breakEven / 100) * 100);
    $('mgAtRecommend').textContent = r.netAtRecommend === null ? '-' : BT.won(r.netAtRecommend);
    var w = $('mgWarn');
    if (r.risk) {
      w.hidden = false;
      w.className = 'warn bad';
      w.textContent = '노출제한 위험 · 추천가 ' + BT.won(r.recommend) + '보다 ' + BT.won(r.over) + ' 높습니다 (' + BT.pct(r.overPct, 1) + ')';
    } else if (r.recommend > 0) {
      w.hidden = false;
      w.className = 'warn';
      w.style.color = 'var(--green)';
      w.style.background = 'var(--green-soft)';
      w.textContent = '추천가 이하 · 노출 위험 낮음 (추천가까지 여유 ' + BT.won(r.recommend - readNum($('mgSale'))) + ')';
    } else {
      w.hidden = true;
      w.style.color = '';
      w.style.background = '';
    }
  }

  /* ── 6. 공지·스레드 ───────────────────── */
  segInit($('noticeSeg'), 'data-nt', function (v) {
    $('noticePaneNotice').hidden = v !== 'notice';
    $('noticePaneThread').hidden = v !== 'thread';
  });
  var ntTag = '요청';
  segInit($('ntTagSeg'), 'data-tag', function (v) { ntTag = v; updateNotice(); });
  ['ntSummary', 'ntDueDate', 'ntDueTime', 'ntAudience', 'ntMemo', 'ntContact'].forEach(function (id) {
    $(id).addEventListener('input', updateNotice);
    $(id).addEventListener('change', updateNotice);
  });

  function updateNotice() {
    var r = BT.noticeFormat({
      tag: ntTag,
      summary: readText($('ntSummary')),
      dueDate: readText($('ntDueDate')),
      dueTime: readText($('ntDueTime')),
      audience: readText($('ntAudience')),
      memo: readText($('ntMemo')),
      contact: readText($('ntContact'))
    });
    $('ntTitleOut').textContent = ntTag ? r.title : '제목';
    $('ntBodyOut').textContent = r.body;
    window._ntAll = r;
  }
  $('btnNtCopyAll').addEventListener('click', function () { copyText(window._ntAll.full, '제목과 본문을 복사했습니다'); });
  $('btnNtCopyTitle').addEventListener('click', function () { copyText(window._ntAll.title, '제목을 복사했습니다'); });
  $('btnNtCopyBody').addEventListener('click', function () { copyText(window._ntAll.body, '본문을 복사했습니다'); });

  var thTimer = null;
  $('thInput').addEventListener('input', function () {
    $('thCount').textContent = readText($('thInput')).length + '자';
    clearTimeout(thTimer);
    thTimer = setTimeout(splitThreadNow, 280);
  });
  $('thMax').addEventListener('change', splitThreadNow);
  $('btnThSplit').addEventListener('click', splitThreadNow);

  function splitThreadNow() {
    var raw = readText($('thInput'));
    var box = $('thResults');
    box.innerHTML = '';
    if (!raw.trim()) return;
    var r = BT.splitThread(raw, BT.num($('thMax').value, 500));
    var head = document.createElement('div');
    head.className = 'card-head';
    head.style.padding = '2px 4px 6px';
    head.innerHTML = '<h2>' + r.total + '편</h2><span class="hint">원고 ' + r.totalChars + '자 · 편당 ' + r.maxChars + '자</span>';
    box.appendChild(head);
    r.parts.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'th-part';
      var head2 = document.createElement('div');
      head2.className = 'th-head';
      var lab = document.createElement('span');
      lab.className = 'th-label';
      lab.textContent = p.label || '한 편으로 끝';
      var ch = document.createElement('span');
      ch.className = 'th-chars' + (p.over ? ' over' : '');
      ch.textContent = p.chars + ' / ' + r.maxChars + '자';
      head2.appendChild(lab); head2.appendChild(ch);
      var body = document.createElement('div');
      body.className = 'th-body';
      body.textContent = p.post;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-copy';
      btn.textContent = p.label ? p.label + ' 복사' : '복사';
      btn.addEventListener('click', function () { copyText(p.post, (p.label || '본문') + ' 복사했습니다'); });
      card.appendChild(head2); card.appendChild(body); card.appendChild(btn);
      box.appendChild(card);
    });
  }

  /* ── 시작 ─────────────────────────────── */
  paintRoute();
  if (currentRoute() === 'fund') calcFund();
  if (currentRoute() === 'margin') calcMargin();
  if (currentRoute() === 'qr') renderQr();
  updateNotice();
})();
