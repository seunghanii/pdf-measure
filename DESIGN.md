# DESIGN.md — PDF 도면 측정기

이 앱의 화면 규칙입니다. [awesome-design-md](https://github.com/VoltAgent/awesome-design-md)의 DESIGN.md 형식을 따랐고,
Linear·Figma 견본처럼 "도구는 조용하게, 도면이 주인공"을 목표로 합니다.
화면 점검은 `.claude/skills/web-design-guidelines`(Vercel Web Interface Guidelines)로 합니다.

## 원칙

1. **도면이 주인공.** 툴바·사이드바는 흰 바탕 + 얇은 테두리. 진한 색은 지금 고른 도구와 주 버튼에만.
2. **색에는 뜻이 있다.** 파랑 = 선택·주 동작, 주황 = 기준 길이(축척), 분홍 = 자석. 다른 곳에 섞어 쓰지 않습니다.
3. **가볍게.** 웹 폰트·UI 라이브러리·큰 애니메이션은 쓰지 않습니다. 효과는 색 전환(`transition-colors`)만.

## 색상 토큰 (`src/index.css` `@theme`)

Tailwind 기본 색은 꺼 두었습니다(`--color-*: initial`). 아래 이름만 쓰세요. 예: `bg-brand-600`, `text-ink-500`.

| 토큰 | 대표 값 | 쓰는 곳 |
| --- | --- | --- |
| `ink-50`…`900` | `#f7f8fa` … `#161a24` | 글자, 테두리, 바탕. 살짝 푸른 흑연색 |
| `brand` (청사진 파랑) | `600 #2a4fe0` | 주 버튼(PDF 열기), 고른 도구, 링크, 선택 표시, 초점 테두리 |
| `ref` (줄자 주황) | `500 #f75e0f` | 기준 길이 도구, 축척 안내 |
| `snap` | `600 #db2777` | 자석 켜짐 |
| `ok` / `warn` / `danger` | `600` | 저장됨 / 주의 / 삭제·오류 |
| `desk` | `#e4e7ed` | 도면 뒤 바탕 |

도면 위에 그리는 측정·마크업 색(`lib/markup.js`, `lib/measure.js`, `lib/memo.js`)은 사용자가 고른 데이터라 토큰과 별개입니다.
색을 바꾸려면 `@theme` 값만 고치면 앱 전체에 반영됩니다.

## 모양

- 둥글기: 버튼 `rounded-lg`, 도구 묶음 안 버튼 `rounded-[10px]`, 카드·창 `rounded-xl`.
- 도구 묶음: `rounded-xl bg-ink-100 p-0.5` 안에 버튼. 고른 도구는 `bg-brand-600 text-white`, 기준 길이는 `bg-ref-500`.
- 카드: `bg-white ring-1 ring-ink-200 shadow-xs`. 큰 그림자는 떠 있는 창(대화상자, 메모장)에만.
- 홈 바탕: `.bg-grid`(옅은 모눈, 도면 용지 느낌).
- 숫자: `tabular-nums`.

## 접근성·사용성 (Web Interface Guidelines에서 고른 것)

- 키보드 초점은 `:focus-visible` 파란 테두리(전역).
- 아이콘만 있는 버튼은 `aria-label`, 켜고 끄는 버튼은 `aria-pressed`.
- `prefers-reduced-motion`이면 전환 효과를 끔.
- `transition: all` 쓰지 않기, 애니메이션은 `transform`/`opacity`만.
