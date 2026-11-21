/* 복대리 연말 법정리스크 1분 진단 — 순수 로직 (DOM 없음)
 * 브라우저와 quickjs 양쪽에서 실행된다. 화면·스타일과 분리되어 있어 test_logic.py가 그대로 검증한다.
 *
 * 근거
 *  - 연차: 근로기준법 제60조(연차 유급휴가), 제61조(연차 유급휴가의 사용 촉진)
 *  - 성희롱 예방교육: 남녀고용평등과 일·가정 양립 지원에 관한 법률 제13조, 과태료 500만원 이하(차수 구분 없이 감경·가중)
 *  - 장애인 인식개선교육: 장애인고용촉진 및 직업재활법 제5조의2, 과태료 1차 100만(2차 200·3차 300)
 *  - 퇴직연금 가입자 교육: 근로자퇴직급여 보장법 제32조제2항, 과태료 1차 200만(2차 500·3차 1,000)
 *
 * 금액은 '추정'이다. 수당은 미사용 평균 일수 가정, 과태료는 1차 부과·법정 상한 기준.
 */
var YR = (function () {
  "use strict";

  var KIT_URL = "https://www.latpeed.com/products/AX28q";
  var CALC_URL = "https://nineonehn.github.io/k-pass-beauty/annual-leave-calc/";

  var HOURS_PER_MONTH = 209; // 주 40시간 + 주휴 8시간 = 월 209시간
  var DEFAULT_MONTHLY_WAGE = 2090000; // 1일 통상임금 8만원이 되는 값

  var DEFAULT_DAYS = {
    unused: 5,      // 직원 1인당 평균 미사용 연차(가정)
    newHire: 5,     // 1년 미만 직원 1인당 평균 미사용 연차(가정)
    secondRound: 3  // 2차 통보 미이행 시 1인당 남는 연차(가정)
  };

  var PENALTY = {
    q4: 5000000,   // 성희롱 예방교육 미실시 — 500만원 이하(차수 구분 없이 감경·가중)
    q5: 1000000,   // 장애인 인식개선교육 미실시 — 1차 100만(2차 200·3차 300)
    q6: 2000000    // 퇴직연금 가입자 교육 미실시 — 1차 200만(2차 500·3차 1,000)
  };

  var QUESTIONS = [
    {
      id: "q1",
      theme: "annual",
      themeLabel: "연차",
      title: "직원별 연차 사용 촉진(1차 서면 촉구)을 보냈나요?",
      help: "소멸 6개월 전부터 10일 이내, 개인별 서면",
      noLabel: "안 보냈거나 기한이 지났다"
    },
    {
      id: "q2",
      theme: "annual",
      themeLabel: "연차",
      title: "1년 미만 직원의 연차 촉진(B트랙)도 챙겼나요?",
      help: "입사 9개월 차 1차, 11개월 차 추가 촉구 · 신입이 없으면 '예'",
      noLabel: "신입은 따로 촉구하지 않았다"
    },
    {
      id: "q3",
      theme: "annual",
      themeLabel: "연차",
      title: "1차 촉구 뒤 2차 통보(사용 시기 지정)까지 했나요?",
      help: "1차 뒤 10일이 지난 다음, 소멸 2개월 전까지",
      noLabel: "1차에서 멈췄다"
    },
    {
      id: "q4",
      theme: "edu",
      themeLabel: "법정교육",
      title: "성희롱 예방교육을 올해 전 직원에게 했나요?",
      help: "연 1회 1시간 이상 · 참석 명부 서명 필수",
      noLabel: "못 했거나 명부가 없다"
    },
    {
      id: "q5",
      theme: "edu",
      themeLabel: "법정교육",
      title: "장애인 인식개선교육을 올해 했나요?",
      help: "연 1회 1시간 이상 · 사업주 포함",
      noLabel: "못 했거나 기록이 없다"
    },
    {
      id: "q6",
      theme: "pension",
      themeLabel: "퇴직연금",
      title: "퇴직연금 가입자에게 연 1회 교육을 했나요?",
      help: "DB·DC 도입 사업장 · 매년 1회 이상",
      noLabel: "안내문만 보내고 교육은 없었다"
    }
  ];

  var THEMES = [
    { key: "annual", label: "연차 촉진", short: "연차" },
    { key: "edu", label: "법정의무교육", short: "교육" },
    { key: "pension", label: "퇴직연금", short: "퇴직연금" }
  ];

  var GRADES = [
    { max: 0, key: "safe", label: "안전", line: "지금 상태로는 연말에 새로 나갈 돈이 거의 없습니다." },
    { max: 2, key: "caution", label: "주의", line: "한두 곳만 막으면 올해는 넘어갑니다." },
    { max: 4, key: "danger", label: "위험", line: "12월에 한꺼번에 청구서가 됩니다." },
    { max: 6, key: "severe", label: "심각", line: "세 갈래가 동시에 열려 있습니다. 우선순위부터 정해야 합니다." }
  ];

  function clampInt(v, lo, hi) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) n = lo;
    if (n < lo) n = lo;
    if (n > hi) n = hi;
    return n;
  }

  function dailyWage(monthlyWage) {
    var m = Number(monthlyWage);
    if (!isFinite(m) || m <= 0) m = DEFAULT_MONTHLY_WAGE;
    return Math.round((m / HOURS_PER_MONTH) * 8);
  }

  function newHireCount(headcount) {
    // 1년 미만 직원은 직원 수의 20%로 보되, 최소 1명·최대 3명
    return Math.min(3, Math.max(1, Math.round(headcount * 0.2)));
  }

  function secondRoundCount(headcount) {
    // 1차 촉구에 회신하지 않은 인원은 절반으로 본다(최소 1명)
    return Math.min(headcount, Math.max(1, Math.round(headcount * 0.5)));
  }

  function gradeFor(score) {
    for (var i = 0; i < GRADES.length; i++) {
      if (score <= GRADES[i].max) return GRADES[i];
    }
    return GRADES[GRADES.length - 1];
  }

  function man(v) {
    // 화면 표기용 만원 단위(정수)
    return Math.round(Number(v) / 10000);
  }

  function wonText(v) {
    var n = Math.round(Number(v) / 10000);
    if (n === 0) return "0원";
    if (n >= 10000) {
      var eok = Math.floor(n / 10000);
      var rest = n % 10000;
      return eok + "억" + (rest ? " " + comma(rest) + "만" : "") + "원";
    }
    return comma(n) + "만원";
  }

  function comma(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* answers: {q1:true(했음)/false(못 했음) ...}
   * opts: {headcount, monthlyWage}
   * 반환: 점수·등급·항목별 금액·합계·근거 문장 */
  function compute(answers, opts) {
    answers = answers || {};
    opts = opts || {};

    var headcount = clampInt(opts.headcount == null ? 10 : opts.headcount, 1, 300);
    var monthlyWage = Number(opts.monthlyWage) > 0 ? Number(opts.monthlyWage) : DEFAULT_MONTHLY_WAGE;
    var wage = dailyWage(monthlyWage);
    var nh = newHireCount(headcount);
    var sr = secondRoundCount(headcount);

    var did = function (id) { return answers[id] !== false; }; // 답하지 않았으면 '했음'으로 보지 않는다
    var answered = function (id) { return answers[id] === true || answers[id] === false; };

    var items = [];
    var miss = {};

    // q1 — 1차 촉구 누락: 미사용 연차 전량이 수당으로 남는다
    if (answered("q1") && !did("q1")) {
      miss.q1 = true;
      items.push({
        id: "q1",
        theme: "annual",
        themeLabel: "연차",
        title: "연차 1차 촉구 서면 누락",
        tag: "약",
        amount: headcount * DEFAULT_DAYS.unused * wage,
        basis: headcount + "명 × 평균 미사용 " + DEFAULT_DAYS.unused + "일 × 1일 통상임금 " + wonText(wage),
        law: "근로기준법 제61조",
        note: "촉진이 무효면 남은 연차가 전부 수당이 됩니다. 하루 늦은 발송의 값이 이 금액입니다.",
        action: "오늘 개인별 서면을 발송하세요. 늦은 발송이 미발송보다 낫습니다."
      });
    }

    // q2 — 1년 미만 트랙 누락
    if (answered("q2") && !did("q2")) {
      miss.q2 = true;
      items.push({
        id: "q2",
        theme: "annual",
        themeLabel: "연차",
        title: "1년 미만 신입 B트랙 누락",
        tag: "약",
        amount: nh * DEFAULT_DAYS.newHire * wage,
        basis: "신입 " + nh + "명 × 평균 미사용 " + DEFAULT_DAYS.newHire + "일 × " + wonText(wage),
        law: "근로기준법 제60조·제61조",
        note: "1년 미만은 입사일 기준으로 따로 촉구해야 합니다. 대부분의 자료가 이 트랙을 빼고 설명합니다.",
        action: "입사 9개월 차 1차 촉구, 11개월 차에 추가 촉구와 2차 통보를 함께 보내세요."
      });
    }

    // q3 — 2차 통보 누락. 1차부터 없으면 같은 연차를 두 번 세지 않는다(합산 표시)
    if (answered("q3") && !did("q3")) {
      miss.q3 = true;
      var deduped = !did("q1");
      items.push({
        id: "q3",
        theme: "annual",
        themeLabel: "연차",
        title: "연차 2차 통보(사용 시기 지정) 누락",
        tag: deduped ? "합산" : "약",
        amount: deduped ? 0 : sr * DEFAULT_DAYS.secondRound * wage,
        basis: deduped
          ? "1차 촉구부터 없어 위 항목에 이미 합산"
          : "1차 미회신 " + sr + "명 × " + DEFAULT_DAYS.secondRound + "일 × " + wonText(wage),
        law: "근로기준법 제61조 제2항",
        note: deduped
          ? "지금은 1차부터 다시 시작해야 합니다. 두 절차를 한 번에 준비하세요."
          : "촉진은 2차 통보까지 끝나야 효력이 있습니다. 1차에서 멈추면 같은 수당이 남습니다.",
        action: "1차 뒤 10일이 지났다면 이번 주에 지정 통보를 보내세요."
      });
    }

    // q4 — 성희롱 예방교육
    if (answered("q4") && !did("q4")) {
      miss.q4 = true;
      items.push({
        id: "q4",
        theme: "edu",
        themeLabel: "법정교육",
        title: "성희롱 예방교육 미실시",
        tag: "최대",
        amount: PENALTY.q4,
        basis: "과태료 500만원 이하 · 차수 구분 없이 감경·가중",
        law: "남녀고용평등법 제13조·제39조",
        note: "교육을 했어도 참석 명부가 없으면 미실시로 봅니다. 점검에서 걸리는 건 내용이 아니라 명부입니다. 11월 27일부터는 법인 대표자·상급자도 수강 대상입니다.",
        action: "12월 셋째 주 전에 1시간 교육 + 그 자리에서 명부 서명을 받으세요."
      });
    }

    // q5 — 장애인 인식개선교육
    if (answered("q5") && !did("q5")) {
      miss.q5 = true;
      items.push({
        id: "q5",
        theme: "edu",
        themeLabel: "법정교육",
        title: "장애인 인식개선교육 미실시",
        tag: "최대",
        amount: PENALTY.q5,
        basis: "1차 100만원 · 2차 200만 · 3차 300만원",
        law: "장애인고용법 제5조의2",
        note: "사업주도 대상입니다. 수료증과 교육자료는 3년 보관하며, 미보관도 같은 과태료 대상입니다.",
        action: "성희롱 교육과 같은 날 1시간으로 묶어 실시하세요."
      });
    }

    // q6 — 퇴직연금 가입자 교육
    if (answered("q6") && !did("q6")) {
      miss.q6 = true;
      items.push({
        id: "q6",
        theme: "pension",
        themeLabel: "퇴직연금",
        title: "퇴직연금 가입자 교육 미실시",
        tag: "최대",
        amount: PENALTY.q6,
        basis: "1차 200만원 · 2차 500만 · 3차 1,000만원",
        law: "근로자퇴직급여 보장법 제32조②",
        note: "제도는 있는데 교육 기록이 없는 경우가 가장 많습니다. 금융사 안내자료 배포만으로는 부족하고, 퇴직연금사업자 위탁 교육은 인정됩니다.",
        action: "연 1회, 가입자 전원 대상 교육을 실시하고 이수 기록을 남기세요."
      });
    }

    var cash = 0;
    var penalty = 0;
    var yearEnd = 0;
    for (var i = 0; i < items.length; i++) {
      if (items[i].theme === "annual") cash += items[i].amount;
      else penalty += items[i].amount;
      items[i].man = man(items[i].amount);
      items[i].amountText = wonText(items[i].amount);
    }
    yearEnd = cash + penalty;

    // 화면 합계는 항목 표기(만원)의 합과 일치시킨다
    var manSum = 0;
    for (var j = 0; j < items.length; j++) manSum += items[j].man;

    var score = items.length;
    var grade = gradeFor(score);

    var themeStats = THEMES.map(function (t) {
      var count = 0;
      var money = 0;
      for (var k = 0; k < items.length; k++) {
        if (items[k].theme === t.key) { count++; money += items[k].amount; }
      }
      return {
        key: t.key,
        label: t.label,
        short: t.short,
        count: count,
        amount: money,
        amountText: wonText(money),
        ok: count === 0
      };
    });

    // 우선순위: 금액 큰 순, 금액이 같으면 연차 먼저
    var actions = items.slice().sort(function (a, b) {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return a.theme === "annual" ? -1 : 1;
    }).slice(0, 3).map(function (it) {
      return { id: it.id, title: it.title, action: it.action, amount: it.amount };
    });

    return {
      score: score,
      grade: grade.key,
      gradeLabel: grade.label,
      gradeLine: grade.line,
      items: items,
      themes: themeStats,
      cash: cash,
      cashText: wonText(cash),
      penalty: penalty,
      penaltyText: wonText(penalty),
      total: yearEnd,
      totalText: wonText(yearEnd),
      totalMan: manSum,
      dailyWage: wage,
      dailyWageText: wonText(wage),
      headcount: headcount,
      monthlyWage: monthlyWage,
      newHireCount: nh,
      secondRoundCount: sr,
      actions: actions,
      assumptions: [
        "직원 " + headcount + "명 · 1일 통상임금 " + wonText(wage) + " 기준",
        "미사용 연차는 1인 평균 " + DEFAULT_DAYS.unused + "일로 가정",
        "과태료는 1차 부과 기준 · 반복 시 최대 1,000만원까지 · 실제 부과액은 사업장 규모·이행 정도에 따라 다름"
      ],
      summary: score === 0
        ? "미비 0개 · 예상 리스크 없음"
        : "미비 " + score + "개 · 예상 리스크 " + wonText(yearEnd)
    };
  }

  return {
    KIT_URL: KIT_URL,
    CALC_URL: CALC_URL,
    QUESTIONS: QUESTIONS,
    THEMES: THEMES,
    GRADES: GRADES,
    PENALTY: PENALTY,
    DEFAULT_DAYS: DEFAULT_DAYS,
    DEFAULT_MONTHLY_WAGE: DEFAULT_MONTHLY_WAGE,
    HOURS_PER_MONTH: HOURS_PER_MONTH,
    dailyWage: dailyWage,
    man: man,
    wonText: wonText,
    comma: comma,
    newHireCount: newHireCount,
    secondRoundCount: secondRoundCount,
    gradeFor: function (score) { return gradeFor(score).key; },
    compute: compute
  };
})();

if (typeof module !== "undefined" && module.exports) { module.exports = YR; }
