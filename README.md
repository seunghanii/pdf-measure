# PDF 도면 측정기

웹 브라우저에서 PDF 도면을 열고, 치수를 아는 선 하나를 **기준 길이**로 지정하면
그 축척으로 **길이, 면적, 각도**를 측정하는 도구입니다.
PDF 파일은 서버로 올라가지 않고 사용자의 브라우저 안에서만 열립니다.

- 기술: React (JavaScript) + Vite + Tailwind CSS + pdf.js
- 서버가 필요 없는 정적 사이트라서 무료 호스팅(Vercel, Netlify, GitHub Pages)에 그대로 올라갑니다.

## 사용법

1. **PDF 열기** 버튼을 누르거나 파일을 화면에 끌어다 놓습니다.
2. **기준 길이** 도구로 도면에서 치수를 아는 선의 양 끝을 클릭하고, 실제 길이(예: 5000 mm)를 입력합니다.
   도면 축척(예: 1:50)을 알고 PDF가 실제 용지 크기라면 오른쪽 패널에서 1:N 으로 바로 지정해도 됩니다.
3. **길이**: 점을 차례로 클릭해 이어 가면 총 길이가 나오고, 마지막 점 다시 클릭·더블클릭·Enter 로 완료 / **면적**: 꼭짓점을 차례로 클릭 후 첫 점·더블클릭·Enter 로 완료 / **각도**: 끝점 → 꼭짓점 → 끝점 순서로 클릭.
4. 여러 페이지 PDF는 위아래로 스크롤해서 모든 페이지를 봅니다.
5. 오른쪽 목록에서 이름을 바꾸거나 삭제하고, 눈 아이콘으로 도면 위에서 숨기거나 다시 보이게 할 수 있습니다. **CSV 저장**으로 엑셀에서 열 수 있습니다.
6. 여러 도면을 열면 위쪽 **탭**으로 바로바로 오갈 수 있습니다. 홈(집 아이콘)에는 **최근 연 도면** 목록이 있어 클릭 한 번으로 다시 엽니다.
7. 측정값과 기준 길이는 브라우저에 **자동 저장**되어, 새로고침하거나 같은 파일을 다시 열어도 그대로 남아 있습니다.
   (같은 이름·크기의 파일을 같은 도면으로 봅니다. 최근 20개까지 보관, 다른 브라우저나 기기와는 공유되지 않습니다.)

| 단축키 | 기능 |
| --- | --- |
| V / H / C / L / A / G | 선택 / 이동 / 기준 길이 / 길이 / 면적 / 각도 |
| Ctrl + 휠, + / - | 확대 / 축소 |
| 스페이스바 + 드래그 | 화면 이동 |
| Shift + 클릭 | 수평·수직·45° 고정 |
| Esc / Backspace | 그리던 도형 취소 / 마지막 점 취소 |
| Delete / Ctrl + Z | 선택 항목 삭제 / 되돌리기 |
| Alt + ← / → | 이전 / 다음 도면 탭 |
| PageUp / PageDown | 이전 / 다음 페이지 |

## 내 컴퓨터에서 실행하기

[Node.js](https://nodejs.org) (LTS 버전)를 설치한 뒤, 이 폴더에서:

```bash
npm install     # 처음 한 번만
npm run dev     # 개발 서버 실행 → 터미널에 나오는 http://localhost:5173 주소를 브라우저로 열기
npm run build   # 배포용 파일을 dist 폴더에 만들기
```

## 무료로 배포하기

### 방법 A. Vercel (추천: 코드를 고치면 자동으로 다시 배포됨)

1. [github.com](https://github.com) 에 가입하고, 이 코드를 저장소(repository)에 올립니다.
2. [vercel.com](https://vercel.com) 에서 **Sign Up → Continue with GitHub** 로 가입합니다. (Hobby 무료 플랜)
3. **Add New… → Project** 를 누르고, 목록에서 이 저장소 옆의 **Import** 를 누릅니다.
4. Framework Preset 이 **Vite** 로 자동 선택된 것을 확인하고 **Deploy** 를 누릅니다.
5. 1분쯤 뒤 `https://프로젝트이름.vercel.app` 주소가 생깁니다. 이 주소를 누구에게나 공유하면 됩니다.

이후 GitHub 저장소에 코드가 바뀌면 Vercel 이 알아서 다시 배포합니다.

### 방법 B. Netlify Drop (가장 빠름: 가입 후 폴더 끌어다 놓기)

1. `npm run build` 로 `dist` 폴더를 만듭니다. (또는 전달받은 `dist` 압축 파일을 풉니다)
2. [app.netlify.com/drop](https://app.netlify.com/drop) 에 접속해 `dist` 폴더를 통째로 끌어다 놓습니다.
3. 바로 `https://임의이름.netlify.app` 주소가 생깁니다. 무료 계정으로 가입하면 주소가 계속 유지됩니다.

코드를 고칠 때마다 다시 빌드해서 끌어다 놓아야 하는 점만 다릅니다.

## 폴더 구조

```
src/
  App.jsx                 열린 탭, 최근 파일, 새로고침 후 복원
  components/
    Workspace.jsx         도면 한 개(탭 한 개)의 상태: 측정 목록, 축척, 되돌리기, 단축키, 자동 저장
    TabBar.jsx            도면 탭
    PdfViewer.jsx         모든 페이지 연속 스크롤 렌더링, 확대/이동, 클릭으로 점 찍기
    MeasurementShape.jsx  도면 위에 그려지는 선/면적/각도와 값 라벨
    Toolbar.jsx           상단 도구 모음
    Sidebar.jsx           축척 설정, 측정 목록, CSV 저장
    CalibrationDialog.jsx 기준 길이 입력 창
    EmptyState.jsx        홈 화면 (파일 열기, 최근 연 도면 목록)
  lib/
    geometry.js           거리, 면적(신발끈 공식), 각도 계산
    units.js              단위 변환과 숫자 표시
    measure.js            측정 종류별 값 계산
    pdf.js                pdf.js 설정
    storage.js            IndexedDB(PDF 파일, 측정값)와 localStorage(열린 탭) 저장
public/sample.pdf         체험용 샘플 평면도 (scripts/make-sample-pdf.mjs 로 생성, 축척 1:50)
```
