# 서버 저장 설정하기 (Supabase 무료 플랜)

로그인하면 PDF 도면과 측정값·마크업이 **서버에 저장**되도록 바꾸는 방법입니다.
다른 컴퓨터나 브라우저에서도 같은 계정으로 로그인하면 그대로 이어서 볼 수 있어요.

서버는 [Supabase](https://supabase.com) 무료 플랜을 씁니다. 앱 코드는 이미 준비되어 있어서,
아래 순서대로 **Supabase 가입 → SQL 한 번 실행 → Vercel 에 값 두 개 넣기**만 하면 됩니다. 30분 정도 걸려요.

> 설정하기 전까지 앱은 지금처럼 브라우저에만 저장하며 그대로 동작합니다.

---

## 무료 플랜으로 되는 것

| 항목 | 무료 한도 | 이 앱에서는 |
| --- | --- | --- |
| 파일 저장 공간 | 1 GB | 도면 PDF 가 평균 3MB 라면 300개쯤 |
| 파일 하나 크기 | 50 MB | 50MB 넘는 PDF 는 파일만 못 올리고, 측정값은 저장됨 |
| 데이터베이스 | 500 MB | 측정값은 아주 작아서 사실상 무제한 |
| 한 달 내려받기 | 5 GB | 한 번 받은 PDF 는 그 컴퓨터에 사본을 두고 다시 받지 않음 |
| 로그인 사용자 | 월 5만 명 | 충분 |
| 카드 등록 | 필요 없음 | |

**꼭 알아 둘 점 두 가지**

1. **일주일 동안 아무도 쓰지 않으면 프로젝트가 일시 중지돼요.** 데이터는 그대로 남아 있고,
   Supabase 대시보드에서 그 프로젝트를 열어 **Resume project** 를 누르면 몇 분 뒤 다시 켜집니다.
   중지된 동안 앱에서는 "서버에 연결하지 못했어요" 라고 나옵니다.
2. **무료 플랜은 자동 백업이 없어요.** 중요한 도면은 앱의 **PDF 저장**(마크업 포함)으로 따로 보관해 두세요.

---

## 1단계. Supabase 가입하고 프로젝트 만들기

1. [supabase.com](https://supabase.com) 에서 **Start your project** 를 누르고 **Continue with GitHub** 로 가입합니다.
   (지금 쓰는 GitHub 계정으로 바로 됩니다.)
2. 조직(Organization)을 만들라고 하면 이름은 아무거나, 플랜은 **Free** 를 고릅니다.
3. **New project** 를 누르고 아래처럼 채웁니다.
   - **Project name**: `pdf-measure`
   - **Database Password**: **Generate a password** 를 누르고 나온 비밀번호를 메모해 둡니다. (앱에는 필요 없지만 나중에 필요할 수 있어요.)
   - **Region**: `Northeast Asia (Seoul)` (한국에서 가장 빠름)
4. **Create new project** 를 누르고 1~2분 기다리면 프로젝트 화면이 나옵니다.

## 2단계. 데이터베이스 표와 파일 보관함 만들기 (SQL 한 번 실행)

1. 왼쪽 메뉴에서 **SQL Editor** 를 누르고, **New query**(또는 `+`)를 누릅니다.
2. 저장소의 [`supabase/schema.sql`](../supabase/schema.sql) 파일을 열어 **내용 전체를 복사**해서 붙여넣습니다.
   (GitHub 에서 파일을 열고 오른쪽 위의 복사 버튼을 누르면 한 번에 복사돼요.)
3. 오른쪽 아래 **Run** 을 누릅니다. 아래쪽에 `Success. No rows returned` 가 나오면 끝입니다.
   - "destructive operation" 경고가 뜨면 **Run this query** 를 눌러도 됩니다. (예전 규칙을 지우고 다시 만드는 부분 때문이에요.)

이 SQL 이 만드는 것:
- `documents` 표: 도면 이름, 크기, 측정값, 마지막으로 연 시각
- `pdfs` 보관함: PDF 파일 (비공개, 파일 하나 50MB 까지)
- 보안 규칙: **로그인한 본인 것만** 읽고 쓸 수 있음 (다른 사람 도면은 보이지 않음)

## 3단계. 로그인 방식 설정

1. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** 로 갑니다. (화면에 따라 이름이 **Providers** 로만 보일 수 있어요.)
2. **Email** 이 켜져 있는지 확인합니다 (기본으로 켜져 있음).
3. **Confirm email** 을 **끕니다** → **Save**.
   - 끄면 가입하자마자 바로 쓸 수 있어요.
   - 켜 두면 가입할 때 확인 메일이 가는데, Supabase 기본 메일은 **프로젝트 팀원(나) 주소로만, 시간당 2통**까지 보내져서 다른 사람은 가입 확인을 못 받아요.
4. 같은 Authentication 메뉴의 **URL Configuration** 으로 가서:
   - **Site URL** 을 `https://pdf-measure-three.vercel.app` 로 바꾸고 **Save**
   - **Redirect URLs** 에 **Add URL** 로 `https://pdf-measure-three.vercel.app` 를 추가
   - (비밀번호 재설정 메일의 링크가 이 앱으로 돌아오게 하는 설정이에요.)

## 4단계. 앱에 넣을 값 두 개 복사하기

1. 프로젝트 화면 위쪽의 **Connect** 버튼을 누릅니다.
   **Connect to your project** 창이 열리고 패키지 설치, 파일 추가 같은 단계가 나오는데 **따라 하지 않아도 됩니다.**
   (앱 코드는 이미 준비되어 있어요. 이 창에서는 값만 복사합니다.)
2. **Framework** 의 `Next.js` 를 **React** 로 바꿉니다. Variant 가 보이면 **Vite** 를 고릅니다.
3. 아래로 내려 **Add files** 단계의 첫 번째 탭 **`.env.local`** 을 누르면 이런 두 줄이 보입니다.
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```
   5단계에서 `=` 앞은 Key, `=` 뒤는 Value 로 그대로 넣으면 됩니다.
   - Framework 를 바꾸지 않아 이름이 `NEXT_PUBLIC_…` 으로 나와도 **값은 같습니다.** 값만 가져가세요.
   - 이 창 대신 **Project Settings → API Keys** 에서 **Publishable key** 를, **Project Settings → Data API** 에서 **Project URL** 을 복사해도 됩니다.
     (`anon` key 만 보이면 그것을 써도 됩니다. `eyJ` 로 시작해요.)

> ⚠️ **secret key**(`sb_secret_…`)나 **service_role** key 는 절대 앱에 넣지 마세요.
> 이 키는 모든 보안 규칙을 무시하는 관리자 열쇠입니다. Publishable key 는 브라우저에 공개되어도 괜찮도록 만들어진 키예요.

## 5단계. Vercel 에 값 넣고 다시 배포하기

1. [vercel.com](https://vercel.com) 에 로그인해 **pdf-measure** 프로젝트를 엽니다.
2. **Environment Variables** 페이지로 갑니다.
   - [이 링크](https://vercel.com/d?to=%2F%5Bteam%5D%2F%5Bproject%5D%2Fsettings%2Fenvironment-variables&title=Go+to+Environment+Variables)를 누르고 프로젝트로 **pdf-measure** 를 고르면 바로 열립니다.
   - 또는 프로젝트 왼쪽 메뉴의 **Environment Variables** 를 누릅니다.
   - Settings 안의 **Environments** 는 다른 페이지예요. 거기 있다면 주소창 끝의 `environments` 를 `environment-variables` 로 바꿔 Enter 를 누르세요.
3. 아래 두 개를 하나씩 추가합니다. (Key 에 이름, Value 에 4단계에서 복사한 값. Environments 는 전부 체크된 그대로)

   | Key | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Project URL (`https://….supabase.co`) |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable key (`sb_publishable_…`) |

   이름의 글자 하나라도 틀리면 동작하지 않아요. 위 표에서 복사해서 붙여넣는 것을 추천합니다.
4. **Save** 를 누릅니다.
5. **환경 변수는 새로 빌드해야 반영됩니다.** 위쪽 **Deployments** 로 가서 맨 위 배포의 오른쪽 **⋯** 메뉴 → **Redeploy** → **Redeploy** 를 누릅니다.
6. 1분쯤 뒤 상태가 **Ready** 가 되면 끝입니다.

## 6단계. 확인하기

1. https://pdf-measure-three.vercel.app 를 열고 새로고침합니다.
2. 홈 화면 위쪽에 **"로그인하면 도면과 측정값이 서버에 저장돼요"** 상자가 보이면 연결된 거예요.
3. **회원가입** 탭에서 이메일과 비밀번호(6자 이상)를 넣고 **가입하고 시작하기** 를 누릅니다.
4. 오른쪽 위에 내 이메일이 보이면 로그인된 상태입니다.
5. 전에 이 브라우저에 저장해 둔 도면이 있으면 노란 상자의 **서버로 옮기기** 를 누르세요.
   서버로 옮긴 뒤 브라우저의 사본은 지워집니다.
6. 도면을 열고 측정해 보세요. 툴바 오른쪽에 **서버에 저장됨** 이 보이면 저장된 거예요.
7. 다른 브라우저나 시크릿 창에서 같은 계정으로 로그인해 도면과 측정값이 보이는지 확인합니다.

Supabase 대시보드에서도 볼 수 있어요: **Table Editor → documents** (측정값), **Storage → pdfs** (PDF 파일), **Authentication → Users** (가입한 사람).

---

## (선택) 나만 또는 우리 팀만 쓰게 하기

앱 주소를 아는 사람은 누구나 가입할 수 있어요. 쓸 사람 계정을 다 만든 뒤에는 가입을 막아 두는 것을 추천합니다.

1. **Authentication → Sign In / Providers** 에서 **Allow new users to sign up** 을 끄고 **Save**.
2. 나중에 팀원을 추가할 때는 **Authentication → Users → Add user → Create new user** 에서
   이메일과 비밀번호를 정해 직접 만들어 주면 됩니다. (**Auto Confirm User** 체크)

각자 자기 도면만 보입니다. 같은 도면을 여러 사람이 함께 보는 공유 기능은 아직 없어요.

---

## 문제가 생기면

| 증상 | 확인할 것 |
| --- | --- |
| 홈에 로그인 상자가 안 보임 | Vercel 환경 변수 이름이 정확한지, 넣은 뒤 **Redeploy** 했는지 |
| "서버에 연결하지 못했어요" | 인터넷 연결, Supabase 프로젝트가 일시 중지됐는지 (대시보드에서 **Resume project**) |
| "이메일 또는 비밀번호가 맞지 않아요" | 비밀번호 확인. 잊었으면 **비밀번호를 잊었어요** (메일은 프로젝트 팀원 주소로만 가요) |
| "가입 확인 메일의 링크를 먼저 눌러 주세요" | 3단계에서 **Confirm email** 을 껐는지 |
| 도면이 저장되지 않고 **서버 저장 실패** 표시 | 2단계 SQL 을 실행했는지 (다시 실행해도 괜찮아요) |
| "PDF 파일은 서버에 올리지 못했어요" | 50MB 넘는 PDF. 측정값은 저장되며, 다른 컴퓨터에서는 같은 PDF 를 직접 열면 이어져요 |
| 다른 사람이 가입했어요 | **Authentication → Users** 에서 지우고, 위의 "나만 쓰게 하기" 설정 |

## 저장되는 방식 (참고)

- 로그인하면 도면 PDF 는 Supabase Storage 의 `pdfs` 보관함, 측정값·마크업·축척은 `documents` 표에 저장됩니다.
- 같은 컴퓨터에서 다시 열 때 빠르도록 서버에서 받은 PDF 사본을 브라우저에 임시로 둡니다.
  브라우저 기록을 지워도 서버에서 다시 받아 오니 괜찮아요.
- 열려 있던 탭 목록만은 컴퓨터마다 따로 기억합니다.
- 로그인하지 않고 쓰면 예전처럼 이 브라우저에만 저장됩니다.

## 내 컴퓨터에서 개발할 때

프로젝트 폴더에 `.env.local` 파일을 만들고 4단계의 두 값을 넣은 뒤 `npm run dev` 를 실행합니다.
(`.env.example` 을 복사해서 쓰면 돼요. `.env.local` 은 GitHub 에 올라가지 않습니다.)

```
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
