/* 복어 툴박스 - 순수 로직 코어
 * DOM 없이 동작하는 계산/변환 함수만 모아 둔다.
 * 브라우저에서는 window.BT, quickjs·node 에서는 module.exports 로 노출.
 * 이 파일 하나만 떼어 test_toolbox.py 로 검증한다.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) { module.exports = api; }
  if (root) { root.BT = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ── 숫자·표기 도우미 ───────────────────────────── */
  function num(v, def) {
    if (v === null || v === undefined || v === '') return def === undefined ? 0 : def;
    var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s₩원]/g, ''));
    return isFinite(n) ? n : (def === undefined ? 0 : def);
  }
  function won(n) {
    if (!isFinite(n)) return '-';
    var v = Math.round(n);
    var sign = v < 0 ? '-' : '';
    return sign + String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '원';
  }
  function eok(n) {
    var v = Math.round(n);
    if (Math.abs(v) < 10000) return won(v);
    var e = Math.floor(Math.abs(v) / 100000000);
    var man = Math.round((Math.abs(v) % 100000000) / 10000);
    var s = '';
    if (e > 0) s += e + '억';
    if (man > 0) s += (s ? ' ' : '') + String(man).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '만';
    return (v < 0 ? '-' : '') + s + '원';
  }
  function pct(n, digits) {
    if (!isFinite(n)) return '-';
    return (Math.round(n * Math.pow(10, digits === undefined ? 1 : digits)) / Math.pow(10, digits === undefined ? 1 : digits)) + '%';
  }
  function floorTo(n, unit) {
    unit = unit || 10000;
    return Math.floor(n / unit) * unit;
  }

  /* ── 1. URL 추적 파라미터 제거 ──────────────────── */
  // 브리프에 지정된 값 + 실제로 쓰이는 추적 파라미터만 넣는다.
  // (v, id, list, t, page, q 처럼 콘텐츠를 결정하는 값은 건드리지 않는다)
  var TRACK_KEYS = [
    'fbclid', 'gclid', 'gclsrc', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'yclid', 'twclid',
    'ttclid', 'li_fat_id', 'rb_clickid', 'srsltid', 'gad_source', 'gadid', 'campaignid',
    'igshid', 'igsh', 'xmt', 'mcid', 'src', 'spec', 'spm', 'scm', 'trk', 'trkcampaign',
    'napm', 'inflow', 'nl_query', 'nv_ad', 'naver_source',
    'trk_info', 'ref', 'ref_src', 'ref_url', 'referrer', 'ncid', 'nclid', 's_cid', 'cmpid',
    'campaign_id', 'adgroup_id', 'ad_id', 'creative_id', 'oly_anon_id', 'oly_enc_id',
    'vero_id', 'vero_conv', 'wickedid', '_ga', '_gl', '_hsenc', '_hsmi', 'hsctatracking',
    'si', 'feature', 'share', 'share_id', 'share_source', 'utm'
  ];

  function isTrackKey(key) {
    var k = String(key).toLowerCase();
    if (k.indexOf('utm_') === 0) return true;
    for (var i = 0; i < TRACK_KEYS.length; i++) {
      if (TRACK_KEYS[i] === k) return true;
    }
    return false;
  }

  function looksLikeUrl(s) {
    if (!s) return false;
    if (/^https?:\/\//i.test(s)) return true;
    // 스킴 없이 도메인만 온 경우 (www. / instagram.com / coupang.com ...)
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$|\?|#)/i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(s);
  }

  function cleanUrl(raw) {
    var input = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!input) return { ok: false, error: '링크를 입력해 주세요.', clean: '', removed: [], changed: false };

    var text = input;
    // 카톡·메모에서 딸려 온 앞뒤 문장 부호 제거
    text = text.replace(/^[<"'(\s]+/, '').replace(/[>"')\s]+$/, '');

    var scheme = '';
    if (/^https?:\/\//i.test(text)) {
      var m = text.match(/^(https?:\/\/)/i);
      scheme = m[1].toLowerCase();
      text = text.slice(m[1].length);
    } else if (!looksLikeUrl(text)) {
      return { ok: false, error: 'URL 형식이 아니에요. http로 시작하는 링크를 넣어 주세요.', clean: '', removed: [], changed: false };
    }

    // 조각(#)은 콘텐츠를 가리키는 경우가 많아 그대로 둔다
    var hash = '';
    var hIdx = text.indexOf('#');
    if (hIdx >= 0) { hash = text.slice(hIdx); text = text.slice(0, hIdx); }

    var qIdx = text.indexOf('?');
    if (qIdx < 0) {
      return { ok: true, clean: (scheme || 'https://') + text + hash, removed: [], changed: input !== (scheme || 'https://') + text + hash };
    }
    var pathPart = text.slice(0, qIdx);
    var query = text.slice(qIdx + 1);

    var kept = [];
    var removed = [];
    var pairs = query.split('&');
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!p) continue;
      var eq = p.indexOf('=');
      var key = eq >= 0 ? p.slice(0, eq) : p;
      var val = eq >= 0 ? p.slice(eq + 1) : '';
      var dKey = key;
      try { dKey = decodeURIComponent(key); } catch (e) { dKey = key; }
      if (isTrackKey(dKey)) {
        removed.push(eq >= 0 ? dKey + '=' + val : dKey);
      } else {
        kept.push(p);
      }
    }
    var clean = (scheme || 'https://') + pathPart + (kept.length ? '?' + kept.join('&') : '') + hash;
    return { ok: true, clean: clean, removed: removed, changed: clean !== input, kept: kept.length };
  }

  /* ── 2. 임장용 자금 계산기 ──────────────────────── */
  // 취득세율: 무주택 1주택 취득 기준(지방세+농특세 포함) 1.1% ~ 3.3%
  function acqTaxRate(price) {
    if (price <= 600000000) return 1.1;
    if (price <= 900000000) return 1.1 + (price - 600000000) / 300000000 * 2.2;
    return 3.3;
  }

  /* 중개보수 상한요율(2021.10 개정, 매매·교환 기준) */
  function brokerRate(price) {
    if (price < 50000000) return { rate: 0.6, cap: 250000 };
    if (price < 200000000) return { rate: 0.5, cap: 800000 };
    if (price < 900000000) return { rate: 0.4, cap: 0 };
    if (price < 1200000000) return { rate: 0.5, cap: 0 };
    if (price < 1500000000) return { rate: 0.6, cap: 0 };
    return { rate: 0.7, cap: 0 };
  }

  /* 원리금균등 월 상환액 */
  function monthlyPayment(principal, annualRatePct, months) {
    var P = Math.max(0, num(principal));
    var n = Math.max(1, Math.round(num(months, 1)));
    var r = num(annualRatePct) / 100 / 12;
    if (n <= 0) return { monthly: 0, total: 0, interest: 0 };
    var monthly = r === 0 ? P / n : P * r / (1 - Math.pow(1 + r, -n));
    var total = monthly * n;
    return { monthly: monthly, total: total, interest: total - P };
  }

  function fundingCalc(input) {
    input = input || {};
    var price = Math.max(0, num(input.price));          // 매매가
    var deposit = Math.max(0, num(input.deposit));      // 전세보증금(갭투자일 때)
    var mode = input.mode === 'gap' ? 'gap' : 'buy';
    var ltvPct = num(input.ltvPct, 70);
    var rate = num(input.rate, 4.5);
    var years = Math.max(1, num(input.years, 30));
    var extraCost = Math.max(0, num(input.extraCost));  // 이사·수리·부대비용
    var vatOn = !!input.brokerVat;

    var dep = mode === 'gap' ? Math.min(deposit, price) : 0;

    // 방공제: 서울 5,500만원 룰(금액 조정 가능), 토글 시에만 적용
    var bangOn = !!input.bangOn;
    var bangAmount = bangOn ? Math.max(0, num(input.bangAmount, 55000000)) : 0;

    var ltvLoan = floorTo(price * Math.min(Math.max(ltvPct, 0), 100) / 100);
    var ltvLoanNet = Math.max(0, ltvLoan - dep);                 // 전세 낀 경우 보증금만큼 차감
    var bangCap = Math.max(0, price - dep - bangAmount);         // 방공제 반영 한도
    var loanPossible = bangOn ? Math.min(ltvLoanNet, floorTo(bangCap)) : ltvLoanNet;

    var override = num(input.loanOverride, 0);
    var loan = override > 0 ? Math.min(override, Math.max(0, price - dep)) : loanPossible;
    var overLtv = override > 0 && override > loanPossible;

    var acqRateManual = input.acqRateManual === '' || input.acqRateManual === null || input.acqRateManual === undefined ? null : num(input.acqRateManual, 0);
    var acqRate = acqRateManual !== null && acqRateManual > 0 ? acqRateManual : acqTaxRate(price);
    var acqTax = Math.round(price * acqRate / 100 / 10) * 10;

    var br = brokerRate(price);
    var broker = Math.min(price * br.rate / 100, br.cap > 0 ? br.cap : Infinity);
    broker = Math.round(broker / 1000) * 1000;
    var brokerTotal = Math.round((vatOn ? broker * 1.1 : broker) / 1000) * 1000;

    var cash = price + acqTax + brokerTotal + extraCost - dep - loan;
    var pay = monthlyPayment(loan, rate, years * 12);

    var items = [
      { key: 'price', label: '매매가', value: price },
      { key: 'deposit', label: '전세보증금 차감', value: -dep },
      { key: 'loan', label: '대출', value: -loan },
      { key: 'acq', label: '취득세', value: acqTax },
      { key: 'broker', label: '중개보수', value: brokerTotal },
      { key: 'extra', label: '기타비용', value: extraCost }
    ];

    var notes = [];
    if (mode === 'gap' && dep <= 0) notes.push('갭투자 모드인데 전세보증금이 0원이에요. 보증금을 넣으면 필요 현금이 줄어든 계산으로 바뀝니다.');
    if (bangOn && floorTo(bangCap) < ltvLoanNet) notes.push('LTV 한도보다 방공제(' + eok(bangAmount) + ')가 먼저 걸렸어요. 이 경우 대출이 ' + eok(loanPossible) + '로 줄어듭니다.');
    if (overLtv) notes.push('직접 입력한 대출액이 LTV·방공제 한도(' + eok(loanPossible) + ')를 넘습니다. 실제 심사에서는 한도까지만 나옵니다.');
    if (cash < 0) notes.push('대출이 매입 비용보다 커서 현금이 남는 계산입니다. 대출 한도를 다시 확인해 주세요.');

    return {
      cash: cash,
      loan: loan,
      loanPossible: loanPossible,
      ltvLoan: ltvLoan,
      monthly: pay.monthly,
      totalInterest: pay.interest,
      totalRepay: pay.total,
      acqTax: acqTax,
      acqRate: acqRate,
      broker: broker,
      brokerTotal: brokerTotal,
      brokerRate: br.rate,
      items: items,
      notes: notes
    };
  }

  /* ── 3. 구매대행 마진·노출제한 체크기 ───────────── */
  /* 관부가세 추정: 목록통관 면세 한도(미국 200달러, 그 외 150달러) + 관세 + 부가세 */
  function dutyEstimate(input) {
    input = input || {};
    var usd = Math.max(0, num(input.usd));
    var fx = Math.max(0, num(input.fx, 1380));
    var ship = Math.max(0, num(input.intlShipping));
    var dutyRate = num(input.dutyRate, 8);
    var vatRate = num(input.vatRate, 10);
    var threshold = num(input.thresholdUsd, 150);
    var goodsKrw = usd * fx;

    if (usd > 0 && usd <= threshold) {
      return { taxable: false, customsValue: goodsKrw, duty: 0, vat: 0, total: 0, goodsKrw: goodsKrw };
    }
    var customsValue = goodsKrw + ship;
    var duty = Math.round(customsValue * dutyRate / 100);
    var vat = Math.round((customsValue + duty) * vatRate / 100);
    return { taxable: true, customsValue: customsValue, duty: duty, vat: vat, total: duty + vat, goodsKrw: goodsKrw };
  }

  var FEE_PRESETS = [
    { key: 'coupang', label: '쿠팡', pct: 10.8 },
    { key: 'smartstore', label: '스마트스토어', pct: 5.5 },
    { key: 'toss', label: '토스쇼핑', pct: 5.0 }
  ];

  function marginCalc(input) {
    input = input || {};
    var usd = Math.max(0, num(input.costUsd));
    var fx = Math.max(0, num(input.fx, 1380));
    var intlShip = Math.max(0, num(input.intlShipping));
    var duty = Math.max(0, num(input.duty));
    var domesticShip = Math.max(0, num(input.domesticShip));
    var other = Math.max(0, num(input.otherCost));
    var sale = Math.max(0, num(input.salePrice));
    var feePct = Math.min(99, Math.max(0, num(input.feePct, 10.8)));
    var recommend = Math.max(0, num(input.recommendPrice));

    var goods = Math.round(usd * fx);
    var cost = Math.round(goods + intlShip + duty + domesticShip + other);
    var fee = Math.round(sale * feePct / 100);
    var net = sale - cost - fee;
    var marginPct = sale > 0 ? net / sale * 100 : 0;
    var breakEven = feePct < 100 ? cost / (1 - feePct / 100) : 0;

    var risk = false, over = 0, overPct = 0, netAtRecommend = null;
    if (recommend > 0) {
      over = sale - recommend;
      overPct = recommend > 0 ? over / recommend * 100 : 0;
      risk = over > 0;
      netAtRecommend = recommend - cost - Math.round(recommend * feePct / 100);
    }

    var notes = [];
    if (sale > 0 && net < 0) notes.push('판매가가 원가·수수료보다 낮습니다. 손익분기 판매가는 ' + won(Math.ceil(breakEven / 100) * 100) + '입니다.');
    if (risk) notes.push('쿠팡 추천가보다 ' + won(over) + ' 높습니다(' + pct(overPct) + '). 최저가 경쟁에서 밀려 노출이 제한될 위험이 큽니다.');
    if (recommend > 0 && !risk) notes.push('추천가 이하입니다. 노출 제한 위험은 낮지만 마진은 ' + won(net) + '입니다.');

    return {
      goods: goods,
      cost: cost,
      fee: fee,
      feePct: feePct,
      net: net,
      marginPct: marginPct,
      breakEven: breakEven,
      recommend: recommend,
      risk: risk,
      over: over,
      overPct: overPct,
      netAtRecommend: netAtRecommend,
      notes: notes
    };
  }

  /* ── 4. 사내 공지 규격 변환 ─────────────────────── */
  var WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
  var TAGS = ['요청', '안내', '확인'];

  function dueText(dateStr, timeStr) {
    if (!dateStr) return timeStr ? timeStr + '까지' : '';
    var m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return String(dateStr);
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var s = Number(m[2]) + '월 ' + Number(m[3]) + '일(' + WEEKDAY[d.getDay()] + ')';
    if (timeStr) s += ' ' + timeStr;
    return s + '까지';
  }

  // 메모 한 줄 규칙: '#'은 ■ 소제목, '-'는 들여쓴 하위 항목, 그 외는 문단
  function formatMemo(memo) {
    var lines = String(memo || '').replace(/\r\n/g, '\n').split('\n');
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      var line = raw.replace(/\s+$/, '');
      if (!line.trim()) { out.push(''); continue; }
      if (/^■/.test(line.trim())) { out.push('■ ' + line.trim().replace(/^■\s*/, '')); continue; }
      if (/^#\s*/.test(line.trim())) { out.push('■ ' + line.trim().replace(/^#\s*/, '')); continue; }
      if (/^-/.test(line.trim())) { out.push('  - ' + line.trim().replace(/^-\s*/, '')); continue; }
      if (/^·/.test(line.trim())) { out.push('  - ' + line.trim().replace(/^·\s*/, '')); continue; }
      // "항목: 값" 형태는 ■ 항목: 값 으로 승격
      if (/^[^:\n]{1,20}:\s*\S/.test(line.trim())) { out.push('■ ' + line.trim()); continue; }
      out.push(line.trim());
    }
    // 연속 빈 줄 정리
    var cleaned = [];
    for (var j = 0; j < out.length; j++) {
      if (out[j] === '' && (cleaned.length === 0 || cleaned[cleaned.length - 1] === '')) continue;
      cleaned.push(out[j]);
    }
    while (cleaned.length && cleaned[cleaned.length - 1] === '') cleaned.pop();
    return cleaned.join('\n');
  }

  function noticeFormat(input) {
    input = input || {};
    var tag = TAGS.indexOf(input.tag) >= 0 ? input.tag : '요청';
    var summary = String(input.summary || '').trim() || '제목을 입력해 주세요';
    var audience = String(input.audience || '').trim() || '구성원 여러분';
    var due = dueText(input.dueDate, String(input.dueTime || '').trim());
    var contact = String(input.contact || '').trim() || '문의: 인사총무팀';
    var memo = formatMemo(input.memo);

    var title = '[' + tag + '] ' + summary + (due ? ' (~' + due + ')' : '');

    var blocks = [];
    blocks.push(audience + ', 안녕하세요. 인사총무팀입니다.');
    if (memo) blocks.push(memo);

    var facts = [];
    if (input.audience && String(input.audience).trim() && String(input.audience).trim() !== '구성원 여러분') {
      facts.push('■ 대상: ' + String(input.audience).trim());
    }
    if (due) facts.push('■ 기한: ' + due);
    if (facts.length) blocks.push(facts.join('\n'));
    blocks.push(contact);

    var body = blocks.join('\n\n');
    return { title: title, body: body, full: title + '\n\n' + body, tag: tag, due: due };
  }

  /* ── 5. 스레드 분할 ────────────────────────────── */
  function splitByLength(block, limit) {
    // 긴 문단: 문장 경계 → 어절 → 강제 절단
    var out = [];
    var rest = block;
    while (rest.length > limit) {
      var cut = -1;
      var window = rest.slice(0, limit);
      var candidates = ['\n', '. ', '다. ', '! ', '? ', ', ', ' '];
      for (var i = 0; i < candidates.length; i++) {
        var idx = window.lastIndexOf(candidates[i]);
        if (idx > limit * 0.5) { cut = idx + (candidates[i] === '. ' || candidates[i] === '다. ' || candidates[i] === '! ' || candidates[i] === '? ' ? 1 : 0); break; }
      }
      if (cut <= 0) cut = limit;
      out.push(rest.slice(0, cut).replace(/\s+$/, ''));
      rest = rest.slice(cut).replace(/^\s+/, '');
    }
    if (rest) out.push(rest);
    return out;
  }

  function splitThread(raw, maxChars) {
    var limitTotal = Math.max(60, Math.round(num(maxChars, 500)));
    var text = String(raw || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').trim();
    if (!text) return { parts: [], total: 0, totalChars: 0, empty: true, maxChars: limitTotal };

    // 라벨("1/9") + "더보기" 자리를 미리 빼 둔다
    var reserve = 12;
    var limit = limitTotal - reserve;

    var blocks = text.split(/\n{2,}/).map(function (b) { return b.trim(); }).filter(function (b) { return b.length > 0; });
    var chunks = [];
    var cur = '';
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b.length > limit) {
        if (cur) { chunks.push(cur); cur = ''; }
        var pieces = splitByLength(b, limit);
        for (var p = 0; p < pieces.length; p++) chunks.push(pieces[p]);
        continue;
      }
      var cand = cur ? cur + '\n\n' + b : b;
      if (cand.length <= limit) { cur = cand; } else { if (cur) chunks.push(cur); cur = b; }
    }
    if (cur) chunks.push(cur);

    if (chunks.length === 0) chunks.push(text.slice(0, limit));

    var total = chunks.length;
    var parts = chunks.map(function (body, idx) {
      var label = (idx + 1) + '/' + total;
      var more = idx < total - 1 ? '더보기' : '';
      var tail = more ? '\n\n' + more + '\n' + label : '\n\n' + label;
      var post = body + tail;
      return {
        index: idx + 1,
        total: total,
        label: label,
        body: body,
        bodyChars: body.length,
        post: post,
        chars: post.length,
        over: post.length > limitTotal
      };
    });

    return {
      parts: parts,
      total: total,
      totalChars: text.length,
      maxChars: limitTotal,
      empty: false,
      allFit: parts.every(function (pt) { return !pt.over; })
    };
  }

  /* ── 6. QR·Wi-Fi 페이로드 ──────────────────────── */
  function wifiPayload(input) {
    input = input || {};
    var ssid = String(input.ssid || '');
    var pass = String(input.password || '');
    var auth = input.auth || 'WPA';   // WPA | WEP | nopass
    var hidden = !!input.hidden;
    function esc(s) { return String(s).replace(/([\\;,:"])/g, '\\$1'); }
    var out = 'WIFI:T:' + auth + ';S:' + esc(ssid) + ';';
    if (auth !== 'nopass') out += 'P:' + esc(pass) + ';';
    if (hidden) out += 'H:true;';
    out += ';';
    return out;
  }

  function qrPayload(type, input) {
    input = input || {};
    if (type === 'wifi') return wifiPayload(input);
    var t = String(input.text || '').trim();
    if (type === 'url' && t && !/^[a-z]+:\/\//i.test(t) && looksLikeUrl(t)) t = 'https://' + t;
    return t;
  }

  return {
    num: num, won: won, eok: eok, pct: pct, floorTo: floorTo,
    isTrackKey: isTrackKey, cleanUrl: cleanUrl,
    acqTaxRate: acqTaxRate, brokerRate: brokerRate, monthlyPayment: monthlyPayment, fundingCalc: fundingCalc,
    dutyEstimate: dutyEstimate, marginCalc: marginCalc, FEE_PRESETS: FEE_PRESETS,
    dueText: dueText, formatMemo: formatMemo, noticeFormat: noticeFormat, TAGS: TAGS,
    splitThread: splitThread,
    wifiPayload: wifiPayload, qrPayload: qrPayload
  };
});
