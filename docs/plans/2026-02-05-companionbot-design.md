# CompanionBot 설계 문서

> 작성일: 2026-02-05

## 개요

**CompanionBot**은 개인의 작업 환경(로컬 문서, Slack, Notion, GitHub, Google Drive)을 메모리로 활용하는 AI 동반자입니다. 텔레그램을 통해 대화하며, 하루가 지나도 맥락이 유지되는 장기 기억 기능을 제공합니다.

### 비전

```
Phase 1: CompanionBot (개인용)
- 나만의 AI 동반자
- 내 작업 환경을 기억하고 맥락을 유지

Phase 2: CompanionBot for Cooperation (협업용)
- 팀과 함께 쓰는 지식 동반자
- GitHub 기반 MVP로 시작
```

---

## 아키텍처

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            메모리 소스 (화이트리스트)                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │  로컬    │ │  Slack   │ │  Notion  │ │  GitHub  │ │  Google  │      │
│  │  파일    │ │          │ │          │ │          │ │  Drive   │      │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘      │
│       └────────────┴────────────┴────────────┴────────────┘            │
│                                 │                                       │
│                    ┌────────────▼────────────┐                         │
│                    │    Source Connector     │ (공통 인터페이스)         │
│                    └────────────┬────────────┘                         │
└─────────────────────────────────┼───────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────┐
│                         CompanionBot Core                               │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                     인덱싱 & 임베딩                               │   │
│  │  청크 분할 → 임베딩 (auto) → SQLite 저장                          │   │
│  │              ↓                                                   │   │
│  │     로컬 > OpenAI > Gemini (fallback 순서)                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    장기 컨텍스트 (세션)                           │   │
│  │  대화 기록 관리 ↔ JSONL 파일 (openclaw 방식)                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                       AI 대화                                    │   │
│  │  벡터 검색 → Claude API → 응답 생성                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────────────────┐
│                          Telegram Bot                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 기술 스택

| 항목 | 선택 | 이유 |
|------|------|------|
| 언어 | TypeScript | openclaw와 동일, 타입 안전성 |
| 런타임 | Node.js 22+ | 최신 LTS, 내장 SQLite 지원 |
| 텔레그램 | grammy | 현대적, TypeScript 친화적 |
| 임베딩(로컬) | node-llama-cpp | openclaw와 동일 |
| DB | better-sqlite3 또는 내장 sqlite | 빠르고 간단 |
| HTTP | fetch (내장) | 외부 의존성 최소화 |
| 키체인 | keytar | OS 키체인 접근 |

---

## 프로젝트 구조

```
companionbot/
├── package.json
├── tsconfig.json
├── .env.example              # 환경변수 예시 (실제 값 X)
├── README.md
├── SECURITY.md               # 보안 설명 문서
│
├── src/
│   ├── index.ts              # 진입점
│   │
│   ├── config/
│   │   ├── index.ts          # 설정 로드
│   │   └── secrets.ts        # OS 키체인 접근
│   │
│   ├── sources/              # 메모리 소스 커넥터
│   │   ├── types.ts          # 공통 인터페이스
│   │   ├── local.ts          # 로컬 파일
│   │   ├── slack.ts
│   │   ├── notion.ts
│   │   ├── github.ts
│   │   └── gdrive.ts
│   │
│   ├── memory/               # 핵심 메모리 시스템
│   │   ├── index.ts          # 메인 매니저
│   │   ├── chunker.ts        # 텍스트 청크 분할
│   │   ├── embeddings.ts     # 임베딩 (auto 모드)
│   │   ├── store.ts          # SQLite 저장
│   │   └── search.ts         # 벡터 검색
│   │
│   ├── session/              # 장기 컨텍스트
│   │   ├── index.ts
│   │   └── history.ts        # JSONL 저장/로드
│   │
│   ├── ai/                   # AI 대화
│   │   ├── index.ts
│   │   └── claude.ts         # Claude API
│   │
│   └── telegram/             # 텔레그램 봇
│       ├── index.ts
│       └── handlers.ts       # 메시지 핸들러
│
├── data/                     # 런타임 데이터 (gitignore)
│   ├── memory.db             # SQLite
│   └── sessions/             # JSONL 파일들
│
└── docs/
    └── security.md           # 상세 보안 문서
```

---

## 보안 설계

### 1. 토큰 저장: OS 키체인

모든 API 토큰은 OS 키체인(macOS Keychain / Windows Credential Manager)에 암호화되어 저장됩니다. 파일 시스템에 평문으로 저장되지 않습니다.

### 2. 서비스 접근: 화이트리스트 필수

사용자가 명시적으로 지정한 채널/폴더/레포만 접근 가능합니다.

```yaml
sources:
  slack:
    channels: ["dev-team", "general"]  # 이것만 접근 가능
  github:
    repos: ["my-org/docs"]  # 이것만 접근 가능
```

### 3. 데이터 외부 전송: 정책 문서화

Anthropic API는 사용자 데이터로 모델 학습을 하지 않습니다 (API Terms of Service). 이 정책을 SECURITY.md에 명시합니다.

### 4. 코드 복잡성: 최소화 + 문서화

- 간결한 코드 (~15개 파일)
- 보안 문서 제공
- 오픈소스로 투명성 확보

---

## 구현 로드맵

### Phase 1: CompanionBot (개인용)

| Step | 내용 | 결과물 |
|------|------|--------|
| 1 | 뼈대 | 텔레그램 봇 + Claude 연결, 단순 대화 |
| 2 | 기억의 시작 | 로컬 파일 인덱싱, 임베딩, SQLite 저장 |
| 3 | 검색 | 벡터 검색, 문서 기반 답변 |
| 4 | 장기 기억 | 세션 저장 (JSONL), 컨텍스트 유지 |
| 5 | 보안 마무리 | OS 키체인, 화이트리스트, SECURITY.md |
| 6 | 소스 확장 | GitHub, Slack, Notion, GDrive 커넥터 |

### Phase 2 MVP: CompanionBot for Cooperation

| Step | 내용 | 결과물 |
|------|------|--------|
| 7 | 협업 기반 | GitHub 소스만 사용, 다중 사용자 세션 분리 |

---

## 메모리 소스별 인증

| 소스 | 인증 방식 |
|------|----------|
| 로컬 파일 | 없음 (로컬) |
| Slack | Bot Token |
| Notion | Integration Token |
| GitHub | Personal Access Token |
| Google Drive | OAuth |

---

## AI 구성

### 대화 모델
- **Claude** (Anthropic)
- 사용자가 API 키 설정

### 임베딩 모델 (auto 모드)
1. **로컬** (기본): node-llama-cpp + embeddinggemma-300M
2. **OpenAI** (fallback): text-embedding-3-small
3. **Gemini** (fallback): Google 임베딩 API

사용자는 Claude 키만 설정하면 되고, 임베딩은 자동으로 최적 옵션 선택.

---

## 참고

이 설계는 [openclaw](https://github.com/openclaw/openclaw)의 메모리 관리 방식을 참고했습니다.

주요 차용 개념:
- SQLite + JSONL 기반 저장
- 청크 분할 및 임베딩
- auto 모드 임베딩 (로컬 > OpenAI > Gemini fallback)
- 세션 기반 장기 컨텍스트
