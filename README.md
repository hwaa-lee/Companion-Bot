# Companion-Bot

> Claude 기반 AI 컴패니언 — 텔레그램 봇 + AI 문서 관리(PKM)

[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

텔레그램에서 대화하고, 파일을 던지면 AI가 자동으로 분류·정리·검색해주는 개인/사내용 AI 비서입니다.

---

## 핵심 기능

**AI 대화**
- Claude Opus 4 / Sonnet 4 / Haiku 3.5 — 모델 자유 전환
- Extended Thinking 지원 (사고 과정 활용)
- 25+ 도구 자동 호출 (파일, 웹, 일정, 메모리, PKM 등)
- 이미지 분석 (사진 보내면 바로 분석)

**AI-PKM 문서 관리**
- PARA 방법론 기반 자동 분류 (Project / Area / Resource / Archive)
- 2단계 AI 분류기: Haiku 배치(빠른) → Sonnet 정밀(정확)
- 파일 던지기만 하면 끝 — 분류, 태깅, 폴더 이동, 관련 노트 링킹 자동
- PDF/PPTX/XLSX 바이너리 텍스트 추출
- 하이브리드 검색 (벡터 + 키워드 + trigram)
- Obsidian 호환 ([[wikilink]], frontmatter)

**시맨틱 메모리**
- 로컬 임베딩 (@xenova/transformers) — API 호출 없음
- 대화 내용 자동 기억 + 관련 기억 검색
- 한국어 최적화 trigram tokenizer

**일정/알림**
- 자연어 리마인더 ("10분 뒤에 알려줘")
- Google Calendar 연동
- Cron 반복 작업
- 브리핑/하트비트 — 주기적 자동 알림

---

## 빠른 시작

**요구사항:** Node.js 18+

```bash
npm install -g companionbot
companionbot
```

첫 실행 시 안내에 따라:
1. Telegram Bot Token 입력 ([@BotFather](https://t.me/BotFather)에서 생성)
2. Anthropic API Key 입력 ([console.anthropic.com](https://console.anthropic.com))
3. 텔레그램에서 봇에게 `/start`

### 사내 배포 시

`config.yaml`에서 접근 제어 설정:

```yaml
telegram:
  # 허용할 chatId만 지정 (빈 배열이면 모든 사용자 허용)
  allowedChatIds: [123456789, 987654321]

pkm:
  enabled: true
```

---

## AI-PKM 문서 관리

### 작동 방식

```
사용자                           Companion-Bot
  │                                    │
  ├─ 텔레그램으로 파일 전송 ──────────→ _Inbox/ 저장
  │                                    │
  │                            Haiku 배치 분류 (Stage 1)
  │                              ↓ 신뢰도 < 0.8
  │                            Sonnet 정밀 분류 (Stage 2)
  │                                    │
  │                            frontmatter 생성
  │                            PARA 폴더로 이동
  │                            관련 노트 링킹
  │                            벡터 인덱싱
  │                                    │
  ├─ "OO 관련 자료 찾아줘" ──────────→ 하이브리드 검색
  ├─ "프로젝트 만들어줘" ─────────────→ 프로젝트 CRUD
  └─ 폴더에 파일 직접 넣기 ──────────→ watcher 자동 감지
```

### 폴더 구조 (PARA)

```
~/.companionbot/pkm/
├── _Inbox/       ← 파일을 여기에 넣으면 자동 분류
├── _Assets/      ← 바이너리 원본 저장
├── 1_Project/    ← 진행 중인 프로젝트 (사람이 생성)
│   ├── PoC_KSNET/
│   └── FLAP_Phase2/
├── 2_Area/       ← 지속 관리 영역 (AI 자동 정리)
│   ├── DevOps/
│   └── 건강관리/
├── 3_Resource/   ← 참고 자료 (AI 자동 정리)
│   ├── 기술문서/
│   └── 독서노트/
└── 4_Archive/    ← 완료/보관 (AI 자동 정리)
```

- **Project**: 사람이 만들고, 마감이 있는 일
- **Area/Resource/Archive**: AI가 하위폴더를 자동 생성하고 문서를 분류

### PKM 명령어 (텔레그램에서)

```
파일 보내기           → 자동으로 _Inbox/에 저장 → 자동 분류
"정리해줘"           → 인박스 전체 분류 실행
"프로젝트 만들어줘"    → 프로젝트 생성
"OO 관련 자료 찾아줘"  → PKM 문서 검색
```

---

## CLI 명령어

```bash
companionbot              # 봇 시작
companionbot setup        # 설정 마법사
companionbot setup telegram  # Telegram 토큰
companionbot setup anthropic # API 키
companionbot setup weather   # 날씨 API
companionbot setup calendar  # Google Calendar
companionbot setup brave     # 웹 검색 API
companionbot setup pkm       # PKM 상태 확인
companionbot -n           # 비대화형 모드 (CI/CD용)
```

## 텔레그램 명령어

| 명령어 | 설명 |
|--------|------|
| `/start` | 봇 시작 |
| `/help` | 도움말 |
| `/model` | AI 모델 변경 (haiku/sonnet/opus) |
| `/compact` | 대화 정리 (토큰 절약) |
| `/memory` | 최근 기억 보기 |
| `/health` | 봇 상태 확인 |
| `/reset` | 대화 초기화 |
| `/pin <메시지>` | 메시지 고정 (항상 컨텍스트에 포함) |
| `/pins` | 고정 목록 |
| `/unpin <번호>` | 고정 해제 |
| `/calendar_setup` | Google Calendar 연동 |
| `/briefing` | 브리핑 설정/실행 |

자연어로도 가능:

```
"하이쿠로 바꿔줘"      → 모델 변경
"10분 뒤에 알려줘"     → 리마인더
"서울 날씨 어때?"      → 날씨 조회
"React 19 검색해줘"    → 웹 검색
```

---

## 도구 목록 (25+)

| 카테고리 | 도구 | 설명 |
|---------|------|------|
| **파일** | read_file, write_file, edit_file, list_directory | 파일 읽기/쓰기/편집/탐색 |
| **시스템** | run_command | 셸 명령 실행 (화이트리스트) |
| **메모리** | save_memory, memory_search, memory_reindex | 기억 저장/검색/재인덱싱 |
| **PKM** | pkm_inbox, pkm_search, pkm_project, pkm_init | 문서 분류/검색/프로젝트 관리 |
| **웹** | web_search, web_fetch | 웹 검색 (Brave), 페이지 가져오기 |
| **일정** | calendar, reminder, cron | 일정/알림/반복작업 |
| **알림** | briefing, heartbeat | 브리핑/하트비트 |
| **세션** | manage_session, change_model, save_persona | 세션/모델/페르소나 관리 |
| **에이전트** | agent | 다단계 자율 작업 |

---

## 설정 (config.yaml)

`config.yaml`로 세부 동작을 조정할 수 있습니다. `config.example.yaml`을 복사해서 사용하세요.

주요 설정:

```yaml
# AI 모델
model:
  default: opus        # opus, sonnet, haiku
  thinking: medium     # off, low, medium, high

# 접근 제어 (사내 배포 시 필수)
telegram:
  allowedChatIds: []   # 빈 배열 = 모든 사용자 허용

# PKM 문서 관리
pkm:
  enabled: false       # true로 변경 시 PKM 활성화
  classify:
    batchSize: 10
    confidenceThreshold: 0.8
    watcherDebounceMs: 2000

# 메모리
memory:
  cacheTtlMinutes: 5
  recentDays: 30
  searchTopK: 5
```

---

## 아키텍처

```
src/
├── telegram/     # Grammy 봇 + 핸들러
├── ai/           # Claude API 호출 + Extended Thinking
├── tools/        # 25+ 도구 정의 + 실행기
├── pkm/          # AI-PKM 모듈
│   ├── classifier.ts   # 2단계 AI 분류기
│   ├── extract.ts      # 바이너리 텍스트 추출
│   ├── frontmatter.ts  # YAML frontmatter 파서
│   ├── inbox.ts        # 인박스 오케스트레이터
│   ├── linker.ts       # 관련 노트 링커
│   ├── project.ts      # 프로젝트 CRUD
│   └── watcher.ts      # _Inbox/ 파일 감시
├── memory/       # 벡터 저장소 + FTS5 + 하이브리드 검색
├── session/      # 세션/히스토리 관리
├── config/       # config.yaml 로더
├── workspace/    # 워크스페이스 경로 관리
├── calendar/     # Google Calendar 연동
├── agents/       # 자율 에이전트
├── reminders/    # 리마인더
├── briefing/     # 브리핑
├── heartbeat/    # 하트비트
├── cron/         # 크론
└── cli/          # CLI 엔트리포인트 + 설정 마법사
```

기술 스택:
- **Runtime**: Node.js 18+ (ESM)
- **Language**: TypeScript
- **Bot Framework**: Grammy
- **AI**: Claude API (Anthropic SDK)
- **Embeddings**: @xenova/transformers (로컬)
- **DB**: better-sqlite3 (벡터 + FTS5)
- **Secrets**: keytar (OS 키체인)

---

## 상시 실행

```bash
npm install -g pm2
pm2 start companionbot --name companion-bot
pm2 startup && pm2 save
```

## 보안

- API 키는 OS 키체인에 저장 (macOS Keychain / Windows Credential Manager / Linux libsecret)
- `telegram.allowedChatIds`로 접근 제어
- 파일명 path traversal 방지
- 파일 접근 경로 검증
- 명령어 화이트리스트
- SSRF 방지

## 트러블슈팅

**봇이 응답 안 할 때**
1. API 키 확인: `companionbot setup anthropic`
2. 로그 확인: `tail -f /tmp/companionbot.log`

**Linux 설치 오류**
```bash
sudo apt-get install libsecret-1-dev  # Debian/Ubuntu
```

**초기화**
```bash
rm -rf ~/.companionbot && companionbot
```

---

## 라이선스

[MIT](LICENSE)

**Issues**: [github.com/hwaa-lee/Companion-Bot/issues](https://github.com/hwaa-lee/Companion-Bot/issues)
